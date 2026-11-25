import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { parseStatus, statusReport } from '../hooks/status.ts'

// `nlk status`: the same report the Telegram status command gives, read from the files in ~/.nlk.
// write.ts copies this file to ~/.nlk/bin with the import above pointed at ./status-lib.ts.
const home = process.env.HOME ?? ''
const read = (f: string): string | null => {
  try { return readFileSync(f, 'utf8') } catch { return null }
}
let tested: string | undefined
try {
  const t = JSON.parse(read(`${home}/.nlk/config.json`) ?? '').testedClaude
  if (typeof t === 'string') tested = t
} catch {}
const now = Date.now()
const report = statusReport(parseStatus(read(`${home}/.nlk/status.json`)), now, tested)
console.log(report)
// The Claude Code version check also works while NLK is down: ask the installed one.
if (!report.includes('Claude Code')) {
  const installed = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim().split(' ')[0]
  if (installed) {
    const line = statusReport({ at: now, gate: 'open', reason: null, claude: installed }, now, tested).split('\n').find(l => l.startsWith('Claude Code'))
    if (line) console.log(line)
  }
}
