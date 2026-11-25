import { test, expect, mock } from 'claude-code/testing'
import { configFile, deskDir } from '../hooks/paths.ts'

const NOW = 1_000_000
const HOME = '/H'
const SEARCH = 'mcp__claude_ai_Gmail__search_threads'
const SEND = 'mcp__claude_ai_Gmail__send_message'
const OTHER = 'mcp__claude_ai_Gmail__list_labels'

type Opts = { files?: Record<string, string>; core?: 'allow' | 'ask' | 'deny' }

// `core` stubs the engine's own verdict beneath the mod's tool.check hook.
function wire(on: any, opts: Opts = {}) {
  const w = { files: { ...opts.files } as Record<string, string> }
  const env: Record<string, string | undefined> = { NLK_HOST: '1', HOME, CLAUDE_CONFIG_DIR: `${HOME}/.nlk/claude` }
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
    if (!(e.path in w.files)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 0, mtimeMs: 1, isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } }
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
