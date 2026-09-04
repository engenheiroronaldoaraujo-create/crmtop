// Alerta sonoro de novas mensagens (app aberto).
// - Navegadores mobile só deixam tocar áudio após um gesto do usuário:
//   chamar unlockAlertSound() no primeiro pointerdown/keydown (feito no Chat).
// - O "alto" vem do compressor com ganho no limite + sequência de tons tipo
//   WhatsApp, repetida uma vez para cada mensagem pendente (até 5).

let ctx: AudioContext | null = null
const STORAGE_KEY = "crm.alert-muted"

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext }

function ensureCtx(): AudioContext | null {
  const Ctx = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext
  if (!Ctx) return null
  if (!ctx || ctx.state === "closed") ctx = new Ctx()
  return ctx
}

export function unlockAlertSound(): void {
  try {
    const c = ensureCtx()
    if (c && c.state === "suspended") void c.resume()
  } catch {
    // sem áudio disponível: ignora
  }
}

export function isAlertMuted(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1"
}

export function setAlertMuted(muted: boolean): void {
  if (muted) localStorage.setItem(STORAGE_KEY, "1")
  else localStorage.removeItem(STORAGE_KEY)
}

function tone(c: AudioContext, dest: AudioNode, freq: number, startAt: number, dur: number) {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = "sine"
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(1, startAt + 0.015)
  gain.gain.setValueAtTime(1, startAt + dur - 0.04)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur)
  osc.connect(gain).connect(dest)
  osc.start(startAt)
  osc.stop(startAt + dur + 0.01)
}

// count = nº de mensagens novas: repete o "plim-plim" para escalar o aviso.
export function playNewMessageAlert(count = 1): void {
  if (isAlertMuted()) return
  try {
    const c = ensureCtx()
    if (!c) return
    if (c.state === "suspended") void c.resume()

    const comp = c.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.knee.value = 6
    comp.ratio.value = 16
    comp.attack.value = 0.002
    comp.release.value = 0.12
    comp.connect(c.destination)

    const pulses = Math.min(Math.max(count, 1), 5)
    let t = c.currentTime + 0.02
    for (let i = 0; i < pulses; i++) {
      tone(c, comp, 880, t, 0.16)
      tone(c, comp, 660, t + 0.2, 0.18)
      t += 0.44
      if (i < pulses - 1) t += 0.28
    }

    navigator.vibrate?.([180, 90, 180])
  } catch {
    // áudio é cortesia: nunca pode quebrar o chat
  }
}
