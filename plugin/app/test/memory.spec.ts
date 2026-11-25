import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemory, backup, memRoutes } from '../memory.ts'

// Concept buckets: "coffee" and "espresso" share one vector direction; everything else hashes elsewhere.
const CONCEPT: Record<string, number> = { coffee: 0, espresso: 0, alpha: 1, beta: 2 }
const fakeEmbed = async (texts: string[]) => texts.map(t => {
  const v = new Float32Array(8)
  for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) v[CONCEPT[w] ?? 3 + (w.length % 5)] += 1
  const n = Math.hypot(...v) || 1
  return v.map(x => x / n)
})
const base = { kind: 'fact', mode: 'normal', source: 'chat' } as const

test('hybrid search finds by meaning and by word', async () => {
  const m = openMemory(':memory:', fakeEmbed)
  await m.save({ ...base, text: 'Tester loves espresso in the morning', kind: 'preference' })
  await m.save({ ...base, text: 'Project alpha ships Friday', kind: 'promise' })
  assert.match((await m.search('coffee', { k: 1, modes: ['normal'] }))[0].text, /espresso/)
  assert.match((await m.search('alpha', { k: 1, modes: ['normal'] }))[0].text, /alpha/)
  m.close()
})

test('superseded memories drop out; forget deletes for real', async () => {
  const m = openMemory(':memory:', fakeEmbed)
  const a = await m.save({ ...base, text: 'Tester drinks espresso' })
  const b = await m.supersede(a, 'Tester drinks tea now')
  const hits = await m.search('espresso tea', { k: 5, modes: ['normal'] })
  assert.deepEqual(hits.map(h => h.id), [b])
  m.forget(b)
  assert.deepEqual(await m.search('espresso tea', { k: 5, modes: ['normal'] }), [])
  assert.deepEqual(m.about('tea'), [])
  m.close()
})

test('only the normal mode exists: any other mode is refused', async () => {
  const m = openMemory(':memory:', fakeEmbed)
  const r = memRoutes({ mem: m, backup: async () => {} })
  await assert.rejects(r['/mem/save']({ text: 'beta note', kind: 'fact', mode: 'summary' }), /mode must be one of normal/)
  await assert.rejects(r['/mem/search']({ q: 'beta', modes: ['summary'] }), /modes must be one of normal/)
  const { id } = await r['/mem/save']({ text: 'beta note', kind: 'fact' })
  assert.deepEqual((await r['/mem/search']({ q: 'beta' })).hits.map(h => h.id), [id])
  m.close()
})

test('kinds filter and touch bumps updated', async () => {
  let t = 100
  const m = openMemory(':memory:', fakeEmbed, () => t)
  const id = await m.save({ ...base, text: 'alpha promise', kind: 'promise' })
  await m.save({ ...base, text: 'alpha fact' })
  const hits = await m.search('alpha', { k: 5, modes: ['normal'], kinds: ['promise'] })
  assert.deepEqual(hits.map(h => h.id), [id])
  t = 200
  m.touch([id])
  assert.equal((await m.search('alpha', { k: 1, modes: ['normal'], kinds: ['promise'] }))[0].updated, 200)
  m.close()
})

// A real database file holding one memory, left open as the service holds it.
const liveDb = async (dir: string) => {
  const m = openMemory(join(dir, 'memory.db'), fakeEmbed)
  await m.save({ ...base, text: 'alpha backed up' })
  return m
}

test('backup holds a consistent database and nothing else', async () => {
  const src = await mkdtemp(join(tmpdir(), 'nlk-bk-'))
  const live = await liveDb(src)
  await writeFile(join(src, 'costs.jsonl'), '{}\n')
  await mkdir(join(src, 'backups', '2026-10-01'), { recursive: true })
  await backup(src, join(src, 'backups'), '2026-10-21')
  live.close()
  const out = join(src, 'backups', '2026-10-21')
  assert.deepEqual((await readdir(out)).sort(), ['memory.db'])
  const copy = openMemory(join(out, 'memory.db'), fakeEmbed)
  assert.equal(copy.about('alpha').length, 1)
  copy.close()
})

test('backup keeps the last 7', async () => {
  const d = await mkdtemp(join(tmpdir(), 'nlk-bk-'))
  const src = join(d, 'memory'); const dest = join(d, 'backups')
  await mkdir(src); (await liveDb(src)).close()
  for (let i = 1; i <= 9; i++) await mkdir(join(dest, `2026-10-0${i}`), { recursive: true })
  await backup(src, dest, '2026-10-21')
  const left = (await readdir(dest)).sort()
  assert.equal(left.length, 7)
  assert.equal(left.at(-1), '2026-10-21')
  assert.equal(left[0], '2026-10-04')
  assert.deepEqual(await readdir(join(dest, '2026-10-21')), ['memory.db'])
})

test('backup pruning removes only its own dated folders', async () => {
  const d = await mkdtemp(join(tmpdir(), 'nlk-bk-'))
  const src = join(d, 'memory'); const dest = join(d, 'backups')
  await mkdir(src); (await liveDb(src)).close()
  for (let i = 1; i <= 9; i++) await mkdir(join(dest, `2026-10-0${i}`), { recursive: true })
  await mkdir(join(dest, 'aaa-not-ours'), { recursive: true })
  await writeFile(join(dest, '.claude.json.backup.1'), 'x')
  await backup(src, dest, '2026-10-21')
  const left = (await readdir(dest)).sort()
  assert.ok(left.includes('aaa-not-ours'))
  assert.ok(left.includes('.claude.json.backup.1'))
  assert.equal(left.filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).length, 7)
})

// Thai has no spaces: the keyword half of the ranking must still find it. fakeEmbed gives every Thai text the same vector, so only the FTS half can tell them apart.
const thai = async () => {
  const m = openMemory(':memory:', fakeEmbed)
  await m.save({ ...base, text: 'เมนูกาแฟโปรดคือลาเต้เย็นไม่หวาน' })
  await m.save({ ...base, text: 'ต้องส่งรายงานให้ลูกค้าวันศุกร์หน้า' })
  const want = await m.save({ ...base, text: 'openbook-kit เป็นโปรเจกต์สาธารณะ MIT ตั้งแต่ 2026-10-03' })
  return { m, want }
}

test('a Thai fact is found by a Thai keyword', async () => {
  const { m, want } = await thai()
  assert.equal((await m.search('สาธารณะ', { k: 1, modes: ['normal'] }))[0].id, want)
  assert.deepEqual(m.about('สาธารณะ').map(x => x.id), [want])
  assert.ok(m.about('โปรเจกต์').some(x => x.id === want))
  assert.equal((await m.search('ตั้งแต่เมื่อไหร่', { k: 1, modes: ['normal'] }))[0].id, want)
  m.close()
})

test('a paraphrased Thai question finds the fact', async () => {
  const { m, want } = await thai()
  for (const q of ['openbook เป็น public ไหม', 'openbook-kit สาธารณะหรือเปล่า', 'โปรเจกต์ openbook-kit สาธารณะหรือเปล่า?']) {
    assert.equal((await m.search(q, { k: 1, modes: ['normal'] }))[0].id, want, q)
  }
  m.close()
})

test('an English word glued to Thai is found', async () => {
  const m = openMemory(':memory:', fakeEmbed)
  await m.save({ ...base, text: 'ต้องส่งรายงานให้ลูกค้าวันศุกร์หน้า' })
  const want = await m.save({ ...base, text: 'วันนี้คุยเรื่อง openbookเป็นโปรเจกต์ใหญ่' })
  assert.equal((await m.search('openbook', { k: 1, modes: ['normal'] }))[0].id, want)
  assert.deepEqual(m.about('openbook').map(x => x.id), [want])
  assert.equal((await m.search('openbookเป็น', { k: 1, modes: ['normal'] }))[0].id, want)
  m.close()
})

test('English-only recall still works, case-insensitively', async () => {
  const m = openMemory(':memory:', fakeEmbed)
  const want = await m.save({ ...base, text: 'Tester prefers Gamma Gadgets' })
  await m.save({ ...base, text: 'Something else entirely' })
  assert.equal((await m.search('gamma', { k: 1, modes: ['normal'] }))[0].id, want)
  assert.deepEqual(m.about('GADGETS').map(x => x.id), [want])
  m.close()
})

test('short and punctuation-only queries never throw', async () => {
  const m = openMemory(':memory:', fakeEmbed)
  const a = await m.save({ ...base, text: 'ok go to AI lab' })
  await m.save({ ...base, text: 'ไปกินข้าว' })
  for (const q of ['a', 'ai', 'ก', 'ไป', '"', '"*()-:^', '???', 'AND OR NOT', "it's", '100%', '_']) {
    await m.search(q, { k: 3, modes: ['normal'] })
    m.about(q)
  }
  assert.deepEqual(m.about('ai').map(x => x.id), [a])
  assert.equal(m.about('ไป').length, 1)
  assert.deepEqual(m.about('?!'), [])
  assert.deepEqual(m.about('100%'), [])
  m.close()
})
