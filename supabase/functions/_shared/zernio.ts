// _shared/zernio.ts
// Cliente HTTP da API Zernio (WhatsApp oficial via Meta Cloud API).
// A API key vive em app_secrets (service role only — ver migration 039) e
// nunca é exposta ao navegador. Toda chamada sai daqui, das Edge Functions.

import type { Supabase } from "./contacts.ts";
import { getSecret } from "./secrets.ts";

export const ZERNIO_API_URL = "https://zernio.com/api/v1";
export const ZERNIO_PROFILE_NAME = "CRM TOP";
export const ZERNIO_API_KEY_NAME = "zernio_api_key";
export const ZERNIO_WEBHOOK_TOKEN_NAME = "zernio_webhook_token";
export const ZERNIO_WEBHOOK_SECRET_NAME = "zernio_webhook_secret";

export interface ZernioConnection {
  id: string;
  profile_id: string | null;
  account_id: string | null;
  account_name: string | null;
  phone_number: string | null;
  status: string;
  webhook_id: string | null;
  webhook_url: string | null;
}

export class ZernioApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ZernioApiError";
    this.status = status;
  }
}

/**
 * Normaliza para E.164 com "+". Os contatos do CRM guardam dígitos sem "+"
 * (migration 013, DDI 55 canônico). Aceita 10–15 dígitos; rejeita LIDs e
 * números visivelmente inválidos.
 */
export function normalizeE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.includes("lid:")) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

/**
 * Maior índice de placeholder posicional ({{1}}, {{2}}...) nos componentes de
 * um template. 0 quando o template não tem variáveis.
 */
export function countTemplatePlaceholders(components: unknown): number {
  let max = 0;
  let text: string;
  try {
    text = typeof components === "string" ? components : JSON.stringify(components ?? "");
  } catch {
    return 0;
  }
  for (const m of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/**
 * Corpo de `template` para POST /v1/broadcasts: os `components` precisam ter
 * um parâmetro por placeholder (mismatch → Meta rejeita com código 132000).
 */
export function buildBroadcastTemplate(
  name: string,
  language: string,
  placeholderCount: number,
  variableMapping: Record<string, unknown>,
): Record<string, unknown> {
  const template: Record<string, unknown> = { name, language };
  if (placeholderCount > 0) {
    template.components = [{
      type: "body",
      parameters: Array.from({ length: placeholderCount }, (_, i) => ({
        type: "text",
        text: `{{${i + 1}}}`,
      })),
    }];
    template.variableMapping = variableMapping;
  }
  return template;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function getZernioKey(sb: Supabase): Promise<string> {
  const fromEnv = Deno.env.get("ZERNIO_API_KEY") ?? "";
  if (fromEnv) return fromEnv;
  return await getSecret(sb, ZERNIO_API_KEY_NAME);
}

export async function getZernioConnection(
  sb: Supabase,
): Promise<ZernioConnection | null> {
  const { data, error } = await sb
    .from("zernio_connections")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ZernioConnection) ?? null;
}

/** Chamada autenticada à API Zernio. Lança ZernioApiError com o status HTTP. */
export async function zernioRequest(
  sb: Supabase,
  path: string,
  opts: {
    method?: string;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
  } = {},
): Promise<any> {
  const key = await getZernioKey(sb);
  if (!key) throw new ZernioApiError("Zernio API key não configurada", 400);

  const url = new URL(`${ZERNIO_API_URL}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const detail =
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.message === "string" && data.message) ||
      (typeof data?.error?.message === "string" && data.error.message) ||
      text.slice(0, 300) ||
      res.statusText;
    throw new ZernioApiError(`Zernio ${res.status}: ${detail}`, res.status);
  }
  return data;
}

/** Garante o profile Zernio do CRM e devolve o profileId (cria se preciso). */
export async function ensureZernioProfile(sb: Supabase): Promise<string> {
  const conn = await getZernioConnection(sb);
  if (conn?.profile_id) return conn.profile_id;

  // Garante a linha singleton (idempotente).
  const { error: upsertErr } = await sb
    .from("zernio_connections")
    .upsert({ id: "default" }, { onConflict: "id" });
  if (upsertErr) throw new Error(upsertErr.message);

  const list = await zernioRequest(sb, "/profiles");
  let profile = (list?.profiles ?? []).find((p: any) => p.name === ZERNIO_PROFILE_NAME);
  if (!profile) {
    const created = await zernioRequest(sb, "/profiles", {
      method: "POST",
      body: { name: ZERNIO_PROFILE_NAME, description: "CRM TOP — WhatsApp oficial (Meta)" },
    });
    profile = created?.profile;
  }
  const profileId = profile?._id ?? profile?.id;
  if (!profileId) throw new Error("Falha ao criar/localizar profile no Zernio");

  const { error } = await sb
    .from("zernio_connections")
    .update({ profile_id: String(profileId) })
    .eq("id", "default");
  if (error) throw new Error(error.message);
  return String(profileId);
}

/** Connection conectada ou erro para o handler devolver 400. */
export async function requireConnected(sb: Supabase): Promise<ZernioConnection> {
  const conn = await getZernioConnection(sb);
  if (!conn?.profile_id || !conn.account_id || conn.status !== "connected") {
    throw new ZernioApiError(
      "WhatsApp oficial não conectado. Conecte em Configurações → WhatsApp.",
      400,
    );
  }
  return conn;
}
