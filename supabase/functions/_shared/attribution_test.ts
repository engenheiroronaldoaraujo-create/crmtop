import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  attributionContextLines,
  detectAdAttribution,
  mergeConversationAttribution,
  normalizeNetwork,
  parseUtm,
} from "./attribution.ts";

Deno.test("parseUtm — lê utms de URL absoluta e relativa", () => {
  assertEquals(parseUtm("https://wa.me/5511999999999?text=oi&utm_source=google&utm_campaign=verao"), {
    utm_source: "google",
    utm_campaign: "verao",
  });
  assertEquals(parseUtm("?utm_source=fb&gclid=abc").utm_source, "fb");
  assertEquals(parseUtm(null), {});
});

Deno.test("normalizeNetwork — distingue google de meta", () => {
  assertEquals(normalizeNetwork("google"), "google");
  assertEquals(normalizeNetwork("gclid"), "google");
  assertEquals(normalizeNetwork("facebook"), "meta");
  assertEquals(normalizeNetwork("Instagram"), "meta");
  assertEquals(normalizeNetwork(null), null);
});

Deno.test("detectAdAttribution — atribuição oficial da Meta com click_id", () => {
  const result = detectAdAttribution({
    isInbound: true,
    content: "Olá! Posso ter mais informações sobre isso?",
    advertiser: {
      id: "ad-123",
      source: "facebook",
      cta_source_url: "https://wa.me/5511999999999?utm_campaign=retargeting",
      click_id: "clk-987",
    },
  });
  assertEquals(result?.source, "ad");
  const meta = result?.meta as Record<string, unknown>;
  assertEquals(meta.ad_id, "ad-123");
  assertEquals(meta.click_id, "clk-987");
  assertEquals(meta.network, "meta");
  assertEquals(meta.detected_via, "meta_attribution");
  assertEquals(meta.utm_campaign, "retargeting");
});

Deno.test("detectAdAttribution — Google Ads por UTM, sem payload de anunciante", () => {
  const result = detectAdAttribution({
    isInbound: true,
    content: "Gostaria de receber mais informações, obrigado",
    utm: { utm_source: "google", gclid: "abc123" },
  });
  assertEquals(result?.source, "ad");
  const meta = result?.meta as Record<string, unknown>;
  assertEquals(meta.network, "google");
  assertEquals(meta.detected_via, "google_attribution");
});

Deno.test("detectAdAttribution — heurística de texto do Google", () => {
  const result = detectAdAttribution({
    isInbound: true,
    content: "Oi, vi seu anúncio no Google e gostaria de saber mais",
  });
  assertEquals(result?.source, "ad");
  assertEquals((result?.meta as Record<string, unknown>).detected_via, "padrao_ctwa_google");
});

Deno.test("detectAdAttribution — mensagem comum não é anúncio", () => {
  assertEquals(detectAdAttribution({ isInbound: true, content: "Bom dia, tudo bem?" }), null);
});

Deno.test("detectAdAttribution — frase genérica NÃO é anúncio do Google", () => {
  assertEquals(
    detectAdAttribution({ isInbound: true, content: "Gostaria de mais informações sobre o sistema" }),
    null,
  );
  assertEquals(
    detectAdAttribution({ isInbound: true, content: "Quero saber mais informações, por favor" }),
    null,
  );
});

Deno.test("detectAdAttribution — ignora mensagens outbound", () => {
  assertEquals(
    detectAdAttribution({ isInbound: false, content: "posso ter mais informações?" }),
    null,
  );
});

Deno.test("mergeConversationAttribution — landing recebe atribuição de anúncio depois", () => {
  const merged = mergeConversationAttribution(
    { source: "landing", source_meta: { utm_source: "google", utm_campaign: "verao" } },
    { source: "ad", meta: { network: "meta", ad_id: "ad-1", detected_via: "meta_attribution" } },
  );
  assertEquals(merged?.source, "ad");
  const meta = merged?.source_meta as Record<string, unknown>;
  assertEquals(meta.utm_source, "google");
  assertEquals(meta.utm_campaign, "verao");
  assertEquals(meta.ad_id, "ad-1");
});

Deno.test("mergeConversationAttribution — heurística nunca rebaixa atribuição oficial", () => {
  const merged = mergeConversationAttribution(
    { source: "ad", source_meta: { network: "google", ad_id: "oficial", detected_via: "google_attribution" } },
    { source: "ad", meta: { network: "meta", detected_via: "padrao_ctwa_meta" } },
  );
  const meta = merged?.source_meta as Record<string, unknown>;
  assertEquals(meta.detected_via, "google_attribution");
  assertEquals(meta.network, "google");
  assertEquals(meta.ad_id, "oficial");
});

Deno.test("mergeConversationAttribution — origem manual é preservada", () => {
  assertEquals(
    mergeConversationAttribution(
      { source: "manual", source_meta: { x: 1 } },
      { source: "ad", meta: { ad_id: "1" } },
    ),
    null,
  );
});

Deno.test("mergeConversationAttribution — marcação manual congela a origem", () => {
  assertEquals(
    mergeConversationAttribution(
      { source: "organic", source_meta: { marcado_manualmente: true } },
      { source: "ad", meta: { network: "meta", detected_via: "meta_attribution" } },
    ),
    null,
  );
});

Deno.test("mergeConversationAttribution — landing promove orgânica", () => {
  const merged = mergeConversationAttribution(
    { source: "organic", source_meta: {} },
    { source: "landing", meta: { utm_source: "google", utm_campaign: "verao" } },
  );
  assertEquals(merged?.source, "landing");
  const meta = merged?.source_meta as Record<string, unknown>;
  assertEquals(meta.utm_campaign, "verao");
});

Deno.test("mergeConversationAttribution — sem mudança retorna null", () => {
  assertEquals(
    mergeConversationAttribution(
      { source: "ad", source_meta: { ad_id: "1" } },
      { source: "ad", meta: { ad_id: "1" } },
    ),
    null,
  );
});

Deno.test("attributionContextLines — gera contexto para o prompt", () => {
  const lines = attributionContextLines("ad", {
    network: "google",
    utm_campaign: "verao",
    ad_id: "ad-1",
  });
  assertNotEquals(lines.length, 0);
  assertEquals(lines.some((l) => l.includes("google")), true);
  assertEquals(lines.some((l) => l.includes("verao")), true);
  assertEquals(attributionContextLines("organic", {}).length, 0);
});
