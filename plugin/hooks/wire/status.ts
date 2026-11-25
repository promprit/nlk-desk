import { atom, read, update } from 'claude-code'
import * as P from '../paths.ts'
import { homeOf, isHost, refreshDeskClaudeMd, type Engine } from '../engine.ts'
import { openOrMute, staticCheck } from '../gate.ts'
import { pollerOwner, telegramHealth, type Channel } from '../channels.ts'
import type { StatusFile } from '../status.ts'
import { healStep, RECONNECT, type HealState } from '../tgheal.ts'
import { registerMemTools } from './mem.ts'
import { registerWeatherTools } from './weather.ts'
import { registerScheduleTools, resetTicker, tick } from './schedule.ts'
import type { Ctx, On } from './ctx.ts'

const gateAtom = atom({ plugin: 'nlk', key: 'gate' } as const, null)

let telegram: Channel | undefined
let hostStartedAt = 0
let claudeVersion: string | undefined
let heal: HealState = {}
const hostTimers: { cancel(): void }[] = []

async function writeStatus($: Engine) {
  const g = await read($, gateAtom)
  const now = await $.clock.now()
  const s: StatusFile = {
    at: now,
    gate: g?.phase ?? 'checking',
    reason: g?.reason ?? null,
    ...(telegram ? { channels: { telegram } } : {}),
    ...(claudeVersion ? { claude: claudeVersion } : {}),
  }
  await $.fs.write(P.statusFile(await homeOf($)), JSON.stringify(s))
}

// The Telegram connection: its own poller (its tmux server is the poller's ancestor) and a Bot API getMe.
// The token stays in this function; only ok, at and a reason reach status.json.
async function channelTick($: Engine) {
  const tg = P.telegramState(await homeOf($))
  const pid = Number((await $.fs.read(`${tg}/bot.pid`).then(String).catch(() => '')).trim()) || null
  const server = Number((await $.process.run(['tmux', '-L', P.TMUX_SOCKET, 'display-message', '-p', '#{pid}']).catch(() => null))?.stdout.trim()) || null
  const ps = (await $.process.run(['ps', '-axo', 'pid=,ppid=']).catch(() => null))?.stdout ?? ''
  const token = /^TELEGRAM_BOT_TOKEN=(\S+)$/m.exec(await $.fs.read(`${tg}/.env`).then(String).catch(() => ''))?.[1]
  const api = token ? await $.http.fetch(`https://api.telegram.org/bot${token}/getMe`).then(r => r.status, () => 'network' as const) : 401
  const now = await $.clock.now()
  telegram = telegramHealth({ now, poller: pollerOwner(ps, pid, server), api, sinceStart: now - hostStartedAt }) ?? undefined
  await reconnectIfMissing($, now)
}

// The Telegram server sometimes never starts after a restart: type the reconnect into its own pane, once per outage.
async function reconnectIfMissing($: Engine, now: number) {
  const pane = telegram?.reason === 'stopped' ? (await $.process.run(['tmux', '-L', P.TMUX_SOCKET, 'capture-pane', '-p', '-t', P.TMUX_SESSION, '-S', '-30']).catch(() => null))?.stdout ?? null : null
  const r = healStep(heal, { now, telegram: telegram ?? null, sessionAgeMs: now - hostStartedAt, pane })
  heal = r.state
  if (!r.reconnect) return
  const keys = (...k: string[]) => $.process.run(['tmux', '-L', P.TMUX_SOCKET, 'send-keys', '-t', P.TMUX_SESSION, ...k]).catch(() => {})
  await keys('-l', RECONNECT)
  await keys('Enter')
}

async function heartbeat($: Engine) {
  await channelTick($).catch(() => {})
  await writeStatus($)
}

async function startHost($: Engine, cwd: string) {
  const now = await $.clock.now()
  hostStartedAt = now
  telegram = undefined
  heal = {}
  claudeVersion = await $.session.version().then(v => v.base ?? v.version, () => undefined)
  await $.process.run(['mkdir', '-p', P.nlkHome(await homeOf($))])
  await openGate($, cwd, now)
  await heartbeat($)
  hostTimers.push($.clock.every(60_000, () => void heartbeat($).catch(() => {})))
  resetTicker()
  hostTimers.push($.clock.every(60_000, () => void tick($).catch(() => {})))
}

async function openGate($: Engine, cwd: string, now: number) {
  const reason = staticCheck({ configDir: await $.env.get('CLAUDE_CONFIG_DIR'), home: await $.env.get('HOME'), cwd })
  await update($, gateAtom, () => openOrMute(reason, now))
}

// Called for the host session in the desk folder.
async function registerAll($: Engine) {
  await registerMemTools($).catch(() => {})
  await registerWeatherTools($).catch(() => {})
  await registerScheduleTools($).catch(() => {})
}

// The host session: the gate and a status.json heartbeat with the channel report, every minute.
export function wireStatus(on: On, _ctx: Ctx) {
  on('session.start', async ($, e, next) => {
    for (const t of hostTimers.splice(0)) t.cancel()
    if (await isHost($)) {
      await startHost($, e.cwd).catch(() => {})
      if (e.cwd === P.deskDir(await homeOf($))) {
        await registerAll($)
        // After the tools: a lock wait here must never delay them.
        await refreshDeskClaudeMd($).catch(() => {})
      }
    }
    return next(e)
  })
}
