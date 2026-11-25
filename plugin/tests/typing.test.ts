import { test, expect, mock } from 'claude-code/testing'
import { telegramState, svcTokenFile } from '../hooks/paths.ts'

const HOME = '/H'
const NOW = 10_000_000_000
const TOKEN = '123456:SECRETSECRETSECRETSECRETSECRETSECRET'
const TG = { kind: 'channel', server: 'plugin:telegram:telegram' } as const
const msg = (userId: string, body: string, msgId = '5') =>
  `<channel source="plugin:telegram:telegram" chat_id="${userId}" message_id="${msgId}" user="tester" user_id="${userId}" ts="2026-10-21T02:00:00.000Z">${body}</channel>`

function wire(on: any, o: { fail?: boolean } = {}) {
  const files: Record<string, string> = {
    [`${telegramState(HOME)}/access.json`]: '{"allowFrom":["111"]}',
    [`${telegramState(HOME)}/.env`]: `TELEGRAM_BOT_TOKEN=${TOKEN}\n`,
    [svcTokenFile(HOME)]: 'tok\n',
  }
  const w = { files, typing: [] as { url: string; body: any }[], entered: 0 }
  const env: Record<string, string | undefined> = { NLK_HOST: '1', HOME, CLAUDE_CONFIG_DIR: `${HOME}/.nlk/claude` }
  mock.store(on)
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.start', async (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
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
    if (e.url.startsWith('https://api.telegram.org/')) {
      w.typing.push({ url: e.url, body: e.init?.body ? JSON.parse(e.init.body) : null })
      if (o.fail) throw new Error(`boom ${e.url}`)
      return { value: { ok: true, status: 200, text: '{"ok":true}', headers: {} } }
    }
    return { value: { ok: true, status: 200, text: JSON.stringify({ sent: true, hits: [] }), headers: {} } }
  })
  on('prompt.submit', async (_$: unknown, e: { text: string }) => { w.entered++; return { text: e.text } })
  return w
}

const startTurn = ($: any) => $.turn.start({ text: 'x', turnId: 't1' })
const endTurn = ($: any) => $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
const submit = ($: any, userId: string, body: string) => $.prompt.submit({ text: msg(userId, body), origin: TG, isMeta: true } as any)

// Defect caught: she shows no sign of life during a long job, or keeps typing after she has answered.
test('his message: typing starts, repeats every 4 s, stops at turn.complete', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = wire(on)
  await submit($, '111', 'what is the weather')
  await startTurn($)
  await clock.settle()
  expect(w.typing).toEqual([{ url: `https://api.telegram.org/bot${TOKEN}/sendChatAction`, body: { chat_id: '111', action: 'typing' } }])
  await clock.advance(4_000)
  expect(w.typing).toHaveLength(2)
  await clock.advance(8_000)
  expect(w.typing).toHaveLength(4)
  await endTurn($)
  await clock.advance(20_000)
  expect(w.typing).toHaveLength(4)
})

test('typing stops by itself after 5 minutes', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = wire(on)
  await submit($, '111', 'long job')
  await startTurn($)
  await clock.advance(300_000)
  const n = w.typing.length
  expect(n).toBeGreaterThan(70)
  expect(n).toBeLessThanOrEqual(76)
  await clock.advance(60_000)
  expect(w.typing).toHaveLength(n)
})

// Defect caught: a stranger's or held message, or a scheduled turn, makes NLK look busy in the owner's chat.
test('a non-owner and a scheduled turn start no typing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = wire(on)
  await submit($, '999', 'hi')
  await startTurn($); await endTurn($)
  await $.prompt.submit({ text: '[nlk:brief] go', origin: { kind: 'user' }, isMeta: false } as any)
  await startTurn($); await endTurn($)
  await clock.advance(20_000)
  expect(w.typing).toEqual([])
})

// Defect caught: the bot token leaks into a log or deny line when the Bot API call dies; a failure must be silent and end the loop.
test('a failing send is silent, leaks no token, and ends the loop', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = wire(on, { fail: true })
  await submit($, '111', 'hi')
  await startTurn($)
  await clock.advance(20_000)
  expect(w.typing).toHaveLength(1)
  expect(Object.entries(w.files).filter(([p, t]) => !p.endsWith('/.env') && t.includes(TOKEN))).toEqual([])
})
