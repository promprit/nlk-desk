import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const REPO = path.resolve(import.meta.dirname, '..')
const TOKEN = '123456789:AbCdEfGhIjKlMnOpQrStUvWxYz012345678'

function run(home: string, script: string, answers: string[]) {
  const stubs = path.join(REPO, 'tests', 'stubs')
  return spawnSync('bash', [path.join(REPO, script)], {
    cwd: REPO,
    input: answers.join('\n') + '\n',
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${stubs}:${process.env.PATH}`, NLK_TOKEN: TOKEN },
  })
}

// answers: pairing "Is this you?", name, city, brief, awake, open editor
const ANSWERS = ['y', 'Test', 'Bangkok', 'n', 'n', 'n']

test('second run skips done steps', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nlk-home-'))
  const first = run(home, 'install.sh', ANSWERS)
  assert.equal(first.status, 0, first.stdout + first.stderr)
  const plist = path.join(home, 'Library/LaunchAgents/com.nlk.session.plist')
  const persona = path.join(home, '.nlk/desk/private/persona.md')
  const mtime = fs.statSync(plist).mtimeMs
  fs.writeFileSync(persona, 'edited by owner\n')
  const second = run(home, 'install.sh', [])
  assert.equal(second.status, 0, second.stdout + second.stderr)
  for (const step of ['login', 'token', 'pairing', 'persona']) {
    assert.match(second.stdout, new RegExp(`skip ${step}`), `no "skip ${step}" in output`)
  }
  assert.equal(fs.statSync(plist).mtimeMs, mtime)
  assert.equal(fs.readFileSync(persona, 'utf8'), 'edited by owner\n')
})
