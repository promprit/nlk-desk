import { test, expect, mock } from 'claude-code/testing'
import { configFile, deskDir, deniesFile, telegramState, svcTokenFile, TG_REPLY } from '../hooks/paths.ts'

const NOW = 1_000_000
const HOME = '/H'
const SEARCH = 'mcp__claude_ai_Gmail__search_threads'
const SEND = 'mcp__claude_ai_Gmail__send_message'
const OTHER = 'mcp__claude_ai_Gmail__list_labels'
const ACCESS = `${telegramState(HOME)}/access.json`
const ALPHA = `${HOME}/work`
const DENIES = deniesFile(HOME)

type Opts = { files?: Record<string, string>; core?: 'allow' | 'ask' | 'deny'; env?: Record<string, string | undefined>; links?: Record<string, string> }

// `core` stubs the engine's own verdict beneath the mod's tool.check hook.
function wire(on: any, opts: Opts = {}) {
  const w = { files: { [`${ALPHA}/README.md`]: '# a\n', [ACCESS]: '{"allowFrom":["111"]}', ...opts.files } as Record<string, string> }
  const env: Record<string, string | undefined> = { NLK_HOST: '1', HOME, CLAUDE_CONFIG_DIR: `${HOME}/.nlk/claude`, ...opts.env }
  mock.store(on)
  on('session.start', async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('env.get', async (_$: unknown, e: { name: string }) => ({ value: env[e.name] }))
  on('fs.exists', async (_$: unknown, e: { path: string }) => ({ value: e.path in w.files }))
  on('fs.read', async (_$: unknown, e: { path: string }) => {
    if (!(e.path in w.files)) throw new Error('ENOENT')
    return { value: w.files[e.path] }
  })
  on('fs.write', async (_$: unknown, e: { path: string; text: string }) => {
    w.files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.stat', async (_$: unknown, e: { path: string; resolve: boolean }) => {
    const link = opts.links?.[e.path]
    if (link === undefined && !(e.path in w.files)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 0, mtimeMs: 1, isLink: link !== undefined, ...(e.resolve ? { realPath: link ?? e.path } : {}) } }
  })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', async () => ({ result: { ok: true } }))
  on('tool.check', async () => ({ decision: opts.core ?? 'allow', reason: 'core' }))
  return w
}

const START = { cwd: deskDir(HOME), surface: 'terminal', isInteractive: true } as const

test('tools.allow lets a read tool through but never a send tool', async ($, on) => {
  mock.clock(on, { now: NOW })
  wire(on, { files: { [configFile(HOME)]: JSON.stringify({ tools: { allow: [SEARCH, SEND] } }) } })
  await $.session.start(START)
  expect((await $.tool.check({ tool: SEARCH, input: {} })).decision).toBe('allow')
  expect((await $.tool.check({ tool: SEND, input: {} })).decision).toBe('deny')
  expect((await $.tool.check({ tool: OTHER, input: {} })).decision).toBe('deny')
})

const denies = (w: { files: Record<string, string> }) => (w.files[DENIES] ?? '').split('\n').filter(Boolean)
const settle = async (w: { files: Record<string, string> }, n: number) => { for (let i = 0; i < 1000 && denies(w).length < n; i++) await Promise.resolve() }

test('every deny is logged', async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = wire(on)
  await $.session.start(START)
  const r = await $.tool.check({ tool: 'Read', input: { file_path: svcTokenFile(HOME) } })
  expect(r.decision).toBe('deny')
  expect(String(r.reason).startsWith('NLK:')).toBe(true)
  await settle(w, 1)
  expect(denies(w).length).toBe(1)
  expect(denies(w)[0]).toContain('"tool":"Read"')
  expect(denies(w)[0]).toContain('"kind":"guard"')
})

test('allowed read passes; a link into a sealed folder is denied', async ($, on) => {
  mock.clock(on, { now: NOW })
  wire(on, { links: { [`${ALPHA}/link.md`]: `${HOME}/.ssh/id` } })
  await $.session.start(START)
  expect((await $.tool.check({ tool: 'Read', input: { file_path: `${ALPHA}/README.md` } })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: `${ALPHA}/link.md` } })).decision).toBe('deny')
})

test('installs are denied with the owner message', async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = wire(on)
  await $.session.start(START)
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'brew install alpha' } })
  expect(r.decision).toBe('deny')
  expect(String(r.reason)).toBe('NLK: installs are blocked; the owner can run it themselves')
  expect(((await $.tool.call({ tool: 'Bash', command: 'brew install alpha' } as any)) as { deny?: string }).deny).toBeTruthy()
})

test('replies go only to the owner chat, attachments checked where they land', async ($, on) => {
  mock.clock(on, { now: NOW })
  wire(on, { links: { [`${deskDir(HOME)}/a.png`]: svcTokenFile(HOME) }, files: { [`${deskDir(HOME)}/b.png`]: 'png' } })
  await $.session.start(START)
  const reply = (files: string[], chat_id = '111') => $.tool.check({ tool: TG_REPLY, input: { chat_id, text: 'x', files } })
  expect((await reply([`${deskDir(HOME)}/b.png`])).decision).toBe('allow')
  expect((await reply([`${deskDir(HOME)}/a.png`])).decision).toBe('deny')
  expect((await reply([`${deskDir(HOME)}/gone.png`])).decision).toBe('deny')
  expect((await reply([], '222')).decision).toBe('deny')
})

test('before pairing no Telegram tool is allowed', async ($, on) => {
  mock.clock(on, { now: NOW })
  wire(on, { files: { [ACCESS]: '{"allowFrom":[]}' } })
  await $.session.start(START)
  expect((await $.tool.check({ tool: TG_REPLY, input: { chat_id: '111', text: 'x' } })).decision).toBe('deny')
})

test('core ask becomes deny; a core deny sticks', async ($, on) => {
  mock.clock(on, { now: NOW })
  wire(on, { core: 'ask' })
  await $.session.start(START)
  expect((await $.tool.check({ tool: 'Read', input: { file_path: `${ALPHA}/README.md` } })).decision).toBe('deny')
})

test('a core deny sticks', async ($, on) => {
  mock.clock(on, { now: NOW })
  wire(on, { core: 'deny' })
  await $.session.start(START)
  expect((await $.tool.check({ tool: 'Read', input: { file_path: `${ALPHA}/README.md` } })).decision).toBe('deny')
})

test('remote sessions are untouched', async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = wire(on, { env: { NLK_HOST: undefined } })
  await $.session.start(START)
  expect((await $.tool.check({ tool: 'Read', input: { file_path: svcTokenFile(HOME) } })).decision).toBe('allow')
  expect(denies(w)).toEqual([])
})

test('tool.call re-check denies a call that skipped the check', async ($, on) => {
  mock.clock(on, { now: NOW })
  const w = wire(on)
  await $.session.start(START)
  const denied = async (input: Record<string, unknown>) => ((await $.tool.call(input as any)) as { deny?: string }).deny
  expect(await denied({ tool: 'Read', file_path: svcTokenFile(HOME) })).toContain('NLK:')
  expect(await denied({ tool: 'Bash', command: 'git push origin main' })).toBeTruthy()
  expect(await denied({ tool: TG_REPLY, chat_id: '222', text: 'x' })).toBeTruthy()
  expect(await denied({ tool: 'Read', file_path: `${ALPHA}/README.md` })).toBeUndefined()
  await settle(w, 3)
  expect(denies(w).length).toBe(3)
})
