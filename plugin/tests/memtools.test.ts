import { test, expect, mock } from 'claude-code/testing'
import { MEM_DOWN, MEM_SPECS, OWN, memCall } from '../hooks/memtools.ts'
import { configFile, svcTokenFile } from '../hooks/paths.ts'

const HOME = '/H'
const START = { cwd: '/H/.nlk/desk', surface: 'terminal', isInteractive: true } as const

function wire(on: any, reply: (url: string, body: any) => { status: number; json: unknown }, role: Record<string, string> = {}) {
  // The guard lets a tool through only when it is on the owner's tools.allow list.
  const files: Record<string, string> = { [svcTokenFile(HOME)]: 'tok\n', [configFile(HOME)]: JSON.stringify({ tools: { allow: MEM_SPECS.map(s => `${OWN}${s.name}`) } }) }
  const w = { fetched: [] as { url: string; body: any }[], registered: [] as string[] }
  const env: Record<string, string | undefined> = { NLK_HOST: '1', HOME, CLAUDE_CONFIG_DIR: `${HOME}/.nlk/claude`, ...role }
  mock.store(on)
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('env.get', async (_$: unknown, e: { name: string }) => ({ value: env[e.name] }))
  on('fs.exists', async (_$: unknown, e: { path: string }) => ({ value: e.path in files }))
  on('fs.read', async (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: files[e.path] }
  })
  on('fs.write', async () => ({ value: undefined }))
  on('fs.stat', async (_$: unknown, e: { path: string; resolve?: boolean }) => ({ value: { kind: 'dir', size: 0, mtimeMs: 1, isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } }))
  on('fs.list', async () => ({ value: [] }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('http.fetch', async (_$: unknown, e: { url: string; init?: { body?: string } }) => {
    const body = e.init?.body ? JSON.parse(e.init.body) : null
    w.fetched.push({ url: e.url, body })
    const r = reply(e.url, body)
    return { value: { ok: r.status === 200, status: r.status, text: JSON.stringify(r.json), headers: {} } }
  })
  on('tool.check', async () => ({ decision: 'allow' }))
  on('tool.register', async (_$: unknown, e: { name: string }) => { w.registered.push(e.name); return { value: { tool: `${OWN}${e.name}` } } })
  return w
}

test('the four memory tools are specced under their names', () => {
  expect(MEM_SPECS.map(s => s.name)).toEqual(['memory_save', 'memory_search', 'memory_forget', 'memory_about'])
})

test('memory_save sends a normal-mode memory to the service', async ($, on) => {
  mock.clock(on, { now: 1 })
  const w = wire(on, () => ({ status: 200, json: { id: 5 } }))
  const r = await $.tool.call({ tool: `${OWN}memory_save`, text: 'likes beta', kind: 'preference' } as never)
  expect(w.fetched[0]!.url).toBe('http://127.0.0.1:4330/mem/save')
  expect(w.fetched[0]!.body).toEqual({ text: 'likes beta', kind: 'preference', mode: 'normal', source: 'chat' })
  expect(String(r.result)).toContain('5')
})

// Defect caught: a worker's saves look like things he said in chat.
test('memory_save in a worker sends source worker', async ($, on) => {
  mock.clock(on, { now: 1 })
  const w = wire(on, () => ({ status: 200, json: { id: 6 } }), { NLK_ROLE: 'worker', NLK_HOST: '' })
  const r = await $.tool.call({ tool: `${OWN}memory_save`, text: 'liked the grinder pick', kind: 'event' } as never)
  expect(w.fetched[0]!.url).toBe('http://127.0.0.1:4330/mem/save')
  expect(w.fetched[0]!.body).toEqual({ text: 'liked the grinder pick', kind: 'event', mode: 'normal', source: 'worker' })
  expect(String(r.result)).toContain('6')
})

test('memory_forget deletes and says so', async ($, on) => {
  mock.clock(on, { now: 1 })
  const w = wire(on, () => ({ status: 200, json: { ok: true } }))
  const r = await $.tool.call({ tool: `${OWN}memory_forget`, id: 7 } as never)
  expect(w.fetched[0]).toEqual({ url: 'http://127.0.0.1:4330/mem/forget', body: { id: 7 } })
  expect(r.result).toBe('forgot memory 7')
})

test('memory_search and memory_about render dated lines; a down service says so', async () => {
  const D = Date.parse('2026-10-20T03:00:00Z')
  const up = (path: string) => Promise.resolve({ ok: true, status: 200, json: path === '/mem/about' ? { memories: [{ id: 3, text: 'alpha fact', created: D }] } : { hits: [{ id: 4, text: 'beta fact', created: D }] } })
  expect(await memCall(up, 'memory_search', { query: 'beta' })).toBe('#4 2026-10-20 beta fact')
  expect(await memCall(up, 'memory_about', { topic: 'alpha' })).toBe('#3 2026-10-20 alpha fact')
  expect(await memCall(() => Promise.resolve({ ok: false, status: 0, json: null }), 'memory_forget', { id: 1 })).toBe('my service is down; try again in a minute')
})

test('service down keeps chat alive', async () => {
  const down = () => Promise.resolve({ ok: false, status: 0, json: null })
  const inputs: Record<string, Record<string, unknown>> = { memory_save: { text: 'x', kind: 'fact' }, memory_search: { query: 'x' }, memory_forget: { id: 1 }, memory_about: { topic: 'x' } }
  for (const spec of MEM_SPECS) expect(await memCall(down, spec.name, inputs[spec.name]!)).toBe(MEM_DOWN)
  const boom = () => Promise.reject(new Error('x'))
  expect(MEM_SPECS.every(s => !JSON.stringify(s).includes('interest'))).toBe(true)
  await expect(memCall(down, 'memory_save', { text: 'x', kind: 'fact' })).resolves.toBe(MEM_DOWN)
  void boom
})
