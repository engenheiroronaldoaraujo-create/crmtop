// Conversão do áudio gravado para o container que o WhatsApp entende.
//
// O problema: o WhatsApp só renderiza "bolha de voz" (o microfone com duração)
// a partir de OGG/Opus. O container nativo depende do navegador:
//
//   Firefox  -> audio/ogg;codecs=opus   (já é o formato certo)
//   Chrome   -> audio/webm;codecs=opus  (NÃO é; o Baileys rejeita/manda como doc)
//   Safari   -> audio/mp4               (NÃO é)
//
// Sem converter, no Chrome o áudio não vira bolha de voz — e dependendo da
// build do Evolution nem chega a ser entregue.
//
// A conversão webm/opus -> ogg/opus NÃO decodifica: é repackaging dos mesmos
// pacotes Opus em outro container, então é rápida e sem perda. O mediabunny faz
// isso em TypeScript puro, sem WASM.
//
// Tudo aqui é best-effort por design: qualquer falha devolve o blob original,
// que continua sendo um áudio válido — só não como bolha de voz. Nunca vale
// perder a gravação por causa de uma conversão.

import { MAX_AUDIO_DURATION_MS } from "./audio-shared"

/**
 * Teto absoluto para a conversão.
 *
 * Motivo: `import("mediabunny")` baixa um chunk de ~724 KB (183 KB gzip) e o
 * `conversion.execute()` não tem prazo. Em 3G/WiFi ruim — ou se a biblioteca
 * travar num codec inesperado — a promise simplesmente nunca resolve. Sem
 * este timeout o `await` do chamador fica pendurado para sempre e a gravação
 * some da tela sem erro nenhum.
 *
 * A conversão é opcional por definição: passados 20s, o blob original (webm)
 * é melhor do que nenhum áudio. Matematicamente o repackaging de até 5 min
 * leva bem menos que isso; o teto existe para o pior caso, não para o normal.
 */
const CONVERSION_TIMEOUT_MS = 20_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} excedeu ${ms}ms`)),
      ms,
    )
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/**
 * O container já é o que o WhatsApp quer? (Firefox cai aqui direto.)
 */
export function isOggContainer(blob: Blob): boolean {
  const type = (blob.type ?? "").toLowerCase()
  return type.includes("ogg") || type.includes("opus")
}

/** Módulo pesado: só entra no bundle quando a conversão é mesmo necessária. */
let converterPromise: Promise<typeof import("mediabunny")> | null = null

async function loadConverter() {
  if (!converterPromise) {
    converterPromise = import("mediabunny")
  }
  return converterPromise
}

/**
 * Converte a gravação para OGG/Opus. Devolve o blob original se não der —
 * o chamador sempre consegue enviar algo.
 */
export async function toOggOpus(blob: Blob): Promise<Blob> {
  if (isOggContainer(blob)) return blob

  // Safari grava mp4; não há caminho barato de AAC -> Opus, e o WhatsApp
  // aceita m4a como áudio comum. Deixa como está.
  if ((blob.type ?? "").toLowerCase().includes("mp4")) {
    console.warn("[audio] container mp4 mantido sem converter para ogg/opus")
    return blob
  }

  try {
    // O import dinâmico é a parte lenta e não pode ser abortado — fica dentro
    // do timeout junto com a conversão, senão o download do chunk trava tudo.
    const { Input, Output, BufferTarget, OggOutputFormat, ALL_FORMATS, BlobSource, Conversion } =
      await withTimeout(loadConverter(), CONVERSION_TIMEOUT_MS, "import do conversor")

    const input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    })
    const target = new BufferTarget()
    const output = new Output({
      format: new OggOutputFormat(),
      target,
    })

    const conversion = await withTimeout(
      Conversion.init({ input, output }),
      CONVERSION_TIMEOUT_MS,
      "init da conversao",
    )
    await withTimeout(conversion.execute(), CONVERSION_TIMEOUT_MS, "execucao da conversao")
    await withTimeout(output.finalize(), CONVERSION_TIMEOUT_MS, "finalizacao da conversao")

    const buffer = target.buffer
    if (!buffer || buffer.byteLength === 0) {
      throw new Error("conversão devolveu buffer vazio")
    }

    const converted = new Blob([buffer], { type: "audio/ogg;codecs=opus" })
    console.log(
      "[audio] convertido para ogg/opus",
      `${blob.size}B ${blob.type} -> ${converted.size}B ${converted.type}`,
    )
    return converted
  } catch (err) {
    // Log e segue: o áudio original ainda é enviável.
    console.error("[audio] falha ao converter para ogg/opus, mantendo original", err)
    return blob
  }
}

/**
 * Aplica a conversão respeitando o teto de duração, para não pagar conversão
 * de um áudio que o servidor recusaria de todo jeito.
 */
export async function prepareAudioForSend(
  blob: Blob,
  durationMs: number,
): Promise<{ blob: Blob; converted: boolean }> {
  if (durationMs > MAX_AUDIO_DURATION_MS) {
    // Sinaliza para a UI avisar; não converte.
    return { blob, converted: false }
  }
  if (isOggContainer(blob)) return { blob, converted: false }

  const converted = await toOggOpus(blob)
  return { blob: converted, converted: converted !== blob }
}
