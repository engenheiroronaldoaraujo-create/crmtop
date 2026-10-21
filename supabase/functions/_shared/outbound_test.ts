import { assert, assertEquals } from "jsr:@std/assert@1";
import { normalizeEvolutionMessageId } from "./outbound.ts";

Deno.test("normalizeEvolutionMessageId: mantém o id real da Evolution", () => {
  assertEquals(normalizeEvolutionMessageId("3EB0ABC123"), "3EB0ABC123");
  assertEquals(normalizeEvolutionMessageId("  3EB0ABC123  "), "3EB0ABC123");
});

Deno.test("normalizeEvolutionMessageId: id ausente vira id único por tentativa", () => {
  // Postgres trata NULL como distinto: um upsert por
  // (conversation_id, evolution_message_id) com NULL nunca faz dedup e cada
  // retry de envio criava uma bolha duplicada no chat.
  const a = normalizeEvolutionMessageId(null);
  const b = normalizeEvolutionMessageId(null);
  assert(a.startsWith("failed-"));
  assertEquals(a === b, false, "cada tentativa precisa de um id distinto");
});

Deno.test("normalizeEvolutionMessageId: string vazia também vira id único", () => {
  const a = normalizeEvolutionMessageId("");
  const b = normalizeEvolutionMessageId(undefined);
  assert(a.startsWith("failed-"));
  assert(b.startsWith("failed-"));
  assertEquals(a === b, false);
});
