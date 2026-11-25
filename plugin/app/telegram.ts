import { readFile } from 'node:fs/promises'

export type TgOpts = { api: string; token: string; chat: string }

/** Bot token from `${tgState}/.env`, owner chat from `access.json` allowFrom[0]. Throws "not paired" without a chat. */
export async function tgOpts(tgState: string, api = 'https://api.telegram.org'): Promise<TgOpts> {
  const env = await readFile(`${tgState}/.env`, 'utf8').catch(() => '')
  const token = /^TELEGRAM_BOT_TOKEN=(.+)$/m.exec(env)?.[1]?.trim()
  let chat: string | undefined
  try { chat = (JSON.parse(await readFile(`${tgState}/access.json`, 'utf8')) as { allowFrom?: unknown[] }).allowFrom?.[0]?.toString() } catch { /* unpaired */ }
  if (!token || !chat) throw new Error('not paired')
  return { api, token, chat }
}

/** Sends one message to the owner chat; returns its message_id (null if Telegram gave none). */
export async function sendText(o: TgOpts, text: string): Promise<number | null> {
  const r = await fetch(`${o.api}/bot${o.token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: o.chat, text }),
  })
  // Never echo the URL: it carries the bot token.
  if (!r.ok) throw new Error(`telegram sendMessage failed: ${r.status}`)
  const j = (await r.json().catch(() => null)) as { result?: { message_id?: unknown } } | null
  return typeof j?.result?.message_id === 'number' ? j.result.message_id : null
}
