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

Deno.serve(async (req) => {
  // This function should only be called by cron or admin — verify with service key
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "") ?? "";
  if (token !== SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

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

      // Fetch subscription from Stripe to check interval
      let isQuarterly = false;
      try {
        const subsResp = await fetchWithTimeout(
          `https://api.stripe.com/v1/subscriptions?customer=${profile.stripe_customer_id}&status=active&limit=1`,
          { headers: { "Authorization": "Basic " + btoa(STRIPE_SECRET_KEY + ":") } },
          15_000
        );
        if (subsResp.ok) {
          const subsData = await subsResp.json();
          const sub = subsData.data?.[0];
          if (sub) {
            const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
            const intervalCount = sub.items?.data?.[0]?.price?.recurring?.interval_count;
            // Quarterly = 3-month interval or 1-quarter interval
            isQuarterly = (interval === "month" && intervalCount === 3);
          }
        }
      } catch {
        continue; // Skip on error
      }

      if (!isQuarterly) continue; // Only process quarterly users

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

      // Engine: check if due for next month unlock
      if (features.has("engine")) {
        const { data: athleteProfile } = await supa
          .from("athlete_profiles")
          .select("engine_months_unlocked, updated_at")
          .eq("user_id", userId)
          .maybeSingle();

        if (athleteProfile) {
          const currentUnlocked = athleteProfile.engine_months_unlocked || 1;
          const lastUpdated = new Date(athleteProfile.updated_at || 0);
          const daysSinceLastUnlock = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);

          // Check we haven't exceeded 3 months per quarter
          const monthsInCurrentQuarter = ((currentUnlocked - 1) % 3) + 1;

          if (daysSinceLastUnlock >= 30 && monthsInCurrentQuarter < 3) {
            const newUnlocked = currentUnlocked + 1;
            results.push(`Engine: unlocking month ${newUnlocked} for user ${userId}`);

            await supa
              .from("athlete_profiles")
              .update({ engine_months_unlocked: newUnlocked })
              .eq("user_id", userId);
          }
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
