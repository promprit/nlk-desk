import * as P from '../paths.ts'
import { BRIEF_PROMPT, REMIND_SPEC, bangkok, due, next, parseConfig, parseSchedule, reminderFrom, type Schedule } from '../schedule.ts'
import { WORKER_TIMEOUT_MS, recentMessages, workerArgv, workerEnv, workerOutput, workerPrompt, workerRunsFile, workerTgDir } from '../worker.ts'
import { OWN } from '../memtools.ts'
import { hasTools, homeOf, svc, type Engine } from '../engine.ts'
import type { Ctx, On } from './ctx.ts'

const MIN = 60_000
const RETRY_MS = 10 * MIN
const PENDING_MS = 15 * MIN
const LATE_MS = 10 * MIN
const REMIND_KEEP_MS = 24 * 60 * MIN

let ticking = false
let writes: Promise<unknown> = Promise.resolve()
let worker: Promise<void> | null = null

async function read($: Engine, path: string): Promise<string | null> {
  const t = await $.fs.read(path).catch(() => null)
  return t === null ? null : String(t)
}

async function load($: Engine): Promise<Schedule> {
  return parseSchedule(await read($, P.scheduleFile(await homeOf($))))
}

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = writes.then(fn)
  writes = run.catch(() => {})
  return run
}

function change($: Engine, fn: (s: Schedule) => Schedule): Promise<Schedule> {
  return serial(async () => {
    const s = fn(await load($))
    await $.fs.write(P.scheduleFile(await homeOf($)), JSON.stringify(s))
    return s
  })
}

function logRun($: Engine, home: string, line: Record<string, unknown>): Promise<void> {
  return serial(async () => {
    const file = workerRunsFile(home)
    const prev = await $.fs.read(file).catch(() => '')
    const lines = `${typeof prev === 'string' ? prev : ''}${JSON.stringify(line)}\n`.split('\n').filter(Boolean)
    await $.fs.write(file, `${lines.slice(-2000).join('\n')}\n`)
  })
}

export function resetTicker() {
  ticking = false
}

async function remindTick($: Engine, now: number) {
  const r = due(now, await load($), {}).reminders[0]
  if (!r) return
  const dropped = now - r.at > REMIND_KEEP_MS
  await change($, s => ({
    ...s,
    reminders: s.reminders.flatMap(x => (x.id !== r.id ? [x] : next(x, now) ?? [])),
    ...(dropped ? { lastWorkerError: 'reminder dropped' } : {}),
  }))
  if (dropped) return
  const text = now - r.at > LATE_MS ? `(late) ${r.text}` : r.text
  if (!(await svc($, '/remind/send', { text })).ok) await change($, s => ({ ...s, reminders: [...s.reminders.filter(x => x.id !== r.id), r] }))
}

function ended(s: Schedule, at: number, why: string | undefined): Schedule {
  const { workerPending: _, lastWorkerError: _e, ...x } = s
  return { ...x, ...(why ? { lastWorkerError: why } : {}), ...(why && s.briefRetry !== bangkok(at).date ? { briefFailAt: at } : {}) }
}

async function startBrief($: Engine, now: number, count: (s: Schedule) => Schedule) {
  const home = await homeOf($)
  const prompt = workerPrompt(BRIEF_PROMPT, recentMessages((await read($, P.inboundLog(home))) ?? '', now))
  await $.process.run(['mkdir', '-p', workerTgDir(home)])
  await change($, s => ({ ...count(s), workerPending: { kind: 'brief', at: now } }))
  const end = (why?: string, sent: Partial<Schedule> = {}) => change($, s => ({ ...ended(s, now, why), ...sent }))
  worker = $.process.run(workerArgv(home), { cwd: P.deskDir(home), env: workerEnv(home), stdin: prompt, timeoutMs: WORKER_TIMEOUT_MS })
    .then(async r => {
      const out = workerOutput(r.stdout)
      const why = r.exitCode !== 0 ? `exit ${r.exitCode}` : out.status === 'error' ? 'worker error' : out.text === null ? 'empty' : undefined
      await logRun($, home, { at: now, kind: 'brief', ok: !why, ...(out.usage ?? {}) }).catch(() => {})
      if (why || out.text === null) return void (await end(why))
      if (!(await svc($, '/remind/send', { text: out.text })).ok) return void (await end('send failed'))
      await end()
    }, async () => {
      await logRun($, home, { at: now, kind: 'brief', ok: false }).catch(() => {})
      await end('timeout')
    })
    .catch(() => {})
    .finally(async () => {
      await change($, s => {
        if (s.workerPending?.at !== now) return s
        const { workerPending: _, ...x } = s
        return x
      }).catch(() => {})
      worker = null
    })
}

async function briefTick($: Engine, now: number) {
  let s = await load($)
  const today = bangkok(now).date
  const p = s.workerPending
  if (p && now - p.at >= PENDING_MS) s = await change($, x => ended(x, p.at, 'interrupted'))
  const config = parseConfig(await read($, P.configFile(await homeOf($))))
  if (due(now, s, config).brief) return startBrief($, now, x => ({ ...x, briefDate: today }))
  if (config.brief?.on && s.briefRetry !== today && s.briefFailAt !== undefined && bangkok(s.briefFailAt).date === today && now - s.briefFailAt >= RETRY_MS) {
    return startBrief($, now, x => ({ ...x, briefRetry: today }))
  }
}

export async function tick($: Engine) {
  if (ticking) return
  ticking = true
  try {
    const now = await $.clock.now()
    await remindTick($, now).catch(() => {})
    if (worker === null) await briefTick($, now).catch(() => {})
  } finally {
    ticking = false
  }
}

async function remindCall($: Engine, input: Record<string, unknown>): Promise<string> {
  const r = reminderFrom(input, crypto.randomUUID().slice(0, 8))
  if (typeof r === 'string') return r
  await change($, s => ({ ...s, reminders: [...s.reminders, r] }))
  return `reminder set for ${new Date(r.at + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')} Bangkok time${r.every ? `, every ${r.every}` : ''}`
}

export async function registerScheduleTools($: Engine) {
  await $.tool.register(REMIND_SPEC)
}

export function wireSchedule(on: On, _ctx: Ctx) {
  on('tool.call', { tool: `${OWN}${REMIND_SPEC.name}` }, async ($, e) => {
    if (!(await hasTools($))) return { deny: 'NLK tools run only in its own session' }
    return { result: await remindCall($, e as unknown as Record<string, unknown>).catch(err => `the remind tool failed: ${String(err).slice(0, 120)}`) }
  })
}
