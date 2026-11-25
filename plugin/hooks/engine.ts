import type { Hook } from 'claude-code'
import * as P from './paths.ts'
import { roleOf } from './role.ts'
import { deskClaudeMd } from './persona.ts'
import { withFileLock, type LockIo } from './lock.ts'

export type Engine = Parameters<Hook<'session.start'>>[0]

// The engine only lets `$` be passed to function declarations at the top level of a module.

async function roleNow($: Engine): Promise<ReturnType<typeof roleOf>> {
  return roleOf(await $.env.get('NLK_HOST'), await $.env.get('NLK_ROLE'))
}

export async function isHost($: Engine): Promise<boolean> {
  return (await roleNow($)) === 'host'
}

export async function isWorker($: Engine): Promise<boolean> {
  return (await roleNow($)) === 'worker'
}

export async function hasTools($: Engine): Promise<boolean> {
  return (await roleNow($)) !== 'remote'
}

export async function homeOf($: Engine): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

export function lockIo($: Engine): LockIo {
  let ready = false
  return {
    mkdir: async path => {
      if (!ready) await $.process.run(['mkdir', '-p', path.slice(0, path.lastIndexOf('/'))])
      ready = true
      return (await $.process.run(['mkdir', path])).exitCode === 0
    },
    writeOwner: (path, token) => $.fs.write(`${path}/owner`, token),
    readOwner: path => $.fs.read(`${path}/owner`).then(t => (typeof t === 'string' ? t : null)).catch(() => null),
    rename: async (from, to) => (await $.process.run(['mv', '-n', from, to])).exitCode === 0 && !(await $.fs.exists(from)),
    rmdir: async path => {
      if (path.includes('.stale.')) { await $.process.run(['rm', '-rf', path]); return }
      await $.process.run(['rm', '-f', `${path}/owner`])
      await $.process.run(['rmdir', path])
    },
    ageMs: async path => {
      const st = await $.fs.stat(path).catch(() => null)
      return st ? (await $.clock.now()) - st.mtimeMs : null
    },
    sleep: ms => $.clock.sleep(ms),
    token: () => crypto.randomUUID(),
  }
}

// The owner's chat: the first id in the telegram plugin's allowFrom; null until the owner has paired.
export async function ownerChat($: Engine): Promise<string | null> {
  try {
    const text = await $.fs.read(`${P.telegramState(await homeOf($))}/access.json`)
    const first: unknown = JSON.parse(typeof text === 'string' ? text : '').allowFrom?.[0]
    return typeof first === 'string' && first ? first : null
  } catch {
    return null
  }
}

// Rewritten whole through a temp file and a rename, so a reader never sees a partial log.
export async function appendInbound($: Engine, home: string, line: string): Promise<void> {
  await $.process.run(['mkdir', '-p', P.logsDir(home)])
  await withFileLock(lockIo($), P.lockDir(home), async () => {
    const file = P.inboundLog(home)
    const prev = await $.fs.read(file).catch(() => '')
    const lines = `${typeof prev === 'string' ? prev : ''}${line}\n`.split('\n').filter(Boolean)
    const tmp = `${file}.tmp`
    await $.fs.write(tmp, `${lines.slice(-2000).join('\n')}\n`)
    if ((await $.process.run(['mv', '-f', tmp, file])).exitCode !== 0) throw new Error('inbound log not renamed')
  })
}

// Writes the desk CLAUDE.md when it differs from the generated text.
export async function refreshDeskClaudeMd($: Engine): Promise<void> {
  const text = deskClaudeMd()
  const file = `${P.deskDir(await homeOf($))}/CLAUDE.md`
  const cur = await $.fs.read(file).catch(() => null)
  if (cur !== text) await $.fs.write(file, text)
}

// The `kind` keeps the line in the format a denies report reads.
export async function logDeny($: Engine, rule: string, tool: string): Promise<void> {
  const home = await homeOf($)
  const line = JSON.stringify({ ts: await $.clock.now(), kind: 'guard', rule, tool })
  await $.process.run(['mkdir', '-p', P.logsDir(home)])
  await withFileLock(lockIo($), P.lockDir(home), async () => {
    const file = P.deniesFile(home)
    const prev = await $.fs.read(file).catch(() => '')
    const lines = `${typeof prev === 'string' ? prev : ''}${line}\n`.split('\n').filter(Boolean)
    await $.fs.write(file, `${lines.slice(-2000).join('\n')}\n`)
  })
}

// Its local service, with the bearer token from svcTokenFile; status 0 when the service is down or the token is missing.
export async function svc($: Engine, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
  try {
    const token = String(await $.fs.read(P.svcTokenFile(await homeOf($)))).trim()
    if (!token) return { ok: false, status: 0, json: null }
    const r = await $.http.fetch(`${P.SVC_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    let json: unknown = null
    try { json = JSON.parse(r.text) } catch { /* not JSON */ }
    return { ok: r.ok, status: r.status, json }
  } catch {
    return { ok: false, status: 0, json: null }
  }
}
