import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Authenticate caller
    const authHeader = req.headers.get("Authorization");
    const supa = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const token = authHeader!.replace("Bearer ", "");
    const {
      data: { user },
      error: authErr,
    } = await supa.auth.getUser(token);

    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Verify admin role
    const { data: profile } = await supa
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "admin") {
      return json({ error: "Forbidden" }, 403);
    }

    // Dispatch by action
    const { action, ...params } = await req.json();

    switch (action) {
      case "get_overview": {
        const { data: stats } = await supa.rpc("admin_usage_stats");
        const { data: trend } = await supa.rpc("admin_daily_trend", {
          days_back: 30,
        });
        const { data: topUsers } = await supa.rpc("admin_top_users", {
          limit_count: 10,
        });

        const { count: journalCount } = await supa
          .from("chunks")
          .select("id", { count: "exact", head: true })
          .eq("category", "journal");
        const { count: scienceCount } = await supa
          .from("chunks")
          .select("id", { count: "exact", head: true })
          .eq("category", "science");

        return json({
          stats,
          trend,
          topUsers,
          chunks: { journal: journalCount, science: scienceCount },
        });
      }

      case "get_users": {
        const { data: users } = await supa.rpc("admin_user_list");
        return json({ users });
      }

      case "update_user": {
        const { user_id, field, value } = params;
        if (!user_id || !field) {
          return json({ error: "Missing user_id or field" }, 400);
        }
        if (!["role", "ai_suite", "engine", "engine_months"].includes(field)) {
          return json({ error: "Invalid field" }, 400);
        }

        if (field === "role") {
          if (!["user", "admin"].includes(value)) {
            return json({ error: "Invalid role" }, 400);
          }
          if (user_id === user.id && value !== "admin") {
            return json({ error: "Cannot remove your own admin role" }, 400);
          }
          const { error: updateErr } = await supa
            .from("profiles")
            .update({ role: value })
            .eq("id", user_id);
          if (updateErr) return json({ error: updateErr.message }, 500);
        }

        if (field === "ai_suite") {
          const features = ["ai_chat", "program_gen", "workout_review", "workout_log"];
          if (value === "grant") {
            for (const feature of features) {
              const { error: upsertErr } = await supa.from("user_entitlements").upsert({
                user_id,
                feature,
                source: "admin",
              }, { onConflict: "user_id,feature,source" });
              if (upsertErr) return json({ error: upsertErr.message }, 500);
            }
          } else if (value === "revoke") {
            const { error: deleteErr } = await supa.from("user_entitlements")
              .delete()
              .eq("user_id", user_id)
              .eq("source", "admin")
              .in("feature", features);
            if (deleteErr) return json({ error: deleteErr.message }, 500);
          } else {
            return json({ error: "Invalid value, use grant or revoke" }, 400);
          }
        }

        if (field === "engine") {
          if (value === "grant") {
            const { error: upsertErr } = await supa.from("user_entitlements").upsert({
              user_id,
              feature: "engine",
              source: "admin",
            }, { onConflict: "user_id,feature,source" });
            if (upsertErr) return json({ error: upsertErr.message }, 500);
          } else if (value === "revoke") {
            const { error: deleteErr } = await supa.from("user_entitlements")
              .delete()
              .eq("user_id", user_id)
              .eq("source", "admin")
              .eq("feature", "engine");
            if (deleteErr) return json({ error: deleteErr.message }, 500);
          } else {
            return json({ error: "Invalid value, use grant or revoke" }, 400);
          }
        }

        if (field === "engine_months") {
          const months = parseInt(value, 10);
          if (isNaN(months) || months < 1) {
            return json({ error: "Invalid months value" }, 400);
          }
          const { error: updateErr } = await supa
            .from("athlete_profiles")
            .update({ engine_months_unlocked: months })
            .eq("user_id", user_id);
          if (updateErr) return json({ error: updateErr.message }, 500);
        }

        return json({ ok: true });
      }

      case "get_knowledge_base": {
        const { count: journalCount } = await supa
          .from("chunks")
          .select("id", { count: "exact", head: true })
          .eq("category", "journal");
        const { count: scienceCount } = await supa
          .from("chunks")
          .select("id", { count: "exact", head: true })
          .eq("category", "science");

        const { data: sources } = await supa
          .from("chunks")
          .select("title, category");

        // Aggregate by title in JS
        const sourceMap: Record<
          string,
          { title: string; category: string; chunks: number }
        > = {};
        for (const s of sources || []) {
          const key = s.title;
          if (!sourceMap[key])
            sourceMap[key] = { title: s.title, category: s.category, chunks: 0 };
          sourceMap[key].chunks++;
        }
        const sourceList = Object.values(sourceMap).sort(
          (a, b) => b.chunks - a.chunks
        );

        return json({
          journal_chunks: journalCount,
          science_chunks: scienceCount,
          sources: sourceList,
        });
      }

      case "get_gyms": {
        const { data: gyms } = await supa
          .from("gyms")
          .select("id, name, max_seats, created_at, owner_id")
          .order("created_at", { ascending: false });

        const enriched = await Promise.all(
          (gyms || []).map(async (g: any) => {
            const { data: ownerProfile } = await supa
              .from("profiles")
              .select("full_name, email")
              .eq("id", g.owner_id)
              .single();
            const { count } = await supa
              .from("gym_members")
              .select("id", { count: "exact", head: true })
              .eq("gym_id", g.id)
              .in("status", ["active", "invited"]);
            return {
              ...g,
              owner_name: ownerProfile?.full_name || ownerProfile?.email || "Unknown",
              owner_email: ownerProfile?.email || "",
              member_count: count || 0,
            };
          })
        );

        return json({ gyms: enriched });
      }

      case "get_gym_members": {
        const { gym_id } = params;
        if (!gym_id) return json({ error: "Missing gym_id" }, 400);

        const { data: members } = await supa
          .from("gym_members")
          .select("id, invited_email, user_id, status, created_at")
          .eq("gym_id", gym_id)
          .order("created_at");

        const enriched = await Promise.all(
          (members || []).map(async (m: any) => {
            if (m.user_id) {
              const { data: p } = await supa
                .from("profiles")
                .select("full_name")
                .eq("id", m.user_id)
                .single();
              return { ...m, full_name: p?.full_name || m.invited_email };
            }
            return { ...m, full_name: m.invited_email };
          })
        );

        return json({ members: enriched });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
