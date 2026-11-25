import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const REPO = path.resolve(import.meta.dirname, '..')

test('no sed backup *-E file is untracked', () => {
  const r = spawnSync('git', ['status', '--short', '--ignored'], { cwd: REPO, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const stray = r.stdout.split('\n').filter((l) => l.startsWith('?? ') && l.endsWith('-E'))
  assert.deepEqual(stray, [])
})

test('.gitignore ignores *-E', () => {
  const r = spawnSync('git', ['check-ignore', '-q', 'plugin/hooks/x.ts-E'], { cwd: REPO })
  assert.equal(r.status, 0)
})
