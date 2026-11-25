import { OWN } from '../memtools.ts'
import { STYLE_SPEC, styleCall } from '../style.ts'
import { configFile } from '../paths.ts'
import { hasTools, homeOf, type Engine } from '../engine.ts'
import type { Ctx, On } from './ctx.ts'

export async function registerStyleTool($: Engine) {
  await $.tool.register(STYLE_SPEC)
}

export function wireStyle(on: On, _ctx: Ctx) {
  on('tool.call', { tool: `${OWN}${STYLE_SPEC.name}` }, async ($, e) => {
    if (!(await hasTools($))) return { deny: 'NLK tools run only in its own session' }
    const file = configFile(await homeOf($))
    const result = await styleCall(
      async () => { const t = await $.fs.read(file); return t === null || t === undefined ? null : String(t) },
      async text => { await $.fs.write(file, text) },
      e as unknown as Record<string, unknown>,
    ).catch(err => `the style_set tool failed: ${String(err).slice(0, 120)}`)
    return { result }
  })
}
