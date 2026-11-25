import { OWN } from '../memtools.ts'
import { WEATHER_SPECS, weatherCall } from '../weathertool.ts'
import { configFile } from '../paths.ts'
import { parseConfig } from '../schedule.ts'
import { hasTools, homeOf, svc, type Engine } from '../engine.ts'
import type { Ctx, On } from './ctx.ts'

// Called from wireSchedule's session.start hook: a module has one matcher-less session.start hook.
export async function registerWeatherTools($: Engine) {
  for (const spec of WEATHER_SPECS) await $.tool.register(spec)
}

async function cityOf($: Engine) {
  const text = await $.fs.read(configFile(await homeOf($))).catch(() => null)
  return parseConfig(text === null ? null : String(text)).city
}

// Its session only; the guard's tool.call hook checks each call first.
export function wireWeather(on: On, _ctx: Ctx) {
  for (const spec of WEATHER_SPECS) {
    on('tool.call', { tool: `${OWN}${spec.name}` }, async ($, e) => {
      if (!(await hasTools($))) return { deny: 'NLK tools run only in its own session' }
      return { result: await weatherCall((path, body) => svc($, path, body), spec.name, e as unknown as Record<string, unknown>, await cityOf($)).catch(err => `the ${spec.name} tool failed: ${String(err).slice(0, 120)}`) }
    })
  }
}
