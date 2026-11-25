export type Inbound = { msgId: string; at: number; text: string }
// attach: what the Telegram plugin tags a file with (attachment_kind, attachment_file_id, attachment_size).
export type Channel = { userId: string; msgId: string; text: string; attach?: { kind: string; fileId: string; size: number | null } }
// owner: stamped, from an id in allowFrom; not-owner: unstamped (passes through) or another id (held); unknown: stamped but unverifiable (held).
export type Who = 'owner' | 'not-owner' | 'unknown'
// What Claude gets instead of a held message; it never echoes the owner's text.
export const HELD = '[a Telegram message arrived that could not be verified; it was held]'

// Only the first tag, at the start of the prompt: the engine renders a channel notification as
// <channel source="plugin:telegram:telegram" chat_id="…" message_id="…" user="…" user_id="…" ts="…">BODY</channel>.
const WRAPPER = /^\s*<channel\s([^>]*)>([\s\S]*?)<\/channel>/
const ATTR = /([a-z_]+)="([^"]*)"/g
const DIGITS = /^\d+$/

function wrapper(text: string): { a: Record<string, string>; body: string } | null {
  const m = WRAPPER.exec(text)
  if (!m) return null
  const a: Record<string, string> = {}
  for (const [, k, v] of (m[1] ?? '').matchAll(ATTR)) if (k !== undefined && v !== undefined && !(k in a)) a[k] = v
  return { a, body: m[2] ?? '' }
}

export function parseChannel(text: string): Channel | null {
  const w = wrapper(text)
  if (!w) return null
  const { a } = w
  const userId = a.user_id ?? a.chat_id
  const msgId = a.message_id
  if (!a.source?.endsWith('telegram') || !userId || !DIGITS.test(userId) || !msgId || !DIGITS.test(msgId)) return null
  const c: Channel = { userId, msgId, text: w.body }
  if (a.attachment_kind && a.attachment_file_id) {
    const size = Number(a.attachment_size)
    c.attach = { kind: a.attachment_kind, fileId: a.attachment_file_id, size: a.attachment_size && Number.isFinite(size) ? size : null }
  }
  return c
}

export function inboundLine(i: Inbound): string {
  return JSON.stringify({ msgId: i.msgId, at: i.at, text: i.text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 500) })
}

// Handled stubs and system lines start with `[`; everything else is the owner's own message.
export const isOwnerText = (text: string): boolean => !text.trimStart().startsWith('[')

export function parseInbound(jsonl: string): Inbound[] {
  const out: Inbound[] = []
  for (const line of jsonl.split('\n')) {
    try {
      const x = JSON.parse(line)
      if (typeof x?.msgId === 'string' && typeof x.at === 'number' && typeof x.text === 'string') out.push({ msgId: x.msgId, at: x.at, text: x.text })
    } catch { /* not a line of ours */ }
  }
  return out
}
