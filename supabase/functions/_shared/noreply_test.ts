import { assertEquals } from "jsr:@std/assert";
import {
  isWeekend,
  localParts,
  skipToBusinessDay,
  substituteVariables,
  timeToMinutes,
} from "./noreply-schedule.ts";

// ---------------------------------------------------------------------------
// substituteVariables
// ---------------------------------------------------------------------------

Deno.test("substituteVariables — interpola nome e telefone do contato", () => {
  const vars = {
    contact: { name: "Maria", phone: "5511999999999" },
    contact_name: "Maria",
  };
  assertEquals(
    substituteVariables("Oi {{contact.name}}, vi seu {{contact.phone}}!", vars),
    "Oi Maria, vi seu 5511999999999!",
  );
  assertEquals(
    substituteVariables("Olá {{contact_name}}!", vars),
    "Olá Maria!",
  );
});

Deno.test("substituteVariables — variável ausente mantém o placeholder", () => {
  const vars = { contact: { name: null as unknown as string } };
  assertEquals(
    substituteVariables("Oi {{contact.name}}!", vars),
    "Oi {{contact.name}}!",
  );
  assertEquals(
    substituteVariables("{{contato.inexistente}}", vars),
    "{{contato.inexistente}}",
  );
});

Deno.test("substituteVariables — template sem variáveis volta igual", () => {
  assertEquals(substituteVariables("Bom dia!", {}), "Bom dia!");
});

// ---------------------------------------------------------------------------
// localParts (fuso America/Sao_Paulo, UTC-3 fixo desde 2019 — sem DST)
// ---------------------------------------------------------------------------

Deno.test("localParts — converte UTC para São Paulo (sábado, 17h)", () => {
  // 2026-10-03T20:00:00Z → 17:00 de sábado em São Paulo.
  const parts = localParts(new Date("2026-10-03T20:00:00Z"));
  assertEquals(parts.dayOfWeek, 6); // sábado
  assertEquals(parts.minutes, 17 * 60);
});

Deno.test("localParts — segunda de manhã em São Paulo", () => {
  // 2026-10-05T12:00:00Z → 09:00 de segunda.
  const parts = localParts(new Date("2026-10-05T12:00:00Z"));
  assertEquals(parts.dayOfWeek, 1);
  assertEquals(parts.minutes, 9 * 60);
});

Deno.test("localParts — meia-noite UTC vira 21:00 do dia anterior", () => {
  // 2026-10-05T00:00:00Z → domingo 21:00 em São Paulo.
  const parts = localParts(new Date("2026-10-05T00:00:00Z"));
  assertEquals(parts.dayOfWeek, 0);
  assertEquals(parts.minutes, 21 * 60);
});

Deno.test("localParts — domingo e sábado são fim de semana", () => {
  assertEquals(isWeekend(new Date("2026-10-03T20:00:00Z")), true); // sáb 17h loc
  assertEquals(isWeekend(new Date("2026-10-04T15:00:00Z")), true); // dom 12h loc
  assertEquals(isWeekend(new Date("2026-10-05T15:00:00Z")), false); // seg 12h loc
});

// ---------------------------------------------------------------------------
// skipToBusinessDay
// ---------------------------------------------------------------------------

Deno.test("skipToBusinessDay — sábado empurra até segunda-feira", () => {
  const sat = new Date("2026-10-03T20:00:00Z"); // sáb 17h São Paulo
  const pushed = skipToBusinessDay(sat, true);
  assertEquals(isWeekend(pushed), false);
  assertEquals(localParts(pushed).dayOfWeek, 1); // segunda
  assertEquals(pushed.getTime() > sat.getTime(), true);
});

Deno.test("skipToBusinessDay — segunda-feira não é empurrada", () => {
  const mon = new Date("2026-10-05T12:00:00Z"); // seg 09h São Paulo
  const pushed = skipToBusinessDay(mon, true);
  assertEquals(pushed.getTime(), mon.getTime());
});

Deno.test("skipToBusinessDay — skip_weekends=false devolve a mesma data", () => {
  const sat = new Date("2026-10-03T20:00:00Z");
  const pushed = skipToBusinessDay(sat, false);
  assertEquals(pushed.getTime(), sat.getTime());
});

Deno.test("skipToBusinessDay — domingo empurra para segunda", () => {
  const sun = new Date("2026-10-04T15:00:00Z"); // dom 12h São Paulo
  const pushed = skipToBusinessDay(sun, true);
  assertEquals(localParts(pushed).dayOfWeek, 1);
});

// ---------------------------------------------------------------------------
// timeToMinutes
// ---------------------------------------------------------------------------

Deno.test("timeToMinutes — parse de HH:MM", () => {
  assertEquals(timeToMinutes("08:00"), 480);
  assertEquals(timeToMinutes("18:30"), 1110);
  assertEquals(timeToMinutes("00:00"), 0);
});
