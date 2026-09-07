// _shared/zernio.ts
// Cliente HTTP da API Zernio (WhatsApp oficial via Meta Cloud API).
// A API key vive em app_secrets (service role only — ver migration 039) e
// nunca é exposta ao navegador. Toda chamada sai daqui, das Edge Functions.

import type { Supabase } from "./contacts.ts";
import { getSecret, setSecret } from "./secrets.ts";

export const ZERNIO_API_URL = "https://zernio.com/api/v1";
export const ZERNIO_PROFILE_NAME = "CRM TOP";
export const ZERNIO_API_KEY_NAME = "zernio_api_key";
export const ZERNIO_WEBHOOK_TOKEN_NAME = "zernio_webhook_token";
export const ZERNIO_WEBHOOK_SECRET_NAME = "zernio_webhook_secret";
export const ZERNIO_INTERNAL_TOKEN_NAME = "zernio_internal_token";

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
 * um template. 0 quando o template não tem variáveis posicionais.
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
 * Slots nomeados do template ({{nome}}, {{empresa}}...) em ordem de primeira
 * aparição — a ordem em que a Meta aceita os valores no envio direto
 * (POST /v1/inbox/conversations → templateParams).
 */
export function listNamedTemplateSlots(components: unknown): string[] {
  let text: string;
  try {
    text = typeof components === "string" ? components : JSON.stringify(components ?? "");
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const m of text.matchAll(/\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * True quando o template usa variáveis COM NOME ({{nome}} — parameter_format
 * NAMED, comum em templates criados no WhatsApp Manager). O engine de
 * broadcast da Zernio não resolve as nomeadas ("only numbered placeholders
 * are supported") — nesses casos o app envia em modo direto (conversa por
 * conversa) resolvendo os valores ele mesmo.
 */
export function hasNamedTemplateParams(components: unknown): boolean {
  let text: string;
  try {
    text = typeof components === "string" ? components : JSON.stringify(components ?? "");
  } catch {
    return false;
  }
  // Ignora os tokens de mapeamento que o próprio broadcast usa ({{1}}).
  return /\{\{\s*[a-zA-Z_]\w*\s*\}\}/.test(text);
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

/**
 * Chamada autenticada à API Zernio. Lança ZernioApiError com o status HTTP.
 *
 * Conformidade com as boas práticas de rate limit da Meta (Graph API):
 * a API de Gerenciamento do WhatsApp (message_templates etc.) tem cota por
 * WABA (200–5.000 chamadas/h) e, ao bater o limite (#80008), CONTINUAR
 * chamando prolonga o bloqueio. Por isso, em erro de limite marcamos um
 * cooldown local e recusamos chamadas de gerenciamento até ele expirar —
 * em vez de ficar tentando de novo em segundos.
 */
export const META_COOLDOWN_KEY = "zernio_meta_cooldown_until";
export const META_COOLDOWN_MINUTES = 40;
const META_MANAGEMENT_PATHS = ["/whatsapp/templates", "/whatsapp/template-library"];

/** Erro #80008 da Meta (rate limit por WABA) — corpo repassado pelo gateway. */
export const META_RATE_LIMIT_RE =
  /#\s*80008|too many calls to this WhatsApp Business/i;

function isMetaManagementPath(path: string): boolean {
  return META_MANAGEMENT_PATHS.some((p) => path.startsWith(p));
}

export class MetaRateLimitedError extends ZernioApiError {
  constructor(message: string) {
    super(message, 429);
    this.name = "MetaRateLimitedError";
  }
}

/** Minutos restantes de cooldown da Meta (0 quando livre). */
export async function metaCooldownRemainingMinutes(sb: Supabase): Promise<number> {
  const raw = await getSecret(sb, META_COOLDOWN_KEY);
  if (!raw) return 0;
  const until = Date.parse(raw);
  if (Number.isNaN(until)) return 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 60_000));
}

async function markMetaCooldown(sb: Supabase): Promise<number> {
  const until = new Date(Date.now() + META_COOLDOWN_MINUTES * 60_000).toISOString();
  await setSecret(sb, META_COOLDOWN_KEY, until);
  return META_COOLDOWN_MINUTES;
}

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

  if (isMetaManagementPath(path)) {
    const remaining = await metaCooldownRemainingMinutes(sb);
    if (remaining > 0) {
      throw new MetaRateLimitedError(
        `A Meta limitou temporariamente as chamadas de gerenciamento desta conta. ` +
          `Aguarde ~${remaining} min antes de tentar de novo (tentativas antes disso prolongam o bloqueio).`,
      );
    }
  }

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
    let detail =
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.message === "string" && data.message) ||
      (typeof data?.error?.message === "string" && data.error.message) ||
      text.slice(0, 300) ||
      res.statusText;
    if (META_RATE_LIMIT_RE.test(detail)) {
      // Grava o cooldown em QUALQUER rota (gerenciamento OU envio): enquanto a
      // Meta mantém o bloqueio, cada chamada adicional o prolonga. Quem consome
      // o cooldown: pré-checagem de templates abaixo e o gate das campanhas no
      // zernio-proxy (campaignSendDirect/actionCampaignSend).
      const mins = await markMetaCooldown(sb);
      if (isMetaManagementPath(path)) {
        throw new MetaRateLimitedError(
          `A Meta limitou temporariamente as chamadas de gerenciamento desta conta (rate limit). ` +
            `Pausamos chamadas de gerenciamento por ~${mins} min — tentar antes disso prolonga o bloqueio.`,
        );
      }
      throw new MetaRateLimitedError(
        `A Meta limitou temporariamente os envios desta conta (rate limit #80008). ` +
          `Envios em massa pausados por ~${mins} min — a fila retoma automaticamente ` +
          `(tentar antes disso prolonga o bloqueio).`,
      );
    }
    throw new ZernioApiError(`Zernio ${res.status}: ${detail}`, res.status);
  }
  return data;
}

/**
 * zernioRequest com retentativas PARA ERROS TRANSITÓRIOS DO LADO ZERNIO
 * (429/5xx da própria Zernio). Erro de rate limit da Meta (#80008) NÃO é
 * re-tentado: vira cooldown (ver boas práticas da Meta — "pare de chamar
 * quando o limite foi atingido").
 */
export async function zernioRequestRetry(
  sb: Supabase,
  path: string,
  opts: {
    method?: string;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
  } = {},
  attempts = 2,
): Promise<any> {
  const delaysMs = [3_000, 15_000];
  let lastErr: unknown;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await zernioRequest(sb, path, opts);
    } catch (err) {
      lastErr = err;
      if (err instanceof MetaRateLimitedError) break; // cooldown, não retry
      const msg = err instanceof Error ? err.message : "";
      const transient = /Zernio 429|Zernio 5\d\d/i.test(msg);
      if (!transient || i === attempts) break;
      await new Promise((r) => setTimeout(r, delaysMs[i] ?? 15_000));
    }
  }
  throw lastErr;
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
