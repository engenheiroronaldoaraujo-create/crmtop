import { assertEquals } from "jsr:@std/assert";
import { timingSafeEqual } from "./timing.ts";

Deno.test("timingSafeEqual — igualdade exata", () => {
  assertEquals(timingSafeEqual("abc123", "abc123"), true);
  assertEquals(timingSafeEqual("", ""), true);
});

Deno.test("timingSafeEqual — diferença no meio e no fim", () => {
  assertEquals(timingSafeEqual("abc123", "abc124"), false);
  assertEquals(timingSafeEqual("abc123", "zbc123"), false);
  assertEquals(timingSafeEqual("abc123", "abc12"), false);
});

Deno.test("timingSafeEqual — comprimentos diferentes nunca casam", () => {
  assertEquals(timingSafeEqual("a", "aa"), false);
  assertEquals(timingSafeEqual("abc", ""), false);
  assertEquals(timingSafeEqual("", "x"), false);
});

Deno.test("timingSafeEqual — token de body vazio não passa", () => {
  // Regressão do bypass: internal_token vazio/whitespace precisa cair fora.
  assertEquals(timingSafeEqual("", "segredo"), false);
  assertEquals(timingSafeEqual("   ", "segredo"), false);
});

Deno.test("timingSafeEqual — UUID de cadência (formato real)", () => {
  const a = "3f2a9c11-7b4e-4d2a-9f31-0c8e5b6d2a70";
  const b = "3f2a9c11-7b4e-4d2a-9f31-0c8e5b6d2a70";
  const c = "3f2a9c11-7b4e-4d2a-9f31-0c8e5b6d2a71";
  assertEquals(timingSafeEqual(a, b), true);
  assertEquals(timingSafeEqual(a, c), false);
});

Deno.test("timingSafeEqual — multibyte UTF-8", () => {
  assertEquals(timingSafeEqual("segredo-ç-🔑", "segredo-ç-🔑"), true);
  assertEquals(timingSafeEqual("segredo-ç-🔑", "segredo-ç-🔒"), false);
  assertEquals(timingSafeEqual("ç", "ç🔑"), false);
});
