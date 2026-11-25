import { test, expect, mock } from 'claude-code/testing'
import { deskDir, statusFile, telegramState } from '../hooks/paths.ts'

const NOW = 1_000_000
const DESK = deskDir('/H')
const STATUS_FILE = statusFile('/H')
const TG = telegramState('/H')
const TOKEN = '123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const PS = ' 100     1\n 200   100\n 300   200\n 400   300\n 900     1\n 950   900\n'

function wire(on: any, o: { pollerPid: string; api: number | 'network'; pane?: string; host?: boolean }) {
  const w = { sent: [] as string[][], files: { [`${TG}/bot.pid`]: o.pollerPid, [`${TG}/.env`]: `TELEGRAM_BOT_TOKEN=${TOKEN}\n` } as Record<string, string>, urls: [] as string[] }
  const env: Record<string, string | undefined> = { NLK_HOST: o.host === false ? undefined : '1', HOME: '/H', CLAUDE_CONFIG_DIR: '/H/.nlk/claude' }
  mock.store(on)
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('env.get', async (_$: unknown, e: { name: string }) => ({ value: env[e.name] }))
  on('fs.exists', async (_$: unknown, e: { path: string }) => ({ value: e.path in w.files }))
  on('fs.read', async (_$: unknown, e: { path: string }) => {
    if (!(e.path in w.files)) throw new Error('ENOENT')
    return { value: w.files[e.path] }
  })
  on('fs.write', async (_$: unknown, e: { path: string; text: string }) => { w.files[e.path] = e.text; return { value: undefined } })
  on('fs.list', async () => ({ value: [] }))
  on('process.run', async (_$: unknown, e: { argv: string[] }) => {
    if (e.argv.includes('send-keys')) w.sent.push(e.argv)
    const out = e.argv[0] === 'ps' ? PS : e.argv.includes('display-message') ? '100\n' : e.argv.includes('capture-pane') ? (o.pane ?? '') : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', async (_$: unknown, e: { url: string }) => {
    w.urls.push(e.url)
    if (o.api === 'network') throw new Error('ENOTFOUND')
    return { value: { ok: o.api === 200, status: o.api, text: '{}', headers: {} } }
  })
  return w
}

const START = { cwd: DESK, surface: 'terminal', isInteractive: true } as const
const channels = (w: { files: Record<string, string> }) => JSON.parse(w.files[STATUS_FILE] ?? '{}').channels

test('status.json reports telegram ok when its own poller runs and the Bot API answers', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = wire(on, { pollerPid: '400\n', api: 200 })
  await $.session.start(START)
  await clock.settle()
  expect(channels(w)).toEqual({ telegram: { at: NOW, ok: true } })
  expect(w.urls.some(u => u.endsWith('/getMe'))).toBe(true)
  expect(w.files[STATUS_FILE]).not.toContain(TOKEN)
})

test('a poller outside its tmux server is a conflict', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = wire(on, { pollerPid: '950', api: 200 })
  await $.session.start(START)
  await clock.settle()
  expect(channels(w)).toEqual({ telegram: { at: NOW, ok: false, reason: 'conflict' } })
})

test('a rejected token and a network failure are named', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = wire(on, { pollerPid: '400', api: 401 })
  await $.session.start(START)
  await clock.settle()
  expect(channels(w)?.telegram?.reason).toBe('token rejected')
})

test('the report refreshes every minute', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = wire(on, { pollerPid: '400', api: 'network' })
  await $.session.start(START)
  await clock.settle()
  expect(channels(w)?.telegram).toEqual({ at: NOW, ok: false, reason: 'network' })
  await clock.advance(60_000)
  expect(channels(w)?.telegram?.at).toBe(NOW + 60_000)
})

test('no poller: left out for the first 90 s after start, then reported stopped', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = wire(on, { pollerPid: '', api: 200 })
  await $.session.start(START)
  await clock.settle()
  expect(channels(w)).toBeUndefined()
  await clock.advance(60_000)
  expect(channels(w)).toBeUndefined()
  await clock.advance(60_000)
  expect(channels(w)).toEqual({ telegram: { at: NOW + 120_000, ok: false, reason: 'stopped' } })
})

test('missing channel at 2 min on an idle pane: it types the reconnect once, then Enter', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { sent } = wire(on, { pollerPid: '', api: 200, pane: '❯ \n  ⏵⏵ auto mode on' })
  await $.session.start(START)
  await clock.settle()
  await clock.advance(60_000)
  expect(sent).toEqual([])
  await clock.advance(60_000)
  expect(sent).toEqual([
    ['tmux', '-L', 'nlk', 'send-keys', '-t', 'nlk', '-l', '/mcp reconnect plugin:telegram:telegram'],
    ['tmux', '-L', 'nlk', 'send-keys', '-t', 'nlk', 'Enter'],
  ])
  await clock.advance(120_000)
  expect(sent.length).toBe(2)
})

test('a menu on screen holds the reconnect back', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { sent } = wire(on, { pollerPid: '', api: 200, pane: ' ❯ 1. Yes\n Enter to select · Esc to cancel' })
  await $.session.start(START)
  await clock.settle()
  await clock.advance(180_000)
  expect(sent).toEqual([])
})

test('a session that is not the host never types into the pane', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { sent } = wire(on, { pollerPid: '', api: 200, pane: '❯ ', host: false })
  await $.session.start(START)
  await clock.settle()
  await clock.advance(180_000)
  expect(sent).toEqual([])
})
