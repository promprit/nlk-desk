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
