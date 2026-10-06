// DIAGNÓSTICO TEMPORÁRIO — apagar após o teste.
//
// Objetivo único: obter a resposta CRUA do Evolution para sendMedia com áudio,
// que é o dado faltante. Não é possível ler os logs da função pela CLI, então o
// diagnóstico se registra em activity_log (legível via SQL).
//
// Envia o MESMO áudio em três variantes para separar o que quebra:
//   1. mediatype audio (voz)      — o que o app faz
//   2. mediatype audio + fileName .audio — como os 66 históricos que chegaram
//   3. mediatype document         — controlado: documents entregam (46 no banco)
//
// Autenticado por DIAG_TOKEN (definido via supabase secrets set). A função é
// removida assim que as respostas forem lidas.

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, type Supabase } from "../_shared/contacts.ts";

const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") ?? "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
const DIAG_TOKEN = Deno.env.get("DIAG_TOKEN") ?? "";

async function log(supabase: Supabase, label: string, data: Record<string, unknown>) {
  await supabase.from("activity_log").insert({
    entity_type: "diagnostic",
    action: label,
    old_data: null,
    new_data: data,
  }).then(
    () => {},
    (e: unknown) => console.error("DIAG_LOG_FAIL", String(e)),
  );
}

async function sendVariant(
  instance: string,
  target: string,
  variant: string,
  media: string,
  extra: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    number: target,
    mediatype: "audio",
    media,
    isBase64: true,
    ...extra,
  };
  if (variant === "document") payload.mediatype = "document";
  const t0 = Date.now();
  let status = 0;
  let body = "";
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/message/sendMedia/${instance}`, {
      method: "POST",
      headers: { apikey: EVOLUTION_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    status = res.status;
    body = await res.text();
  } catch (err) {
    status = -1;
    body = String(err);
  }
  let parsed: unknown = null;
  try { parsed = JSON.parse(body); } catch { parsed = null; }
  const p = parsed as Record<string, unknown> | null;
  return {
    variant,
    status,
    ms: Date.now() - t0,
    key_id: ((p?.key as Record<string, unknown>)?.id) ?? null,
    fileName: String(payload.fileName ?? "-"),
    mediatype: String(payload.mediatype),
    body: body.slice(0, 1200),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!DIAG_TOKEN || token !== DIAG_TOKEN) {
    return jsonResponse(401, { error: "diagnostic token invalid" });
  }

  try {
    const supabase = serviceClient();

    // Pega o áudio mais recente já enviado (o ogg remuxado pelo app) —
    // mesmos bytes que falham, sem precisar que ninguém grave de novo.
    const overridePath = url.searchParams.get("path");
    const { data: audio } = overridePath
      ? { data: { media_url: overridePath } }
      : await supabase
      .from("messages")
      .select("media_url, evolution_message_id")
      .eq("type", "audio")
      .eq("direction", "outbound")
      .not("media_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!audio?.media_url || (!overridePath && !audio.media_url.endsWith(".ogg"))) {
      return jsonResponse(400, { error: "nenhum ogg recente encontrado", got: audio?.media_url ?? null });
    }

    const { data: blob, error: dl } = await supabase.storage
      .from("whatsapp-media")
      .download(audio.media_url);
    if (dl || !blob) return jsonResponse(500, { error: "download falhou: " + (dl?.message ?? "") });

    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    const media = btoa(bin);

    // Lê o OpusHead para reportar canais/taxa — WhatsApp so toca mono, e
    // um arquivo estereo chega mas o player do cliente nao reproduz.
    let opusHead: Record<string, unknown> | null = null;
    let pages = 0;
    let lastGranule = -1;
    if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      let p = 0;
      const scan = new Uint8Array(bytes);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      while (p + 27 <= scan.length) {
        if (!(scan[p] === 0x4f && scan[p + 1] === 0x67 && scan[p + 2] === 0x67 && scan[p + 3] === 0x53)) break;
        pages++;
        const granule = dv.getBigUint64(p + 6, true);
        if (granule !== 0xffffffffffffffffn && granule !== 0n) lastGranule = Number(granule);
        const segs = scan[p + 26];
        let body = 0;
        const table = [];
        for (let i = 0; i < segs; i++) { const s = scan[p + 27 + i]; table.push(s); body += s; }
        const dataStart = p + 27 + segs;
        const packet = scan.subarray(dataStart, dataStart + (table[0] ?? 0));
        if (packet.length >= 19 && String.fromCharCode(...packet.subarray(0, 8)) === "OpusHead") {
          opusHead = {
            version: packet[8],
            channels: packet[9],
            preskip: dv.getUint16(dataStart + 10, true),
            sampleRate: dv.getUint32(dataStart + 12, true),
            gain: dv.getInt16(dataStart + 16, true),
            mappingFamily: packet[18],
          };
        }
        p += 27 + segs + body;
      }
    }
    const granuleInfo = {
      pages,
      lastGranule,
      durationSec: lastGranule > 0 ? +(lastGranule / 48000).toFixed(3) : null,
    };

    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_name")
      .eq("status", "connected")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!inst) return jsonResponse(500, { error: "sem instancia conectada" });

    const target = String(url.searchParams.get("target") ?? "5515996575288");
    // ?analyze=1 só lê e reporta o arquivo, sem enviar — para não gerar mais
    // mensagens de teste no WhatsApp do usuário.
    if (url.searchParams.get("analyze") === "1") {
      await log(supabase, "DIAG_AUDIO_ANALYZE", { source: audio.media_url, bytes: bytes.length, opusHead, granuleInfo });
      return jsonResponse(200, { ok: true, source: audio.media_url, bytes: bytes.length, opusHead, granuleInfo, sent: false });
    }

    const results = [];
    results.push(await sendVariant(inst.instance_name, target, "audio-ogg-ptt", media, {
      fileName: "audio.ogg",
      ptt: true,
    }));
    results.push(await sendVariant(inst.instance_name, target, "audio-ogg-sem-ptt", media, {
      fileName: "audio.ogg",
    }));
    results.push(await sendVariant(inst.instance_name, target, "audio-extaudio", media, {
      fileName: "audio.audio",
    }));
    results.push(await sendVariant(inst.instance_name, target, "document", media, {
      fileName: "audio.ogg",
      mimetype: "audio/ogg",
    }));

    await log(supabase, "DIAG_AUDIO_RESULT", {
      source: audio.media_url,
      bytes: bytes.length,
      opusHead,
      target,
      results,
    });

    return jsonResponse(200, { ok: true, source: audio.media_url, bytes: bytes.length, opusHead, target, results });
  } catch (err) {
    return jsonResponse(500, { error: String(err) });
  }
});
