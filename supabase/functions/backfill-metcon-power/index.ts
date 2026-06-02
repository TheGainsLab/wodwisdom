/**
 * THROWAWAY — recomputes power (joules/watts) on every logged metcon block
 * for one user (?email=), overwriting existing values. Delete after use.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeMetconPower, type MetconBlockInput } from "../_shared/metcon-workcalc.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

Deno.serve(async (req) => {
  const email = (new URL(req.url).searchParams.get("email") ?? "longbender@gmail.com").toLowerCase();
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY);

  let userId: string | null = null;
  for (let page = 1; page <= 25 && !userId; page++) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data || data.users.length === 0) break;
    const u = data.users.find((x) => (x.email ?? "").toLowerCase() === email);
    if (u) userId = u.id;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    return new Response(JSON.stringify({ error: `no user for ${email}` }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }

  const { data: ap } = await supa
    .from("athlete_profiles").select("bodyweight, units, gender")
    .eq("user_id", userId).maybeSingle();
  const athlete = {
    bodyweight: num(ap?.bodyweight),
    units: (ap?.units as string) ?? null,
    gender: (ap?.gender as string) ?? null,
  };

  const { data: blocks, error: bErr } = await supa
    .from("workout_log_blocks")
    .select("id, block_scheme, block_text, score, capped, capped_reps, time_cap_seconds, joules, workout_logs!inner(user_id)")
    .eq("block_type", "metcon")
    .eq("workout_logs.user_id", userId);
  if (bErr) {
    return new Response(JSON.stringify({ error: bErr.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const results: unknown[] = [];
  for (const b of blocks ?? []) {
    const { data: entries } = await supa
      .from("workout_log_entries")
      .select("movement, reps, weight, weight_unit, distance, distance_unit, calories")
      .eq("block_id", b.id).order("sort_order");
    const input: MetconBlockInput = {
      block_scheme: (b.block_scheme as string) ?? null,
      block_text: (b.block_text as string) ?? null,
      score: (b.score as string) ?? null,
      capped: (b.capped as boolean) ?? null,
      capped_reps: num(b.capped_reps),
      time_cap_seconds: num(b.time_cap_seconds),
      movements: (entries ?? [])
        .filter((e) => String(e.movement ?? "").trim())
        .map((e) => ({
          movement: String(e.movement).trim(),
          reps: num(e.reps),
          weight: num(e.weight),
          weight_unit: (e.weight_unit as string) ?? null,
          distance: num(e.distance),
          distance_unit: (e.distance_unit as string) ?? null,
          calories: num(e.calories),
        })),
    };
    const before = num(b.joules);
    try {
      const power = await computeMetconPower(input, athlete, ANTHROPIC_API_KEY);
      if (power) {
        await supa.from("workout_log_blocks").update({
          joules: power.joules,
          avg_power_watts: power.avg_power_watts,
          avg_w_per_kg: power.avg_w_per_kg,
          body_mass_kg: power.body_mass_kg,
        }).eq("id", b.id);
        results.push({ score: b.score, joules_before: before, status: "updated", ...power });
      } else {
        results.push({ score: b.score, joules_before: before, status: "skipped (computeMetconPower null — see logs)" });
      }
    } catch (e) {
      results.push({ score: b.score, joules_before: before, status: "error", error: (e as Error).message });
    }
  }

  return new Response(
    JSON.stringify({ email, athlete, metcons: blocks?.length ?? 0, results }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});
