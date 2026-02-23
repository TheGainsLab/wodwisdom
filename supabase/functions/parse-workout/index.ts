/**
 * Parse workout text into blocks with movements and suggested weights.
 * Used by Start Workout page to pre-populate block cards and weight inputs.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseWorkout } from "../_shared/workout-parser.ts";
import { suggestWeight } from "../_shared/weight-suggestions.ts";
import {
  buildLibraryEntries,
  buildMovementsContext,
  type MovementsRow,
} from "../_shared/build-movements-context.ts";
import type { ParsedBlock, ParsedBlockMovement } from "../_shared/workout-parser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface MovementWithSuggestion extends ParsedBlockMovement {
  suggested_weight?: number | null;
}

interface BlockWithSuggestions extends Omit<ParsedBlock, "movements"> {
  movements: MovementWithSuggestion[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await supa.auth.getUser(token);

    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { workout_text } = await req.json();
    if (!workout_text || typeof workout_text !== "string") {
      return new Response(JSON.stringify({ error: "Missing workout_text" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const trimmed = workout_text.trim();
    if (trimmed.length < 10) {
      return new Response(JSON.stringify({ error: "Paste a complete workout to parse" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const [
      { data: movementsData },
      { data: athleteProfile },
    ] = await Promise.all([
      supa
        .from("movements")
        .select("canonical_name, display_name, modality, category, aliases, competition_count"),
      supa
        .from("athlete_profiles")
        .select("lifts, units")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const rows: MovementsRow[] = (movementsData || []) as MovementsRow[];
    const movementsContext = rows.length > 0 ? buildMovementsContext(rows) : undefined;
    const libraryEntries = rows.length > 0 ? buildLibraryEntries(rows) : [];
    const { blocks, notices } = await parseWorkout(trimmed, {
      libraryEntries,
      movementsContext,
      apiKey: ANTHROPIC_API_KEY ?? undefined,
    });

    const blocksWithSuggestions: BlockWithSuggestions[] = blocks.map((block) => ({
      ...block,
      movements: block.movements.map((m) => {
        const suggested_weight =
          m.modality === "W"
            ? suggestWeight(m.load, m.canonical, athleteProfile ?? undefined)
            : null;
        return {
          ...m,
          suggested_weight: suggested_weight ?? undefined,
        };
      }),
    }));

    return new Response(
      JSON.stringify({
        blocks: blocksWithSuggestions,
        notices,
      }),
      {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("parse-workout error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  }
});
