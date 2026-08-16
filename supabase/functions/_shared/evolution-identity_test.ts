// Testes da camada central de identidade WhatsApp.
// Cobre os casos obrigatórios do spec: phone BR, +, LID, remoteJidAlt,
// mudança de LID, 10/11/12/13 dígitos, grupo, pushName e idempotência.
// Rodar com: deno test supabase/functions/_shared/evolution-identity_test.ts

import {
  classifyJid,
  historyPhone,
  isRelevantJid,
  isValidBrPhone,
  normalizePhoneStrict,
  normalizeWhatsAppIdentity,
  phoneLookupVariants,
  resolveSendTarget,
} from "./evolution-identity.ts";

// Asserts locais (zero dependências).
function equal(actual: unknown, expected: unknown, msg?: string): void {
  if (actual !== expected) {
    throw new Error(
      `${msg ?? "not equal"}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
    );
  }
}
function deepEqual(actual: unknown, expected: unknown, msg?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${msg ?? "deep equal"}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Caso 1 — telefone brasileiro
// ---------------------------------------------------------------------------
Deno.test("Caso 1: telefone brasileiro 5515999999999@s.whatsapp.net", () => {
  const id = normalizeWhatsAppIdentity({ remoteJid: "5515999999999@s.whatsapp.net" });
  equal(id.jidType, "phone");
  equal(id.phone, "5515999999999");
  equal(id.isLid, false);
  equal(id.lid, null);
});

// ---------------------------------------------------------------------------
// Caso 2 — JID com "+"
// ---------------------------------------------------------------------------
Deno.test("Caso 2: JID com +5515999999999@s.whatsapp.net", () => {
  const id = normalizeWhatsAppIdentity({ remoteJid: "+5515999999999@s.whatsapp.net" });
  equal(id.phone, "5515999999999");
});

// ---------------------------------------------------------------------------
// Caso 3 — LID
// ---------------------------------------------------------------------------
Deno.test("Caso 3: LID 12345678901234@lid NÃO vira telefone", () => {
  const id = normalizeWhatsAppIdentity({ remoteJid: "12345678901234@lid" });
  equal(id.jidType, "lid");
  equal(id.lid, "lid:12345678901234");
  equal(id.phone, null);
  equal(id.isLid, true);
});

// ---------------------------------------------------------------------------
// Caso 4 — LID + telefone alternativo (remoteJidAlt)
// ---------------------------------------------------------------------------
Deno.test("Caso 4: LID + remoteJidAlt mantém os dois identificadores", () => {
  const id = normalizeWhatsAppIdentity({
    remoteJid: "12345678901234@lid",
    remoteJidAlt: "5515999999999@s.whatsapp.net",
  });
  equal(id.lid, "lid:12345678901234");
  equal(id.phone, "5515999999999");
});

// ---------------------------------------------------------------------------
// Caso 5 — mudança de LID (mesmo contato, novo LID)
// ---------------------------------------------------------------------------
// Um contato já tem phone 5515999999999. Chega um novo LID
// 98765432109876@lid com remoteJidAlt = 5515999999999@s.whatsapp.net.
// O resolutor deve devolver o MESMO telefone → o lookup por phone encontra o
// contato existente (merge no banco) em vez de criar outro.
Deno.test("Caso 5: mudança de LID resolve para o mesmo telefone", () => {
  const id = normalizeWhatsAppIdentity({
    remoteJid: "98765432109876@lid",
    remoteJidAlt: "5515999999999@s.whatsapp.net",
  });
  equal(id.lid, "lid:98765432109876");
  equal(id.phone, "5515999999999");
  // Sem o alt, a chave é LID (nunca telefone inventado); com o alt, o
  // merge para o contato existente acontece pelo phone.
  equal(historyPhone("98765432109876@lid"), "lid:98765432109876");
});

// ---------------------------------------------------------------------------
// Casos 6–9 — 10/11/12/13 dígitos: comprimento sozinho NUNCA é telefone
// ---------------------------------------------------------------------------
Deno.test("Caso 6: 10 dígitos com DDD inválido não é telefone", () => {
  // DDD 36 não existe → inválido (junk, não phone nem LID).
  equal(normalizePhoneStrict("3699999999"), null);
  const id = normalizeWhatsAppIdentity({ remoteJid: "3699999999@s.whatsapp.net" });
  equal(id.phone, null);
  equal(id.lid, null);
});

Deno.test("Caso 7: 11 dígitos válido vira phone BR canônico (contexto DDD+assinante)", () => {
  // DDD 11 + 9 dígitos começando em 9 → celular válido.
  equal(normalizePhoneStrict("11999999999"), "5511999999999");
  // Mesmo tamanho, porém com DDD inválido → não é phone.
  equal(normalizePhoneStrict("36999999999"), null);
});

Deno.test("Caso 8: 12 dígitos sem DDI 55 válido não é phone", () => {
  // 12 dígitos fora do padrão 55+DDD+assinante → inválido.
  equal(normalizePhoneStrict("119999999999"), null);
});

Deno.test("Caso 9: 13 dígitos não começa só pelo tamanho", () => {
  // DDD 36 inexistente mesmo com 13 dígitos → não é phone (parece LID).
  equal(normalizePhoneStrict("5536999999999"), null);
  // 13 dígitos válidos → phone.
  equal(normalizePhoneStrict("5515999999999"), "5515999999999");
});

// ---------------------------------------------------------------------------
// Caso 10 — LID de 14 dígitos
// ---------------------------------------------------------------------------
Deno.test("Caso 10: LID de 14 dígitos nunca é telefone", () => {
  equal(normalizePhoneStrict("12345678901234"), null);
  equal(isValidBrPhone("12345678901234"), false);
  const id = normalizeWhatsAppIdentity({ remoteJid: "12345678901234@lid" });
  equal(id.lid, "lid:12345678901234");
  equal(id.phone, null);
});

// ---------------------------------------------------------------------------
// Caso 11 — grupo
// ---------------------------------------------------------------------------
Deno.test("Caso 11: grupo @g.us não vira telefone", () => {
  const id = normalizeWhatsAppIdentity({ remoteJid: "5515999999999-1234567890@g.us" });
  equal(id.jidType, "group");
  equal(id.isGroup, true);
  equal(id.phone, null);
  equal(id.lid, null);
  equal(classifyJid("5515999999999-1234567890@g.us"), "group");
  equal(isRelevantJid("5515999999999-1234567890@g.us"), false);
});

// ---------------------------------------------------------------------------
// Caso 12 — pushName vazio não afeta a identidade
// ---------------------------------------------------------------------------
Deno.test("Caso 12: pushName não é usado na resolução de identidade", () => {
  // pushName null/ausente não bloqueia phone/LID.
  const id = normalizeWhatsAppIdentity({ remoteJid: "5515999999999@s.whatsapp.net" });
  equal(id.phone, "5515999999999");
  // pushName NÃO deve ser chave: nenhuma função de identidade o recebe.
});

// ---------------------------------------------------------------------------
// Caso 13 — idempotência (chave determinística)
// ---------------------------------------------------------------------------
// A dedup em banco usa unique(conversation_id, evolution_message_id); aqui
// garantimos que a chave de contato é determinística — a mesma entrada sempre
// produz a mesma chave, então reprocessar um webhook não cria contato novo.
Deno.test("Caso 13: identidade é determinística (mesmo input → mesma chave)", () => {
  const a = historyPhone("5515999999999@s.whatsapp.net");
  const b = historyPhone("5515999999999@s.whatsapp.net");
  equal(a, "5515999999999");
  equal(a, b);
  // LID puro → chave LID, jamais telefone.
  equal(historyPhone("12345678901234@lid"), "lid:12345678901234");
});

// ---------------------------------------------------------------------------
// Extras — variantes do nono dígito (lookup, sem alterar dados)
// ---------------------------------------------------------------------------
Deno.test("Lookup: variantes do nono dígito BR", () => {
  const variants = phoneLookupVariants("5515999999999"); // 55 15 9 99999999
  deepEqual(variants, ["5515999999999", "551599999999"]);
  deepEqual(phoneLookupVariants("551599999999"), ["551599999999", "5515999999999"]);
});

// ---------------------------------------------------------------------------
// Destino de envio
// ---------------------------------------------------------------------------
Deno.test("Envio: prioriza JID confirmado sobre phone", () => {
  const { target, via } = resolveSendTarget({
    jid: "5515999999999@s.whatsapp.net",
    phone: "5515999999999",
    lid: "lid:12345678901234",
  });
  equal(target, "5515999999999");
  equal(via, "jid");
});

Deno.test("Envio: JID falso (LID embrulhado) não vira número inventado", () => {
  const { target, via } = resolveSendTarget({
    jid: "12345678901234@s.whatsapp.net",
    phone: null,
    lid: null,
  });
  equal(target, null);
  equal(via, null);
});

Deno.test("Envio: sem phone usa LID com prefixo lid:", () => {
  const { target, via } = resolveSendTarget({ phone: null, lid: "lid:12345678901234", jid: null });
  equal(target, "lid:12345678901234");
  equal(via, "lid");
});

Deno.test("Envio: sem nenhum identificador não inventa nada", () => {
  const { target } = resolveSendTarget({ phone: null, lid: null, jid: null });
  equal(target, null);
});

// ---------------------------------------------------------------------------
// Números internacionais não são quebrados: fora do plano BR → null (não é
// transformado em telefone BR errado).
// ---------------------------------------------------------------------------
Deno.test("Internacional: +1/+44 fora do padrão BR não viram phone BR", () => {
  equal(normalizePhoneStrict("14155552671"), null);
  equal(normalizePhoneStrict("447700900123"), null);
});
