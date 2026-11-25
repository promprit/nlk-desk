import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const REPO = path.resolve(import.meta.dirname, '..')
const STUBS = path.join(REPO, 'tests', 'stubs')
const TOKEN = '123456789:AbCdEfGhIjKlMnOpQrStUvWxYz012345678'

type Opts = { args?: string[]; env?: Record<string, string>; stubs?: string; pathTail?: string }

function run(home: string, script: string, answers: string[], o: Opts = {}) {
  return spawnSync('bash', [path.join(REPO, script), ...(o.args ?? [])], {
    cwd: REPO,
    input: answers.join('\n') + '\n',
    encoding: 'utf8',
    env: {
      ...process.env, HOME: home, NLK_TOKEN: TOKEN, NLK_WAIT_CHANNELS: '0', NLK_WAIT_STATUS: '0',
      PATH: `${o.stubs ?? STUBS}:${o.pathTail ?? process.env.PATH}`, ...o.env,
    },
  })
}

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nlk-home-'))
// pairing "Is this you?", name, city, brief, awake, open editor
const ANSWERS = ['y', 'Test', 'Bangkok', 'n', 'n', 'n']
const install = (home: string, answers = ANSWERS) => {
  const r = run(home, 'install.sh', answers)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  return r
}
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]))
const agents = (home: string) => path.join(home, 'Library/LaunchAgents')
const log = (home: string) => fs.readFileSync(path.join(home, 'stub.log'), 'utf8')

test('fresh install writes everything under ~/.nlk', () => {
  const home = tmpHome()
  install(home)
  for (const f of ['settings.json', 'app/server.ts', 'desk/CLAUDE.md', 'desk/private/persona.md', 'config.json', 'svc.token']) {
    // svc.token is made by the service on its first start; the installer only makes its folder ready.
    if (f === 'svc.token') continue
    assert.ok(fs.existsSync(path.join(home, '.nlk', f)), `${f} missing`)
  }
  assert.ok(fs.existsSync(path.join(agents(home), 'com.nlk.session.plist')))
  assert.ok(fs.existsSync(path.join(agents(home), 'com.nlk.svc.plist')))
  assert.ok(!fs.existsSync(path.join(home, '.claude')))
  assert.match(fs.readFileSync(path.join(home, '.nlk/desk/private/persona.md'), 'utf8'), /Test/)
})

test('agents point into ~/.nlk only', () => {
  const home = tmpHome()
  install(home)
  for (const l of ['session', 'svc']) {
    const text = fs.readFileSync(path.join(agents(home), `com.nlk.${l}.plist`), 'utf8')
    const paths = [...text.matchAll(/<string>(\/[^<]*)<\/string>/g)].map(m => m[1] ?? '')
    assert.ok(paths.length > 0)
    for (const p of paths) assert.ok(p.startsWith(path.join(home, '.nlk')), `${p} is outside ~/.nlk`)
  }
})

test('token saved only to the channel .env, mode 600', () => {
  const home = tmpHome()
  install(home)
  const env = path.join(home, '.nlk/claude/channels/telegram-nlk/.env')
  assert.equal(fs.statSync(env).mode & 0o777, 0o600)
  assert.match(fs.readFileSync(env, 'utf8'), /^TELEGRAM_BOT_TOKEN=/)
  for (const f of files(home)) {
    if (f === env) continue
    assert.ok(!fs.readFileSync(f).includes(TOKEN), `token found in ${f}`)
  }
})

test('pairing allowlists exactly the confirmed sender', () => {
  const home = tmpHome()
  install(home)
  const access = JSON.parse(fs.readFileSync(path.join(home, '.nlk/claude/channels/telegram-nlk/access.json'), 'utf8'))
  assert.equal(access.dmPolicy, 'allowlist')
  assert.deepEqual(access.allowFrom, ['111'])

  const other = tmpHome()
  const r = run(other, 'install.sh', ['n'])
  assert.notEqual(r.status, 0)
  assert.match(r.stdout + r.stderr, /Not paired/)
  assert.ok(!fs.existsSync(path.join(other, '.nlk/claude/channels/telegram-nlk/access.json')))
})

test('second run skips done steps', () => {
  const home = tmpHome()
  install(home)
  const plist = path.join(agents(home), 'com.nlk.session.plist')
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

test('keep-awake only when chosen', () => {
  const yes = tmpHome()
  install(yes, ['y', 'Test', 'Bangkok', 'n', 'y', 'n'])
  const awake = fs.readFileSync(path.join(agents(yes), 'com.nlk.awake.plist'), 'utf8')
  assert.match(awake, /caffeinate/)
  assert.match(awake, /<string>-s<\/string>/)
  const no = tmpHome()
  install(no)
  assert.ok(!fs.existsSync(path.join(agents(no), 'com.nlk.awake.plist')))
})

test('missing prerequisite asks before brew', () => {
  const home = tmpHome()
  // a PATH with the stubs but no tmux: stubs copied without tmux, node linked alone, no Homebrew dir
  const stubs = fs.mkdtempSync(path.join(os.tmpdir(), 'nlk-stubs-'))
  for (const f of fs.readdirSync(STUBS)) if (f !== 'tmux') fs.copyFileSync(path.join(STUBS, f), path.join(stubs, f))
  for (const f of fs.readdirSync(stubs)) fs.chmodSync(path.join(stubs, f), 0o755)
  const nodeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'nlk-node-'))
  fs.symlinkSync(process.execPath, path.join(nodeBin, 'node'))
  const r = run(home, 'install.sh', ['n'], { stubs, pathTail: `${nodeBin}:/usr/bin:/bin` })
  assert.notEqual(r.status, 0)
  assert.match(r.stdout, /brew install tmux/)
  assert.ok(!fs.existsSync(path.join(home, 'stub.log')) || !/^brew /m.test(log(home)))
})

test('nlk backup copies memory and config', () => {
  const home = tmpHome()
  install(home)
  fs.writeFileSync(path.join(home, '.nlk/memory/m.db'), 'data')
  const r = run(home, 'nlk', [], { args: ['backup'] })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const [dir] = fs.readdirSync(path.join(home, 'NLK-backups'))
  assert.match(dir ?? '', /^\d{4}-\d{2}-\d{2}-\d{4}$/)
  assert.ok(fs.existsSync(path.join(home, 'NLK-backups', dir ?? '', 'memory/m.db')))
  assert.ok(fs.existsSync(path.join(home, 'NLK-backups', dir ?? '', 'config.json')))
})

test('uninstall leaves nothing but backups', () => {
  const home = tmpHome()
  install(home)
  const r = run(home, 'uninstall.sh', ['y', 'y'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(fs.readdirSync(agents(home)).filter(f => f.startsWith('com.nlk.')), [])
  assert.ok(!fs.existsSync(path.join(home, '.nlk')))
  assert.ok(fs.existsSync(path.join(home, 'NLK-backups')))
  for (const l of ['session', 'svc', 'awake']) assert.match(log(home), new RegExp(`launchctl bootout gui/\\d+/com\\.nlk\\.${l}`))
  assert.match(r.stdout.trimEnd().split('\n').at(-1) ?? '', /revoke its token in BotFather \(\/revoke\)\.$/)
})

test('nlk status warns on newer Claude Code', () => {
  const home = tmpHome()
  install(home)
  const cfg = path.join(home, '.nlk/config.json')
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), testedClaude: '2.2.0' }))
  const r = run(home, 'nlk', [], { args: ['status'], env: { STUB_CLAUDE_VERSION: '2.3.0' } })
  assert.match(r.stdout, /newer than tested/)
})

test('nlk status works after the repo folder moves', () => {
  const home = tmpHome()
  const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'nlk-repo-'))
  const copy = path.join(moved, 'moved-repo')
  fs.cpSync(REPO, copy, { recursive: true, filter: s => !/(^|\/)(\.git|node_modules|\.claude|\.orchestrate)(\/|$)/.test(path.relative(REPO, s)) })
  const r1 = spawnSync('bash', [path.join(copy, 'install.sh')], {
    cwd: copy, input: ANSWERS.join('\n') + '\n', encoding: 'utf8',
    env: { ...process.env, HOME: home, NLK_TOKEN: TOKEN, NLK_WAIT_CHANNELS: '0', NLK_WAIT_STATUS: '0', PATH: `${STUBS}:${process.env.PATH}` },
  })
  assert.equal(r1.status, 0, r1.stdout + r1.stderr)
  fs.renameSync(copy, path.join(moved, 'renamed-repo'))
  const r = spawnSync('bash', [path.join(moved, 'renamed-repo', 'nlk'), 'status'], {
    encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${STUBS}:${process.env.PATH}` },
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /NLK is not running/)
})
