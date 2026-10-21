// _shared/noreply-attempts.ts
//
// Seleção da próxima tentativa da régua de follow-up.
//
// Extraído do `noreply-runner` para ser testável: a lógica é pura e um
// erro aqui manda a mensagem ERRADA para o lead (com o template e o delay
// de outra tentativa).

export interface NoreplyAttemptLike {
  attempt_number: number;
  delay_hours: number;
}

/**
 * Escolhe a próxima tentativa a enviar.
 *
 * A tentativa é escolhida pelo NÚMERO, nunca pela posição no array.
 *
 * Antes o runner usava `attempts[state.attempts_made]` — mapeamento
 * POSICIONAL. O admin podia desativar a tentativa 2 na UI: o array ativo
 * ficava [1, 3] e a 2ª mensagem enviada usava o template e o delay da
 * tentativa 3. O `attempt_number` é a identidade correta.
 *
 * @param attempts  Tentativas ATIVAS, ordenadas por `attempt_number`.
 * @param attemptsMade  Número da última tentativa enviada (0 = nenhuma).
 * @returns A próxima tentativa, ou null se todas as ativas já foram enviadas.
 */
export function selectNextAttempt<T extends NoreplyAttemptLike>(
  attempts: T[],
  attemptsMade: number,
): T | null {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  const pending = attempts
    .filter((a) => a.attempt_number > attemptsMade)
    .sort((a, b) => a.attempt_number - b.attempt_number);
  return pending.length > 0 ? pending[0] : null;
}

/**
 * Próxima tentativa APÓS a enviada (para agendar o próximo check).
 * Retorna null quando não há mais tentativas ativas.
 */
export function selectFollowingAttempt<T extends NoreplyAttemptLike>(
  attempts: T[],
  attemptsMade: number,
): T | null {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  const pending = attempts
    .filter((a) => a.attempt_number > attemptsMade)
    .sort((a, b) => a.attempt_number - b.attempt_number);
  return pending.length > 1 ? pending[1] : null;
}
