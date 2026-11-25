import { test, expect, mock } from 'claude-code/testing'
import { configFile, deskDir, inboundLog, scheduleFile, svcTokenFile, telegramState } from '../hooks/paths.ts'
import { OWN } from '../hooks/memtools.ts'
import { workerRunsFile, workerTgDir } from '../hooks/worker.ts'

const HOME = '/H'
const SCHEDULE = scheduleFile(HOME)
const RUNS = workerRunsFile(HOME)
const START = { cwd: deskDir(HOME), surface: 'terminal', isInteractive: true } as const
const MIN = 60_000
const at = (hhmm: string, day = '2026-10-21') => Date.parse(`${day}T${hhmm}:00+07:00`)
const OK = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const allow = ['remind', 'weather_today', 'set_location'].map(n => `${OWN}${n}`)
const BRIEF_ON = { [configFile(HOME)]: JSON.stringify({ brief: { on: true, at: '09:00' }, city: { name: 'Bangkok', lat: 13.7, lon: 100.5 }, tools: { allow } }) }

function wire(on: any, extra: Record<string, string> = {}) {
  const files: Record<string, string> = { [`${telegramState(HOME)}/access.json`]: '{"allowFrom":["111"]}', [svcTokenFile(HOME)]: 'tok\n', [configFile(HOME)]: JSON.stringify({ tools: { allow } }), ...extra }
  const w = {
    files, fetched: [] as string[], registered: [] as string[],
    workers: [] as { argv: string[]; env: Record<string, string>; stdin?: string }[], workerOut: 'Good morning, rain at 14:00', workerExit: 0, workerError: false, gate: null as Promise<void> | null,
    bodies: {} as Record<string, any[]>, failing: [] as string[], badWrites: [] as string[], submitted: [] as string[],
  }
  const env: Record<string, string | undefined> = { NLK_HOST: '1', HOME }
  mock.store(on)
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('env.get', async (_$: unknown, e: { name: string }) => ({ value: env[e.name] }))
  on('fs.exists', async (_$: unknown, e: { path: string }) => ({ value: e.path in files }))
  on('fs.read', async (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: files[e.path] }
  })
  on('fs.write', async (_$: unknown, e: { path: string; text: string }) => {
    if (w.badWrites.includes(e.path)) throw new Error('EIO')
    files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.stat', async (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }
  })
  on('fs.list', async () => ({ value: [] }))
  on('process.run', async (_$: unknown, e: { argv: string[]; init?: { env?: Record<string, string>; stdin?: string } }) => {
    if (e.argv[0] === 'claude' && e.argv[1] === '-p') {
      w.workers.push({ argv: [...e.argv], env: e.init?.env ?? {}, stdin: e.init?.stdin })
      if (w.gate) await w.gate
      return { value: { ...OK(JSON.stringify({ type: 'result', is_error: w.workerError, result: w.workerOut, usage: { input_tokens: 1, output_tokens: 1 } })), exitCode: w.workerExit } }
    }
    return { value: OK() }
  })
  on('http.fetch', async (_$: unknown, e: { url: string; init?: { body?: string } }) => {
    const path = new URL(e.url).pathname
    w.fetched.push(path)
    ;(w.bodies[path] ??= []).push(e.init?.body ? JSON.parse(e.init.body) : null)
    if (w.failing.includes(path)) return { value: { ok: false, status: 502, text: '{"error":"telegram down"}', headers: {} } }
    return { value: { ok: true, status: 200, text: '{}', headers: {} } }
  })
  on('tool.check', async () => ({ decision: 'allow' }))
  on('tool.register', async (_$: unknown, e: { name: string }) => { w.registered.push(e.name); return { value: { tool: `${OWN}${e.name}` } } })
  on('prompt.submit', async (_$: unknown, e: { text: string }) => { w.submitted.push(e.text); return { text: e.text } })
  return w
}

const saved = (w: { files: Record<string, string> }) => JSON.parse(w.files[SCHEDULE] ?? '{}')
const sched = (s: Record<string, unknown>) => ({ [SCHEDULE]: JSON.stringify({ reminders: [], ...s }) })
const fetches = (w: { fetched: string[] }, path: string) => w.fetched.filter(p => p === path)
const minute = async (clock: any, n = 1) => { for (let i = 0; i < n; i++) { await clock.advance(MIN); await clock.settle() } }

test('the brief runs in a worker on sonnet, is sent by the service, and never submitted', async ($, on) => {
  const clock = mock.clock(on, { now: at('08:59') })
  const w = wire(on, BRIEF_ON)
  await $.session.start(START as any)
  await clock.settle()
  expect(w.registered).toEqual(expect.arrayContaining(['remind', 'weather_today', 'set_location']))
  await minute(clock)
  expect(w.submitted).toEqual([])
  expect(w.workers).toHaveLength(1)
  expect(w.workers[0]!.argv).toContain('sonnet')
  expect(w.workers[0]!.env).toMatchObject({ NLK_ROLE: 'worker', NLK_HOST: '', TELEGRAM_STATE_DIR: workerTgDir(HOME) })
  expect(w.workers[0]!.stdin).toContain('[nlk:brief]')
  expect(w.workers[0]!.argv.some(a => a.includes('[nlk:brief]'))).toBe(false)
  expect(w.bodies['/remind/send']).toEqual([{ text: 'Good morning, rain at 14:00' }])
  expect(saved(w).briefDate).toBe('2026-10-21')
  expect((w.files[RUNS] ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l))).toEqual([{ at: at('09:00'), kind: 'brief', ok: true, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }])
  await minute(clock, 5)
  expect(w.workers).toHaveLength(1)
})

test('without the config brief no worker ever runs', async ($, on) => {
  const clock = mock.clock(on, { now: at('08:59') })
  const w = wire(on)
  await $.session.start(START as any)
  await minute(clock, 30)
  expect(w.workers).toEqual([])
})

test('the owner\'s messages reach the worker on stdin, never in argv', async ($, on) => {
  const clock = mock.clock(on, { now: at('08:59') })
  const w = wire(on, { ...BRIEF_ON, [inboundLog(HOME)]: `${JSON.stringify({ msgId: '9', at: at('08:30'), text: 'my secret plan' })}\n` })
  await $.session.start(START as any)
  await minute(clock)
  expect(w.workers[0]!.argv.some(a => a.includes('secret plan'))).toBe(false)
  expect(w.workers[0]!.stdin).toContain('"my secret plan"')
})

test('a reminder is sent by the service with no worker and no submit, even in quiet hours', async ($, on) => {
  const clock = mock.clock(on, { now: at('23:00') })
  const w = wire(on, sched({ reminders: [
    { id: 'r1', text: 'call alpha', at: at('23:00') },
    { id: 'r2', text: 'stretch', at: at('23:00'), every: 'day' },
  ] }))
  await $.session.start(START as any)
  await minute(clock)
  expect(w.bodies['/remind/send']).toEqual([{ text: 'call alpha' }])
  expect(saved(w).reminders.map((r: { id: string }) => r.id)).toEqual(['r2'])
  await minute(clock)
  expect(w.bodies['/remind/send']).toEqual([{ text: 'call alpha' }, { text: 'stretch' }])
  expect(saved(w).reminders).toEqual([expect.objectContaining({ text: 'stretch', at: at('23:00', '2026-10-22'), every: 'day' })])
  await minute(clock, 2)
  expect(w.bodies['/remind/send']).toHaveLength(2)
  expect(w.workers).toEqual([])
  expect(w.submitted).toEqual([])
})

test('late reminder fires once', async ($, on) => {
  const clock = mock.clock(on, { now: at('12:00') })
  const w = wire(on, sched({ reminders: [{ id: 'r1', text: 'call alpha', at: at('10:00') }] }))
  await $.session.start(START as any)
  await minute(clock, 2)
  expect(w.bodies['/remind/send']).toEqual([{ text: '(late) call alpha' }])
  expect(saved(w).reminders).toEqual([])
  await minute(clock, 3)
  expect(fetches(w, '/remind/send')).toHaveLength(1)
  expect(w.submitted).toEqual([])
})

test('a reminder with the service down for 30 min is kept, then sent marked late', async ($, on) => {
  const clock = mock.clock(on, { now: at('23:00') })
  const w = wire(on, sched({ reminders: [{ id: 'r1', text: 'call alpha', at: at('23:00') }] }))
  w.failing.push('/remind/send')
  await $.session.start(START as any)
  await minute(clock, 30)
  expect(fetches(w, '/remind/send')).toHaveLength(30)
  expect(saved(w).reminders).toEqual([{ id: 'r1', text: 'call alpha', at: at('23:00') }])
  w.failing = []
  await minute(clock)
  expect(w.bodies['/remind/send']!.at(-1)).toEqual({ text: '(late) call alpha' })
  expect(saved(w).reminders).toEqual([])
  await minute(clock, 3)
  expect(fetches(w, '/remind/send')).toHaveLength(31)
})

test('a reminder is advanced before it is sent: a failed save sends nothing, then it goes out once', async ($, on) => {
  const clock = mock.clock(on, { now: at('23:00') })
  const w = wire(on, sched({ reminders: [{ id: 'r1', text: 'call alpha', at: at('23:00') }] }))
  w.badWrites.push(SCHEDULE)
  await $.session.start(START as any)
  await minute(clock)
  expect(w.bodies['/remind/send']).toBeUndefined()
  w.badWrites = []
  await minute(clock, 3)
  expect(w.bodies['/remind/send']).toEqual([{ text: 'call alpha' }])
  expect(saved(w).reminders).toEqual([])
})

test('a repeating reminder whose send fails is put back and sent on the next tick', async ($, on) => {
  const clock = mock.clock(on, { now: at('23:00') })
  const r1 = { id: 'r1', text: 'stretch', at: at('23:00'), every: 'day' }
  const w = wire(on, sched({ reminders: [r1] }))
  w.failing.push('/remind/send')
  await $.session.start(START as any)
  await minute(clock)
  expect(saved(w).reminders).toEqual([r1])
  w.failing = []
  await minute(clock)
  expect(w.bodies['/remind/send']).toHaveLength(2)
  expect(saved(w).reminders).toEqual([{ ...r1, at: at('23:00', '2026-10-22') }])
})

test('a reminder over 24 h overdue is dropped, not sent', async ($, on) => {
  const clock = mock.clock(on, { now: at('23:00') })
  const w = wire(on, sched({ reminders: [{ id: 'r1', text: 'call alpha', at: at('22:00', '2026-10-20') }] }))
  await $.session.start(START as any)
  await minute(clock)
  expect(w.bodies['/remind/send']).toBeUndefined()
  expect(saved(w).reminders).toEqual([])
  expect(saved(w).lastWorkerError).toBe('reminder dropped')
})

test('a failed brief is retried once after 10 minutes, never twice', async ($, on) => {
  const clock = mock.clock(on, { now: at('08:59') })
  const w = wire(on, BRIEF_ON)
  w.workerExit = 1
  await $.session.start(START as any)
  await minute(clock)
  expect(w.workers).toHaveLength(1)
  expect(saved(w).lastWorkerError).toBe('exit 1')
  expect(saved(w).briefFailAt).toBe(at('09:00'))
  await minute(clock, 5)
  expect(w.workers).toHaveLength(1)
  await minute(clock, 5)
  expect(w.workers).toHaveLength(2)
  expect(saved(w).briefRetry).toBe('2026-10-21')
  await minute(clock, 20)
  expect(w.workers).toHaveLength(2)
  expect(w.bodies['/remind/send']).toBeUndefined()
})

for (const [name, error, out, why] of [['is_error', true, 'x', 'worker error'], ['an empty result', false, '', 'empty']] as const) {
  test(`a brief the worker answers with ${name} is retried once`, async ($, on) => {
    const clock = mock.clock(on, { now: at('08:59') })
    const w = wire(on, BRIEF_ON)
    w.workerError = error
    w.workerOut = out
    await $.session.start(START as any)
    await minute(clock)
    expect(saved(w).lastWorkerError).toBe(why)
    expect(saved(w).briefFailAt).toBe(at('09:00'))
    await minute(clock, 10)
    expect(w.workers).toHaveLength(2)
    await minute(clock, 30)
    expect(w.workers).toHaveLength(2)
  })
}

test('a brief cut off by a restart runs again once', async ($, on) => {
  const clock = mock.clock(on, { now: at('09:20') })
  const w = wire(on, { ...BRIEF_ON, ...sched({ briefDate: '2026-10-21', workerPending: { kind: 'brief', at: at('09:00') } }) })
  await $.session.start(START as any)
  await minute(clock)
  expect(w.workers).toHaveLength(1)
  expect(saved(w).briefRetry).toBe('2026-10-21')
  expect(saved(w).workerPending).toBeUndefined()
  expect(w.bodies['/remind/send']).toHaveLength(1)
  await minute(clock, 30)
  expect(w.workers).toHaveLength(1)
})

test('a sent brief is done even when the run log cannot be written', async ($, on) => {
  const clock = mock.clock(on, { now: at('08:59') })
  const w = wire(on, BRIEF_ON)
  w.badWrites.push(RUNS)
  await $.session.start(START as any)
  await minute(clock)
  expect(w.bodies['/remind/send']).toHaveLength(1)
  expect(saved(w).briefFailAt).toBeUndefined()
  expect(saved(w).lastWorkerError).toBeUndefined()
  await minute(clock, 20)
  expect(w.workers).toHaveLength(1)
})

test('the tick does not wait on a running worker', async ($, on) => {
  const clock = mock.clock(on, { now: at('08:59') })
  const w = wire(on, { ...BRIEF_ON, ...sched({ reminders: [{ id: 'r1', text: 'call alpha', at: at('09:01') }] }) })
  let release = () => {}
  w.gate = new Promise<void>(r => { release = r })
  await $.session.start(START as any)
  await clock.advance(MIN)
  expect(saved(w).workerPending).toEqual({ kind: 'brief', at: at('09:00') })
  await minute(clock)
  expect(w.bodies['/remind/send']).toEqual([{ text: 'call alpha' }])
  release()
  await clock.settle()
  expect(saved(w).workerPending).toBeUndefined()
})

test('remind rejects a bad time and says why, and the tool saves a good one', async ($, on) => {
  mock.clock(on, { now: at('23:00') })
  const w = wire(on)
  await $.session.start(START as any)
  const bad = await $.tool.call({ tool: `${OWN}remind`, text: 'x', at: 'tomorrow' } as never)
  expect(String(bad.result)).toContain('YYYY-MM-DDTHH:MM')
  expect(w.files[SCHEDULE]).toBeUndefined()
  const ok = await $.tool.call({ tool: `${OWN}remind`, text: 'call alpha', at: '2026-10-21T23:02' } as never)
  expect(String(ok.result)).toContain('reminder set')
  expect(saved(w).reminders).toEqual([expect.objectContaining({ text: 'call alpha', at: at('23:02') })])
})

test('weather_today uses the config city when the input has none', async ($, on) => {
  mock.clock(on, { now: at('12:00') })
  const w = wire(on, BRIEF_ON)
  await $.session.start(START as any)
  await $.tool.call({ tool: `${OWN}weather_today` } as never)
  expect(w.bodies['/weather']).toEqual([{ place: 'Bangkok' }])
})
