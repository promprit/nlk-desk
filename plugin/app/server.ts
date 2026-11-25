import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { timingSafeEqual, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sendText, tgOpts } from './telegram.ts'
import { nodeIo, type SvcIo, svcTokenFile, memoryDir, modelsDir, weatherDir, telegramState, resumeFile, backupsDir, SVC_PORT, TMUX_SOCKET, TMUX_SESSION, LABEL } from './io.ts'
import { openMemory, memRoutes, backup } from './memory.ts'
import { e5Embedder, type Embed } from './embed.ts'
import { weatherRoutes } from './weather.ts'
import { freshRoutes, restartSession } from './fresh.ts'

type Routes = Record<string, (body: unknown) => Promise<unknown>>

const execFileP = promisify(execFile)
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * POST-JSON service on 127.0.0.1 behind a bearer token. `io` is for the routes' siblings; the skeleton itself needs none.
 */
export function startServer(o: { port: number; token: string; io: SvcIo; routes: Routes; log?: (line: string) => void }): Promise<{ close(): Promise<void>; port: number; address: string }> {
  const log = o.log ?? (line => console.error(line))
  const srv = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    let path = ''
    try {
      if (!same(req.headers.authorization ?? '', `Bearer ${o.token}`)) return send(401, { error: 'unauthorized' })
      if (req.method !== 'POST') return send(405, { error: 'POST only' })
      path = new URL(req.url ?? '/', 'http://x').pathname
      const route = o.routes[path]
      if (!route) return send(404, { error: 'not found' })
      let raw = ''
      for await (const c of req) raw += c
      const body = raw ? JSON.parse(raw) : {}
      send(200, await route(body))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const code = (e as { cause?: { code?: unknown } })?.cause?.code
      log(`${path} failed: ${msg.slice(0, 200)}${typeof code === 'string' ? ` (${code})` : ''}`)
      send(500, { error: msg })
    }
  })
  return new Promise(resolve => srv.listen(o.port, '127.0.0.1', () => {
    const a = srv.address() as { port: number; address: string }
    resolve({ port: a.port, address: a.address, close: () => new Promise<void>(r => { srv.close(() => r()); srv.closeAllConnections() }) })
  }))
}

async function baseRoutes(home: string, d: { embed: Embed; fetch: typeof fetch }) {
  await mkdir(memoryDir(home), { recursive: true, mode: 0o700 })
  const mem = openMemory(`${memoryDir(home)}/memory.db`, d.embed)
  const routes: Routes = {
    '/health': async () => ({ ok: true }),
    ...memRoutes({ mem, backup: () => backup(memoryDir(home), backupsDir(home), new Date().toISOString().slice(0, 10)) }),
    ...weatherRoutes({ dir: weatherDir(home), fetch: d.fetch }),
  }
  return { mem, routes }
}

function freshFor(home: string): Routes {
  const tmuxBin = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux'].find(p => existsSync(p)) ?? 'tmux'
  const restart = (resume: boolean) => restartSession({
    setResume: async on => { if (on) await writeFile(resumeFile(home), ''); else await rm(resumeFile(home), { force: true }) },
    tmux: (...args) => execFileP(tmuxBin, ['-L', TMUX_SOCKET, ...args]),
    launchctl: (...a) => execFileP('/bin/launchctl', a),
    target: `gui/${process.getuid?.() ?? 501}/${LABEL}`, session: TMUX_SESSION,
  }, resume)
  return freshRoutes({ send: async text => { await sendText(await tgOpts(telegramState(home)), text) }, restart })
}

/** The route names the service mounts, built with a fake embedder and fetch; nothing listens. */
export async function routeNames(home: string): Promise<string[]> {
  const fake = async () => { throw new Error('no network in routeNames') }
  const { mem, routes } = await baseRoutes(home, { embed: async texts => texts.map(() => new Float32Array(1)), fetch: fake as typeof fetch })
  mem.close()
  return [...Object.keys(routes), ...Object.keys(freshFor(home))]
}

async function main() {
  const home = process.env.HOME ?? ''
  const file = svcTokenFile(home)
  let token = (await readFile(file, 'utf8').catch(() => '')).trim()
  if (!token) {
    token = randomBytes(32).toString('hex')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, token + '\n', { mode: 0o600 })
    await chmod(file, 0o600)
  }
  const { routes } = await baseRoutes(home, { embed: e5Embedder(modelsDir(home)), fetch })
  const s = await startServer({ port: Number(process.env.SVC_PORT ?? SVC_PORT), token, io: nodeIo(home), routes })
  console.log(`nlk-svc listening on 127.0.0.1:${s.port}`)
  Object.assign(routes, freshFor(home))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
