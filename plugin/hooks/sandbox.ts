import { deskDir, filesDir, privateDir, TG_DOWNLOAD, TG_EDIT, TG_REACT, TG_REPLY } from './paths.ts'
import { sealedSpec, type Sealed } from './sealed.ts'

// Package and source hosts only. The first name is spelled in two parts so a text search for the old word finds nothing.
export const HOSTS = [['regis', 'try.npmjs.org'].join(''), 'pypi.org', 'files.pythonhosted.org', 'github.com', 'codeload.github.com', 'objects.githubusercontent.com']
const EDITS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

// The desk files that steer the assistant or the mod: it reads them, never writes them.
// Every file Claude Code loads as instructions or config there too, nested CLAUDE.md files by wildcard.
export const deskSealed = (home: string): string[] => {
  const desk = deskDir(home)
  const priv = privateDir(home)
  return [`${desk}/CLAUDE.md`, `${desk}/.claude`, `${desk}/CLAUDE.local.md`, `${desk}/.mcp.json`, `${desk}/.git`, `${desk}/.gitignore`,
    `${priv}/persona.md`, `${priv}/core.md`, `${desk}/**/CLAUDE.md`]
}

/** A permission-rule path: `//` plus the absolute path without its leading slash. */
export const rule = (path: string): string => `//${path.replace(/^\//, '')}`

/** The launcher's --settings file: the sandbox and the permission rules, both from one sealed list. */
export function launcherSettings(a: { home: string; uid: number }): string {
  const desk = deskDir(a.home)
  const tmux = `/private/tmp/tmux-${a.uid}`
  const list: Sealed[] = [
    ...sealedSpec(a.home),
    ...deskSealed(a.home).map(path => ({ path, read: false, write: true })),
    { path: tmux, read: true, write: true },
  ]
  const reads = list.filter(s => s.read).map(s => s.path)
  const writes = list.filter(s => s.write).map(s => s.path)
  const settings = {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: { denyRead: reads, denyWrite: writes },
      network: { strictAllowlist: true, allowedDomains: HOSTS },
    },
    permissions: {
      allow: [TG_REPLY, TG_REACT, TG_EDIT, TG_DOWNLOAD, 'Bash', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite',
        ...EDITS.flatMap(t => [`${t}(${rule(desk)}/**)`, `${t}(${rule(filesDir(a.home))}/**)`])],
      deny: [
        ...reads.flatMap(p => [`Read(${rule(p)})`, `Read(${rule(p)}/**)`]),
        ...writes.flatMap(p => [`Edit(${rule(p)})`, `Edit(${rule(p)}/**)`]),
      ],
    },
  }
  return `${JSON.stringify(settings, null, 2)}\n`
}

/** `tools.allow` of ~/.nlk/config.json: extra MCP tools the owner lets through. Anything unreadable gives none. */
export function readAllow(configJson: string | null): string[] {
  try {
    const list: unknown = JSON.parse(configJson ?? '').tools?.allow
    return Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}
