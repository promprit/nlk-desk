import { test, expect, mock } from 'claude-code/testing'
import { recallBlock, recallFor } from '../hooks/recall.ts'
import { svcTokenFile, telegramState } from '../hooks/paths.ts'

const HOME = '/H'
const TG = { kind: 'channel', server: 'plugin:telegram:telegram' } as const
const msg = (userId: string, body: string) =>
  `<channel source="plugin:telegram:telegram" chat_id="${userId}" message_id="7" user="tester" user_id="${userId}" ts="2026-10-21T02:00:00.000Z">${body}</channel>`
const D1 = Date.parse('2026-10-20T03:00:00Z')
const D2 = Date.parse('2026-10-18T03:00:00Z')

function wire(on: any, reply: ((url: string, body: any) => unknown) | 'down', extra: Record<string, string> = {}) {
  const files: Record<string, string> = { [`${telegramState(HOME)}/access.json`]: '{"allowFrom":["111"]}', [svcTokenFile(HOME)]: 'tok\n', ...extra }
  const w = { entered: [] as string[], context: [] as string[], fetched: [] as { url: string; body: any }[] }
  const env: Record<string, string | undefined> = { NLK_HOST: '1', HOME, CLAUDE_CONFIG_DIR: `${HOME}/.nlk/claude` }
  mock.store(on)
  on('env.get', async (_$: unknown, e: { name: string }) => ({ value: env[e.name] }))
  on('fs.exists', async (_$: unknown, e: { path: string }) => ({ value: e.path in files }))
  on('fs.read', async (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: files[e.path] }
  })
  on('fs.write', async (_$: unknown, e: { path: string; text: string }) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.stat', async (_$: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }
  })
  on('fs.list', async () => ({ value: [] }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('http.fetch', async (_$: unknown, e: { url: string; init?: { body?: string } }) => {
    if (reply === 'down') throw new Error('ECONNREFUSED')
    const body = e.init?.body ? JSON.parse(e.init.body) : null
    w.fetched.push({ url: e.url, body })
    return { value: { ok: true, status: 200, text: JSON.stringify(reply(e.url, body)), headers: {} } }
  })
  on('prompt.submit', async (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    w.entered.push(e.text)
    w.context.push(...(e.context ?? []))
    return { text: e.text }
  })
  return w
}

const hits = () => ({ hits: [{ id: 1, text: 'likes beta', created: D1 }, { id: 2, text: 'asked about alpha', created: D2 }] })

test('recall with service down passes through', async ($, on) => {
  mock.clock(on, { now: 1 })
  const w = wire(on, 'down')
  await $.prompt.submit({ text: msg('111', 'hi'), origin: TG } as any)
  expect(w.entered).toEqual([msg('111', 'hi')])
})

// Channel prompts are isMeta: a text rewrite is ignored when they start a turn, so recall rides in `context`.
test('owner prompt gets the recall block as context, the text untouched', async ($, on) => {
  mock.clock(on, { now: 1 })
  const w = wire(on, hits)
  await $.prompt.submit({ text: msg('111', 'hi'), origin: TG, isMeta: true } as any)
  expect(w.entered).toEqual([msg('111', 'hi')])
  expect(w.context.join('\n')).toMatch(/^<recall>[\s\S]*2026-10-20[\s\S]*2026-10-18[\s\S]*<\/recall>$/)
  const search = w.fetched.find(f => f.url.endsWith('/mem/search'))!.body
  expect(search).toEqual({ q: 'hi', k: 3 })
})

test('an empty recall leaves the text unchanged', async ($, on) => {
  mock.clock(on, { now: 1 })
  const w = wire(on, () => ({ hits: [] }))
  await $.prompt.submit({ text: msg('111', 'hi'), origin: TG } as any)
  expect(w.entered).toEqual([msg('111', 'hi')])
})

test('non-owner and non-channel prompts get no recall', async ($, on) => {
  mock.clock(on, { now: 1 })
  const w = wire(on, hits)
  await $.prompt.submit({ text: msg('222', 'hi'), origin: TG } as any)
  await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' } } as any)
  // The stranger's message is dropped (never entered); the composer prompt passes untouched.
  expect(w.entered).toEqual(['hi'])
  expect(w.context).toEqual([])
  expect(w.fetched).toEqual([])
})

test('recallBlock dates every line', () => {
  expect(recallBlock([{ text: 'one', created: D1 }])).toBe('<recall>\n- 2026-10-20 one\n</recall>')
})

test('recall caps at 3 memories and 600 characters', async () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ id: i, text: 'x'.repeat(200), created: D1 }))
  const block = await recallFor(async () => ({ ok: true, status: 200, json: { hits: six } }), 'hi')
  expect(block.length).toBeLessThanOrEqual(600)
  expect(block.split('\n').filter(l => l.startsWith('- ')).length).toBeLessThanOrEqual(3)
  expect(block.startsWith('<recall>')).toBe(true)
  expect(block.endsWith('</recall>')).toBe(true)
})
