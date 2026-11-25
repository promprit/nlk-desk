import { parseStyle, type Style } from './style.ts'

const BRIEF_WINDOW = 3 * 60
const HOUR = 3600_000
const DAY = 24 * HOUR
const BANGKOK_MS = 7 * HOUR

export type Reminder = { id: string; text: string; at: number; every?: 'day' | 'week' | 'month' }
export type WorkerPending = { kind: 'brief'; at: number }
export type Schedule = { briefDate?: string; reminders: Reminder[]; lastCheckAt?: number; briefRetry?: string; briefFailAt?: number; lastWorkerError?: string; workerPending?: WorkerPending }
export type Config = { name?: string; city?: { name: string; lat: number; lon: number }; brief?: { on: boolean; at: string }; awake?: boolean; tools?: { allow?: string[] }; testedClaude?: string; style?: Style }

export function bangkok(now: number): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now))
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

export const quiet = (minutes: number): boolean => minutes >= 23 * 60 || minutes < 8 * 60

const clock = (s: unknown): number | null => {
  const m = typeof s === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s) : null
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** ~/.nlk/config.json; a missing or damaged file, or a field of the wrong shape, is left out. */
export function parseConfig(text: string | null): Config {
  try {
    const j = JSON.parse(text ?? '')
    const c: Config = {}
    if (typeof j.name === 'string') c.name = j.name
    const city = j.city
    if (typeof city?.name === 'string' && Number.isFinite(city.lat) && Number.isFinite(city.lon)) c.city = { name: city.name, lat: city.lat, lon: city.lon }
    if (typeof j.brief?.on === 'boolean' && clock(j.brief.at) !== null) c.brief = { on: j.brief.on, at: j.brief.at }
    if (typeof j.awake === 'boolean') c.awake = j.awake
    if (Array.isArray(j.tools?.allow)) c.tools = { allow: j.tools.allow.filter((t: unknown) => typeof t === 'string') }
    if (typeof j.testedClaude === 'string') c.testedClaude = j.testedClaude
    const st = parseStyle(j.style)
    if (Object.keys(st).length) c.style = st
    return c
  } catch {
    return {}
  }
}

/** What the ticker should do now. The brief is off unless the config turns it on: once a day from its time for 3 hours, never in the late quiet hours (from 23:00).
 * The time is the owner's choice, so an early one (07:30) is honoured. */
export function due(now: number, s: Schedule, config: Config): { brief: boolean; reminders: Reminder[] } {
  const b = bangkok(now)
  const from = config.brief?.on ? clock(config.brief.at) : null
  return {
    brief: from !== null && s.briefDate !== b.date && b.minutes < 23 * 60 && b.minutes >= from && b.minutes < from + BRIEF_WINDOW,
    reminders: s.reminders.filter(r => r.at <= now),
  }
}

function step(at: number, every: 'day' | 'week' | 'month'): number {
  if (every !== 'month') return at + (every === 'day' ? DAY : 7 * DAY)
  const d = new Date(at + BANGKOK_MS)
  d.setUTCMonth(d.getUTCMonth() + 1)
  return d.getTime() - BANGKOK_MS
}

/** The reminder after it fires: a repeating one moves to its next time after now; a one-off is gone. */
export function next(r: Reminder, now: number): Reminder | null {
  if (!r.every) return null
  let at = r.at
  while (at <= now) at = step(at, r.every)
  return { ...r, at }
}

/** ~/.nlk/schedule.json; a missing or damaged file is an empty schedule. */
export function parseSchedule(text: unknown): Schedule {
  try {
    const j = JSON.parse(typeof text === 'string' ? text : '')
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    return {
      reminders: Array.isArray(j.reminders) ? j.reminders.filter((r: Reminder) => typeof r?.id === 'string' && typeof r.text === 'string' && Number.isFinite(r.at)) : [],
      ...(typeof j.briefDate === 'string' ? { briefDate: j.briefDate } : {}),
      ...(num(j.lastCheckAt) === undefined ? {} : { lastCheckAt: j.lastCheckAt }),
      ...(typeof j.briefRetry === 'string' ? { briefRetry: j.briefRetry } : {}),
      ...(num(j.briefFailAt) === undefined ? {} : { briefFailAt: j.briefFailAt }),
      ...(typeof j.lastWorkerError === 'string' ? { lastWorkerError: j.lastWorkerError } : {}),
      ...(j.workerPending?.kind === 'brief' && num(j.workerPending.at) !== undefined ? { workerPending: { kind: 'brief' as const, at: j.workerPending.at } } : {}),
    }
  } catch {
    return { reminders: [] }
  }
}

/** A remind tool call as a reminder, or the reason it is not one. */
export function reminderFrom(input: Record<string, unknown>, id: string): Reminder | string {
  const { text, at, every } = input
  if (typeof text !== 'string' || !text.trim()) return 'remind needs text'
  if (typeof at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(at) || !Number.isFinite(Date.parse(`${at}:00+07:00`))) return 'remind needs at as YYYY-MM-DDTHH:MM in Bangkok time'
  if (every !== undefined && every !== 'day' && every !== 'week' && every !== 'month') return 'every must be day, week or month'
  return { id, text: text.trim(), at: Date.parse(`${at}:00+07:00`), ...(every ? { every } : {}) }
}

export const REMIND_SPEC = {
  name: 'remind',
  description: 'Set a reminder for the owner. at is a date and time in Bangkok time as YYYY-MM-DDTHH:MM; every repeats it daily, weekly or monthly.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'what to remind the owner of' },
      at: { type: 'string', description: 'YYYY-MM-DDTHH:MM, Bangkok time' },
      every: { type: 'string', enum: ['day', 'week', 'month'] },
    },
    required: ['text', 'at'],
  },
  isDeferred: false,
} as const

export const BRIEF_PROMPT = '[nlk:brief] Write today\'s short morning message for the owner: the weather for their city (use weather_today), any reminders due today, and one friendly line. Thai or English as the owner usually writes. 3–6 short lines.'
