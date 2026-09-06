import { assertEquals } from "jsr:@std/assert";
import {
  buildBroadcastTemplate,
  chunk,
  countTemplatePlaceholders,
  hasNamedTemplateParams,
  listNamedTemplateSlots,
  META_COOLDOWN_KEY,
  metaCooldownRemainingMinutes,
  normalizeE164,
} from "./zernio.ts";
import type { Supabase } from "./contacts.ts";

function sbWithSecret(value: string | null): Supabase {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: value ? { value } : null }),
        }),
      }),
    }),
  } as unknown as Supabase;
}

Deno.test("metaCooldownRemainingMinutes: sem registro = livre", async () => {
  assertEquals(await metaCooldownRemainingMinutes(sbWithSecret(null)), 0);
});

Deno.test("metaCooldownRemainingMinutes: timestamp no passado = livre", async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  assertEquals(await metaCooldownRemainingMinutes(sbWithSecret(past)), 0);
});

Deno.test("metaCooldownRemainingMinutes: futuro retorna minutos restantes", async () => {
  const future = new Date(Date.now() + 10 * 60_000).toISOString();
  assertEquals(await metaCooldownRemainingMinutes(sbWithSecret(future)), 10);
});

Deno.test("metaCooldownRemainingMinutes: valor inválido = livre", async () => {
  assertEquals(await metaCooldownRemainingMinutes(sbWithSecret("não-é-data")), 0);
});

Deno.test("META_COOLDOWN_KEY é estável", () => {
  assertEquals(META_COOLDOWN_KEY, "zernio_meta_cooldown_until");
});

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

Deno.test("countTemplatePlaceholders: nomeado NÃO conta como posicional", () => {
  const components = [
    { type: "BODY", text: "Olá, {{nome}}! Atencionalmente." },
  ];
  assertEquals(countTemplatePlaceholders(components), 0);
});

Deno.test("hasNamedTemplateParams: detecta {{nome}} (incompatível com broadcast)", () => {
  const named = [
    { type: "BODY", text: "Olá, {{nome}}!", example: { body_text_named_params: [{ param_name: "nome" }] } },
  ];
  assertEquals(hasNamedTemplateParams(named), true);
});

Deno.test("hasNamedTemplateParams: numérico puro é compatível", () => {
  const numbered = [{ type: "BODY", text: "Olá, {{1}}!", example: { body_text: ["Ronaldo"] } }];
  assertEquals(hasNamedTemplateParams(numbered), false);
  assertEquals(hasNamedTemplateParams([{ type: "BODY", text: "Fixo" }]), false);
  assertEquals(hasNamedTemplateParams(null), false);
});

Deno.test("listNamedTemplateSlots: ordem de primeira aparição, sem duplicar", () => {
  const components = [
    { type: "BODY", text: "{{empresa}} oferece {{nome}}, e {{empresa}} de novo" },
  ];
  assertEquals(listNamedTemplateSlots(components), ["empresa", "nome"]);
  assertEquals(listNamedTemplateSlots([{ type: "BODY", text: "{{1}} e {{2}}" }]), []);
  assertEquals(listNamedTemplateSlots(null), []);
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
