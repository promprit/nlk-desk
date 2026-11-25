import type { PromptOrigin } from 'claude-code'
import * as P from '../paths.ts'
import { HELD, inboundLine, parseChannel, type Channel, type Who } from '../inbound.ts'
import { recallFor } from '../recall.ts'
import { appendInbound, homeOf, isHost, logDeny, svc, type Engine } from '../engine.ts'
import { isFresh, freshStub } from '../fresh.ts'
import { armTyping } from './typing.ts'
import type { Ctx, On } from './ctx.ts'

// Channel prompts are isMeta: the engine ignores a text rewrite when one starts a turn. Anything Claude must not
// see is dropped (the reason shows only in the owner's terminal, never the text); anything added rides in `context`.
const FRESH_DROP = 'NLK: /fresh handled by the service outside the chat'

// Only what the engine stamped as the telegram channel, from an id in allowFrom, is the owner's message.
// A stamped message that cannot be checked (pairing file missing or damaged, parse error) is unknown.
export async function ownerMessage($: Engine, text: string, origin: PromptOrigin): Promise<{ who: Who; c?: Channel }> {
  if (origin.kind !== 'channel' || !origin.server.endsWith('telegram')) return { who: 'not-owner' }
  try {
    if (!(await isHost($))) return { who: 'not-owner' }
    const c = parseChannel(text)
    if (!c) return { who: 'unknown' }
    const access = await $.fs.read(`${P.telegramState(await homeOf($))}/access.json`)
    const allowFrom: unknown = JSON.parse(typeof access === 'string' ? access : '').allowFrom
    if (!Array.isArray(allowFrom)) return { who: 'unknown' }
    return { who: allowFrom.includes(c.userId) ? 'owner' : 'not-owner', c }
  } catch {
    return { who: 'unknown' }
  }
}

async function logInbound($: Engine, c: { msgId: string; text: string }) {
  try {
    await appendInbound($, await homeOf($), inboundLine({ msgId: c.msgId, at: await $.clock.now(), text: c.text }))
  } catch {
    await logDeny($, 'inbound log failed', 'prompt.submit').catch(() => {})
  }
}

export function wireInbound(on: On, _ctx: Ctx) {
  on('prompt.submit', async ($, e, next) => {
    const { who, c } = await ownerMessage($, e.text, e.origin)
    // Held: dropped, so Claude never gets it; no recall. The log keeps a stub (never the text); only an unverifiable one tells the owner.
    if (who === 'unknown' || (who === 'not-owner' && c)) {
      if (who === 'unknown') await svc($, '/owner/notice', { kind: 'unverified' }).catch(() => {})
      if (c) await logInbound($, { msgId: c.msgId, text: `[held ${c.msgId}]` })
      return { drop: HELD }
    }
    const owner = who === 'owner' && c ? c : null
    // `/fresh`: the service clears the conversation and restarts it; Claude never sees it and the log keeps a stub.
    if (owner && isFresh(owner.text)) {
      await logInbound($, { msgId: owner.msgId, text: freshStub(owner.msgId) })
      await svc($, '/fresh', { msgId: owner.msgId }).catch(() => logDeny($, '/fresh not delivered', 'prompt.submit').catch(() => {}))
      return { drop: FRESH_DROP }
    }
    // Logged before the prompt enters, so a tool in the same turn finds the message.
    if (owner) await logInbound($, owner)
    if (!owner) return next(e)
    armTyping()
    const block = await recallFor((path, body) => svc($, path, body), owner.text).catch(() => '')
    return next(block ? { ...e, context: [...(e.context ?? []), block] } : e)
  })
}
