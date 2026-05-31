/**
 * Scheduled job: runs daily to handle mid-quarter program generation and Engine unlocks.
 *
 * For quarterly subscribers:
 *   - Programming: if 30+ days since last month generated, trigger next month
 *   - Engine: if 30+ days since last unlock, increment engine_months_unlocked
 *
 * Only processes quarterly users. Monthly users are handled by invoice.payment_succeeded.
 *
 * Deploy: supabase functions deploy monthly-generation-cron
 * Schedule via Supabase cron or external scheduler (e.g. daily at 06:00 UTC)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetch-with-timeout.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

// Gating is `verify_jwt = false` in config.toml + the function URL only being
// called by pg_cron (jobname='monthly-generation', daily 06:00 UTC). The
// previous custom bearer-check against Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
// silently 401'd every cron run because pg_cron's
// current_setting('supabase.service_role_key') no longer matches the env-var
// value injected into the function — Supabase shipped a parallel key
// generation (sb_secret_…) and the two are no longer byte-identical. Drift in
// the platform's key story is not something we want this cron to defend
// against; the request is intra-project anyway.
Deno.serve(async (_req) => {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const results: string[] = [];

  try {
    // Find all users with active subscriptions
    const { data: allEntitlements } = await supa
      .from("user_entitlements")
      .select("user_id, feature")
      .in("feature", ["programming", "engine"])
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString());

    if (!allEntitlements || allEntitlements.length === 0) {
      return new Response(JSON.stringify({ message: "No users to process", results }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Group by user
    const userFeatures = new Map<string, Set<string>>();
    for (const ent of allEntitlements) {
      if (!userFeatures.has(ent.user_id)) userFeatures.set(ent.user_id, new Set());
      userFeatures.get(ent.user_id)!.add(ent.feature);
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const [userId, features] of userFeatures) {
      // Check if user is on quarterly billing
      const { data: profile } = await supa
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", userId)
        .maybeSingle();

      if (!profile?.stripe_customer_id) continue;

      // Fetch active Stripe subscription for this customer.
      let sub: any = null;
      try {
        const subsResp = await fetchWithTimeout(
          `https://api.stripe.com/v1/subscriptions?customer=${profile.stripe_customer_id}&status=active&limit=1`,
          { headers: { "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":") } },
          15_000
        );
        if (subsResp.ok) {
          const subsData = await subsResp.json();
          sub = subsData.data?.[0] ?? null;
        }
      } catch {
        continue; // Skip on error
      }
      if (!sub) continue;

      const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
      const intervalCount = sub.items?.data?.[0]?.price?.recurring?.interval_count;
      const isQuarterly = (interval === "month" && intervalCount === 3);

      if (!isQuarterly) continue; // Only process quarterly users; monthly handled by webhook

      // Programming: check if due for next month
      if (features.has("programming")) {
        const { data: programs } = await supa
          .from("programs")
          .select("id, generated_months, updated_at")
          .eq("user_id", userId)
          .eq("source", "generated")
          .order("created_at", { ascending: false })
          .limit(1);

        if (programs && programs.length > 0) {
          const program = programs[0];
          const lastUpdated = new Date(program.updated_at || program.created_at);
          const daysSinceLastMonth = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);

          // Check we haven't exceeded 3 months per quarter
          // generated_months mod 3: if 0, we're at a quarter boundary (wait for payment)
          const monthsInCurrentQuarter = ((program.generated_months || 1) - 1) % 3 + 1;

          if (daysSinceLastMonth >= 30 && monthsInCurrentQuarter < 3) {
            const nextMonth = (program.generated_months || 1) + 1;
            results.push(`Programming: triggering month ${nextMonth} for user ${userId}`);

            try {
              await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/generate-next-month`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
                  "x-webhook-user-id": userId,
                },
                body: JSON.stringify({ program_id: program.id, user_id: userId }),
              }, 30_000);
            } catch (e) {
              results.push(`Programming: FAILED for user ${userId}: ${(e as Error).message}`);
            }
          }
        }
      }

      // Engine: compute entitled months from Stripe (current_period_start +
      // paid-invoice count) and raise engine_months_unlocked if behind.
      //
      // Previous "30 days since last_at" trigger was fragile: any artificial
      // last_at value (migration backfill, reconciler write, manual fix) could
      // drift from the true subscription anchor and cause premature or missed
      // unlocks. Stripe's period_start is the source of truth — fresh every run.
      //
      // Math: months_into_current_quarter = min(floor(days_since_period_start / 30) + 1, 3)
      //       entitled = (paid_invoice_count - 1) * 3 + months_into_current_quarter
      //       (capped at 36 to match the webhook ceiling)
      //
      // Only ever raises; never lowers — won't clobber an admin override.
      if (features.has("engine")) {
        const { data: athleteProfile } = await supa
          .from("athlete_profiles")
          .select("engine_months_unlocked")
          .eq("user_id", userId)
          .maybeSingle();
        const currentUnlocked = athleteProfile?.engine_months_unlocked ?? 0;

        const periodStartSec = sub.current_period_start as number | undefined;
        if (typeof periodStartSec !== "number") continue;

        // Count paid invoices on this subscription. Each represents one
        // quarterly purchase (3 months of access).
        let paidInvoiceCount = 0;
        try {
          const invResp = await fetchWithTimeout(
            `https://api.stripe.com/v1/invoices?customer=${profile.stripe_customer_id}&subscription=${sub.id}&status=paid&limit=100`,
            { headers: { "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":") } },
            15_000
          );
          if (invResp.ok) {
            const invData = await invResp.json();
            paidInvoiceCount = (invData.data ?? []).length;
          }
        } catch {
          continue; // skip on error
        }
        if (paidInvoiceCount === 0) continue;

        const daysIntoPeriod = (Date.now() - periodStartSec * 1000) / (1000 * 60 * 60 * 24);
        const monthsIntoCurrentQuarter = Math.min(Math.floor(daysIntoPeriod / 30) + 1, 3);
        const entitled = Math.min((paidInvoiceCount - 1) * 3 + monthsIntoCurrentQuarter, 36);

        if (entitled > currentUnlocked) {
          // Anchor last_at to when the most recent unlock SHOULD have happened
          // (periodStart + (months_in_quarter - 1) * 30 days) so the next drip
          // lands on time. Diagnostic only — cron doesn't read last_at anymore.
          const lastAtMs = periodStartSec * 1000 + (monthsIntoCurrentQuarter - 1) * 30 * 24 * 60 * 60 * 1000;
          results.push(`Engine: raising user ${userId} from ${currentUnlocked} to ${entitled} (inv=${paidInvoiceCount}, into_quarter=${monthsIntoCurrentQuarter})`);

          await supa
            .from("athlete_profiles")
            .upsert(
              {
                user_id: userId,
                engine_months_unlocked: entitled,
                engine_months_unlocked_last_at: new Date(lastAtMs).toISOString(),
              },
              { onConflict: "user_id" }
            );
        }
      }
    }

    return new Response(JSON.stringify({ message: "Cron complete", results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Cron error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
