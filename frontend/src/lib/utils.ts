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
  if (!phone) return phone
  const d = phone.replace(/\D/g, "")
  // Canonical 10–13 digit phones (with or without the 55 country code).
  if (/^\d{10,13}$/.test(d)) {
    let n = d
    if (n.length === 10 || n.length === 11) n = "55" + n
    if (n.length === 13 && n.startsWith("55")) {
      return `+${n.slice(0, 2)} (${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}`
    }
    if (n.length === 12 && n.startsWith("55")) {
      return `+${n.slice(0, 2)} (${n.slice(2, 4)}) ${n.slice(4, 8)}-${n.slice(8)}`
    }
    return `+${n}`
  }
  // A long digit string (e.g. a stray LID or un-normalized value) must never be
  // shown raw — present it as a best-effort Brazilian phone instead.
  if (d.length >= 10) return formatLidAsPhone(phone) ?? phone
  return phone
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