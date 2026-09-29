import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  MAX_AUDIO_DURATION_MS,
  MIN_AUDIO_DURATION_MS,
  formatDuration,
  pickRecordingMime,
} from "@/lib/audio-shared"
import { isOggContainer, prepareAudioForSend } from "@/lib/opus-convert"

// ---------------------------------------------------------------------------
// useAudioRecorder
// ---------------------------------------------------------------------------
// Gravação da bolha de voz pelo vendedor (web/PWA).
//
// Três decisões de implementação que valem registro:
//
// 1. A duração vem do relógio de parede, não de `MediaRecorder.onstop`. O
//    `blob.duration` do MediaRecorder é Infinity nos navegadores que não
//    carregam os metadados do container — o Safari é o caso comum. O Evolution
//    não devolve duração, então quem manda é o cliente, e um NaN/Infinity aqui
//    passaria pela validação do servidor.
//
// 2. O cleanup é explícito e roda em três gatilhos: unmount, troca de conversa
//    (o `stop` é dependência do effect) e descarte. Sem isso o ícone de
//    microfone fica preso aceso e o stream de mídia fica aberto.
//
// 3. O container é escolhido por `isTypeSupported`, com ogg/opus primeiro — é o
//    único que o WhatsApp renderiza como bolha de voz com microfone.
//    Se o navegador não suportar nenhum, o hook entra em `unsupported` e a UI
//    esconde o botão (o usuário ainda pode anexar um arquivo de áudio).

export type RecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "processing"
  | "preview"
  | "denied"
  | "unsupported"

export type AudioRecording = {
  blob: Blob
  mime: string
  durationMs: number
  fileName: string
}

function isBrowserRecordingSupported(): boolean {
  return typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== "undefined"
}

export function useAudioRecorder() {
  const [status, setStatus] = useState<RecorderStatus>(() =>
    isBrowserRecordingSupported() ? "idle" : "unsupported"
  )
  const [durationMs, setDurationMs] = useState(0)
  const [recording, setRecording] = useState<AudioRecording | null>(null)
  // Pulso de 250ms só para redesenhar a duração enquanto grava.
  const [tick, setTick] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const startedAtRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  // Blob da gravação em andamento. Permite saber se o usuário ainda está
  // olhando para ela quando a conversão assincrônica terminar, e garante
  // que o áudio sobreviva a qualquer falha no pós-processamento.
  const recordingRef = useRef<Blob | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const releasePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
  }, [])

  // Descarta tudo e volta para idle. Usado no unmount e ao trocar de conversa.
  const reset = useCallback(() => {
    clearTimer()
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop()
      } catch {
        // Já parado — nada a fazer.
      }
    }
    recorderRef.current = null
    releaseStream()
    releasePreviewUrl()
    chunksRef.current = []
    recordingRef.current = null
    startedAtRef.current = 0
    setRecording(null)
    setDurationMs(0)
    setTick(0)
    setStatus(isBrowserRecordingSupported() ? "idle" : "unsupported")
  }, [clearTimer, releaseStream, releasePreviewUrl])

  // Unmount e troca de conversa: nada pode sobreviver a isso.
  useEffect(() => reset, [reset])

  // Constrói o AudioRecording final a partir de um blob.
  const buildRecording = useCallback((blob: Blob, durationMs: number, fallbackMime: string): AudioRecording => {
    const finalMime = blob.type || fallbackMime
    const ext = finalMime.includes("mp4")
      ? "m4a"
      : finalMime.includes("webm")
      ? "webm"
      : "ogg"
    return { blob, mime: finalMime, durationMs, fileName: `audio.${ext}` }
  }, [])

  // Convert é async e pode demorar (chunk de ~724 KB) ou falhar. Durante esse
  // tempo a gravação TEM que continuar visível e enviável: é por isso que
  // `recordingRef` guarda o blob desde o `onstop`, antes de qualquer await.
  const convertInBackground = useCallback(
    async (raw: Blob, durationMs: number, fallbackMime: string) => {
      try {
        const { blob } = await prepareAudioForSend(raw, durationMs)
        // Só troca se o usuário ainda estiver olhando para esta gravação
        // (pode ter descartado ou trocado de conversa durante a conversão).
        if (recordingRef.current === raw) {
          setRecording(buildRecording(blob, durationMs, fallbackMime))
          setStatus("preview")
        }
      } catch (err) {
        // prepareAudioForSend já é best-effort e devolve o original; se mesmo
        // assim lançar, o preview com o blob original já está na tela.
        console.error("[audio] falha inesperada na preparacao do envio", err)
      }
    },
    [buildRecording],
  )

  const finishRecording = useCallback((mime: string) => {
    clearTimer()
    const chunks = chunksRef.current
    chunksRef.current = []
    releaseStream()

    const measured = Math.max(0, Date.now() - startedAtRef.current)
    // Safari pode reportar duration Infinity/NaN; a medição de parede é a
    // fonte da verdade, e o clamp cobre a janela entre start e stop.
    const measuredClamped = Number.isFinite(measured) ? measured : 0

    if (chunks.length === 0 || measuredClamped < MIN_AUDIO_DURATION_MS) {
      setRecording(null)
      setDurationMs(0)
      setStatus("idle")
      return
    }

    const raw = new Blob(chunks, { type: mime })

    // 1) Publica IMEDIATAMENTE o blob original. O usuário já pode revisar e
    //    enviar; nada depende da conversão.
    recordingRef.current = raw
    setRecording(buildRecording(raw, measuredClamped, mime))
    setDurationMs(measuredClamped)

    // 2) Só converte se o browser não gravar ogg nativamente. Quando grava,
    //    pulamos direto para o preview sem passar por "processing".
    if (isOggContainer(raw)) {
      setStatus("preview")
      return
    }

    setStatus("processing")
    void convertInBackground(raw, measuredClamped, mime)
  }, [buildRecording, clearTimer, convertInBackground, releaseStream])

  const start = useCallback(async () => {
    if (!isBrowserRecordingSupported()) {
      setStatus("unsupported")
      return
    }

    // Uma gravação em andamento é descartada se o usuário pedir outra.
    reset()

    const mime = pickRecordingMime(
      (t) => window.MediaRecorder.isTypeSupported(t)
    )
    if (!mime) {
      setStatus("unsupported")
      toast.error("Este navegador não suporta gravação de áudio")
      return
    }

    setStatus("requesting")
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setStatus("denied")
      const name = (err as DOMException)?.name
      if (name === "NotAllowedError" || name === "SecurityError") {
        toast.error("Permissão de microfone negada")
      } else if (name === "NotFoundError") {
        toast.error("Nenhum microfone encontrado")
      } else {
        toast.error("Não foi possível acessar o microfone")
      }
      return
    }

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    } catch {
      releaseStream()
      setStatus("idle")
      toast.error("Falha ao iniciar a gravação")
      return
    }

    streamRef.current = stream
    recorderRef.current = recorder
    chunksRef.current = []

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
    }
    recorder.onstop = () => {
      finishRecording(mime || recorder.mimeType || "audio/ogg")
    }
    // onerror sem tratamento deixa o ícone preso em "gravando" para sempre.
    recorder.onerror = () => {
      toast.error("Erro durante a gravação")
      reset()
    }

    startedAtRef.current = Date.now()
    recorder.start(250)
    setDurationMs(0)
    setStatus("recording")

    timerRef.current = window.setInterval(() => {
      setTick((t) => t + 1)
      if (Date.now() - startedAtRef.current >= MAX_AUDIO_DURATION_MS) {
        try {
          recorder.stop()
        } catch {
          // race com um stop manual — o onstop já vai fechar.
        }
      }
    }, 250)
  }, [finishRecording, reset, releaseStream])

  const stop = useCallback(() => {
    clearTimer()
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop()
      } catch {
        // ignore
      }
    }
  }, [clearTimer])

  const cancel = useCallback(() => {
    reset()
  }, [reset])

  const discard = useCallback(() => {
    reset()
  }, [reset])

  // Duração ao vivo. O cálculo puro acontece num effect (que roda quando
  // `tick` muda, a cada 250ms durante a gravação) e o render só lê o estado —
  // chamar Date.now() ou ler ref aqui violaria as regras de pureza do React.
  const [liveMs, setLiveMs] = useState(0)
  useEffect(() => {
    if (status !== "recording") {
      setLiveMs(durationMs)
      return
    }
    const measured = Math.min(MAX_AUDIO_DURATION_MS, Date.now() - startedAtRef.current)
    setLiveMs(Number.isFinite(measured) ? measured : 0)
  }, [status, durationMs, tick])

  return {
    status,
    recording,
    durationMs: liveMs,
    remainingMs: Math.max(0, MAX_AUDIO_DURATION_MS - liveMs),
    formattedDuration: formatDuration(liveMs),
    isRecording: status === "recording",
    isProcessing: status === "processing",
    isPreview: status === "preview",
    isSupported: status !== "unsupported",
    start,
    stop,
    cancel,
    discard,
    reset,
  }
}
