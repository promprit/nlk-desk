// The "typing…" indicator while NLK works on the owner's message: Telegram shows it for about 5 s, so it is sent every 4 s.
export const TYPING_EVERY_MS = 4_000
export const TYPING_MAX_MS = 5 * 60_000

export type TypingIo = {
  every(ms: number, fn: () => void): { cancel(): void }
  now(): Promise<number>
  /** One typing action; it throws when Telegram or the token fails. */
  send(): Promise<void>
}

/** Sends one now, then every 4 s until the returned stop, the 5-minute cap or a failed send. A failure is silent: nothing is logged. */
export function startTyping(io: TypingIo): () => void {
  let timer: { cancel(): void } | null = null
  let stopped = false
  const stop = () => { stopped = true; timer?.cancel() }
  const tick = async (from: number) => {
    try {
      if (stopped) return
      if ((await io.now()) - from >= TYPING_MAX_MS) return stop()
      await io.send()
    } catch { stop() }
  }
  void io.now().then(from => {
    if (stopped) return
    void tick(from)
    timer = io.every(TYPING_EVERY_MS, () => void tick(from))
  }, stop)
  return stop
}
