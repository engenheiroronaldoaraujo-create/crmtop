// Camada compartilhada de transcrição de áudio (webhook + ai-service).
// OpenRouter recebe o áudio como content part `input_audio` (data URI +
// formato). Modelos de chat multimodais (ex.: Gemini Flash) transcrevem bem
// PT-BR. Tudo aqui é best-effort: falha nunca derruba o ingest da mensagem.

export const TRANSCRIPTION_PROMPT =
  "Transcreva literalmente o áudio em português do Brasil. " +
  "Ignore ruídos de fundo. Se não houver fala inteligível, responda apenas com a palavra: VAZIO";

export const EMPTY_TRANSCRIPTS = new Set(["", "vazio", "none", "null"]);

function isEmptyTranscript(text: string): boolean {
  const norm = text.toLowerCase().replace(/[\s.\[\]()!]+/g, "");
  return EMPTY_TRANSCRIPTS.has(norm);
}

// Limite de segurança do payload enviado ao OpenRouter (base64).
export const MAX_AUDIO_BASE64_BYTES = 12 * 1024 * 1024; // ~9 MB de áudio binário

export function pickAudioFormat(mimetype: string): string {
  const base = (mimetype ?? "").split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/amr": "amr",
    "audio/webm": "webm",
  };
  return map[base] ?? "ogg";
}

export function shouldAttemptTranscription(opts: {
  enabled: boolean;
  isAudio: boolean;
  isFromMe: boolean;
  base64Length: number;
}): boolean {
  if (!opts.enabled || !opts.isAudio || opts.isFromMe) return false;
  if (opts.base64Length === 0) return false;
  if (opts.base64Length > MAX_AUDIO_BASE64_BYTES) return false;
  return true;
}

export function buildTranscriptionRequest(opts: {
  model: string;
  base64: string;
  mimetype: string;
  maxTokens?: number;
}): Record<string, unknown> {
  return {
    model: opts.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: TRANSCRIPTION_PROMPT },
          {
            type: "input_audio",
            input_audio: {
              data: opts.base64,
              format: pickAudioFormat(opts.mimetype),
            },
          },
        ],
      },
    ],
    temperature: 0,
    max_tokens: opts.maxTokens ?? 512,
  };
}

export function parseTranscriptionResponse(json: any): string {
  let raw = json?.choices?.[0]?.message?.content ?? "";
  if (Array.isArray(raw)) {
    raw = raw
      .map((part: any) => (typeof part === "string" ? part : part?.text ?? ""))
      .join("");
  }
  const text = String(raw).trim();
  if (isEmptyTranscript(text)) return "";
  return text;
}

export const DEFAULT_TRANSCRIPTION_MODEL = "google/gemini-2.5-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function transcribeAudio(opts: {
  apiKey: string;
  model: string;
  base64: string;
  mimetype: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}): Promise<string> {
  if (!opts.apiKey) throw new Error("OPENROUTER_API_KEY ausente para transcrição");
  const doFetch = opts.fetchFn ?? fetch;
  const res = await doFetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://crm-top.vercel.app",
      "X-Title": "CRM_TOP_TRANSCRIBE",
    },
    body: JSON.stringify(
      buildTranscriptionRequest({
        model: opts.model,
        base64: opts.base64,
        mimetype: opts.mimetype,
      }),
    ),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`transcription failed ${res.status}: ${err.slice(0, 200)}`);
  }
  return parseTranscriptionResponse(await res.json());
}
