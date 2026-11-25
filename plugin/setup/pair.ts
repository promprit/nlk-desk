import { readFileSync } from 'node:fs'

export type Sender = { id: string; name: string; chatId: string; updateId: number }

/** The first message in a `getUpdates` answer, or null when there is none. */
export function firstSender(updatesJson: string): Sender | null {
  try {
    const r = JSON.parse(updatesJson)?.result
    if (!Array.isArray(r)) return null
    for (const u of r) {
      const m = u?.message
      if (!m || typeof u.update_id !== 'number' || m.from?.id === undefined || m.chat?.id === undefined) continue
      return { id: String(m.from.id), name: String(m.from.first_name ?? m.from.username ?? m.from.id), chatId: String(m.chat.id), updateId: u.update_id }
    }
    return null
  } catch {
    return null
  }
}

/** The Telegram plugin's access.json with exactly one allowed sender; other fields of an existing file are kept. */
export function allowlistAccess(prevText: string | null, id: string): string {
  let prev: Record<string, unknown> = {}
  try {
    const p = JSON.parse(prevText ?? '')
    if (p && typeof p === 'object' && !Array.isArray(p)) prev = p
  } catch {}
  return `${JSON.stringify({ ...prev, dmPolicy: 'allowlist', allowFrom: [id], groups: {}, pending: {} }, null, 2)}\n`
}

// CLI for install.sh: `node pair.ts sender < updates.json` prints `id<TAB>name<TAB>chatId<TAB>updateId` or nothing;
// `node pair.ts access <id> [prevFile]` prints the new access.json.
if (import.meta.main) {
  const [cmd, a, b] = process.argv.slice(2)
  if (cmd === 'sender') {
    const s = firstSender(readFileSync(0, 'utf8'))
    if (s) process.stdout.write(`${s.id}\t${s.name}\t${s.chatId}\t${s.updateId}\n`)
  } else if (cmd === 'access' && a) {
    let prev: string | null = null
    try { prev = b ? readFileSync(b, 'utf8') : null } catch {}
    process.stdout.write(allowlistAccess(prev, a))
  }
}
