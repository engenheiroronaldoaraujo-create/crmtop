import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shouldAutoActivateSdr } from "./sdr-activation.ts";

const base = {
  source: "ad",
  network: "meta",
  enabled: true,
  testMode: false,
  allowedSources: ["ad", "landing"] as string[] | null,
  allowedNetworks: ["google", "meta"] as string[] | null,
  existingStatus: null,
};

Deno.test("auto-ativa ad e landing", () => {
  assertEquals(shouldAutoActivateSdr({ ...base, source: "ad" }), "activate");
  assertEquals(shouldAutoActivateSdr({ ...base, source: "landing" }), "activate");
});

Deno.test("não ativa origem orgânica/manual", () => {
  assertEquals(shouldAutoActivateSdr({ ...base, source: "organic" }), "skip");
  assertEquals(shouldAutoActivateSdr({ ...base, source: "manual" }), "skip");
});

Deno.test("respeita decisão humana anterior", () => {
  assertEquals(shouldAutoActivateSdr({ ...base, existingStatus: "paused_human" }), "preserve");
  assertEquals(shouldAutoActivateSdr({ ...base, existingStatus: "transferred" }), "preserve");
  assertEquals(shouldAutoActivateSdr({ ...base, existingStatus: "active" }), "preserve");
});

Deno.test("respeita SDR desligado, modo teste e allowed_sources", () => {
  assertEquals(shouldAutoActivateSdr({ ...base, enabled: false }), "skip");
  assertEquals(shouldAutoActivateSdr({ ...base, testMode: true }), "skip");
  assertEquals(shouldAutoActivateSdr({ ...base, allowedSources: ["organic"] }), "skip");
  assertEquals(shouldAutoActivateSdr({ ...base, allowedSources: null }), "activate");
});

Deno.test("filtra rede do anuncio (Google/Meta) como os filtros do chat", () => {
  assertEquals(shouldAutoActivateSdr({ ...base, network: "google" }), "activate");
  assertEquals(shouldAutoActivateSdr({ ...base, network: "google", allowedNetworks: ["meta"] }), "skip");
  assertEquals(shouldAutoActivateSdr({ ...base, network: "meta", allowedNetworks: ["google"] }), "skip");
  assertEquals(shouldAutoActivateSdr({ ...base, network: null, allowedNetworks: ["meta"] }), "activate");
  assertEquals(shouldAutoActivateSdr({ ...base, network: null, allowedNetworks: ["google"] }), "skip");
  // landing nao tem rede: nao e filtrado por allowed_networks
  assertEquals(shouldAutoActivateSdr({ ...base, source: "landing", network: null, allowedNetworks: [] }), "activate");
});
