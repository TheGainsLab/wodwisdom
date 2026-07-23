-- billing_events: cancellation-intent event types.
--
-- cancel_scheduled  = cancel_at_period_end flipped true (the earliest,
--                     clearest churn-intent signal — weeks of warning).
-- cancel_unscheduled = the flip back (a confirmed save).
--
-- Written by stripe-webhook's customer.subscription.updated handler on the
-- transition (previous_attributes-guarded, so incidental updates never
-- re-record). Powers the founder's scheduled-cancellation dossier alerts and
-- future churn-intent reporting.

ALTER TABLE billing_events DROP CONSTRAINT IF EXISTS billing_events_event_type_check;
ALTER TABLE billing_events
  ADD CONSTRAINT billing_events_event_type_check
  CHECK (event_type IN (
    'purchased', 'canceled', 'payment_churn', 'payment_failed',
    'refunded', 'dispute', 'plan_changed',
    'cancel_scheduled', 'cancel_unscheduled'
  ));
