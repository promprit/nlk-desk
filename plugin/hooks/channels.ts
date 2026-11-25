export type Channel = { at: number; ok: boolean; reason?: 'token rejected' | 'network' | 'rate limited' | 'conflict' | 'stopped' }
export type Owner = 'mine' | 'other' | 'none'

// The telegram plugin writes its poller's pid to bot.pid. It is its own when its own tmux server is an ancestor
// (`ps -axo pid=,ppid=` rows); any other live poller holds its bot.
export function pollerOwner(ps: string, pollerPid: number | null, serverPid: number | null): Owner {
  const parent = new Map<number, number>()
  for (const row of ps.split('\n')) {
    const [pid, ppid] = row.trim().split(/\s+/).map(Number)
    if (Number.isInteger(pid) && Number.isInteger(ppid)) parent.set(pid as number, ppid as number)
  }
  if (pollerPid === null || !parent.has(pollerPid)) return 'none'
  for (let p: number | undefined = pollerPid, hops = 0; p !== undefined && p > 1 && hops < 32; p = parent.get(p), hops++)
    if (p === serverPid) return 'mine'
  return 'other'
}

// The plugin starts a little after its session: in the first 90 s a missing poller is left out (null), which the status
// shows as no report, so a restart never flashes red.
export const START_GRACE_MS = 90_000

export function telegramHealth(a: { now: number; poller: Owner; api: number | 'network'; sinceStart: number }): Channel | null {
  const at = a.now
  if (a.poller === 'other') return { at, ok: false, reason: 'conflict' }
  if (a.api === 401 || a.api === 404) return { at, ok: false, reason: 'token rejected' }
  if (a.api === 429) return { at, ok: false, reason: 'rate limited' }
  if (a.api === 'network' || a.api >= 500 || a.api !== 200) return { at, ok: false, reason: 'network' }
  if (a.poller === 'mine') return { at, ok: true }
  return a.sinceStart < START_GRACE_MS ? null : { at, ok: false, reason: 'stopped' }
}
