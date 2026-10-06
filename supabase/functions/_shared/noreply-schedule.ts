// _shared/noreply-schedule.ts
// Helpers puros (sem I/O) da régua de follow-up sem resposta — isolados aqui
// para serem testáveis direto (`deno test`), mesmo padrão de timing.ts.

/** Fuso usado por todo o CRM (BR). */
export const NOREPLY_TIMEZONE = "America/Sao_Paulo";

/**
 * Interpolação de variáveis no formato {{caminho.aninhado}} — igual à da
 * cadência: variável ausente mantém o placeholder (não quebra o texto).
 */
export function substituteVariables(
  template: string,
  data: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
    const parts = path.split(".");
    let val: unknown = data;
    for (const p of parts) {
      if (val && typeof val === "object") val = (val as Record<string, unknown>)[p];
      else return match;
    }
    return val != null ? String(val) : match;
  });
}

/**
 * Peças de data local (dia da semana 0-6 e minutos desde 00:00) sem depender
 * do fuso do isolate — o Edge roda em UTC, o negócio é America/Sao_Paulo.
 */
export function localParts(
  date: Date,
  timezone: string = NOREPLY_TIMEZONE,
): { dayOfWeek: number; minutes: number } {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  let day = 0;
  let hh = 0;
  let mm = 0;
  for (const p of parts) {
    if (p.type === "weekday") day = names.indexOf(p.value);
    if (p.type === "hour") hh = parseInt(p.value, 10) % 24;
    if (p.type === "minute") mm = parseInt(p.value, 10);
  }
  return { dayOfWeek: day < 0 ? 0 : day, minutes: hh * 60 + mm };
}

export function isWeekend(date: Date, timezone: string = NOREPLY_TIMEZONE): boolean {
  const day = localParts(date, timezone).dayOfWeek;
  return day === 0 || day === 6;
}

/**
 * Empurra a data para um dia útil (passos de 6h) quando cai no fim de semana.
 * O envio em si ainda passa pelo porteiro de horário comercial, então aterrar
 * de madrugada de segunda é suficiente — business_hours segura até as 8h.
 */
export function skipToBusinessDay(
  date: Date,
  skipWeekends: boolean,
  timezone: string = NOREPLY_TIMEZONE,
): Date {
  if (!skipWeekends) return date;
  const d = new Date(date.getTime());
  let guard = 0;
  while (isWeekend(d, timezone) && guard++ < 12) {
    d.setTime(d.getTime() + 6 * 3600_000);
  }
  return d;
}

/** Converte "HH:MM" em minutos desde 00:00 (para comparar com localParts). */
export function timeToMinutes(t: string): number {
  const [h, m] = String(t).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
