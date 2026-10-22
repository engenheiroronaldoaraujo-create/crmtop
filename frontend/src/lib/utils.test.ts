import { describe, expect, it } from "vitest"
import {
  contactDisplayName,
  escapePostgrestSearch,
  formatPhone,
  isRealPhone,
  isValidPhoneInput,
  normalizePhoneInput,
  phoneFromJid,
} from "@/lib/utils"

describe("isRealPhone", () => {
  it("aceita celular BR com nono dígito", () => {
    expect(isRealPhone("5511987654321")).toBe(true)
    expect(isRealPhone("11987654321")).toBe(true)
  })

  it("aceita fixo BR (8 dígitos)", () => {
    expect(isRealPhone("1133334444")).toBe(true)
    expect(isRealPhone("551133334444")).toBe(true)
  })

  it("rejeita DDD inexistente", () => {
    // DDD 20 não existe (a lista cobre 11-19, 21, 22, 24, 27, 28, ...).
    expect(isRealPhone("20987654321")).toBe(false)
    expect(isRealPhone("5520987654321")).toBe(false)
  })

  it("rejeita número com tamanho inválido", () => {
    expect(isRealPhone("123")).toBe(false)
    expect(isRealPhone("5511987654321234")).toBe(false)
    expect(isRealPhone("")).toBe(false)
    expect(isRealPhone(null)).toBe(false)
    expect(isRealPhone(undefined)).toBe(false)
  })

  it("rejeita assinante começando por 0 ou 1", () => {
    expect(isRealPhone("11012345678")).toBe(false)
    expect(isRealPhone("5511012345678")).toBe(false)
  })
})

describe("normalizePhoneInput", () => {
  it("prefixa o DDI 55 em número de 10/11 dígitos", () => {
    expect(normalizePhoneInput("11987654321")).toBe("5511987654321")
    expect(normalizePhoneInput("1133334444")).toBe("551133334444")
  })

  it("mantém número já com DDI", () => {
    expect(normalizePhoneInput("5511987654321")).toBe("5511987654321")
  })

  it("ignora pontuação do usuário", () => {
    expect(normalizePhoneInput("(11) 98765-4321")).toBe("5511987654321")
    expect(normalizePhoneInput("+55 11 98765 4321")).toBe("5511987654321")
  })

  it("devolve null para tamanho inválido", () => {
    expect(normalizePhoneInput("123")).toBeNull()
    expect(normalizePhoneInput("")).toBeNull()
  })
})

describe("isValidPhoneInput", () => {
  it("rejeita '+' e espaços (o valor é gravado cru no banco)", () => {
    // A regra antiga (`/^\\+?\\d{10,15}$/`) aceitava '+' e gravava o valor
    // com o '+', quebrando a comparação `phone.eq.<valor>` do PostgREST.
    expect(isValidPhoneInput("+5511987654321")).toBe(false)
    expect(isValidPhoneInput("55 11 98765 4321")).toBe(false)
    expect(isValidPhoneInput("(11) 98765-4321")).toBe(false)
  })

  it("aceita só dígitos válidos", () => {
    expect(isValidPhoneInput("5511987654321")).toBe(true)
    expect(isValidPhoneInput("11987654321")).toBe(true)
  })

  it("rejeita vazio e null", () => {
    expect(isValidPhoneInput("")).toBe(false)
    expect(isValidPhoneInput(null)).toBe(false)
    expect(isValidPhoneInput(undefined)).toBe(false)
  })
})

describe("escapePostgrestSearch", () => {
  it("remove os separadores do filtro or()", () => {
    // Sem o escape, digitar ',' ou '(' quebrava a query ("parse error").
    expect(escapePostgrestSearch("a,b")).toBe("ab")
    expect(escapePostgrestSearch("a(b)")).toBe("ab")
    expect(escapePostgrestSearch('a"b\'c')).toBe("abc")
  })

  it("remove os curingas do ILIKE", () => {
    expect(escapePostgrestSearch("100%")).toBe("100")
    expect(escapePostgrestSearch("a_b")).toBe("ab")
    expect(escapePostgrestSearch("a*b")).toBe("ab")
  })

  it("mantém o termo normal", () => {
    expect(escapePostgrestSearch("João Silva")).toBe("João Silva")
    expect(escapePostgrestSearch("  azul  ")).toBe("azul")
  })
})

describe("phoneFromJid", () => {
  it("extrai o número de um JID @s.whatsapp.net", () => {
    expect(phoneFromJid("5511987654321@s.whatsapp.net")).toBe("5511987654321")
  })

  it("nunca deriva número de um @lid", () => {
    // LID é identificador, não telefone.
    expect(phoneFromJid("12345678901234@lid")).toBeNull()
  })

  it("devolve null para JID inválido", () => {
    expect(phoneFromJid(null)).toBeNull()
    expect(phoneFromJid("")).toBeNull()
    expect(phoneFromJid("123@s.whatsapp.net")).toBeNull()
  })
})

describe("formatPhone", () => {
  it("formata celular BR em E.164", () => {
    expect(formatPhone("5511987654321")).toBe("+55 (11) 98765-4321")
  })

  it("não inventa formato para número inválido", () => {
    expect(formatPhone("123456")).toBe("123456")
  })
})

describe("contactDisplayName", () => {
  it("usa o nome quando existe", () => {
    expect(contactDisplayName({ name: "Maria", phone: "5511987654321" })).toBe("Maria")
  })

  it("ignora nome que é só dígitos (identificador LID)", () => {
    expect(contactDisplayName({ name: "1234567890", phone: "5511987654321" })).toBe(
      "+55 (11) 98765-4321",
    )
  })

  it("usa o telefone quando não há nome", () => {
    expect(contactDisplayName({ phone: "5511987654321" })).toBe("+55 (11) 98765-4321")
  })

  it("usa o JID quando não há telefone", () => {
    expect(contactDisplayName({ jid: "5511987654321@s.whatsapp.net" })).toBe("+5511987654321")
  })

  it("nunca deriva número do LID", () => {
    const name = contactDisplayName({ lid: "lid:987654321098" })
    expect(name).not.toContain("9876543210")
    expect(name).toContain("••")
  })

  it("devolve 'Contato sem número' quando não há nada", () => {
    expect(contactDisplayName({})).toBe("Contato sem número")
  })
})
