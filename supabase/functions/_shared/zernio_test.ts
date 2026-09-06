import { assertEquals } from "jsr:@std/assert";
import {
  buildBroadcastTemplate,
  chunk,
  countTemplatePlaceholders,
  normalizeE164,
} from "./zernio.ts";

Deno.test("normalizeE164: dígitos BR sem '+' viram E.164", () => {
  assertEquals(normalizeE164("5511999998888"), "+5511999998888");
  assertEquals(normalizeE164("+55 11 99999-8888"), "+5511999998888");
});

Deno.test("normalizeE164: rejeita LID e números curtos/longos", () => {
  assertEquals(normalizeE164("lid:1234567890"), null);
  assertEquals(normalizeE164("12345"), null);
  assertEquals(normalizeE164("1234567890123456"), null);
  assertEquals(normalizeE164(null), null);
});

Deno.test("countTemplatePlaceholders: maior índice posicional", () => {
  const components = [
    { type: "BODY", text: "Olá {{1}}, seu pedido {{2}} foi confirmado!" },
    { type: "FOOTER", text: "R$ {{3}}" },
  ];
  assertEquals(countTemplatePlaceholders(components), 3);
  assertEquals(countTemplatePlaceholders([{ type: "BODY", text: "Sem variáveis" }]), 0);
  assertEquals(countTemplatePlaceholders(null), 0);
});

Deno.test("buildBroadcastTemplate: sem variáveis omite components", () => {
  const t = buildBroadcastTemplate("boas_vindas", "pt_BR", 0, {});
  assertEquals(t, { name: "boas_vindas", language: "pt_BR" });
});

Deno.test("buildBroadcastTemplate: um parâmetro por placeholder", () => {
  const mapping = { "1": { field: "name" }, "2": { field: "custom", customValue: "VIP" } };
  const t = buildBroadcastTemplate("campanha", "pt_BR", 2, mapping);
  assertEquals(t.name, "campanha");
  assertEquals(t.language, "pt_BR");
  assertEquals((t.components as Array<Record<string, unknown>>)[0].parameters, [
    { type: "text", text: "{{1}}" },
    { type: "text", text: "{{2}}" },
  ]);
  assertEquals(t.variableMapping, mapping);
});

Deno.test("chunk: lotes corretos inclusive no final", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 3), []);
});
