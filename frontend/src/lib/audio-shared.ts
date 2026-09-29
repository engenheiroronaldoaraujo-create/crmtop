// Espelho client-side de supabase/functions/_shared/audio.ts.
//
// POR QUE DUPLICA: o frontend tem tsconfig próprio (include: ["src"]) e a
// Vercel só instala as deps de frontend/, então as Edge Functions não são
// importáveis daqui sem quebrar `tsc -b` e o build. Mantém-se só o que o
// cliente precisa; a validação autoritativa é a do servidor
// (validateAudioUpload), que roda de novo em evolution-proxy.
//
// Ao mudar um limite aqui, mudar também no original e rodar
// `deno test supabase/functions/_shared/audio_test.ts`.

export const MAX_AUDIO_BYTES = 20 * 1024 * 1024
export const MAX_AUDIO_DURATION_MS = 5 * 60 * 1000
export const MIN_AUDIO_DURATION_MS = 500

/** Ordem de preferência: ogg/opus é o único que vira bolha de voz no WhatsApp. */
export const RECORDING_MIME_CANDIDATES = [
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const

export function pickRecordingMime(
  isTypeSupported: (type: string) => boolean,
): string {
  for (const candidate of RECORDING_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(candidate)) return candidate
    } catch {
      // Navegador pode lançar em types malformados — segue para o próximo.
    }
  }
  return ""
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const min = Math.floor(total / 60)
  const sec = total % 60
  return `${min}:${String(sec).padStart(2, "0")}`
}
