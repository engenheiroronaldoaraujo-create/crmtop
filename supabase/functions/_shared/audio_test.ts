import { assertEquals } from "jsr:@std/assert";
import {
  audioExtension,
  baseMime,
  elapsedMs,
  formatDuration,
  isAllowedAudioMime,
  MAX_AUDIO_BASE64_BYTES,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_MS,
  MIN_AUDIO_DURATION_MS,
  pickRecordingMime,
  validateAudioUpload,
} from "./audio.ts";

Deno.test("pickRecordingMime — prefere ogg/opus (único que vira bolha de voz)", () => {
  const all = () => true;
  assertEquals(pickRecordingMime(all), "audio/ogg;codecs=opus");
});

Deno.test("pickRecordingMime — cai para webm quando ogg não é suportado", () => {
  // Chrome suporta webm/opus mas não ogg no MediaRecorder.
  const chromeLike = (t: string) => t.includes("webm") || t === "audio/mp4";
  assertEquals(pickRecordingMime(chromeLike), "audio/webm;codecs=opus");
});

Deno.test("pickRecordingMime — cai para mp4 no Safari", () => {
  const safariLike = (t: string) => t === "audio/mp4";
  assertEquals(pickRecordingMime(safariLike), "audio/mp4");
});

Deno.test("pickRecordingMime — devolve vazio quando nada é suportado", () => {
  assertEquals(pickRecordingMime(() => false), "");
});

Deno.test("pickRecordingMime — isTypeSupported lançando não aborta a cadeia", () => {
  const throwing = (t: string) => {
    if (t === "audio/ogg;codecs=opus") throw new Error("bad type");
    return t === "audio/webm";
  };
  assertEquals(pickRecordingMime(throwing), "audio/webm");
});

Deno.test("baseMime — remove o parâmetro de codecs", () => {
  assertEquals(baseMime("audio/ogg; codecs=opus"), "audio/ogg");
  assertEquals(baseMime("AUDIO/WEBM;codecs=opus"), "audio/webm");
  assertEquals(baseMime(""), "");
});

Deno.test("isAllowedAudioMime — aceita webm e ogg, rejeita o resto", () => {
  assertEquals(isAllowedAudioMime("audio/ogg;codecs=opus"), true);
  assertEquals(isAllowedAudioMime("audio/webm;codecs=opus"), true);
  assertEquals(isAllowedAudioMime("audio/mp4"), true);
  assertEquals(isAllowedAudioMime("image/png"), false);
  assertEquals(isAllowedAudioMime("application/octet-stream"), false);
  assertEquals(isAllowedAudioMime(""), false);
});

Deno.test("audioExtension — mapeia container para extensão do objeto", () => {
  assertEquals(audioExtension("audio/ogg;codecs=opus"), "ogg");
  assertEquals(audioExtension("audio/webm;codecs=opus"), "webm");
  assertEquals(audioExtension("audio/mp4"), "m4a");
  // Formato desconhecido cai em ogg — o container mais compatível com o WhatsApp.
  assertEquals(audioExtension("audio/xyz"), "ogg");
});

Deno.test("validateAudioUpload — aceita gravação válida", () => {
  assertEquals(
    validateAudioUpload({ mime: "audio/ogg;codecs=opus", sizeBytes: 120_000, durationMs: 8000 }),
    { ok: true },
  );
});

Deno.test("validateAudioUpload — rejeita formato não-áudio", () => {
  const r = validateAudioUpload({ mime: "image/png", sizeBytes: 1000, durationMs: 5000 });
  assertEquals(r.ok, false);
  assertEquals(r.ok === false && r.error.includes("não suportado"), true);
});

Deno.test("validateAudioUpload — rejeita arquivo vazio", () => {
  const r = validateAudioUpload({ mime: "audio/ogg", sizeBytes: 0, durationMs: 5000 });
  assertEquals(r.ok, false);
  assertEquals(r.ok === false && r.error.includes("vazio"), true);
});

Deno.test("validateAudioUpload — rejeita acima de 20 MB", () => {
  const r = validateAudioUpload({
    mime: "audio/ogg",
    sizeBytes: MAX_AUDIO_BYTES + 1,
    durationMs: 5000,
  });
  assertEquals(r.ok, false);
  assertEquals(r.ok === false && r.error.includes("muito grande"), true);
});

Deno.test("validateAudioUpload — aceita exatamente 20 MB", () => {
  assertEquals(
    validateAudioUpload({ mime: "audio/ogg", sizeBytes: MAX_AUDIO_BYTES, durationMs: 5000 }).ok,
    true,
  );
});

Deno.test("validateAudioUpload — rejeita gravação curta demais (toque acidental)", () => {
  const r = validateAudioUpload({ mime: "audio/ogg", sizeBytes: 2000, durationMs: 100 });
  assertEquals(r.ok, false);
  assertEquals(r.ok === false && r.error.includes("curta"), true);
});

Deno.test("validateAudioUpload — rejeita acima do teto de duração", () => {
  const r = validateAudioUpload({
    mime: "audio/ogg",
    sizeBytes: 5_000_000,
    durationMs: MAX_AUDIO_DURATION_MS + 1,
  });
  assertEquals(r.ok, false);
  assertEquals(r.ok === false && r.error.includes("longa"), true);
});

Deno.test("validateAudioUpload — rejeita duração NaN/infinita (Safari)", () => {
  assertEquals(
    validateAudioUpload({ mime: "audio/ogg", sizeBytes: 5000, durationMs: Number.NaN }).ok,
    false,
  );
  assertEquals(
    validateAudioUpload({ mime: "audio/ogg", sizeBytes: 5000, durationMs: Number.POSITIVE_INFINITY })
      .ok,
    false,
  );
});

Deno.test("validateAudioUpload — duração exatamente no mínimo é aceita", () => {
  assertEquals(
    validateAudioUpload({ mime: "audio/ogg", sizeBytes: 5000, durationMs: MIN_AUDIO_DURATION_MS }).ok,
    true,
  );
});

Deno.test("elapsedMs — relógio de parede nunca devolve negativo", () => {
  assertEquals(elapsedMs(1000, 3500), 2500);
  // Relógio adjusts para trás (NTP) não pode gerar duração negativa.
  assertEquals(elapsedMs(5000, 4000), 0);
});

Deno.test("formatDuration — m:ss", () => {
  assertEquals(formatDuration(0), "0:00");
  assertEquals(formatDuration(8000), "0:08");
  assertEquals(formatDuration(65_000), "1:05");
  assertEquals(formatDuration(300_000), "5:00");
});

Deno.test("limites ficam coerentes entre áudio e transcrição", () => {
  // O teto binário (20 MB) é maior que o de base64 (12 MB) — a transcrição
  // recusa antes do envio recusar, que é o comportamento desejado.
  assertEquals(MAX_AUDIO_BYTES > MAX_AUDIO_BASE64_BYTES, true);
});
