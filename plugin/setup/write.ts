import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { AWAKE_LABEL, LABEL, SVC_LABEL, appDir, configFile, deskDir, launcherSettingsFile, logsDir, nlkHome, privateDir } from '../hooks/paths.ts'
import { deskClaudeMd } from '../hooks/persona.ts'
import { launcherSettings } from '../hooks/sandbox.ts'
import { parseConfig } from '../hooks/schedule.ts'
import { writeConfig } from './config.ts'
import { ctlScript, plist, runLauncher, sessionScript, svcScript } from './launcher.ts'

const ROOT = new URL('../..', import.meta.url).pathname
const read = (p: string): string | null => {
  try { return readFileSync(p, 'utf8') } catch { return null }
}
const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/'))

function put(path: string, content: string, mode = 0o644): void {
  if (read(path) === content) {
    console.log(`unchanged ${path}`)
    return
  }
  mkdirSync(dirOf(path), { recursive: true })
  writeFileSync(path, content, { mode })
  chmodSync(path, mode)
  console.log(`written ${path}`)
}

function which(name: string): string {
  const r = spawnSync('/usr/bin/which', [name], { encoding: 'utf8' })
  const p = r.stdout.trim()
  if (r.status !== 0 || !p) throw new Error(`${name} is not on PATH`)
  return p
}

/** plugin/app without its tests, to ~/.nlk/app (the service the agent runs; node_modules is installed there by npm ci). */
export function writeApp(repo: string, home: string): void {
  cpSync(`${repo}/plugin/app`, appDir(home), { recursive: true, filter: s => !/\/(test|node_modules)(\/|$)/.test(s) })
  console.log(`written ${appDir(home)}`)
}

/** The two private files, copied from desk/private templates only when missing; the owner's name fills the placeholders. */
export function writeTemplates(repo: string, home: string): void {
  const name = parseConfig(read(configFile(home))).name
  for (const f of ['persona', 'core']) {
    const dest = `${privateDir(home)}/${f}.md`
    if (existsSync(dest)) {
      console.log(`unchanged ${dest}`)
      continue
    }
    let text = read(`${repo}/desk/private/${f}.template.md`) ?? ''
    if (name) text = text.replaceAll('{{OWNER_NAME}}', name).replaceAll('{{NICKNAME_FOR_OWNER}}', name)
    put(dest, text)
  }
}

/** status.ts runs from ~/.nlk/bin, so it keeps working when the repo moves: its imports point at copies beside it. */
export function writeBin(repo: string, home: string): void {
  const bin = `${nlkHome(home)}/bin`
  put(`${bin}/status.ts`, (read(`${repo}/plugin/setup/status.ts`) ?? '').replace("'../hooks/status.ts'", "'./status-lib.ts'"))
  put(`${bin}/status-lib.ts`, read(`${repo}/plugin/hooks/status.ts`) ?? '')
  put(`${bin}/gate.ts`, read(`${repo}/plugin/hooks/gate.ts`) ?? '')
}

export function writeAll(repo: string, home: string, awake: boolean | undefined): void {
  const node = process.execPath
  const claude = which('claude')
  const tmux = which('tmux')
  const nlk = nlkHome(home)
  const agents = `${home}/Library/LaunchAgents`
  mkdirSync(logsDir(home), { recursive: true })

  put(`${nlk}/run.mjs`, runLauncher({ home, node, claude, tmux }))
  put(`${nlk}/session.sh`, sessionScript({ home, node }), 0o755)
  put(`${nlk}/svc.sh`, svcScript({ home, node }), 0o755)
  put(`${nlk}/ctl.sh`, ctlScript({ home, node, tmux }), 0o755)
  put(launcherSettingsFile(home), launcherSettings({ home, uid: process.getuid() }))
  put(`${agents}/${LABEL}.plist`, plist({ label: LABEL, args: [`${nlk}/session.sh`], keepAlive: true, log: `${logsDir(home)}/session.log` }))
  put(`${agents}/${SVC_LABEL}.plist`, plist({ label: SVC_LABEL, args: [`${nlk}/svc.sh`], keepAlive: true, log: `${logsDir(home)}/svc.log` }))
  if (awake ?? parseConfig(read(configFile(home))).awake) put(`${agents}/${AWAKE_LABEL}.plist`, plist({ label: AWAKE_LABEL, args: ['/usr/bin/caffeinate', '-s'], keepAlive: true }))
  writeApp(repo, home)
  writeBin(repo, home)
  writeTemplates(repo, home)
  put(`${deskDir(home)}/CLAUDE.md`, deskClaudeMd())

  const tested = read(`${repo}/TESTED_CLAUDE`)?.trim()
  if (tested) put(configFile(home), writeConfig(parseConfig(read(configFile(home))), { testedClaude: tested }))
}

// `node write.ts app|templates|all` (HOME from the environment).
if (import.meta.main) {
  const home = process.env.HOME ?? ''
  if (!home) throw new Error('HOME is not set')
  const cmd = process.argv[2]
  if (cmd === 'app') writeApp(ROOT.replace(/\/$/, ''), home)
  else if (cmd === 'templates') writeTemplates(ROOT.replace(/\/$/, ''), home)
  else if (cmd === 'all') writeAll(ROOT.replace(/\/$/, ''), home, undefined)
  else {
    console.error('usage: write.ts app|templates|all')
    process.exit(2)
  }
}
