import { test, expect, mock } from 'claude-code/testing'
import { isOwnerText } from '../hooks/inbound.ts'
import { inboundLog, svcTokenFile, telegramState } from '../hooks/paths.ts'

const HOME = '/H'
const TG = { kind: 'channel', server: 'plugin:telegram:telegram' } as const
const msg = (userId: string, body: string, msgId = '5') =>
  `<channel source="plugin:telegram:telegram" chat_id="${userId}" message_id="${msgId}" user="tester" user_id="${userId}" ts="2026-10-21T02:00:00.000Z">${body}</channel>`

function wire(on: any) {
  const files: Record<string, string> = { [`${telegramState(HOME)}/access.json`]: '{"allowFrom":["111"]}', [svcTokenFile(HOME)]: 'tok\n' }
  const w = { files, entered: [] as string[], fetched: [] as { path: string; body: any }[] }
  const env: Record<string, string | undefined> = { NLK_HOST: '1', HOME, CLAUDE_CONFIG_DIR: `${HOME}/.nlk/claude` }
  mock.store(on)
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
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
  on('process.run', async (_$: unknown, e: { argv: string[] }) => {
    if (e.argv[0] === 'mv' && e.argv[2] && e.argv[3]) { files[e.argv[3]] = files[e.argv[2]] ?? ''; delete files[e.argv[2]] }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', async (_$: unknown, e: { url: string; init?: { body?: string } }) => {
    const path = new URL(e.url).pathname
    w.fetched.push({ path, body: e.init?.body ? JSON.parse(e.init.body) : null })
    return { value: { ok: true, status: 200, text: JSON.stringify({ sent: true, hits: [] }), headers: {} } }
  })
  on('prompt.submit', async (_$: unknown, e: { text: string }) => { w.entered.push(e.text); return { text: e.text } })
  return w
}

const calls = (w: { fetched: { path: string }[] }) => w.fetched.filter(f => f.path === '/fresh')
const dropped = (r: unknown) => typeof (r as { drop?: unknown }).drop === 'string'

test('/fresh goes to the service, never to Claude; the log keeps a stub', async ($, on) => {
  mock.clock(on, { now: 10_000_000_000 })
  const w = wire(on)
  const r = await $.prompt.submit({ text: msg('111', '/fresh'), origin: TG, isMeta: true } as any)
  expect(calls(w)).toHaveLength(1)
  expect(dropped(r)).toBe(true)
  expect(w.entered).toEqual([])
  expect(w.files[inboundLog(HOME)]).toContain('[fresh turn 5 handled]')
})

test('/FRESH@nlk_bot works in any case', async ($, on) => {
  mock.clock(on, { now: 10_000_000_000 })
  const w = wire(on)
  await $.prompt.submit({ text: msg('111', '/FRESH@nlk_bot'), origin: TG, isMeta: true } as any)
  expect(calls(w)).toHaveLength(1)
})

test('/fresh from anyone else is held, never run', async ($, on) => {
  mock.clock(on, { now: 10_000_000_000 })
  const w = wire(on)
  const r = await $.prompt.submit({ text: msg('222', '/fresh'), origin: TG, isMeta: true } as any)
  expect(calls(w)).toEqual([])
  expect(dropped(r)).toBe(true)
})

test('text that only starts with /fresh is a normal message', async ($, on) => {
  mock.clock(on, { now: 10_000_000_000 })
  const w = wire(on)
  await $.prompt.submit({ text: msg('111', '/freshly baked?'), origin: TG, isMeta: true } as any)
  expect(calls(w)).toEqual([])
  expect(w.entered).toHaveLength(1)
})

test('non-owner message is held', async ($, on) => {
  mock.clock(on, { now: 10_000_000_000 })
  const w = wire(on)
  const r = await $.prompt.submit({ text: msg('222', 'hello'), origin: TG, isMeta: true } as any)
  expect((r as { drop?: string }).drop).toBe('[a Telegram message arrived that could not be verified; it was held]')
  expect(w.entered).toEqual([])
  expect(w.fetched.filter(f => f.path.startsWith('/mem'))).toEqual([])
  expect(w.files[inboundLog(HOME)]).toContain('[held 5]')
  expect(w.files[inboundLog(HOME)]).not.toContain('hello')
})

test('only lines not starting with [ are the owner\'s real messages', () => {
  expect(isOwnerText('[fresh turn 9 handled]')).toBe(false)
  expect(isOwnerText('  [x]')).toBe(false)
  expect(isOwnerText('hi [x]')).toBe(true)
})
