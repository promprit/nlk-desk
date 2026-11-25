import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { routeNames, startServer } from '../server.ts'
import type { SvcIo } from '../io.ts'

const fakeIo = (): SvcIo => ({ home: '/nowhere', read: async () => null, append: async () => {}, now: () => 0 })

// Memory routes minus every vault route (/mem/vault, /mem/reindex), weather, fresh and health; nothing else.
test('mounts only memory, weather and health routes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nlksvc-'))
  const names = [...await routeNames(home)].sort()
  assert.deepEqual(names, [
    '/fresh',
    '/health',
    '/mem/about',
    '/mem/backup',
    '/mem/forget',
    '/mem/save',
    '/mem/search',
    '/weather',
    '/weather/place',
  ])
})

test('rejects calls without the token', async () => {
  const s = await startServer({ port: 0, token: 't', io: fakeIo(), routes: { '/ping': async () => ({ pong: true }) } })
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/ping`, { method: 'POST' })).status, 401)
  const ok = await fetch(`http://127.0.0.1:${s.port}/ping`, { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{}' })
  assert.deepEqual(await ok.json(), { pong: true })
  await s.close()
})

const boot = () => startServer({
  port: 0, token: 't', io: fakeIo(), log: () => {},
  routes: { '/ping': async () => ({ pong: true }), '/boom': async () => { throw new Error('bad') } },
})
const post = (port: number, path: string) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{}' })

test('binds only to 127.0.0.1', async () => {
  const s = await boot()
  assert.equal((await post(s.port, '/ping')).status, 200)
  assert.equal(s.address, '127.0.0.1')
  await s.close()
})

test('404 on unknown route, 500 with error on a throw, GET refused', async () => {
  const s = await boot()
  assert.equal((await post(s.port, '/nope')).status, 404)
  const b = await post(s.port, '/boom')
  assert.equal(b.status, 500)
  assert.deepEqual(await b.json(), { error: 'bad' })
  const g = await fetch(`http://127.0.0.1:${s.port}/ping`, { headers: { authorization: 'Bearer t' } })
  assert.equal(g.status, 405)
  await s.close()
})

test('a failing route is logged with its path and cause code, never the request body', async () => {
  const lines: string[] = []
  const cause = Object.assign(new Error('connect'), { code: 'ECONNRESET' })
  const s = await startServer({
    port: 0, token: 't', io: fakeIo(), log: l => lines.push(l),
    routes: { '/weather': async () => { throw new TypeError('fetch failed', { cause }) } },
  })
  const r = await fetch(`http://127.0.0.1:${s.port}/weather`, { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{"place":"secret words"}' })
  assert.equal(r.status, 500)
  assert.deepEqual(lines, ['/weather failed: fetch failed (ECONNRESET)'])
  await s.close()
})
