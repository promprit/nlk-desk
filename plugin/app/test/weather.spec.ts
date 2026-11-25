import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { advice, forecast, geocode, weatherRoutes, type Forecast } from '../weather.ts'

// Open-Meteo shapes (no key): forecast {current:{temperature_2m}, daily:{temperature_2m_max,temperature_2m_min}, hourly:{time,precipitation_probability,precipitation,uv_index}},
// air quality {hourly:{time,pm2_5}}, geocoding {results:[{name,latitude,longitude}]}.
const times = Array.from({ length: 24 }, (_, h) => `2026-10-21T${String(h).padStart(2, '0')}:00`)
const day = (fill: (h: number) => number) => times.map((_, h) => fill(h))

type Plan = { prob?: (h: number) => number; mm?: (h: number) => number; uv?: (h: number) => number; pm?: (h: number) => number; down?: boolean }

async function fake(plan: Plan = {}) {
  const hits: string[] = []
  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    hits.push(`${url.pathname}?${url.searchParams.toString()}`)
    if (plan.down) { res.statusCode = 503; return res.end('down') }
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/v1/forecast') {
      return res.end(JSON.stringify({
        current: { temperature_2m: 31.4 },
        daily: { temperature_2m_max: [34.1], temperature_2m_min: [26.2] },
        hourly: { time: times, precipitation_probability: day(plan.prob ?? (() => 0)), precipitation: day(plan.mm ?? (() => 0)), uv_index: day(plan.uv ?? (() => 1)) },
      }))
    }
    if (url.pathname === '/v1/air-quality') return res.end(JSON.stringify({ hourly: { time: times, pm2_5: day(plan.pm ?? (() => 10)) } }))
    if (url.pathname === '/v1/search') {
      const name = url.searchParams.get('name')
      const known: Record<string, [number, number]> = { 'Chiang Mai': [18.7883, 98.9853], Phuket: [7.8804, 98.3923] }
      const at = known[name ?? '']
      return res.end(JSON.stringify(at ? { results: [{ name, latitude: at[0], longitude: at[1] }] } : {}))
    }
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
  const f: typeof fetch = (input, init) =>
    fetch(String(input).replace(/^https:\/\/[a-z-]*\.?open-meteo\.com/, base), init)
  return { hits, f, close: () => new Promise<void>(r => { srv.close(() => r()); srv.closeAllConnections() }) }
}

const BKK = { lat: 13.7563, lon: 100.5018, tz: 'Asia/Bangkok' }
const adviceFor = async (plan: Plan) => {
  const s = await fake(plan)
  try { return advice(await forecast(s.f, BKK)) } finally { await s.close() }
}

test('advice says umbrella at 45%', async () => {
  assert.equal((await adviceFor({ prob: h => (h === 15 ? 45 : 5) })).rain, 'umbrella')
})

test('rain jacket at 70% or 6 mm', async () => {
  assert.equal((await adviceFor({ prob: h => (h === 15 ? 70 : 5) })).rain, 'rain jacket')
  assert.equal((await adviceFor({ prob: () => 10, mm: h => (h === 16 ? 6 : 0) })).rain, 'rain jacket')
})

test('none at 20%', async () => {
  const a = await adviceFor({ prob: () => 20 })
  assert.equal(a.rain, 'none')
  assert.equal(a.rainWindow, null)
})

test('rain window first-last hour', async () => {
  const a = await adviceFor({ prob: h => (h >= 14 && h <= 17 ? 50 : 10) })
  assert.equal(a.rainWindow, '14:00-17:00')
})

test('mask over 37.5 and sunscreen from UV 8', async () => {
  const hi = await adviceFor({ pm: h => (h === 8 ? 40 : 10), uv: h => (h === 12 ? 8 : 1) })
  assert.equal(hi.mask, true)
  assert.equal(hi.sunscreen, true)
  assert.equal(hi.pm25Max, 40)
  assert.equal(hi.uvMax, 8)
  const lo = await adviceFor({ pm: () => 37.5, uv: () => 7 })
  assert.equal(lo.mask, false)
  assert.equal(lo.sunscreen, false)
})

test('forecast reads current, high and low and asks for Bangkok time', async () => {
  const s = await fake()
  try {
    const f: Forecast = await forecast(s.f, BKK)
    assert.equal(f.now, 31.4)
    assert.equal(f.high, 34.1)
    assert.equal(f.low, 26.2)
    assert.match(s.hits.join('\n'), /timezone=Asia%2FBangkok/)
  } finally { await s.close() }
})

test('geocode finds a place and returns null for none', async () => {
  const s = await fake()
  try {
    assert.deepEqual(await geocode(s.f, 'Chiang Mai'), { name: 'Chiang Mai', lat: 18.7883, lon: 98.9853 })
    assert.equal(await geocode(s.f, 'Nowhereville'), null)
  } finally { await s.close() }
})

test('set_location then weather uses it', async () => {
  const s = await fake({ prob: () => 40 })
  const dir = await mkdtemp(join(tmpdir(), 'nlk-weather-'))
  try {
    const routes = weatherRoutes({ dir, fetch: s.f })
    const first = await routes['/weather']({}) as { place: string; advice: string[] }
    assert.equal(first.place, 'Bangkok')
    assert.match(s.hits.at(-2) ?? '', /latitude=13\.7563/)
    const set = await routes['/weather/place']({ name: 'Chiang Mai' }) as { place: string }
    assert.equal(set.place, 'Chiang Mai')
    assert.match(await readFile(join(dir, 'location.json'), 'utf8'), /Chiang Mai/)
    const w = await routes['/weather']({}) as { place: string; now: number; high: number; low: number; rainWindow: string; advice: string[]; pm25Max: number; uvMax: number }
    assert.equal(w.place, 'Chiang Mai')
    assert.match(s.hits.at(-2) ?? '', /latitude=18\.7883/)
    assert.deepEqual(w.advice, ['umbrella'])
    assert.equal(w.rainWindow, '00:00-23:00')
    assert.equal(w.high, 34.1)
    assert.equal(w.pm25Max, 10)
    await routes['/weather']({ place: 'Phuket' })
    assert.match(await readFile(join(dir, 'location.json'), 'utf8'), /Chiang Mai/)
  } finally { await s.close() }
})

test('an unknown place is a clear error', async () => {
  const s = await fake()
  const dir = await mkdtemp(join(tmpdir(), 'nlk-weather-'))
  try {
    await assert.rejects(weatherRoutes({ dir, fetch: s.f })['/weather/place']({ name: 'Nowhereville' }), /could not find Nowhereville/)
  } finally { await s.close() }
})

test('Open-Meteo down gives a clear error', async () => {
  const s = await fake({ down: true })
  const dir = await mkdtemp(join(tmpdir(), 'nlk-weather-'))
  try {
    await assert.rejects(weatherRoutes({ dir, fetch: s.f })['/weather']({}), /weather service unavailable/)
  } finally { await s.close() }
})
