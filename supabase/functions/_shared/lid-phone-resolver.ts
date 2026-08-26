// _shared/lid-phone-resolver.ts
// Resolução LID → telefone real via Evolution API, com cache em banco.
//
// Contexto: algumas instâncias/Evolution entregam TODA mensagem inbound como
// remoteJid @lid sem senderPn/remoteJidAlt. O contato nasce sem telefone e a
// conversa aparece como "Contato sem número". Este módulo consulta a Evolution
// UMA vez por LID, guarda o resultado em `lid_phone_cache` (positivo e negativo)
// e devolve o telefone para o upsert do contato.
//
// Nunca inventa número: só aceita telefone que passe na normalização BR v2.

import { normalizePhoneStrict } from "./evolution-identity.ts";

export interface LidCacheEntry {
  phone: string | null;
  resolved_at: string | null;
  attempts: number;
  last_attempt_at: string;
}

export interface LidCacheStore {
  get(lid: string): Promise<LidCacheEntry | null>;
  put(entry: { lid: string; phone: string | null }): Promise<void>;
}

export function createLidCacheStore(supabase: {
  from(table: string): any;
}): LidCacheStore {
  return {
    async get(lid) {
      const { data } = await supabase
        .from("lid_phone_cache")
        .select("phone, resolved_at, attempts, last_attempt_at")
        .eq("lid", lid)
        .maybeSingle();
      return (data as LidCacheEntry | null) ?? null;
    },
    async put({ lid, phone }) {
      const { data: existing } = await supabase
        .from("lid_phone_cache")
        .select("attempts")
        .eq("lid", lid)
        .maybeSingle();
      const now = new Date().toISOString();
      await supabase.from("lid_phone_cache").upsert(
        {
          lid,
          phone,
          resolved_at: phone ? now : null,
          attempts: (existing?.attempts ?? 0) + 1,
          last_attempt_at: now,
          updated_at: now,
        },
        { onConflict: "lid" },
      );
    },
  };
}

// TTLs: positivo vale 30 dias (revalida devagar); negativo segura 24h para
// não martelar a API a cada mensagem de um LID ainda desconhecido.
export const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Extrai telefone válido de uma linha de contato da Evolution. Aceita os
 * formatos vistos no wild: `number`/`phoneNumber` diretos ou um `id`
 * @s.whatsapp.net (que embute o telefone). Retorna sempre forma canônica
 * (55 + dígitos) ou null.
 */
export function extractPhoneFromContactRow(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  for (const key of ["number", "phoneNumber", "phone"]) {
    const v = r[key];
    if (typeof v === "string") {
      const normalized = normalizePhoneStrict(v);
      if (normalized) return normalized;
    }
  }
  if (typeof r.id === "string" && r.id.endsWith("@s.whatsapp.net")) {
    const digits = r.id.split("@")[0].replace(/\D/g, "");
    const normalized = normalizePhoneStrict(digits);
    if (normalized) return normalized;
  }
  return null;
}

/** Normaliza as várias formas de resposta da Evolution para uma lista de linhas. */
export function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === "object");
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["contacts", "data", "response"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object");
    }
    if ("id" in obj) return [obj];
  }
  return [];
}

interface FetchLike {
  (url: string, init?: RequestInit): Promise<Response>;
}

/**
 * Consulta a Evolution tentando, em ordem:
 *   1. POST /chat/findContacts/{instance}  { where: { id: "<digits>@lid" } }
 *   2. GET  /chat/getContacts/{instance}   (fallback: filtra pelo LID localmente)
 * Best-effort: qualquer erro/404 apenas devolve null.
 */
export async function fetchLidPhoneFromEvolution(opts: {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  lidDigits: string;
  fetchFn?: FetchLike;
}): Promise<string | null> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetchFn ?? fetch;
  const headers = { "Content-Type": "application/json", apikey: opts.apiKey };
  const fullJid = `${opts.lidDigits}@lid`;

  // 1. findContacts (busca pontual na store da instância)
  try {
    const res = await doFetch(`${base}/chat/findContacts/${opts.instanceName}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ where: { id: fullJid } }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const rows = extractRows(await res.json());
      for (const row of rows) {
        const phone = extractPhoneFromContactRow(row);
        if (phone) return phone;
      }
    }
  } catch {
    // segue para o fallback
  }

  // 2. getContacts (lista completa; filtro local pelo LID)
  try {
    const res = await doFetch(`${base}/chat/getContacts/${opts.instanceName}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const rows = extractRows(await res.json());
      for (const row of rows) {
        const rowId = typeof row.id === "string" ? row.id : "";
        const matches =
          rowId.split("@")[0] === opts.lidDigits ||
          (typeof row.lid === "string" && row.lid.replace(/\D/g, "") === opts.lidDigits);
        if (!matches) continue;
        const phone = extractPhoneFromContactRow(row);
        if (phone) return phone;
      }
    }
  } catch {
    // desiste silenciosamente
  }

  return null;
}

/**
 * Fluxo completo com cache: acerto/insucesso recente evitam rede.
 * Retorna o telefone canônico ou null.
 */
export async function resolveLidPhone(opts: {
  store: LidCacheStore;
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  lidDigits: string;
  fetchFn?: FetchLike;
  now?: () => number;
}): Promise<string | null> {
  const lid = opts.lidDigits.replace(/\D/g, "");
  if (!lid) return null;
  const nowMs = (opts.now ?? Date.now)();

  const cached = await opts.store.get(lid);
  if (cached) {
    if (cached.phone) {
      const ref = cached.resolved_at ?? cached.last_attempt_at;
      const age = nowMs - new Date(ref).getTime();
      if (Number.isNaN(age) || age < POSITIVE_TTL_MS) return cached.phone;
    } else {
      const age = nowMs - new Date(cached.last_attempt_at).getTime();
      if (!Number.isNaN(age) && age < NEGATIVE_TTL_MS) return null;
    }
  }

  const phone = await fetchLidPhoneFromEvolution({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    instanceName: opts.instanceName,
    lidDigits: lid,
    fetchFn: opts.fetchFn,
  });

  await opts.store.put({ lid, phone });
  return phone;
}
