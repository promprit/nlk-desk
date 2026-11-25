import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')

function pairAgainBullet(): string {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8')
  const line = readme.split('\n').find((l) => l.startsWith('- **Pair again**'))
  assert.ok(line, 'README has a "Pair again" troubleshooting bullet')
  return line
}

test('Pair again stops NLK before deleting access.json', () => {
  const bullet = pairAgainBullet()
  const stop = bullet.indexOf('./nlk stop')
  const access = bullet.indexOf('access.json')
  assert.ok(stop >= 0, 'Pair again bullet tells the user to run ./nlk stop')
  assert.ok(access >= 0, 'Pair again bullet mentions access.json')
  assert.ok(stop < access, 'the ./nlk stop step comes before the access.json deletion')
})

test('Pair again restarts NLK with ./install.sh after the deletion', () => {
  const bullet = pairAgainBullet()
  const access = bullet.indexOf('access.json')
  const install = bullet.indexOf('./install.sh')
  assert.ok(install > access, './install.sh comes after the access.json deletion')
})
