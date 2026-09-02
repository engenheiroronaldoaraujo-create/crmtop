import { assertEquals } from "jsr:@std/assert";
import {
  buildTranscriptionRequest,
  MAX_AUDIO_BASE64_BYTES,
  parseTranscriptionResponse,
  pickAudioFormat,
  shouldAttemptTranscription,
  transcribeAudio,
} from "./transcribe.ts";

Deno.test("pickAudioFormat — opus (PTT do WhatsApp) vira ogg", () => {
  assertEquals(pickAudioFormat("audio/ogg; codecs=opus"), "ogg");
  assertEquals(pickAudioFormat("audio/opus"), "ogg");
  assertEquals(pickAudioFormat("audio/mpeg"), "mp3");
  assertEquals(pickAudioFormat("audio/mp4"), "m4a");
  assertEquals(pickAudioFormat(""), "ogg");
});

Deno.test("shouldAttemptTranscription — só áudio inbound com transcrição ligada", () => {
  assertEquals(
    shouldAttemptTranscription({ enabled: true, isAudio: true, isFromMe: false, base64Length: 1000 }),
    true,
  );
  assertEquals(
    shouldAttemptTranscription({ enabled: false, isAudio: true, isFromMe: false, base64Length: 1000 }),
    false,
  );
  assertEquals(
    shouldAttemptTranscription({ enabled: true, isAudio: false, isFromMe: false, base64Length: 1000 }),
    false,
  );
  assertEquals(
    shouldAttemptTranscription({ enabled: true, isAudio: true, isFromMe: true, base64Length: 1000 }),
    false,
  );
  assertEquals(
    shouldAttemptTranscription({ enabled: true, isAudio: true, isFromMe: false, base64Length: 0 }),
    false,
  );
});

Deno.test("shouldAttemptTranscription — rejeita áudio acima do limite de payload", () => {
  assertEquals(
    shouldAttemptTranscription({
      enabled: true,
      isAudio: true,
      isFromMe: false,
      base64Length: MAX_AUDIO_BASE64_BYTES + 1,
    }),
    false,
  );
});

Deno.test("buildTranscriptionRequest — content part input_audio com base64 puro", () => {
  const body = buildTranscriptionRequest({
    model: "google/gemini-2.5-flash",
    base64: "QUJD",
    mimetype: "audio/ogg; codecs=opus",
  }) as any;
  assertEquals(body.model, "google/gemini-2.5-flash");
  assertEquals(body.temperature, 0);
  const parts = body.messages[0].content;
  assertEquals(parts[0].type, "text");
  assertEquals(parts[1].type, "input_audio");
  assertEquals(parts[1].input_audio.data, "QUJD");
  assertEquals(parts[1].input_audio.format, "ogg");
});

Deno.test("parseTranscriptionResponse — string simples", () => {
  assertEquals(
    parseTranscriptionResponse({ choices: [{ message: { content: " Quero o preço " } }] }),
    "Quero o preço",
  );
});

Deno.test("parseTranscriptionResponse — array de parts (multimodal)", () => {
  assertEquals(
    parseTranscriptionResponse({
      choices: [{ message: { content: [{ type: "text", text: "Oi," }, { type: "text", text: " tudo bem?" }] } }],
    }),
    "Oi, tudo bem?",
  );
});

Deno.test("parseTranscriptionResponse — VAZIO/silêncio vira string vazia", () => {
  assertEquals(parseTranscriptionResponse({ choices: [{ message: { content: "VAZIO" } }] }), "");
  assertEquals(parseTranscriptionResponse({ choices: [{ message: { content: "vazio." } }] }), "");
  assertEquals(parseTranscriptionResponse({}), "");
});

Deno.test("transcribeAudio — chama OpenRouter e devolve transcrição", async () => {
  let seenBody: any = null;
  const transcript = await transcribeAudio({
    apiKey: "sk-or-test",
    model: "google/gemini-2.5-flash",
    base64: "QUJD",
    mimetype: "audio/ogg",
    fetchFn: (async (_url: any, init: any) => {
      seenBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "olá" } }] }), { status: 200 });
    }) as typeof fetch,
  });
  assertEquals(transcript, "olá");
  assertEquals(seenBody.messages[0].content[1].input_audio.format, "ogg");
});

Deno.test("transcribeAudio — HTTP 4xx lança erro", async () => {
  let err: Error | null = null;
  try {
    await transcribeAudio({
      apiKey: "sk-or-test",
      model: "x",
      base64: "QUJD",
      mimetype: "audio/ogg",
      fetchFn: (async () => new Response("boom", { status: 400 })) as typeof fetch,
    });
  } catch (e) {
    err = e as Error;
  }
  assertEquals(err?.message?.startsWith("transcription failed 400"), true);
});
