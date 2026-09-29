// Remux server-side de webm/opus -> ogg/opus.
//
// POR QUE NO SERVIDOR: o container que o Chrome produz (webm/opus) não é o
// que o WhatsApp renderiza como bolha de voz (ogg/opus). A primeira tentativa
// foi converter no cliente — e falhou repetidamente em campo: a assinatura no
// banco (audio_recordings.mime = "audio/webm;codecs=opus" mesmo depois do
// código de conversão publicado) mostra que o navegador do usuário não
// executou a conversão, provavelmente por cache do service worker.
//
// Como o remux não transcodifica — os pacotes Opus são idênticos, só troca o
// container — ele NÃO precisa de WebCodecs. Verificado em Node puro (que não
// tem WebCodecs): webm 38.944 B -> ogg 38.764 B, assinatura "OggS" correta.
// Por isso roda em Deno/Edge Function.
//
// Ver _shared/audio.ts para os limites de tamanho/duração.

const EBML_HEADER = [0x1a, 0x45, 0xdf, 0xa3];

/** O blob é um container Matroska/WebM (o que o MediaRecorder do Chrome gera)? */
export function isWebm(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === EBML_HEADER[0] &&
    bytes[1] === EBML_HEADER[1] &&
    bytes[2] === EBML_HEADER[2] &&
    bytes[3] === EBML_HEADER[3];
}

/** O blob já é Ogg (o que o Firefox gera nativamente e o WhatsApp espera)? */
export function isOgg(bytes: Uint8Array): boolean {
  // "OggS"
  return bytes.length >= 4 &&
    bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
}

/**
 * Remuxa webm/opus para ogg/opus — o formato das bolhas de voz do WhatsApp.
 * Devolve os bytes de entrada quando não é webm ou quando a conversão falha:
 * o chamador decide o que fazer com o container original, mas nunca perde o
 * áudio por causa do remux.
 */
export async function remuxWebmToOgg(
  bytes: Uint8Array,
  timeoutMs = 15_000,
): Promise<Uint8Array> {
  if (!isWebm(bytes)) return bytes;

  try {
    const { Input, Output, BufferTarget, OggOutputFormat, ALL_FORMATS, BlobSource, Conversion } =
      await import("npm:mediabunny@1.60.0");

    const input = new Input({
      // Uint8Array.buffer é ArrayBufferLike; Blob exige ArrayBuffer puro.
      source: new BlobSource(new Blob([bytes as unknown as ArrayBuffer], {
        type: "audio/webm;codecs=opus",
      })),
      formats: ALL_FORMATS,
    });
    const target = new BufferTarget();
    const output = new Output({
      format: new OggOutputFormat(),
      target,
    });

    // O Edge Function tem prazo de execução; um remux travado não pode levar
    // o request junto.
    const conversion = await Promise.race([
      (async () => {
        const conv = await Conversion.init({ input, output });
        await conv.execute();
        await output.finalize();
        return target.buffer;
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);

    if (!conversion || conversion.byteLength === 0) {
      console.error("REMUX_TIMEOUT_OU_VAZIO");
      return bytes;
    }
    const out = new Uint8Array(conversion.slice(0));
    if (!isOgg(out)) {
      console.error("REMUX_SAIDA_INESPERADA", out.slice(0, 4).toString());
      return bytes;
    }
    console.log("REMUX_OK", bytes.length, "->", out.length);
    return out;
  } catch (err) {
    // Best-effort: devolve o original e deixa o chamador decidir.
    console.error("REMUX_ERROR", err instanceof Error ? err.message : String(err));
    return bytes;
  }
}
