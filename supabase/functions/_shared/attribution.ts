// attribution.ts — atribuição de anúncio (Google/Meta) para conversas WhatsApp.
//
// Antes esta lógica vivia inline no evolution-webhook e tinha três problemas:
//  1. só reconhecia Meta (CTWA) — lead do Google caía como "organic";
//  2. o `click_id` era lido do payload mas nunca gravado;
//  3. a origem eragravada apenas na criação da conversa — um lead que vinha da
//     landing e depois clicava no anúncio perdia a atribuição (contacts.ts).
//
// Tudo aqui é puro (sem I/O) para poder ser testado com `deno test`.

import type { ConversationOrigin, ConversationSource } from "./contacts.ts";

export type DetectedNetwork = "meta" | "google" | null;

export interface AdvertiserPayload {
  id?: string;
  source?: string;
  cta_source_url?: string;
  click_id?: string;
}

export interface AttributionInput {
  advertiser?: AdvertiserPayload | null;
  content?: string | null;
  isInbound?: boolean;
  /** UTMs vindos da landing (lead-webhook) ou de outra fonte externa. */
  utm?: Record<string, string | null | undefined> | null;
}

// Mensagem pré-preenchida clássica do click-to-WhatsApp da Meta.
const META_CTWA_PATTERN =
  /posso ter mais informa|pelo an[uú]ncio|vi o an[uú]ncio|seu an[uú]ncio|an[uú]ncio no (facebook|instagram)/i;

// Google Ads click-to-WhatsApp não tem um texto obrigatório, mas usa frases
// pré-preenchidas parecidas e marca a URL com utm_source=gclid/fbclid.
const GOOGLE_CTWA_PATTERN =
  /an[uú]ncio no google|vi no google|google ads|gostaria de (mais|receber) informa|gostaria de saber mais|mais informa[cç][oõ]es sobre/i;

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
] as const;

/** Extrai parâmetros de atribuição de uma URL (wa.me, landing etc). */
export function parseUtm(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://x.local/?${raw.replace(/^\?/, "")}`);
    const out: Record<string, string> = {};
    for (const key of UTM_KEYS) {
      const value = url.searchParams.get(key);
      if (value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Normaliza a rede para `meta` / `google`, mantendo o valor bruto à parte. */
export function normalizeNetwork(raw: string | null | undefined): DetectedNetwork {
  if (!raw) return null;
  const v = String(raw).toLowerCase();
  if (/google|gclid/.test(v)) return "google";
  if (/meta|facebook|instagram|facebook\.com|instagram\.com|fbclid|ig/.test(v)) return "meta";
  return null;
}

function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Decide se a mensagem veio de um anúncio e devolve a origem a ser gravada.
 * `null` = mensagem comum (não mexe na conversa).
 */
export function detectAdAttribution(input: AttributionInput): ConversationOrigin | null {
  if (input.isInbound === false) return null;

  const advertiser = input.advertiser ?? null;
  const content = input.content ?? "";
  const utm = {
    ...parseUtm(advertiser?.cta_source_url),
    ...clean(input.utm ?? {}),
  } as Record<string, string>;

  const official = Boolean(
    advertiser?.id || advertiser?.source || utm.gclid || utm.fbclid || utm.utm_source,
  );
  const metaHeuristic = META_CTWA_PATTERN.test(content);
  const googleHeuristic = GOOGLE_CTWA_PATTERN.test(content) || normalizeNetwork(utm.utm_source) === "google";

  if (!official && !metaHeuristic && !googleHeuristic) return null;

  const rawNetwork = advertiser?.source ?? utm.utm_source ?? null;
  const network = normalizeNetwork(rawNetwork) ??
    (googleHeuristic ? "google" : metaHeuristic ? "meta" : null);
  const detectedVia = official
    ? (network === "google" ? "google_attribution" : "meta_attribution")
    : googleHeuristic
      ? "padrao_ctwa_google"
      : "padrao_ctwa_meta";

  return {
    source: "ad",
    meta: clean({
      ad_id: advertiser?.id ?? null,
      click_id: advertiser?.click_id ?? null,
      network,
      network_raw: rawNetwork,
      cta_source_url: advertiser?.cta_source_url ?? null,
      detected_via: detectedVia,
      ...utm,
    }),
  };
}

interface AttributedConversation {
  source?: string | null;
  source_meta?: unknown;
}

function asMeta(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Mescla atribuição nova em uma conversa existente.
 *
 * Regras importantes:
 *  - origem 'manual' (marcada por humano) nunca é sobrescrita;
 *  - atribuição oficial (meta_attribution/google_attribution) não é rebaixada
 *    por heurística de texto;
 *  - UTMs da landing são preservados quando o anúncio chega depois;
 *  - retorna null quando nada muda (evita UPDATE em toda mensagem).
 */
export function mergeConversationAttribution(
  existing: AttributedConversation | null,
  incoming: ConversationOrigin | null | undefined,
): { source: ConversationSource; source_meta: Record<string, unknown> } | null {
  if (!incoming || (!incoming.source && !incoming.meta)) return null;

  const currentSource = (existing?.source ?? "organic") as ConversationSource;
  if (currentSource === "manual") return null;

  const currentMeta = asMeta(existing?.source_meta);
  const incomingMeta = clean(asMeta(incoming.meta));
  const incomingOfficial = /^(meta|google)_attribution$/.test(String(incomingMeta.detected_via ?? ""));
  const currentOfficial = /^(meta|google)_attribution$/.test(String(currentMeta.detected_via ?? ""));

  let nextSource: ConversationSource = currentSource;
  let nextMeta: Record<string, unknown> = currentMeta;

  if (incoming.source === "ad") {
    nextSource = "ad";
    if (currentOfficial && !incomingOfficial) {
      // Heurística não apaga dado oficial; só preenche o que faltava.
      nextMeta = { ...incomingMeta };
      for (const [k, v] of Object.entries(currentMeta)) {
        if (v !== null && v !== undefined && v !== "") nextMeta[k] = v;
      }
    } else {
      nextMeta = { ...currentMeta, ...incomingMeta };
    }
  } else if (incoming.source === "landing" && currentSource !== "ad") {
    nextMeta = { ...currentMeta, ...incomingMeta };
  } else if (incoming.meta && Object.keys(incomingMeta).length > 0) {
    nextMeta = { ...currentMeta, ...incomingMeta };
  } else {
    return null;
  }

  if (nextSource === currentSource && JSON.stringify(nextMeta) === JSON.stringify(currentMeta)) {
    return null;
  }
  return { source: nextSource, source_meta: nextMeta };
}

/** Linhas curtas injetadas no prompt do SDR para ele conhecer a origem do lead. */
export function attributionContextLines(source: string | null, sourceMeta: unknown): string[] {
  const meta = asMeta(sourceMeta);
  if (!source || source === "organic" || Object.keys(meta).length === 0) return [];
  const label: Record<string, string> = {
    ad: "Anúncio (click-to-WhatsApp)",
    landing: "Landing page / formulário",
    campaign: "Disparo de campanha",
    manual: "Cadastro manual",
  };
  const lines = [`ORIGEM DO LEAD: ${label[source] ?? source}`];
  const network = meta.network ?? meta.network_raw;
  if (network) lines.push(`REDE DO ANÚNCIO: ${network}`);
  if (meta.utm_campaign) lines.push(`CAMPANHA: ${meta.utm_campaign}`);
  if (meta.utm_source) lines.push(`UTM SOURCE: ${meta.utm_source}`);
  if (meta.ad_id) lines.push(`AD ID: ${meta.ad_id}`);
  return lines;
}
