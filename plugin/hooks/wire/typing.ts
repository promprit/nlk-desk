import * as P from '../paths.ts'
import { homeOf, ownerChat, type Engine } from '../engine.ts'
import type { Ctx, On } from './ctx.ts'
import { startTyping } from '../typing.ts'

let armed = false
let stop: (() => void) | null = null

export function armTyping() { armed = true }

async function sendTyping($: Engine): Promise<void> {
  const env = await $.fs.read(`${P.telegramState(await homeOf($))}/.env`)
  const token = /^TELEGRAM_BOT_TOKEN=(\S+)/m.exec(typeof env === 'string' ? env : '')?.[1]
  const chat = await ownerChat($)
  if (!token || !chat) throw new Error('no token or chat')
  const r = await $.http.fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, action: 'typing' }),
  })
  if (!r.ok) throw new Error('sendChatAction refused')
}

export function typingTurnStart($: Engine) {
  if (!armed) return
  armed = false
  stop?.()
  stop = startTyping({ every: (ms, fn) => $.clock.every(ms, fn), now: async () => $.clock.now(), send: () => sendTyping($) })
}

export function typingTurnEnd() {
  stop?.()
  stop = null
  armed = false
}

// A module has one matcher-less hook per event: this wire owns turn.start and turn.complete.
export function wireTyping(on: On, _ctx: Ctx) {
  on('turn.start', async ($, e, next) => { typingTurnStart($); return next(e) })
  on('turn.complete', async (_$, e, next) => { typingTurnEnd(); return next(e) })
}
