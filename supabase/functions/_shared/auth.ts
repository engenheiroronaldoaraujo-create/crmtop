// _shared/auth.ts
//
// Autorização server-side das Edge Functions.
//
// Antes cada função tinha sua própria cópia de `requireUser`/`requireAdmin`
// (admin-users, evolution-proxy, zernio-proxy, ai-service, deal-inspector) e
// o sdr-engine não tinha nenhuma. Aí a segurança virou função da função:
// um endpoint novo sem checagem é um endpoint aberto.
//
// Regra do projeto:
//   - a plataforma (verify_jwt) é a 1ª camada, mas 11 das 14 funções
//     desligaram verify_jwt porque são chamadas server-to-server pelo
//     pg_cron/webhook. A camada real é SEMPRE esta;
//   - o papel (admin/vendedor) é sempre lido de `profiles.role` no banco,
//     nunca de claim do cliente.

import { jsonResponse } from "./cors.ts";
import type { Supabase } from "./contacts.ts";
import { timingSafeEqual } from "./timing.ts";

export interface CallerProfile {
  id: string;
  role: string;
  full_name?: string | null;
}

/** Extrai o Bearer token do header Authorization. */
export function bearerToken(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * true quando a chamada usa a service role (server-to-server). O webhook e
 * os runners do pg_cron falam com as Edge Functions por esse caminho.
 */
export function isServiceRole(req: Request): boolean {
  const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!sr) return false;
  return timingSafeEqual(bearerToken(req), sr);
}

/**
 * Resolve o caller autenticado. Retorna null quando o token é ausente,
 * inválido ou o profile não existe mais (usuário removido/banido).
 */
export async function getCallerProfile(
  req: Request,
  supabase: Supabase,
): Promise<CallerProfile | null> {
  const token = bearerToken(req);
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile) return null;

  return {
    id: profile.id as string,
    role: profile.role as string,
    full_name: (profile.full_name as string | null) ?? null,
  };
}

/** Exige usuário autenticado. Lança a Response 401. */
export async function requireUser(req: Request, supabase: Supabase): Promise<CallerProfile> {
  const profile = await getCallerProfile(req, supabase);
  if (!profile) throw jsonResponse(401, { error: "unauthorized" });
  return profile;
}

/** Exige papel admin. Lança 401 (não autenticado) ou 403 (não admin). */
export async function requireAdmin(req: Request, supabase: Supabase): Promise<CallerProfile> {
  const profile = await requireUser(req, supabase);
  if (profile.role !== "admin") {
    throw jsonResponse(403, { error: "forbidden: admin role required" });
  }
  return profile;
}

/**
 * Exige admin OU chamada server-to-server (service role).
 * Use em funções que servem tanto o webhook quanto o painel admin.
 */
export async function requireAdminOrService(
  req: Request,
  supabase: Supabase,
): Promise<CallerProfile | null> {
  if (isServiceRole(req)) return null;
  return await requireAdmin(req, supabase);
}
