// _shared/evolution-identity.ts
// Camada ÚNICA de resolução de identidade WhatsApp (JID / LID / telefone).
// Todas as regras de normalização vivem aqui — evolution-webhook e
// evolution-proxy importam daqui. Nunca espalhar regras de telefone/JID por
// componentes ou funções.
//
// Princípio fundamental:
//   Telefone é uma identidade de contato.
//   JID é uma identidade WhatsApp (@s.whatsapp.net).
//   LID é uma identidade WhatsApp (@lid), NÃO é telefone.
// Nunca tratar os três como a mesma coisa.

export type JidType = "phone" | "lid" | "group" | "broadcast" | "unknown";

export interface WhatsAppIdentity {
  /** JID bruto recebido da Evolution (ex.: 5515999999999@s.whatsapp.net). */
  rawRemoteJid: string | null;
  /** Identificador alternativo (remoteJidAlt), quando presente. */
  rawRemoteJidAlt: string | null;
  /** JID canônico (igual ao rawRemoteJid quando relevante). */
  jid: string | null;
  jidType: JidType;
  /** LID armazenado como "lid:<digits>"; null quando não há LID. */
  lid: string | null;
  /** Telefone canônico BR E.164 sem "+" (10–13 dígitos, prefixo 55); null quando não é telefone. */
  phone: string | null;
  isLid: boolean;
  isGroup: boolean;
  isBroadcast: boolean;
}

// ---------------------------------------------------------------------------
// Teléfone — normalização canônica brasileira (plano de numeração ANATEL).
// v1 checava apenas comprimento (10–13 dígitos), o que deixava LIDs de 13
// dígitos passarem como telefone. v2 exige validade semântica (DDD real +
// estrutura de assinante) e nunca aceita LIDs como telefone.
// ---------------------------------------------------------------------------

const VALID_BR_DDDS = new Set<number>([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * True iff `digits` (somente dígitos, com ou sem prefixo 55) é um telefone
 * brasileiro estruturalmente válido sob a regra v2:
 *   - 10/11 dígitos (sem DDI): DDD válido; assinante de 11 dígitos começa com 9
 *     (celular), de 10 começa com 2–9 (fixo/legado).
 *   - 12 dígitos: 55 + DDD válido + [2-9]\d{7}$.
 *   - 13 dígitos: 55 + DDD válido + 9\d{8}$.
 *   - qualquer outro comprimento → false. O tamanho sozinho NUNCA é prova de
 *     telefone: LIDs têm 14+ dígitos e são rejeitados aqui.
 */
export function isValidBrPhone(digits: string): boolean {
  if (digits.length === 10 || digits.length === 11) {
    const ddd = Number(digits.slice(0, 2));
    if (!VALID_BR_DDDS.has(ddd)) return false;
    const sub = digits.slice(2);
    if (digits.length === 11) return sub[0] === "9"; // celular
    return /^[2-9]/.test(sub); // fixo / celular legado
  }
  if (digits.length === 12) {
    if (!digits.startsWith("55")) return false;
    const ddd = Number(digits.slice(2, 4));
    if (!VALID_BR_DDDS.has(ddd)) return false;
    return /^[2-9]\d{7}$/.test(digits.slice(4));
  }
  if (digits.length === 13) {
    if (!digits.startsWith("55")) return false;
    const ddd = Number(digits.slice(2, 4));
    if (!VALID_BR_DDDS.has(ddd)) return false;
    return /^9\d{8}$/.test(digits.slice(4));
  }
  return false;
}

/**
 * Retorna o telefone canônico ("55" + 12/13 dígitos) ou null. null significa
 * que o valor NÃO é um telefone BR válido — quem chama trata como LID quando o
 * comprimento de dígitos é >= 12, ou como lixo caso contrário.
 */
export function normalizePhoneStrict(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d]/g, "");
  if (!isValidBrPhone(digits)) return null;
  // A forma canônica sempre carrega o DDI 55.
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits; // 12/13 dígitos já incluem "55"
}

/**
 * Variantes de lookup para o NONO DÍGITO brasileiro. Celulares podem existir
 * no banco na forma com (13 dígitos) ou sem (12 dígitos, pré-nono dígito) o 9.
 * Usado SOMENTE para encontrar contatos existentes — jamais altera o telefone
 * armazenado sem confirmação.
 */
export function phoneLookupVariants(phone: string | null | undefined): string[] {
  const canonical = normalizePhoneStrict(phone);
  if (!canonical) return [];
  const set = new Set<string>([canonical]);
  if (canonical.length === 12) {
    // 55 + DDD + 8 dígitos → variante celular com nono dígito.
    const mobile = `${canonical.slice(0, 4)}9${canonical.slice(4)}`;
    if (isValidBrPhone(mobile)) set.add(mobile);
  }
  if (canonical.length === 13) {
    // 55 + DDD + 9 + 8 dígitos → variante legada sem o nono dígito.
    const legacy = `${canonical.slice(0, 4)}${canonical.slice(5)}`;
    if (isValidBrPhone(legacy)) set.add(legacy);
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// JID — classificação e extração
// ---------------------------------------------------------------------------

export function stripNumberSuffix(jid: string): string {
  return (jid.split("@")[0] ?? "").replace(/[^\d]/g, "");
}

/**
 * Classifica um JID pelo sufixo/domínio. NUNCA usa quantidade de dígitos como
 * heurística — o domínio é a evidência (grupo @g.us, broadcast @broadcast,
 * status @status@broadcast, LID @lid, telefone @s.whatsapp.net).
 */
export function classifyJid(jid: string): JidType {
  if (!jid) return "unknown";
  if (jid.endsWith("@g.us")) return "group";
  if (jid.endsWith("@broadcast") || jid.endsWith("@status@broadcast")) return "broadcast";
  if (jid.endsWith("@lid")) return "lid";
  if (jid.endsWith("@s.whatsapp.net")) return "phone";
  return "unknown";
}

/**
 * JIDs de pessoa (phone/lid) relevantes para o CRM. Grupos, broadcasts,
 * newsletters e status estão fora do escopo do F1.
 */
export function isRelevantJid(jid: string): boolean {
  if (!jid) return false;
  if (jid.endsWith("@newsletter")) return false;
  const type = classifyJid(jid);
  if (type === "group" || type === "broadcast") return false;
  if (type === "phone") return stripNumberSuffix(jid).length >= 10;
  if (type === "lid") return stripNumberSuffix(jid).length >= 8;
  return false;
}

// ---------------------------------------------------------------------------
// Identidade — normalização central
// ---------------------------------------------------------------------------

/**
 * Constrói a identidade estruturada a partir de tudo que a Evolution fornece.
 *
 * Regras aplicadas:
 *  - @s.whatsapp.net → normalmente telefone; mas Evolution pode envolver um LID
 *    (14+ dígitos) num JID de domínio de telefone → nesse caso é LID.
 *  - @lid → LID. NUNCA virar telefone.
 *  - remoteJidAlt / senderPn → podem carregar o telefone real de um LID;
 *    um candidato @lid nunca é telefone.
 */
export function normalizeWhatsAppIdentity(input: {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  senderPn?: string | null;
}): WhatsAppIdentity {
  const rawRemoteJid = input.remoteJid ?? null;
  const rawRemoteJidAlt = input.remoteJidAlt ?? null;
  const type = classifyJid(rawRemoteJid ?? "");

  const identity: WhatsAppIdentity = {
    rawRemoteJid,
    rawRemoteJidAlt,
    jid: rawRemoteJid,
    jidType: type,
    lid: null,
    phone: null,
    isLid: false,
    isGroup: type === "group",
    isBroadcast: type === "broadcast",
  };

  if (type === "group" || type === "broadcast" || type === "unknown") {
    return identity;
  }

  const digits = stripNumberSuffix(rawRemoteJid ?? "");
  const phone = normalizePhoneStrict(digits);

  if (type === "phone") {
    if (phone) {
      identity.phone = phone;
      return identity;
    }
    // LID (14+ dígitos) embrulhado num JID de telefone — não é telefone.
    if (digits.length >= 12) {
      identity.isLid = true;
      identity.jidType = "lid";
      identity.lid = `lid:${digits}`;
      return identity;
    }
    return identity;
  }

  // type === "lid"
  identity.isLid = true;
  identity.lid = `lid:${digits}`;

  // Recupera o telefone real do LID via metadata, quando disponível.
  for (const candidate of [input.senderPn, input.remoteJidAlt]) {
    if (!candidate) continue;
    // Um candidato @lid nunca é telefone.
    if (candidate.endsWith("@lid")) continue;
    const clean = candidate.endsWith("@s.whatsapp.net")
      ? candidate.split("@")[0]
      : candidate;
    const normalized = normalizePhoneStrict(clean);
    if (normalized) {
      identity.phone = normalized;
      break;
    }
  }
  return identity;
}

/**
 * Chave de contato para um JID: telefone canônico ou "lid:<digits>".
 * LIDs nunca são retornados como telefone.
 */
export function historyPhone(jid: string): string | null {
  const identity = normalizeWhatsAppIdentity({ remoteJid: jid });
  return identity.phone ?? identity.lid;
}

// ---------------------------------------------------------------------------
// Destino de envio
// ---------------------------------------------------------------------------

export type SendTarget = {
  /** Número a enviar na Evolution (dígitos de telefone ou "lid:<digits>"). */
  target: string | null;
  via: "jid" | "phone" | "lid" | null;
};

/**
 * Decide o destinatário correto para ENVIO. Prioridade:
 *   1. JID confirmado @s.whatsapp.net cujos dígitos formam telefone válido;
 *   2. telefone E.164 validado;
 *   3. LID (Evolution 2.3.7 aceita "lid:<digits>") — último recurso.
 *
 * Se o único identificador for um LID, retorna o LID (nunca inventa número).
 * Nunca envia "12345678901234@lid" tratando o número como telefone.
 */
export function resolveSendTarget(contact: {
  phone?: string | null;
  lid?: string | null;
  jid?: string | null;
}): SendTarget {
  if (contact.jid && classifyJid(contact.jid) === "phone") {
    const digits = stripNumberSuffix(contact.jid);
    if (isValidBrPhone(digits)) {
      return { target: digits, via: "jid" };
    }
  }
  const phone = normalizePhoneStrict(contact.phone);
  if (phone) return { target: phone, via: "phone" };
  if (contact.lid) {
    const lid = contact.lid.startsWith("lid:") ? contact.lid : `lid:${contact.lid}`;
    return { target: lid, via: "lid" };
  }
  return { target: null, via: null };
}