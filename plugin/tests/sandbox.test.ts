import { test, expect } from 'claude-code/testing'
import { launcherSettings, readAllow, rule } from '../hooks/sandbox.ts'
import { deskDir } from '../hooks/paths.ts'
import { sealedSpec } from '../hooks/sealed.ts'

const H = '/H'
const DESK = deskDir(H)
const settings = () => JSON.parse(launcherSettings({ home: H, uid: 501 }))

test('settings are strict and emit both rule forms from one list', () => {
  const s = settings()
  expect(s.sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false })
  expect(s.sandbox.network.strictAllowlist).toBe(true)
  expect(s.permissions.deny).toContain(`Edit(/${DESK}/CLAUDE.md)`)
  expect(s.permissions.allow).toContain(`Edit(/${DESK}/**)`)
  expect(s.permissions.allow).toContain('Write(//H/.nlk/files/**)')
  expect(s.permissions.allow).not.toContain('Edit')
  expect(JSON.stringify(s)).not.toMatch(/"\/\/\//)
  for (const p of s.sandbox.filesystem.denyRead) expect(s.permissions.deny).toContain(`Read(${rule(p)}/**)`)
  for (const p of s.sandbox.filesystem.denyWrite) expect(s.permissions.deny).toContain(`Edit(${rule(p)})`)
  for (const r of s.permissions.deny as string[]) {
    const p = `/${r.replace(/^(Read|Edit)\(\/\/|(\/\*\*)?\)$/g, '')}`
    expect(s.sandbox.filesystem[r.startsWith('Read') ? 'denyRead' : 'denyWrite']).toContain(p)
  }
})

test('the desk is writable only by its own files, and only Edit-family tools on the desk', () => {
  const s = settings()
  for (const f of ['CLAUDE.md', '.claude', 'private/persona.md', 'private/core.md']) expect(s.sandbox.filesystem.denyWrite).toContain(`${DESK}/${f}`)
  for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
    expect(s.permissions.allow).toContain(`${t}(/${DESK}/**)`)
    expect(s.permissions.allow).not.toContain(t)
  }
  for (const t of ['mcp__plugin_telegram_telegram__reply', 'mcp__plugin_telegram_telegram__react', 'mcp__plugin_telegram_telegram__edit_message', 'mcp__plugin_telegram_telegram__download_attachment', 'Bash', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite'])
    expect(s.permissions.allow).toContain(t)
})

test('credential stores, ~/.claude, the Telegram env and the service token are sealed both ways', () => {
  const s = settings()
  const { denyRead, denyWrite } = s.sandbox.filesystem
  for (const p of ['/H/.ssh', '/H/.aws', '/H/.gnupg', '/H/.claude', '/H/Library/Keychains', '/H/.nlk/claude/channels/telegram-nlk/.env', '/H/.nlk/svc.token']) {
    expect(denyRead).toContain(p)
    expect(denyWrite).toContain(p)
    expect(s.permissions.deny).toContain(`Read(/${p}/**)`)
    expect(s.permissions.deny).toContain(`Edit(/${p})`)
  }
  expect(sealedSpec(H)).toContainEqual({ path: '/H/.ssh', read: true, write: true })
})

test('every desk file Claude Code loads as instructions is write-sealed', () => {
  const s = settings()
  for (const f of ['CLAUDE.local.md', '.mcp.json', '.git', '.gitignore', '**/CLAUDE.md']) {
    expect(s.sandbox.filesystem.denyWrite).toContain(`${DESK}/${f}`)
    expect(s.permissions.deny).toContain(`Edit(/${DESK}/${f})`)
  }
  expect(s.permissions.deny).toContain(`Edit(/${DESK}/.git/**)`)
  expect(s.sandbox.filesystem.denyRead).not.toContain(`${DESK}/.git`)
})

test('tmux socket dir is sealed both ways', () => {
  const s = settings()
  expect(s.sandbox.filesystem.denyRead).toContain('/private/tmp/tmux-501')
  expect(s.sandbox.filesystem.denyWrite).toContain('/private/tmp/tmux-501')
})

test('allow-list is exactly the six hosts', () => {
  expect(settings().sandbox.network.allowedDomains).toEqual(['registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org', 'github.com', 'codeload.github.com', 'objects.githubusercontent.com'])
})

test('rule() keeps one slash pair for any absolute path', () => {
  expect(rule('/V/x')).toBe('//V/x')
  expect(rule('/')).toBe('//')
})

test('readAllow reads tools.allow and falls back to none', () => {
  expect(readAllow('{"tools":{"allow":["mcp__a__b",3]}}')).toEqual(['mcp__a__b'])
  for (const bad of [null, '', '{', '{}', '{"tools":{"allow":"x"}}']) expect(readAllow(bad)).toEqual([])
})
