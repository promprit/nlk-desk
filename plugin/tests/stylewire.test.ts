import { test, expect, mock } from 'claude-code/testing'
import { configFile, deskDir, svcTokenFile, telegramState } from '../hooks/paths.ts'
import { OWN } from '../hooks/memtools.ts'

const HOME = '/H'
const TG = { kind: 'channel', server: 'plugin:telegram:telegram' } as const
const msg = (userId: string, body: string) =>
  `<channel source="plugin:telegram:telegram" chat_id="${userId}" message_id="7" user="tester" user_id="${userId}" ts="2026-10-21T02:00:00.000Z">${body}</channel>`

function wire(on: any, config?: string) {
  const files: Record<string, string> = { [`${telegramState(HOME)}/access.json`]: '{"allowFrom":["111"]}', [svcTokenFile(HOME)]: 'tok\n' }
  if (config !== undefined) files[configFile(HOME)] = config
  const w = { files, context: [] as string[] }
  const env: Record<string, string | undefined> = { NLK_HOST: '1', HOME }
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
  on('http.fetch', async () => { throw new Error('ECONNREFUSED') })
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('tool.check', async () => ({ decision: 'allow' }))
  on('tool.register', async (_$: unknown, e: { name: string }) => ({ value: { tool: `${OWN}${e.name}` } }))
  on('prompt.submit', async (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    w.context.push(...(e.context ?? []))
    return { text: e.text }
  })
  return w
}

const START = { cwd: deskDir(HOME), surface: 'terminal', isInteractive: true } as const
const FULL = { gender: 'male', age: 'younger', tone: 'warm', emoji: 'some', lang: 'mix', callOwner: 'Nok' }

test('an owner prompt gets a style block first', async ($, on) => {
  mock.clock(on, { now: 1 })
  const w = wire(on, JSON.stringify({ style: FULL }))
  await $.prompt.submit({ text: msg('111', 'hi'), origin: TG } as any)
  expect(w.context[0]).toMatch(/^<style>/)
  expect(w.context[0]).toContain('พี่Nok')
})

test('no style in config.json: the block asks for onboarding', async ($, on) => {
  mock.clock(on, { now: 1 })
  const w = wire(on, '{}')
  await $.prompt.submit({ text: msg('111', 'hi'), origin: TG } as any)
  expect(w.context[0]).toContain('[nlk:onboarding]')
})

test('a missing config file still gets the onboarding block', async ($, on) => {
  mock.clock(on, { now: 1 })
  const w = wire(on)
  await $.prompt.submit({ text: msg('111', 'hi'), origin: TG } as any)
  expect(w.context[0]).toContain('[nlk:onboarding]')
})

test('a non-owner prompt gets no style block', async ($, on) => {
  mock.clock(on, { now: 1 })
  const w = wire(on, JSON.stringify({ style: FULL }))
  await $.prompt.submit({ text: msg('222', 'hi'), origin: TG } as any)
  expect(w.context).toEqual([])
})

test('style_set writes config.json', async ($, on) => {
  mock.clock(on, { now: 1 })
  const w = wire(on, JSON.stringify({ name: 'A', tools: { allow: [`${OWN}style_set`] } }))
  await $.session.start(START as any)
  await $.tool.call({ tool: `${OWN}style_set`, tone: 'direct' } as never)
  expect(JSON.parse(w.files[configFile(HOME)]!)).toEqual({ name: 'A', tools: { allow: [`${OWN}style_set`] }, style: { tone: 'direct' } })
})
