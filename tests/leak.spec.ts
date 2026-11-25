import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scan, hashWord, repoFiles, loadHashes } from '../tools/leak-hashes.mjs'

test('flags a forbidden word without printing it', () => {
  const hashes = new Set([hashWord('secretname')])
  const hits = scan([{ path: 'a.md', text: 'hello\nmy SecretName here' }], hashes)
  assert.deepEqual(hits, [{ path: 'a.md', line: 2 }])
  assert.ok(!JSON.stringify(hits).toLowerCase().includes('secretname'))
})

test('matches 2-4 word runs', () => {
  const hashes = new Set([hashWord('blue harbor')])
  assert.equal(scan([{ path: 'b', text: 'the Blue  Harbor folder' }], hashes).length, 1)
})

test('repo is clean', () => {
  // tracked files via `git ls-files`, skipping tests/leak-hashes.json and binary files
  const hits = scan(repoFiles(), loadHashes())
  assert.deepEqual(hits, [])
})

test('plain words file never inside the repo', () => {
  assert.ok(!repoFiles().some((f: { path: string }) => f.path.endsWith('nlk-leak-words.txt')))
})
