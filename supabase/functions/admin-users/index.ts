import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ROLES = ["admin", "vendedor"];

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Validates the caller JWT and returns the profile iff the caller is an admin.
// The check is done server-side against profiles.role — never trusts client claims.
async function requireAdmin(
  req: Request,
  supabase: ReturnType<typeof serviceClient>,
): Promise<{ id: string; role: string }> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw jsonResponse(401, { error: "missing token" });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw jsonResponse(401, { error: "invalid token" });

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin") {
    throw jsonResponse(403, { error: "forbidden: admin role required" });
  }
  return profile;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = serviceClient();
    await requireAdmin(req, supabase);
    const body = await req.json();
    const { action } = body as {
      action: string;
      email?: string;
      full_name?: string;
      role?: string;
      temp_password?: string;
      user_id?: string;
    };

    switch (action) {
      case "list": {
        const { data: { users }, error } = await supabase.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        if (error) return jsonResponse(400, { error: error.message });
        const ids = users.map((u) => u.id);
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id, full_name, role, is_platform_admin, avatar_url, created_at")
          .in("id", ids);
        if (profilesError) return jsonResponse(400, { error: profilesError.message });
        const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
        const result = users.map((u) => ({
          id: u.id,
          email: u.email,
          banned: Boolean(u.banned_until),
          ...(profileMap.get(u.id) ?? {}),
        }));
        return jsonResponse(200, { users: result });
      }

      case "create": {
        const email = (body.email ?? "").trim().toLowerCase();
        const full_name = (body.full_name ?? "").trim();
        const role = body.role;
        const temp_password = body.temp_password ?? "";
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return jsonResponse(400, { error: "invalid email" });
        }
        if (!ALLOWED_ROLES.includes(role ?? "")) {
          return jsonResponse(400, { error: "role must be admin or vendedor" });
        }
        if (temp_password.length < 8) {
          return jsonResponse(400, { error: "temp_password must be at least 8 characters" });
        }
        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password: temp_password,
          email_confirm: true,
          user_metadata: { full_name, role },
        });
        if (error) return jsonResponse(400, { error: error.message });
        return jsonResponse(200, {
          user: { id: data.user.id, email: data.user.email },
        });
      }

      case "deactivate": {
        const { user_id } = body;
        if (!user_id) return jsonResponse(400, { error: "user_id is required" });
        // Go duration format (time.ParseDuration). ~100 years: effectively
        // permanent — the user is never deleted (history stays intact).
        const { error } = await supabase.auth.admin.updateUserById(user_id, {
          ban_duration: "876000h",
        });
        if (error) return jsonResponse(400, { error: error.message });
        return jsonResponse(200, { ok: true });
      }

      case "reactivate": {
        const { user_id } = body;
        if (!user_id) return jsonResponse(400, { error: "user_id is required" });
        const { error } = await supabase.auth.admin.updateUserById(user_id, {
          ban_duration: "none",
        });
        if (error) return jsonResponse(400, { error: error.message });
        return jsonResponse(200, { ok: true });
      }

      case "reset-password": {
        const { user_id } = body;
        const temp_password = body.temp_password ?? "";
        if (!user_id) return jsonResponse(400, { error: "user_id is required" });
        if (temp_password.length < 8) {
          return jsonResponse(400, { error: "temp_password must be at least 8 characters" });
        }
        const { error } = await supabase.auth.admin.updateUserById(user_id, {
          password: temp_password,
        });
        if (error) return jsonResponse(400, { error: error.message });
        return jsonResponse(200, { ok: true });
      }

      case "set-role": {
        const { user_id, role } = body;
        if (!user_id) return jsonResponse(400, { error: "user_id is required" });
        if (!ALLOWED_ROLES.includes(role ?? "")) {
          return jsonResponse(400, { error: "role must be admin or vendedor" });
        }
        // Block demoting the last remaining admin.
        if (role === "vendedor") {
          const { data: target } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", user_id)
            .maybeSingle();
          if (target?.role === "admin") {
            const { count, error: countError } = await supabase
              .from("profiles")
              .select("id", { count: "exact", head: true })
              .eq("role", "admin");
            if (!countError && (count ?? 0) <= 1) {
              return jsonResponse(400, { error: "cannot demote the last admin" });
            }
          }
        }
        const { error } = await supabase
          .from("profiles")
          .update({ role })
          .eq("id", user_id);
        if (error) return jsonResponse(400, { error: error.message });
        return jsonResponse(200, { ok: true });
      }

      case "set-ai-config": {
        const configType = body.config_type ?? "MODEL_UPDATED";
        const configData = { model: body.model, temperature: body.temperature, max_tokens: body.max_tokens, key: body.key };
        await supabase.from("activity_log").insert({
          entity_type: "ai_config",
          entity_id: null,
          action: configType,
          actor_id: profile.id,
          new_data: configData,
        }).then(() => {}, () => {});
        return jsonResponse(200, { ok: true });
      }

      case "set-secret": {
        // Note: Supabase Edge Function secrets cannot be updated via API.
        // This action stores the intent; actual secret update requires CLI or Dashboard.
        // For now, store in activity_log as a record.
        const secretName = body.name;
        if (!secretName || !body.value) {
          return jsonResponse(400, { error: "name and value required" });
        }
        await supabase.from("activity_log").insert({
          entity_type: "secret_update",
          entity_id: null,
          action: `SECRET_REQUESTED: ${secretName}`,
          actor_id: profile.id,
          new_data: { name: secretName, value_length: (body.value as string).length },
        }).then(() => {}, () => {});
        return jsonResponse(200, { ok: true, message: "Secret update requested. Use Supabase Dashboard to update secrets." });
      }

      default:
        return jsonResponse(400, { error: "unknown action" });
    }
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("admin-users error", err);
    return jsonResponse(500, { error: "internal error" });
  }
});
