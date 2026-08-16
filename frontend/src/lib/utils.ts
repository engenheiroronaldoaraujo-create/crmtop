import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isRealPhone(phone: string | null | undefined): boolean {
  return typeof phone === "string" && /^\d{10,15}$/.test(phone)
}

export function formatPhone(phone: string): string {
  if (!isRealPhone(phone)) return phone
  const d = phone.replace(/\D/g, "")
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

export function contactDisplayName(c: {
  name?: string | null
  push_name?: string | null
  phone: string
}): string {
  return c.name || c.push_name || c.phone
}
