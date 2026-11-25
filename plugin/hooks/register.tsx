import type { Register } from 'claude-code'
import type { Ctx } from './wire/ctx.ts'
import { wireGuard } from './wire/guard.ts'
import { wireInbound } from './wire/inbound.ts'
import { wireMem } from './wire/mem.ts'
import { wireTyping } from './wire/typing.ts'

const ctx: Ctx = {}

// Each feature's wiring lives in wire/<feature>.ts; this file only calls them (later tasks add their wire* calls).
export const register: Register = on => {
  wireGuard(on, ctx)
  wireInbound(on, ctx)
  wireMem(on, ctx)
  wireTyping(on, ctx)
}
