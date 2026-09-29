// Comparação de segredos em tempo constante.
//
// Um `===` comum sai no primeiro caractere diferente, o que vaza o prefixo
// do segredo por timing. Sobre HTTP isso exige muitas amostras para ser
// explorável, mas o custo de corrigir é quase zero e o benefício é não
// depender dessa premissa.

/**
 * Retorna true apenas se `a` e `b` forem idênticos, em tempo constante em
 * relação ao conteúdo.
 *
 * Percorre sempre o maior dos dois tamanhos (bytes UTF-8), tratando posição
 * ausente como 0, e acumula a diferença num único XOR. O resultado é
 * independente de *onde* a diferença está.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // O XOR do tamanho entra no acumulador: assim "abc" vs "abcd" não vaza nem
  // pelo comprimento.
  let diff = ba.length ^ bb.length;
  const len = Math.max(ba.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
