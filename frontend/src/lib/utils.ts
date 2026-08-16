import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isRealPhone(phone: string | null | undefined): phone is string {
  return typeof phone === "string" && /^\d{10,13}$/.test(phone)
}

// Displays phone numbers in Brazilian E.164 format. Numbers stored without the
// country code (10/11 digits, common in the WhatsApp contact list) are assumed
// Brazilian and shown with +55. Display-only: the stored value is untouched.
export function formatPhone(phone: string): string {
  if (!isRealPhone(phone)) return phone
  let d = phone.replace(/\D/g, "")
  if (d.length === 10 || d.length === 11) d = "55" + d
  if (d.length === 13 && d.startsWith("55")) {
    return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  }
  if (d.length === 12 && d.startsWith("55")) {
    return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  }
  return `+${d}`
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

// Formats the digits of a LID as a Brazilian phone number for DISPLAY ONLY.
// A LID is an opaque identifier, not a real phone, so the resulting number is
// derived (never used as a send target — the chat still blocks sending to
// contacts without a real phone). Brazilian numbers are 10–11 digits; we take
// the trailing phone-like digits and prepend the +55 country code.
export function formatLidAsPhone(lid: string | null | undefined): string | null {
  if (!lid) return null
  const d = lid.replace(/^lid:/, "").replace(/[^\d]/g, "")
  if (d.length < 10) return null
  let phone: string
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    phone = d
  } else {
    const core = d.length >= 11 ? d.slice(-11) : d
    phone = core.startsWith("55") ? core : `55${core}`
  }
  return formatPhone(phone)
}

export function contactDisplayName(c: {
  name?: string | null
  push_name?: string | null
  phone?: string | null
  lid?: string | null
}): string {
  const n = c.name || c.push_name
  if (n) return n
  if (isRealPhone(c.phone)) return formatPhone(c.phone)
  // LID-only contact with no name: the only available number is the LID. Present
  // it formatted as a standard Brazilian phone (55 xx xxxxx-xxxx) so the
  // conversation is identifiable, instead of a generic "Contato sem número".
  const lidPhone = formatLidAsPhone(c.lid)
  if (lidPhone) return lidPhone
  return "Contato sem número"
}