import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// CANONICAL Brazilian phone validation — v2 (plano de numeração ANATEL).
// v1 only checked length (10–13 digits), which let 13-digit LIDs through as
// phones (e.g. DDDs 36/70, or a 13-digit number whose subscriber lacks the
// leading 9). v2 requires semantic validity.
//   Valid DDDs (closed list): 11-19, 21, 22, 24, 27, 28, 31-35, 37, 38,
//     41-49, 51, 53, 54, 55, 61-69, 71, 73, 74, 75, 77, 79, 81-89, 91-99
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
])

// True iff `digits` (only digits, with or without 55 prefix) is a structurally
// valid Brazilian phone under the v2 rule.
function isValidBrPhone(digits: string): boolean {
  if (digits.length === 10 || digits.length === 11) {
    const ddd = Number(digits.slice(0, 2))
    if (!VALID_BR_DDDS.has(ddd)) return false
    const sub = digits.slice(2)
    if (digits.length === 11) return sub[0] === "9" // mobile
    return /^[2-9]/.test(sub) // landline / legacy mobile
  }
  if (digits.length === 12) {
    if (!digits.startsWith("55")) return false
    const ddd = Number(digits.slice(2, 4))
    if (!VALID_BR_DDDS.has(ddd)) return false
    return /^[2-9]\d{7}$/.test(digits.slice(4))
  }
  if (digits.length === 13) {
    if (!digits.startsWith("55")) return false
    const ddd = Number(digits.slice(2, 4))
    if (!VALID_BR_DDDS.has(ddd)) return false
    return /^9\d{8}$/.test(digits.slice(4))
  }
  return false
}

export function isRealPhone(phone: string | null | undefined): phone is string {
  return typeof phone === "string" && isValidBrPhone(phone.replace(/\D/g, ""))
}

// Extrai o número embutido de um JID @s.whatsapp.net (telefone do WhatsApp,
// BR ou internacional). NUNCA deriva número de @lid (LID é identificador, não
// telefone). JIDs @s.whatsapp.net com 14+ dígitos são LIDs embrulhados e são
// rejeitados.
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null
  if (!jid.endsWith("@s.whatsapp.net")) return null
  const digits = jid.split("@")[0].replace(/\D/g, "")
  if (digits.length >= 10 && digits.length <= 13) return digits
  return null
}

// Displays phone numbers in Brazilian E.164 format. Numbers stored without the
// country code (10/11 digits, common in the WhatsApp contact list) are assumed
// Brazilian and shown with +55. Display-only: the stored value is untouched.
// Only valid BR phones are formatted; anything else is returned untouched so a
// raw long digit string is never presented as a phone.
export function formatPhone(phone: string): string {
  if (!phone) return phone
  // isRealPhone applies the v2 semantic rule; callers (contactDisplayName) also
  // guard with it. Anything invalid is returned untouched so a raw long digit
  // string is never presented as a phone.
  if (!isRealPhone(phone)) return phone
  let n = phone.replace(/\D/g, "")
  if (n.length === 10 || n.length === 11) n = "55" + n
  if (n.length === 13 && n.startsWith("55")) {
    return `+${n.slice(0, 2)} (${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}`
  }
  if (n.length === 12 && n.startsWith("55")) {
    // 55 + DDD + 8 digits: routing JID of pre-ninth-digit Brazilian numbers.
    // Insert the 9th digit only for mobile ranges (6–9); landlines (2–5) keep
    // their 8 digits. Display-only — the stored value is never changed.
    const ddd = n.slice(2, 4)
    const num = n.slice(4) // 8 digits
    const first = num[0]
    if (first === "6" || first === "7" || first === "8" || first === "9") {
      const mobile = "9" + num // 9 digits
      return `+55 (${ddd}) ${mobile.slice(0, 5)}-${mobile.slice(5)}`
    }
    return `+55 (${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`
  }
  return `+${n}`
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

export function isSameDay(a: string, b: string): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

export function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }
  if (isSameDay(iso, today.toISOString())) return "Hoje"
  if (isSameDay(iso, yesterday.toISOString())) return "Ontem"
  return d.toLocaleDateString("pt-BR", opts)
}

export function formatListTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  if (isSameDay(iso, today.toISOString())) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

export function contactDisplayName(c: {
  name?: string | null
  push_name?: string | null
  phone?: string | null
  jid?: string | null
}): string {
  const n = c.name || c.push_name
  if (n) return n
  if (isRealPhone(c.phone)) return formatPhone(c.phone)
  // JID @s.whatsapp.net carrega o número (BR ou internacional) embutido.
  const jidPhone = phoneFromJid(c.jid)
  if (jidPhone) return `+${jidPhone}`
  // LID é identificador WhatsApp, não telefone — nunca derivar número.
  return "Contato sem número"
}