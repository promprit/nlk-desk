import { mkdir, readFile, writeFile } from 'node:fs/promises'

type Fetch = typeof fetch
type Place = { name: string; lat: number; lon: number }
type Routes = Record<string, (body: unknown) => Promise<unknown>>

export type Forecast = { now: number; high: number; low: number; hours: { hour: string; prob: number; mm: number; uv: number }[]; pm25: number[] }

const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const GEO = 'https://geocoding-api.open-meteo.com/v1/search'
// The default is plain Bangkok; the owner's own place is set by chat and stays in `<dir>/location.json`.
const BANGKOK: Place = { name: 'Bangkok', lat: 13.7563, lon: 100.5018 }

async function getJson(f: Fetch, url: string): Promise<any> {
  const r = await f(url).catch(() => null)
  if (!r || !r.ok) throw new Error(`weather service unavailable (${r ? r.status : 'network'})`)
  return r.json()
}

const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : [])

/** Today's weather from Open-Meteo, hour by hour in `tz`. Air quality is optional: without it pm25 is empty. */
export async function forecast(f: Fetch, o: { lat: number; lon: number; tz: string }): Promise<Forecast> {
  const where = `latitude=${o.lat}&longitude=${o.lon}&timezone=${encodeURIComponent(o.tz)}&forecast_days=1`
  const w = await getJson(f, `${FORECAST}?${where}&current=temperature_2m&daily=temperature_2m_max,temperature_2m_min&hourly=precipitation_probability,precipitation,uv_index`)
  const air = await getJson(f, `${AIR}?${where}&hourly=pm2_5`).catch(() => null)
  const h = w.hourly ?? {}
  const times: string[] = Array.isArray(h.time) ? h.time : []
  const [prob, mm, uv] = [nums(h.precipitation_probability), nums(h.precipitation), nums(h.uv_index)]
  return {
    now: Number(w.current?.temperature_2m),
    high: Number(w.daily?.temperature_2m_max?.[0]),
    low: Number(w.daily?.temperature_2m_min?.[0]),
    hours: times.map((t, i) => ({ hour: `${t.slice(11, 13)}:00`, prob: prob[i] ?? 0, mm: mm[i] ?? 0, uv: uv[i] ?? 0 })),
    pm25: nums(air?.hourly?.pm2_5).filter(Number.isFinite),
  }
}

/** What to carry: umbrella from 30%, rain jacket above 60% or any hour of 5 mm; a mask over 37.5 ug/m3 PM2.5; sunscreen from UV 8. */
export function advice(f: Forecast): { rain: 'none' | 'umbrella' | 'rain jacket'; rainWindow: string | null; mask: boolean; sunscreen: boolean; pm25Max: number | null; uvMax: number } {
  const maxProb = Math.max(0, ...f.hours.map(x => x.prob))
  const wet = f.hours.filter(x => x.prob >= 30)
  const first = wet[0]
  const last = wet[wet.length - 1]
  const rain = maxProb > 60 || f.hours.some(x => x.mm >= 5) ? 'rain jacket' : maxProb >= 30 ? 'umbrella' : 'none'
  const pm25Max = f.pm25.length ? Math.max(...f.pm25) : null
  const uvMax = Math.max(0, ...f.hours.map(x => x.uv))
  return { rain, rainWindow: first && last ? (first.hour === last.hour ? first.hour : `${first.hour}-${last.hour}`) : null, mask: pm25Max !== null && pm25Max > 37.5, sunscreen: uvMax >= 8, pm25Max, uvMax }
}

export async function geocode(f: Fetch, name: string): Promise<Place | null> {
  const j = await getJson(f, `${GEO}?name=${encodeURIComponent(name)}&count=1`)
  const r = j.results?.[0]
  return r ? { name: String(r.name), lat: Number(r.latitude), lon: Number(r.longitude) } : null
}

/** /weather {place?} and /weather/place {name}; the saved place is `<dir>/location.json`. */
export function weatherRoutes(o: { dir: string; fetch: Fetch }): Routes {
  const file = `${o.dir}/location.json`
  const saved = async (): Promise<Place> => {
    try {
      const p = JSON.parse(await readFile(file, 'utf8'))
      return Number.isFinite(p.lat) && Number.isFinite(p.lon) ? { name: String(p.name ?? 'here'), lat: p.lat, lon: p.lon } : BANGKOK
    } catch {
      return BANGKOK
    }
  }
  const find = async (name: string): Promise<Place> => {
    const p = await geocode(o.fetch, name)
    if (!p) throw new Error(`I could not find ${name}`)
    return p
  }
  return {
    '/weather': async body => {
      const name = (body as { place?: unknown } | null)?.place
      const p = typeof name === 'string' && name.trim() ? await find(name.trim()) : await saved()
      const f = await forecast(o.fetch, { lat: p.lat, lon: p.lon, tz: 'Asia/Bangkok' })
      const a = advice(f)
      return { place: p.name, now: f.now, high: f.high, low: f.low, rainWindow: a.rainWindow, advice: [...(a.rain === 'none' ? [] : [a.rain]), ...(a.mask ? ['mask'] : []), ...(a.sunscreen ? ['sunscreen'] : [])], pm25Max: a.pm25Max, uvMax: a.uvMax }
    },
    '/weather/place': async body => {
      const name = (body as { name?: unknown } | null)?.name
      if (typeof name !== 'string' || !name.trim()) throw new Error('name is required')
      const p = await find(name.trim())
      await mkdir(o.dir, { recursive: true })
      await writeFile(file, JSON.stringify(p))
      return { place: p.name }
    },
  }
}
