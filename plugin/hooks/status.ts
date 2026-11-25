import type { Phase } from './gate.ts'

export type StatusFile = {
  at: number
  gate: Phase
  reason: string | null
  busy?: boolean
  replyAt?: number
  channels?: { telegram?: { at: number; ok: boolean; reason?: string } }
  // The running Claude Code version, when the engine reports it.
  claude?: string
}
export const STALE_MS = 300_000
export const PAIR_CODE = /^[a-z0-9]{5,8}$/i

export function parseStatus(text: string | null): StatusFile | null {
  if (!text) return null
  try {
    const s = JSON.parse(text) as StatusFile
    return typeof s.at === 'number' && typeof s.gate === 'string' ? s : null
  } catch {
    return null
  }
}

const NEWER = 'newer than tested; if NLK misbehaves, send this line to whoever gave you NLK'

const num = (v: string) => v.split('.').map(n => Number.parseInt(n, 10) || 0)
function newer(a: string, b: string): boolean {
  const x = num(a)
  const y = num(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

const TG_REASON: Record<string, string> = {
  'token rejected': 'the bot token was rejected',
  network: 'cannot reach Telegram',
  'rate limited': 'Telegram is rate limiting',
  conflict: 'another program is polling this bot',
  stopped: 'the Telegram poller is not running',
}

export function statusReport(s: StatusFile | null, now: number, testedClaude?: string): string {
  if (!s) return 'NLK is not running (no status file)'
  const mins = Math.round((now - s.at) / 60_000)
  if (now - s.at > STALE_MS) return `NLK is not running (last heartbeat ${mins} min ago)`
  const lines = [`NLK: ${s.gate}${s.reason ? ` (${s.reason})` : ''} · heartbeat ${mins} min ago`]
  const tg = s.channels?.telegram
  lines.push(!tg ? 'Telegram: starting' : tg.ok ? 'Telegram: connected' : `Telegram: not connected (${(tg.reason && TG_REASON[tg.reason]) ?? tg.reason ?? 'unknown'})`)
  if (s.busy) lines.push('Busy: working on a reply')
  if (s.replyAt) lines.push(`Last reply: ${Math.round((now - s.replyAt) / 60_000)} min ago`)
  if (s.claude) {
    lines.push(testedClaude
      ? `Claude Code ${s.claude} (tested with ${testedClaude})${newer(s.claude, testedClaude) ? ` — ${NEWER}` : ''}`
      : `Claude Code ${s.claude}`)
  }
  return lines.join('\n')
}
