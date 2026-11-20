import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shouldAutoActivateSdr } from "./sdr-activation.ts";

const base = {
  source: "ad",
  enabled: true,
  testMode: false,
  allowedSources: ["ad", "landing"] as string[] | null,
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
