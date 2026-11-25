import { DatabaseSync } from 'node:sqlite'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export const KINDS = ['fact', 'preference', 'decision', 'promise', 'feeling', 'event', 'interest'] as const
export const MODES = ['normal'] as const
export type Kind = typeof KINDS[number]
export type Mode = typeof MODES[number]
export type Memory = { id: number; text: string; kind: Kind; mode: Mode; created: number; updated: number; source: string; supersededBy: number | null; weight: number }
export type NewMemory = { text: string; kind: Kind; mode: Mode; source: string; weight?: number }
type Embed = (texts: string[], kind?: 'query' | 'passage') => Promise<Float32Array[]>
type Row = Record<string, unknown>

const blob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
const unblob = (b: unknown) => { const u = b as Uint8Array; return new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)) }
const cosine = (a: Float32Array, b: Float32Array) => {
  let d = 0, x = 0, y = 0
  for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; x += a[i]! * a[i]!; y += b[i]! * b[i]! }
  return d / (Math.sqrt(x * y) || 1)
}
const segmenter = new Intl.Segmenter('th', { granularity: 'word' })
const words = (q: string) => [...segmenter.segment(q)].filter(s => s.isWordLike).map(s => s.segment.toLowerCase())
const len = (w: string) => [...w].length
/**
 * The trigram tokenizer cannot match a term under 3 characters, so `fts` holds the terms of 3+ characters (each quoted, OR-joined, so
 * punctuation never breaks the syntax) and `short` the rest, which fall back to LIKE only when no longer term exists.
 */
const ftsQuery = (q: string) => {
  const ws = [...new Set(words(q))]
  const fts = ws.filter(w => len(w) >= 3).map(w => `"${w.replaceAll('"', '""')}"`).join(' OR ')
  return { fts, short: fts ? [] : ws }
}
const likeEsc = (w: string) => w.replace(/[\\%_]/g, c => '\\' + c)
const toMemory = (r: Row): Memory => ({
  id: r.id as number, text: r.text as string, kind: r.kind as Kind, mode: r.mode as Mode, created: r.created as number,
  updated: r.updated as number, source: r.source as string, supersededBy: (r.superseded_by as number | null) ?? null, weight: r.weight as number,
})

export function openMemory(file: string, embed: Embed, now: () => number = Date.now) {
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, mode TEXT NOT NULL, created INTEGER NOT NULL,
      updated INTEGER NOT NULL, source TEXT NOT NULL, superseded_by INTEGER, weight REAL NOT NULL DEFAULT 1);
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(text, tokenize="trigram");
    CREATE TABLE IF NOT EXISTS vecs(id INTEGER PRIMARY KEY, v BLOB NOT NULL);
  `)
  const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[]
  const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p)

  const matchIds = (q: string, limit: number): number[] => {
    const { fts, short } = ftsQuery(q)
    if (fts) return all(`SELECT rowid AS id FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ${limit}`, fts).map(r => r.id as number)
    if (!short.length) return []
    return all(`SELECT id FROM memories WHERE ${short.map(() => "text LIKE ? ESCAPE '\\'").join(' OR ')} LIMIT ${limit}`, ...short.map(w => `%${likeEsc(w)}%`)).map(r => r.id as number)
  }

  async function fuse(q: string, ids: number[], weight: (id: number) => number): Promise<{ id: number; score: number }[]> {
    if (!ids.length) return []
    const ok = new Set(ids)
    const ftsRank = new Map<number, number>()
    matchIds(q, 200).filter(id => ok.has(id)).forEach((id, i) => ftsRank.set(id, i))
    const [qv] = await embed([q], 'query')
    const vecRank = new Map<number, number>()
    all('SELECT id, v FROM vecs').filter(r => ok.has(r.id as number))
      .map(r => ({ id: r.id as number, s: cosine(qv!, unblob(r.v)) })).sort((a, b) => b.s - a.s).forEach((r, i) => vecRank.set(r.id, i))
    return ids.map(id => ({
      id, score: ((ftsRank.has(id) ? 1 / (60 + ftsRank.get(id)!) : 0) + (vecRank.has(id) ? 1 / (60 + vecRank.get(id)!) : 0)) * weight(id),
    })).sort((a, b) => b.score - a.score || a.id - b.id)
  }

  const get = (id: number) => toMemory(all('SELECT * FROM memories WHERE id = ?', id)[0]!)

  const self = {
    async save(m: NewMemory): Promise<number> {
      const [v] = await embed([m.text], 'passage')
      const t = now()
      const id = Number(run('INSERT INTO memories(text, kind, mode, created, updated, source, weight) VALUES(?,?,?,?,?,?,?)', m.text, m.kind, m.mode, t, t, m.source, m.weight ?? 1).lastInsertRowid)
      run('INSERT INTO memories_fts(rowid, text) VALUES(?,?)', id, m.text)
      run('INSERT INTO vecs(id, v) VALUES(?,?)', id, blob(v!))
      return id
    },

    async search(q: string, o: { k: number; modes: Mode[]; kinds?: Kind[] }): Promise<Memory[]> {
      const rows = all('SELECT * FROM memories WHERE superseded_by IS NULL').map(toMemory)
        .filter(m => o.modes.includes(m.mode) && (!o.kinds || o.kinds.includes(m.kind)))
      const byId = new Map(rows.map(m => [m.id, m]))
      const ranked = await fuse(q, rows.map(m => m.id), id => byId.get(id)!.weight)
      return ranked.slice(0, o.k).map(r => byId.get(r.id)!)
    },

    forget(id: number) {
      run('DELETE FROM memories WHERE id = ?', id)
      run('DELETE FROM memories_fts WHERE rowid = ?', id)
      run('DELETE FROM vecs WHERE id = ?', id)
    },

    /** Current (not superseded) memories that mention `topic`, newest first. Word match only: no embedding call. */
    about(topic: string): Memory[] {
      const ids = matchIds(topic, -1)
      if (!ids.length) return []
      return all(`SELECT * FROM memories WHERE id IN (${ids.map(() => '?').join(',')}) AND superseded_by IS NULL ORDER BY updated DESC, id DESC`, ...ids).map(toMemory)
    },

    async supersede(oldId: number, text: string): Promise<number> {
      const o = get(oldId)
      const id = await self.save({ text, kind: o.kind, mode: o.mode, source: o.source, weight: o.weight })
      run('UPDATE memories SET superseded_by = ? WHERE id = ?', id, oldId)
      return id
    },

    touch(ids: number[]) { for (const id of ids) run('UPDATE memories SET updated = ? WHERE id = ?', now(), id) },

    close: () => db.close(),
  }
  return self
}

/** Back up `src`'s database to `destRoot/<date>/`; keep only the newest 7 dated folders. */
export async function backup(src: string, destRoot: string, date: string): Promise<void> {
  const out = join(destRoot, date)
  // A rerun the same day replaces that day: VACUUM INTO will not write over a file.
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  // VACUUM INTO writes one consistent file (the WAL folded in) while the service keeps the database open.
  const db = new DatabaseSync(join(src, 'memory.db'), { readOnly: true })
  try { db.prepare('VACUUM INTO ?').run(join(out, 'memory.db')) } finally { db.close() }
  const dirs = (await readdir(destRoot, { withFileTypes: true })).filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name)).map(e => e.name).sort()
  for (const d of dirs.slice(0, Math.max(0, dirs.length - 7))) await rm(join(destRoot, d), { recursive: true, force: true })
}

type Mem = ReturnType<typeof openMemory>
const str = (v: unknown, name: string) => { if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} must be a non-empty string`); return v }
const oneOf = <T extends string>(v: unknown, set: readonly T[], name: string): T => { if (!set.includes(v as T)) throw new Error(`${name} must be one of ${set.join(', ')}`); return v as T }
const modesOf = (v: unknown): Mode[] => Array.isArray(v) && v.length ? v.map(m => oneOf(m, MODES, 'modes')) : ['normal']

/** POST routes for the memory engine. `backup` is passed in so the specs need no disk. */
export function memRoutes(d: { mem: Mem; backup: () => Promise<void> }) {
  type B = Record<string, any>
  return {
    '/mem/save': async (b: unknown) => {
      const x = b as B
      return { id: await d.mem.save({ text: str(x.text, 'text'), kind: oneOf(x.kind, KINDS, 'kind'), mode: oneOf(x.mode ?? 'normal', MODES, 'mode'), source: String(x.source ?? 'chat'), weight: typeof x.weight === 'number' ? x.weight : undefined }) }
    },
    '/mem/search': async (b: unknown) => {
      const x = b as B
      const hits = await d.mem.search(str(x.q, 'q'), { k: Number(x.k ?? 5), modes: modesOf(x.modes), kinds: Array.isArray(x.kinds) ? x.kinds.map((k: unknown) => oneOf(k, KINDS, 'kinds')) : undefined })
      d.mem.touch(hits.map(h => h.id))
      return { hits }
    },
    '/mem/forget': async (b: unknown) => { d.mem.forget(Number((b as B).id)); return { ok: true } },
    '/mem/about': async (b: unknown) => ({ memories: d.mem.about(str((b as B).topic, 'topic')) }),
    '/mem/backup': async () => { await d.backup(); return { ok: true } },
  }
}
