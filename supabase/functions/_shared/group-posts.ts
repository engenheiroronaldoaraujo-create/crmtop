// _shared/group-posts.ts
// Helpers puros (sem I/O) dos posts em grupo + DM a quem comentar — isolados
// aqui para serem testáveis direto (`deno test`), mesmo padrão de
// noreply-schedule.ts.

import { substituteVariables } from "./noreply-schedule.ts";

/** JIDs de grupo Baileys/Evolution. */
export function isGroupJid(jid: string | null | undefined): boolean {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

/**
 * Comentário dentro da janela de engajamento? (published_at, published_at + window].
 */
export function isWithinEngagementWindow(
  publishedAt: Date,
  commentedAt: Date,
  windowHours: number,
): boolean {
  const start = publishedAt.getTime();
  const t = commentedAt.getTime();
  if (Number.isNaN(start) || Number.isNaN(t)) return false;
  if (t <= start) return false;
  return t <= start + windowHours * 3600_000;
}

/**
 * Jitter do delay da DM: segundos inteiros dentro de [minS, maxS].
 * `rand` injetável para testes (default Math.random).
 */
export function pickDmDelaySeconds(
  minS: number,
  maxS: number,
  rand: () => number = Math.random,
): number {
  const lo = Math.max(0, Math.floor(minS));
  const hi = Math.max(lo, Math.floor(maxS));
  if (hi === lo) return lo;
  return lo + Math.floor(rand() * (hi - lo + 1));
}

/** Quando a DM deve sair: comentário + jitter. */
export function engagementDueAt(
  commentedAt: Date,
  minS: number,
  maxS: number,
  rand: () => number = Math.random,
): Date {
  return new Date(commentedAt.getTime() + pickDmDelaySeconds(minS, maxS, rand) * 1000);
}

/** Render do template da DM com o nome do contato (fallback "você"). */
export function renderGroupDm(template: string, contactName: string | null): string {
  const name = (contactName ?? "").trim() || "você";
  return substituteVariables(template, {
    contact: { name },
    contact_name: name,
  });
}

/**
 * Extrai o stanzaId da mensagem citada (reply), cobrindo texto e mídias com
 * legenda — o contextInfo vive dentro de cada tipo de mensagem.
 */
export function extractQuotedId(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  const candidates: unknown[] = [
    (m.extendedTextMessage as Record<string, unknown> | undefined)?.contextInfo,
  ];
  for (const key of ["imageMessage", "videoMessage", "documentMessage", "audioMessage", "stickerMessage"]) {
    const sub = m[key] as Record<string, unknown> | undefined;
    if (sub) candidates.push(sub.contextInfo);
  }
  for (const c of candidates) {
    if (c && typeof c === "object") {
      const stanzaId = (c as Record<string, unknown>).stanzaId;
      if (typeof stanzaId === "string" && stanzaId) return stanzaId;
    }
  }
  return null;
}
