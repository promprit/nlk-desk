import * as P from '../paths.ts'
import { guardCheck, normalize, sealedRoots, type GuardPaths, type Verdict } from '../guard.ts'
import { readAllow } from '../sandbox.ts'
import { hasTools, homeOf, logDeny, ownerChat, type Engine } from '../engine.ts'
import type { Ctx, On } from './ctx.ts'

const FILE_TOOLS: Record<string, string> = { Read: 'file_path', Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path', Glob: 'path', Grep: 'path' }

async function guardPaths($: Engine): Promise<GuardPaths & { allow: string[] }> {
  const home = await homeOf($)
  const config = await $.fs.read(P.configFile(home)).catch(() => null)
  return {
    home, desk: P.deskDir(home), tgState: P.telegramState(home), ownerChat: await ownerChat($),
    sealed: sealedRoots(home), allow: readAllow(typeof config === 'string' ? config : null),
  }
}

// The absolute path a tool argument names: `~` is home, a relative path starts in the desk.
function absOf(raw: string, home: string): string {
  const s = raw.replace(/^file:\/\//i, '')
  if (s.startsWith('~')) return normalize(home + (s.includes('/') ? s.slice(s.indexOf('/')) : ''))
  return normalize(s.startsWith('/') ? s : `${P.deskDir(home)}/${s}`)
}

// Where a path lands after symlinks; a path not there yet lands under its nearest existing ancestor.
async function realOf($: Engine, path: string, home: string): Promise<{ path: string } | undefined> {
  let rest = ''
  for (let cur = absOf(path, home); cur !== '/'; ) {
    const s = await $.fs.stat(cur, { resolve: true }).catch(() => null)
    if (s) return s.realPath === undefined ? undefined : { path: `${s.realPath.replace(/\/$/, '')}${rest}` }
    const cut = cur.lastIndexOf('/')
    rest = `${cur.slice(cut)}${rest}`
    cur = cur.slice(0, cut) || '/'
  }
  return undefined
}

// The guard on where file tools and reply attachments land (a path that lands nowhere is denied). Every deny is logged.
async function hostCheck($: Engine, tool: string, input: unknown): Promise<Verdict> {
  const gp = await guardPaths($)
  const x = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const key = FILE_TOOLS[tool]
  const raw = key ? x[key] : undefined
  const target = typeof raw === 'string' && raw ? raw : tool === 'Glob' || tool === 'Grep' ? gp.desk : undefined
  const real = target === undefined ? undefined : await realOf($, target, gp.home)
  const files = tool === P.TG_REPLY && Array.isArray(x.files) ? x.files : []
  const landed: ({ path: string } | undefined)[] = []
  for (const f of files) if (typeof f === 'string') landed.push(await realOf($, f, gp.home))
  const lost = (target !== undefined && !real) || landed.some(r => !r)
  const checked = files.length ? { ...x, files: [...files, ...landed.map(r => r?.path)] } : input
  const v = lost ? { decision: 'deny' as const, reason: 'cannot tell where that path lands' } : guardCheck(tool, checked, gp, real)
  if (v.decision === 'allow') return v
  void logDeny($, v.reason ?? 'denied', tool).catch(() => {})
  return { decision: 'deny', reason: `NLK: ${v.reason}` }
}

export function wireGuard(on: On, _ctx: Ctx) {
  // The hook answers allow or deny: a core ask would wait on a prompt nobody answers.
  on('tool.check', async ($, e, next) => {
    if (!(await hasTools($))) return next(e)
    const core = await next(e)
    if (core.decision === 'deny') return core
    const v = await hostCheck($, e.tool, e.input)
    if (v.decision === 'deny') return { decision: 'deny' as const, reason: v.reason }
    if (core.decision === 'ask') return { decision: 'deny' as const, reason: 'NLK: that would need a prompt; nobody is at the keyboard' }
    return { decision: 'allow' as const }
  }).catch(async () => ({ decision: 'deny' as const, reason: 'NLK: the guard failed' }))

  // A plugin seated above this one can carry tool.check past the hook above, so the same verdict is applied again when the tool runs.
  on('tool.call', async ($, e, next) => {
    if (!(await hasTools($))) return next(e)
    const { tool, tool_use_id: _id, consent: _c, agentId: _a, requestMeta: _m, ...input } = e as unknown as Record<string, unknown> & { tool: string }
    const v = await hostCheck($, tool, input)
    if (v.decision === 'deny') return { deny: v.reason ?? 'NLK: denied' }
    return next(e)
  }).catch(async ($, e, next) => (next.called ? next(e) : (await hasTools($).catch(() => true)) ? { deny: 'NLK: the guard failed' } : next(e)))
}
