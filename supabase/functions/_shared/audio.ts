// Camada compartilhada do áudio gravado pelo vendedor (bolha de voz).
//
// Duas responsabilidades:
//   1. Escolher o container que o MediaRecorder vai produzir (client-side).
//   2. Validar o que chegou no servidor — o cliente NUNCO é confiável.
//
// O WhatsApp renderiza uma "bolha de voz" (microfone, com duração) apenas para
// o container OGG/Opus. WebM/Opus costuma ser rejeitado pelo Baileys ou cair
// como documento, então a preferência é sempre ogg; os demais são fallback.
//
// Os limites aqui espelham as checagens que já existem no evolution-proxy
// (20 MB em index.ts:480) e na transcrição (12 MB base64 em transcribe.ts:18).

// ---------------------------------------------------------------------------
// Limites
// ---------------------------------------------------------------------------

// Espelha o teto de send-media do evolution-proxy (20 MB).
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

// Espelha o teto de base64 da transcrição (~9 MB binário, transcribe.ts:18).
export const MAX_AUDIO_BASE64_BYTES = 12 * 1024 * 1024;

// WhatsApp aceita bem mais que isso, mas acima de ~5 min o custo da
// transcrição e o atraso do SDR crescem sem ganho comercial.
export const MAX_AUDIO_DURATION_MS = 5 * 60 * 1000;

export const MIN_AUDIO_DURATION_MS = 500;

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

// Ordem de preferência: o primeiro que o navegador suportar.
// `audio/ogg;codecs=opus` é o único que vira bolha de voz nativa.
export const RECORDING_MIME_CANDIDATES = [
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

export type RecordingMime = (typeof RECORDING_MIME_CANDIDATES)[number] | "";

/** Base do MIME, sem o parâmetro de codecs. */
export function baseMime(mimetype: string): string {
  return (mimetype ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Primeiro container suportado pelo navegador. `isTypeSupported` é injetado
 * para poder ser testado sem DOM.
 */
export function pickRecordingMime(
  isTypeSupported: (type: string) => boolean,
): RecordingMime {
  for (const candidate of RECORDING_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch {
      // Navegador pode lançar em types malformados — segue para o próximo.
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Validação server-side
// ---------------------------------------------------------------------------

// Allowlist espelhando o bucket (config.toml:124 + migration 056).
// `audio/webm` entrou na 056 — sem ela o upload falha em silêncio.
const ALLOWED_AUDIO_BASES = new Set([
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/amr",
]);

export function isAllowedAudioMime(mimetype: string): boolean {
  return ALLOWED_AUDIO_BASES.has(baseMime(mimetype));
}

/** Extensão para o container, usada no nome do objeto no Storage. */
export function audioExtension(mimetype: string): string {
  const map: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/amr": "amr",
  };
  return map[baseMime(mimetype)] ?? "ogg";
}

/**
 * Valida o áudio recebido. Retorna `{ ok: true }` ou `{ ok: false, error }`
 * com mensagem em pt-BR, no mesmo tom das demais respostas do proxy.
 */
export function validateAudioUpload(input: {
  mime: string;
  sizeBytes: number;
  durationMs: number;
}): { ok: true } | { ok: false; error: string } {
  const { mime, sizeBytes, durationMs } = input;

  if (!isAllowedAudioMime(mime)) {
    return { ok: false, error: `formato de áudio não suportado (${mime || "desconhecido"})` };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: "arquivo de áudio vazio" };
  }
  if (sizeBytes > MAX_AUDIO_BYTES) {
    return { ok: false, error: "áudio muito grande (máx. 20 MB)" };
  }
  if (!Number.isFinite(durationMs) || durationMs < MIN_AUDIO_DURATION_MS) {
    return { ok: false, error: "gravação muito curta" };
  }
  if (durationMs > MAX_AUDIO_DURATION_MS) {
    return {
      ok: false,
      error: `gravação muito longa (máx. ${Math.round(MAX_AUDIO_DURATION_MS / 60000)} min)`,
    };
  }
  return { ok: true };
}

/**
 * O MediaRecorder entrega duration === Infinity quando a duração é desconhecida
 * (Safari). O navegador web tem o fluxo de dados em WebAudio, então medimos
 * pelo tempo decorrido do relógio de parede.
 */
export function elapsedMs(startedAt: number, now: number): number {
  return Math.max(0, Math.round(now - startedAt));
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}
