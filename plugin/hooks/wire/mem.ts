import { MEM_SPECS, OWN, memCall } from '../memtools.ts'
import { hasTools, isWorker, svc, type Engine } from '../engine.ts'
import type { Ctx, On } from './ctx.ts'

// Called from the status wiring once the gate is open: a module has one matcher-less session.start hook.
export async function registerMemTools($: Engine) {
  for (const spec of MEM_SPECS) await $.tool.register(spec)
}

// Its session only; the guard's tool.call hook checks each call first.
export function wireMem(on: On, _ctx: Ctx) {
  for (const spec of MEM_SPECS) {
    on('tool.call', { tool: `${OWN}${spec.name}` }, async ($, e) => {
      if (!(await hasTools($))) return { deny: 'NLK tools run only in its own session' }
      const source = (await isWorker($)) ? 'worker' : 'chat'
      return { result: await memCall((path, body) => svc($, path, body), spec.name, e as unknown as Record<string, unknown>, source).catch(err => `the ${spec.name} tool failed: ${String(err).slice(0, 120)}`) }
    })
  }
}
