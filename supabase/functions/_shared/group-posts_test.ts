import { assertEquals } from "jsr:@std/assert";
import {
  engagementDueAt,
  extractQuotedId,
  isGroupJid,
  isWithinEngagementWindow,
  pickDmDelaySeconds,
  renderGroupDm,
} from "./group-posts.ts";

// ---------------------------------------------------------------------------
// isGroupJid
// ---------------------------------------------------------------------------

Deno.test("isGroupJid — @g.us é grupo, resto não", () => {
  assertEquals(isGroupJid("5511999999999-1234567890@g.us"), true);
  assertEquals(isGroupJid("5511999999999@s.whatsapp.net"), false);
  assertEquals(isGroupJid("5511999999999@lid"), false);
  assertEquals(isGroupJid(null), false);
  assertEquals(isGroupJid(undefined), false);
});

// ---------------------------------------------------------------------------
// isWithinEngagementWindow
// ---------------------------------------------------------------------------

Deno.test("isWithinEngagementWindow — dentro da janela de 72h conta", () => {
  const pub = new Date("2026-10-01T10:00:00Z");
  assertEquals(isWithinEngagementWindow(pub, new Date("2026-10-01T10:00:01Z"), 72), true);
  assertEquals(isWithinEngagementWindow(pub, new Date("2026-10-04T09:59:59Z"), 72), true);
});

Deno.test("isWithinEngagementWindow — fora da janela ou antes não conta", () => {
  const pub = new Date("2026-10-01T10:00:00Z");
  assertEquals(isWithinEngagementWindow(pub, new Date("2026-10-04T10:00:01Z"), 72), false);
  assertEquals(isWithinEngagementWindow(pub, new Date("2026-10-01T10:00:00Z"), 72), false);
  assertEquals(isWithinEngagementWindow(pub, new Date("2026-09-30T10:00:00Z"), 72), false);
});

// ---------------------------------------------------------------------------
// pickDmDelaySeconds / engagementDueAt
// ---------------------------------------------------------------------------

Deno.test("pickDmDelaySeconds — respeita [min, max] e min==max", () => {
  assertEquals(pickDmDelaySeconds(300, 900, () => 0), 300);
  assertEquals(pickDmDelaySeconds(300, 900, () => 0.99999), 900);
  assertEquals(pickDmDelaySeconds(600, 600), 600);
  assertEquals(pickDmDelaySeconds(900, 300), 900); // max<min: trava no min
});

Deno.test("engagementDueAt — comentário + jitter dentro da faixa", () => {
  const commented = new Date("2026-10-01T10:00:00Z");
  const due = engagementDueAt(commented, 300, 900, () => 0);
  assertEquals(due.toISOString(), "2026-10-01T10:05:00.000Z");
  const dueMax = engagementDueAt(commented, 300, 900, () => 0.99999);
  assertEquals(dueMax.getTime() - commented.getTime() <= 900_000, true);
});

// ---------------------------------------------------------------------------
// renderGroupDm
// ---------------------------------------------------------------------------

Deno.test("renderGroupDm — {{contact.name}} e fallback", () => {
  assertEquals(renderGroupDm("Oi {{contact.name}}!", "Maria"), "Oi Maria!");
  assertEquals(renderGroupDm("Oi {{contact_name}}!", null), "Oi você!");
  assertEquals(renderGroupDm("Oi {{contact.name}}!", "  "), "Oi você!");
});

// ---------------------------------------------------------------------------
// extractQuotedId
// ---------------------------------------------------------------------------

Deno.test("extractQuotedId — texto citado (reply)", () => {
  assertEquals(
    extractQuotedId({
      extendedTextMessage: { text: "concordo!", contextInfo: { stanzaId: "ABC123" } },
    }),
    "ABC123",
  );
});

Deno.test("extractQuotedId — imagem com legenda citada", () => {
  assertEquals(
    extractQuotedId({
      imageMessage: { caption: "olha", contextInfo: { stanzaId: "XYZ999" } },
    }),
    "XYZ999",
  );
});

Deno.test("extractQuotedId — sem citação retorna null", () => {
  assertEquals(extractQuotedId({ conversation: "oi gente" }), null);
  assertEquals(extractQuotedId(null), null);
  assertEquals(
    extractQuotedId({ extendedTextMessage: { text: "oi" } }),
    null,
  );
});
