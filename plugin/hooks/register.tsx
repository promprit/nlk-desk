import type { Register } from 'claude-code'
import type { Ctx } from './wire/ctx.ts'
import { wireGuard } from './wire/guard.ts'
import { wireInbound } from './wire/inbound.ts'
import { wireMem } from './wire/mem.ts'
import { wireSchedule } from './wire/schedule.ts'
import { wireStatus } from './wire/status.ts'
import { wireTyping } from './wire/typing.ts'
import { wireWeather } from './wire/weather.ts'
import { wireStyle } from './wire/style.ts'

const ctx: Ctx = {}

export const register: Register = on => {
  wireStatus(on, ctx)
  wireInbound(on, ctx)
  wireGuard(on, ctx)
  wireMem(on, ctx)
  wireWeather(on, ctx)
  wireStyle(on, ctx)
  wireSchedule(on, ctx)
  wireTyping(on, ctx)
}
