import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  selectFollowingAttempt,
  selectNextAttempt,
} from "./noreply-attempts.ts";

const A = (attempt_number: number, delay_hours = 24) => ({
  attempt_number,
  delay_hours,
});

Deno.test("selectNextAttempt: pega a 1ª tentativa quando nada foi enviado", () => {
  const attempts = [A(1, 24), A(2, 72), A(3, 72)];
  assertEquals(selectNextAttempt(attempts, 0)?.attempt_number, 1);
});

Deno.test("selectNextAttempt: avança pelo número da tentativa enviada", () => {
  const attempts = [A(1, 24), A(2, 72), A(3, 72)];
  assertEquals(selectNextAttempt(attempts, 1)?.attempt_number, 2);
  assertEquals(selectNextAttempt(attempts, 2)?.attempt_number, 3);
});

Deno.test("selectNextAttempt: tentativa desativada é pulada pelo NÚMERO", () => {
  // A tentativa 2 foi desativada na UI: o array ativo é [1, 3].
  // O mapeamento posicional (attempts[1]) pegaria a tentativa 3 — o bug.
  const attempts = [A(1, 24), A(3, 168)];
  const next = selectNextAttempt(attempts, 1);
  assertEquals(next?.attempt_number, 3);
  // O importante: nunca volta para uma tentativa já enviada.
  assertEquals(selectNextAttempt(attempts, 3), null);
});

Deno.test("selectNextAttempt: com a 1ª desativada, começa pela 2ª", () => {
  const attempts = [A(2, 72), A(3, 72)];
  assertEquals(selectNextAttempt(attempts, 0)?.attempt_number, 2);
});

Deno.test("selectNextAttempt: null quando todas foram enviadas", () => {
  const attempts = [A(1), A(2)];
  assertEquals(selectNextAttempt(attempts, 2), null);
  assertEquals(selectNextAttempt(attempts, 5), null);
});

Deno.test("selectNextAttempt: array vazio devolve null", () => {
  assertEquals(selectNextAttempt([], 0), null);
});

Deno.test("selectNextAttempt: ordena mesmo se a lista vier embaralhada", () => {
  const attempts = [A(3, 72), A(1, 24), A(2, 72)];
  assertEquals(selectNextAttempt(attempts, 0)?.attempt_number, 1);
  assertEquals(selectNextAttempt(attempts, 1)?.attempt_number, 2);
});

Deno.test("selectFollowingAttempt: devolve a tentativa seguinte", () => {
  const attempts = [A(1, 24), A(2, 72), A(3, 72)];
  assertEquals(selectFollowingAttempt(attempts, 0)?.attempt_number, 2);
  assertEquals(selectFollowingAttempt(attempts, 1)?.attempt_number, 3);
  // Última tentativa: não há a seguinte.
  assertEquals(selectFollowingAttempt(attempts, 2), null);
});

Deno.test("selectFollowingAttempt: pula a tentativa desativada", () => {
  const attempts = [A(1, 24), A(3, 168)];
  // Depois da 1ª (enviada), a próxima ativa é a 3ª (a 2ª está desativada).
  assertEquals(selectFollowingAttempt(attempts, 0)?.attempt_number, 3);
  // Depois da 3ª não há mais nada ativo.
  assertEquals(selectFollowingAttempt(attempts, 1), null);
});
