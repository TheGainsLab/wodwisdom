-- Paid periods: the payments record (founder decisions, 2026-11-22).
--
-- Engine months unlocked must equal the number of PAID BILLING PERIODS across
-- a person's whole history — every subscription, every Stripe customer record
-- (each re-subscribe through checkout creates a new customer, and
-- profiles.stripe_customer_id holds only the latest). Until now the count was
-- re-derived from the CURRENT subscription's invoices only, so someone who
-- paid three months, left and paid again stayed at three; and a refund's
-- month was handed back by the next nightly recount, because nothing
-- remembered the refund.
--
-- paid_periods: one row per paid Stripe invoice of a subscription.
--   counts / count_reason  is this invoice a new billing period? Decided by
--     the one rule in supabase/functions/_shared/paid-periods.ts: a renewal;
--     the first paid invoice of its subscription; or a paid plan change at
--     least 15 days after the person's last counted period began.
--   months                 1 (monthly) or 3 (quarterly) when it counts, else 0.
--   includes_engine / includes_programming   what the period's plan included.
--     Only periods that include the Engine unlock Engine months.
--   refunded_at            set when the invoice's charge was fully refunded.
--     A refunded row is left out of every recount.
--   user_id                null until the payer is tied to an account (a
--     checkout made before the account existed); rows are also found by
--     stripe_customer_id.
--
-- This migration records NOTHING and changes nobody's months. The table
-- starts empty; stripe-webhook fills it from the first invoice paid after
-- deploy. Loading history is a separate, founder-approved step.
--
-- ── LOADING HISTORY (for whoever writes the loader; nothing here runs it) ──
-- Input: every PAID invoice of every subscription from a Stripe export, all
-- customers. Group them per PERSON (the app account: match the invoice's
-- customer id to profiles.stripe_customer_id, else its customer email to
-- profiles.email case-insensitively; one person may have several customer
-- ids), pass each person's whole list to buildHistoryRows()
-- (_shared/paid-periods.ts), have the founder review the output, then write
-- each row with record_paid_period(). Per invoice the loader needs:
--   id                     the invoice id (in_...): the primary key here.
--   customer               the customer id (cus_...).
--   customer_email         as on the invoice.
--   subscription           the subscription id (sub_...). No subscription =
--                          not a period; leave it out.
--   created                when the invoice was created; orders the history.
--   status_transitions.paid_at   when it was paid (else created).
--   the period line's period.start / period.end   the period it bills. The
--                          period line is the line item that is NOT a
--                          proration; an invoice whose lines are ALL
--                          prorations has no period of its own
--                          (has_period_line = false).
--   amount_paid, currency.
--   billing_reason         subscription_create / subscription_cycle /
--                          subscription_update / ...
--   cadence                from the period line's price: recurring.interval
--                          month x1 = monthly; month x3 (or quarter x1) =
--                          quarterly; anything else = other.
--   includes_engine / includes_programming   from the period line's PRICE,
--                          the way the webhook reads it
--                          (_shared/plan-entitlements.ts): price metadata
--                          `entitlements` (comma list) if present, else price
--                          metadata `plan` looked up in PLAN_ENTITLEMENTS. So
--                          the export must carry each line's price id and
--                          that price's metadata. A price that has since been
--                          archived still returns its metadata from Stripe by
--                          id; a price with NO such metadata (older than the
--                          app, or a Dashboard-made subscription) resolves to
--                          nothing and must be mapped by hand from its
--                          product, per price id, before the load — do not
--                          default it either way.
--   refunded               whether the invoice's charge was FULLY refunded
--                          (charge.amount_refunded >= charge.amount), and
--                          when. The invoice itself does not say; it comes
--                          from the charge (or a refunds export).
--
-- Idempotent + SQL-editor-ready.

BEGIN;

-- ─── 1. The table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS paid_periods (
  stripe_invoice_id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_email text,
  stripe_customer_id text,
  stripe_subscription_id text,
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  amount_paid integer,
  currency text,
  billing_reason text,
  cadence text NOT NULL DEFAULT 'other' CHECK (cadence IN ('monthly', 'quarterly', 'other')),
  includes_engine boolean NOT NULL DEFAULT false,
  includes_programming boolean NOT NULL DEFAULT false,
  counts boolean NOT NULL DEFAULT false,
  count_reason text NOT NULL DEFAULT 'zero_or_other' CHECK (count_reason IN (
    'first_of_subscription', 'cycle', 'plan_change_after_15d', 'plan_change_within_15d',
    'plan_change_no_prior', 'zero_or_other', 'refunded_unrecorded')),
  months integer NOT NULL DEFAULT 0 CHECK (months IN (0, 1, 3)),
  refunded_at timestamptz,
  source text NOT NULL DEFAULT 'webhook' CHECK (source IN ('webhook', 'backfill')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- a row that does not count carries no months
  CONSTRAINT paid_periods_months_only_when_counted CHECK (counts OR months = 0)
);

CREATE INDEX IF NOT EXISTS idx_paid_periods_user ON paid_periods (user_id, period_start);
CREATE INDEX IF NOT EXISTS idx_paid_periods_subscription ON paid_periods (stripe_subscription_id, period_start);
CREATE INDEX IF NOT EXISTS idx_paid_periods_customer ON paid_periods (stripe_customer_id);

ALTER TABLE paid_periods ENABLE ROW LEVEL SECURITY;
-- No end-user policies: service role and SECURITY DEFINER functions only.
REVOKE ALL ON paid_periods FROM anon, authenticated;
GRANT ALL ON paid_periods TO service_role;

COMMENT ON TABLE paid_periods IS
  'One row per paid Stripe subscription invoice: whether it is a new billing period (counts), how many months it buys, what the plan included, and whether it was refunded. The source for Engine months unlocked across a person''s whole history. Written by stripe-webhook via record_paid_period; history loaded separately.';

-- ─── 2. Record one invoice (idempotent) ──────────────────────────────
-- Recording the same invoice again can only ADD knowledge:
--   * counts never goes from true to false, and months never down;
--   * refunded_at is never cleared;
--   * a missing user_id (and any other missing field) is filled in.
-- So a re-delivered event, a retry that could not read Stripe, or the history
-- load meeting a row the webhook already wrote can never take a period away.
CREATE OR REPLACE FUNCTION public.record_paid_period(p_row jsonb)
RETURNS paid_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id text := NULLIF(p_row ->> 'stripe_invoice_id', '');
  v_counts boolean := COALESCE((p_row ->> 'counts')::boolean, false);
  v_months integer := COALESCE((p_row ->> 'months')::integer, 0);
  v_out paid_periods;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'record_paid_period: stripe_invoice_id is required';
  END IF;
  IF NOT v_counts THEN
    v_months := 0;
  END IF;

  INSERT INTO paid_periods AS pp (
    stripe_invoice_id, user_id, customer_email, stripe_customer_id, stripe_subscription_id,
    paid_at, period_start, period_end, amount_paid, currency, billing_reason,
    cadence, includes_engine, includes_programming, counts, count_reason, months,
    refunded_at, source
  ) VALUES (
    v_id,
    NULLIF(p_row ->> 'user_id', '')::uuid,
    NULLIF(p_row ->> 'customer_email', ''),
    NULLIF(p_row ->> 'stripe_customer_id', ''),
    NULLIF(p_row ->> 'stripe_subscription_id', ''),
    NULLIF(p_row ->> 'paid_at', '')::timestamptz,
    NULLIF(p_row ->> 'period_start', '')::timestamptz,
    NULLIF(p_row ->> 'period_end', '')::timestamptz,
    NULLIF(p_row ->> 'amount_paid', '')::integer,
    NULLIF(p_row ->> 'currency', ''),
    NULLIF(p_row ->> 'billing_reason', ''),
    COALESCE(NULLIF(p_row ->> 'cadence', ''), 'other'),
    COALESCE((p_row ->> 'includes_engine')::boolean, false),
    COALESCE((p_row ->> 'includes_programming')::boolean, false),
    v_counts,
    COALESCE(NULLIF(p_row ->> 'count_reason', ''), 'zero_or_other'),
    v_months,
    NULLIF(p_row ->> 'refunded_at', '')::timestamptz,
    COALESCE(NULLIF(p_row ->> 'source', ''), 'webhook')
  )
  ON CONFLICT (stripe_invoice_id) DO UPDATE SET
    user_id = COALESCE(pp.user_id, EXCLUDED.user_id),
    customer_email = COALESCE(pp.customer_email, EXCLUDED.customer_email),
    stripe_customer_id = COALESCE(pp.stripe_customer_id, EXCLUDED.stripe_customer_id),
    stripe_subscription_id = COALESCE(pp.stripe_subscription_id, EXCLUDED.stripe_subscription_id),
    paid_at = COALESCE(pp.paid_at, EXCLUDED.paid_at),
    period_start = COALESCE(pp.period_start, EXCLUDED.period_start),
    period_end = COALESCE(pp.period_end, EXCLUDED.period_end),
    amount_paid = COALESCE(pp.amount_paid, EXCLUDED.amount_paid),
    currency = COALESCE(pp.currency, EXCLUDED.currency),
    billing_reason = COALESCE(pp.billing_reason, EXCLUDED.billing_reason),
    -- a period that newly counts brings its own cadence, reason and months
    cadence = CASE WHEN NOT pp.counts AND EXCLUDED.counts THEN EXCLUDED.cadence
                   WHEN pp.cadence = 'other' THEN EXCLUDED.cadence ELSE pp.cadence END,
    count_reason = CASE WHEN NOT pp.counts AND EXCLUDED.counts THEN EXCLUDED.count_reason ELSE pp.count_reason END,
    counts = pp.counts OR EXCLUDED.counts,
    months = GREATEST(pp.months, EXCLUDED.months),
    includes_engine = pp.includes_engine OR EXCLUDED.includes_engine,
    includes_programming = pp.includes_programming OR EXCLUDED.includes_programming,
    refunded_at = COALESCE(pp.refunded_at, EXCLUDED.refunded_at)
    -- source and created_at stay as first written
  RETURNING pp.* INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.record_paid_period(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_paid_period(jsonb) TO service_role;

-- ─── 3. A person's periods ───────────────────────────────────────────
-- Every row of one person: by account, and — for rows not yet tied to an
-- account — by the Stripe customer id given or the one on their profile.
-- Returns ALL rows (uncounted and refunded too): the caller filters, because
-- a refunded or uncounted row still tells it to leave that invoice out.
CREATE OR REPLACE FUNCTION public.paid_periods_for_person(p_user_id uuid, p_stripe_customer_id text)
RETURNS SETOF paid_periods
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT pp.*
  FROM paid_periods pp
  WHERE (p_user_id IS NOT NULL AND pp.user_id = p_user_id)
     OR (pp.user_id IS NULL AND pp.stripe_customer_id IS NOT NULL AND (
          pp.stripe_customer_id = p_stripe_customer_id
          OR pp.stripe_customer_id = (SELECT stripe_customer_id FROM profiles WHERE id = p_user_id)
        ))
     -- a row tied to an account is also found by its customer id when the
     -- caller does not know the account (an invoice event for a customer no
     -- profile points at any more)
     OR (p_user_id IS NULL AND p_stripe_customer_id IS NOT NULL AND pp.stripe_customer_id = p_stripe_customer_id)
  ORDER BY pp.period_start NULLS FIRST, pp.stripe_invoice_id;
$$;

REVOKE ALL ON FUNCTION public.paid_periods_for_person(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paid_periods_for_person(uuid, text) TO service_role;

-- ─── 4. A full refund ────────────────────────────────────────────────
-- Marks the invoice's row refunded and takes its months back, in one
-- transaction, ONCE: a row already refunded changes nothing, so a re-delivered
-- charge.refunded event cannot take a second month. This is the only place
-- engine_months_unlocked is ever lowered by the billing system.
--   p_lower_by  the months to take back, worked out by the caller (a quarter
--               refunded in its first month has released one month, not
--               three). Clamped to 0..row.months; null = the row's months.
--   p_user_id   whose months, when the row is not tied to an account yet.
-- Months are lowered only if the row counted, included the Engine and carries
-- months. Floored at 0.
CREATE OR REPLACE FUNCTION public.refund_paid_period(p_invoice_id text, p_lower_by integer, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row paid_periods;
  v_user uuid;
  v_lower integer := 0;
  v_before integer;
  v_after integer;
BEGIN
  SELECT * INTO v_row FROM paid_periods WHERE stripe_invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  IF v_row.refunded_at IS NOT NULL THEN
    RETURN jsonb_build_object('found', true, 'newly_refunded', false, 'lowered_by', 0);
  END IF;

  v_user := COALESCE(v_row.user_id, p_user_id);
  UPDATE paid_periods SET refunded_at = now(), user_id = v_user WHERE stripe_invoice_id = p_invoice_id;

  IF v_row.counts AND v_row.includes_engine AND v_row.months > 0 AND v_user IS NOT NULL THEN
    v_lower := LEAST(GREATEST(COALESCE(p_lower_by, v_row.months), 0), v_row.months);
    IF v_lower > 0 THEN
      SELECT COALESCE(engine_months_unlocked, 0) INTO v_before
      FROM athlete_profiles WHERE user_id = v_user FOR UPDATE;
      IF FOUND THEN
        v_after := GREATEST(v_before - v_lower, 0);
        UPDATE athlete_profiles SET engine_months_unlocked = v_after WHERE user_id = v_user;
      ELSE
        v_lower := 0;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'newly_refunded', true,
    'user_id', v_user,
    'counts', v_row.counts,
    'includes_engine', v_row.includes_engine,
    'months', v_row.months,
    'lowered_by', v_lower,
    'before', v_before,
    'after', v_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refund_paid_period(text, integer, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_paid_period(text, integer, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
