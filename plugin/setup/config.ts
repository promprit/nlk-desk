import { readFileSync } from 'node:fs'
import { parseConfig, type Config } from '../hooks/schedule.ts'

export const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/
export const envFile = (token: string): string => `TELEGRAM_BOT_TOKEN=${token}\n`

export type Answers = { name?: string; city?: { name: string; lat: number; lon: number }; brief?: { on: boolean; at: string }; awake?: boolean; testedClaude?: string }

/** ~/.nlk/config.json: the owner's answers laid over what the file already holds (tools.allow stays). */
export function writeConfig(prev: Config | null, a: Answers): string {
  const next: Config = { ...(prev ?? {}) }
  if (a.name) next.name = a.name
  if (a.city) next.city = a.city
  if (a.brief) next.brief = a.brief
  if (a.awake !== undefined) next.awake = a.awake
  if (a.testedClaude) next.testedClaude = a.testedClaude
  return `${JSON.stringify(next, null, 2)}\n`
}

// CLI for install.sh:
// `node config.ts write <configFile> <name> <city> <lat> <lon> <on|off> <HH:MM> <yes|no>` prints the new config text.
// (The token never goes through argv: install.sh checks it against TOKEN_RE's pattern and writes the .env itself.)
if (import.meta.main) {
  const [cmd = '', ...rest] = process.argv.slice(2)
  if (cmd === 'write') {
    const [file = '', name = '', city = '', lat = '', lon = '', brief = 'off', at = '08:30', awake = 'no'] = rest
    let prev: string | null = null
    try { prev = readFileSync(file, 'utf8') } catch {}
    const answers: Answers = { name, awake: awake === 'yes', brief: { on: brief === 'on', at } }
    if (city && lat !== '' && lon !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) answers.city = { name: city, lat: Number(lat), lon: Number(lon) }
    process.stdout.write(writeConfig(parseConfig(prev), answers))
  }
}
