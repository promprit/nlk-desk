// Leak check by hash: the repo stores only sha256 hashes of forbidden words, never the words.
// `node tools/leak-hashes.mjs build` reads ~/.dryas/nlk-leak-words.txt and writes tests/leak-hashes.json.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HASHES_FILE = 'tests/leak-hashes.json'
const WORDS_FILE = join(homedir(), '.dryas', 'nlk-leak-words.txt')
const SPLIT = /[^\p{L}\p{N}@._/-]+/u

const norm = s => s.toLowerCase().normalize('NFC').trim().replace(/\s+/g, ' ')

export const hashWord = s => createHash('sha256').update(norm(s)).digest('hex')

const tokens = line => line.split(SPLIT).map(t => t.replace(/[.,]+$/, '')).filter(Boolean)

/** One `{ path, line }` per line that holds a hashed word, a 2-4 token run, or is one as a whole. */
export function scan(files, hashes) {
  const hits = []
  for (const { path, text } of files) {
    text.split('\n').forEach((raw, i) => {
      const toks = tokens(raw)
      const candidates = [raw.trim()]
      for (let a = 0; a < toks.length; a++)
        for (let n = 1; n <= 4 && a + n <= toks.length; n++) candidates.push(toks.slice(a, a + n).join(' '))
      if (candidates.some(c => c && hashes.has(hashWord(c)))) hits.push({ path, line: i + 1 })
    })
  }
  return hits
}

/** Tracked text files: skips the hash file, files over 1 MB and files with a NUL byte. */
export function repoFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  const files = []
  for (const path of out.split('\0').filter(Boolean)) {
    if (path === HASHES_FILE) continue
    const full = join(ROOT, path)
    let st
    try { st = statSync(full) } catch { continue }
    if (!st.isFile() || st.size > 1024 * 1024) continue
    const buf = readFileSync(full)
    if (buf.includes(0)) continue
    files.push({ path, text: buf.toString('utf8') })
  }
  return files
}

export function loadHashes() {
  return new Set(JSON.parse(readFileSync(join(ROOT, HASHES_FILE), 'utf8')).sha256)
}

function build() {
  const words = readFileSync(WORDS_FILE, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  const sha256 = [...new Set(words.map(hashWord))].sort()
  writeFileSync(join(ROOT, HASHES_FILE), `${JSON.stringify({ sha256 }, null, 2)}\n`)
  console.log(`${HASHES_FILE} written, ${sha256.length} hashes`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv[2] === 'build') build()
