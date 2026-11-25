import type { PromptOrigin } from 'claude-code'
import * as P from '../paths.ts'
import { HELD, inboundLine, parseChannel, type Channel, type Who } from '../inbound.ts'
import { recallFor } from '../recall.ts'
import { parseConfig } from '../schedule.ts'
import { styleBlock } from '../style.ts'
import { appendInbound, homeOf, isHost, logDeny, svc, type Engine } from '../engine.ts'
import { isFresh, freshStub } from '../fresh.ts'
import { armTyping } from './typing.ts'
import type { Ctx, On } from './ctx.ts'

// Channel prompts are isMeta: the engine ignores a text rewrite when one starts a turn. Anything Claude must not
// see is dropped (the reason shows only in the owner's terminal, never the text); anything added rides in `context`.
const FRESH_DROP = 'NLK: /fresh handled by the service outside the chat'

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
    if (who === 'unknown' || (who === 'not-owner' && c)) {
      if (who === 'unknown') await svc($, '/owner/notice', { kind: 'unverified' }).catch(() => {})
      if (c) await logInbound($, { msgId: c.msgId, text: `[held ${c.msgId}]` })
      return { drop: HELD }
    }
    const owner = who === 'owner' && c ? c : null
    if (owner && isFresh(owner.text)) {
      await logInbound($, { msgId: owner.msgId, text: freshStub(owner.msgId) })
      await svc($, '/fresh', { msgId: owner.msgId }).catch(() => logDeny($, '/fresh not delivered', 'prompt.submit').catch(() => {}))
      return { drop: FRESH_DROP }
    }
    if (owner) await logInbound($, owner)
    if (!owner) return next(e)
    armTyping()
    const block = await recallFor((path, body) => svc($, path, body), owner.text).catch(() => '')
    const cfgText = await $.fs.read(P.configFile(await homeOf($))).catch(() => null)
    const style = styleBlock(parseConfig(cfgText === null ? null : String(cfgText)).style)
    return next({ ...e, context: [...(e.context ?? []), style, ...(block ? [block] : [])] })
  })
}
