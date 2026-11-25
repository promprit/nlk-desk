import { test, expect } from 'claude-code/testing'
import { WEATHER_ASK, WEATHER_DOWN, WEATHER_SPECS, weatherCall } from '../hooks/weathertool.ts'

const W = { place: 'Bangkok', now: 31, high: 34, low: 26, rainWindow: '14:00-17:00', advice: ['umbrella', 'mask'], pm25Max: 40, uvMax: 6 }
const tool = 'weather_today'

test('weather renders the window and what to carry', async () => {
  const calls: { path: string; body: unknown }[] = []
  const text = await weatherCall(async (path, body) => { calls.push({ path, body }); return { ok: true, status: 200, json: W } }, tool, { place: 'Phuket' })
  expect(calls).toEqual([{ path: '/weather', body: { place: 'Phuket' } }])
  expect(text).toContain('rain likely 14:00-17:00')
  expect(text).toContain('carry: umbrella, mask')
})

test('weather with nothing to carry says nothing', async () => {
  const text = await weatherCall(async () => ({ ok: true, status: 200, json: { ...W, rainWindow: null, advice: [] } }), tool, { place: 'Bangkok' })
  expect(text).toContain('no rain expected')
  expect(text).toContain('carry: nothing')
})

test('the default place comes from the config city when the input has none', async () => {
  const calls: { path: string; body: unknown }[] = []
  const svc = async (path: string, body: unknown) => { calls.push({ path, body }); return { ok: true, status: 200, json: W } }
  await weatherCall(svc, tool, {}, { name: 'Chiang Mai' })
  await weatherCall(svc, tool, { place: 'Phuket' }, { name: 'Chiang Mai' })
  expect(calls.map(c => c.body)).toEqual([{ place: 'Chiang Mai' }, { place: 'Phuket' }])
})

test('no city and no input: the tool asks which city and calls nothing', async () => {
  let called = false
  const text = await weatherCall(async () => { called = true; return { ok: true, status: 200, json: W } }, tool, {})
  expect(text).toBe(WEATHER_ASK)
  expect(called).toBe(false)
})

test('set_location posts the name', async () => {
  const calls: { path: string; body: unknown }[] = []
  const text = await weatherCall(async (path, body) => { calls.push({ path, body }); return { ok: true, status: 200, json: { place: 'Chiang Mai' } } }, 'set_location', { name: 'Chiang Mai' })
  expect(calls).toEqual([{ path: '/weather/place', body: { name: 'Chiang Mai' } }])
  expect(text).toBe('location set to Chiang Mai')
})

test('service down gives the standard text, a service error its message', async () => {
  expect(await weatherCall(async () => ({ ok: false, status: 0, json: null }), tool, { place: 'x' })).toBe(WEATHER_DOWN)
  expect(await weatherCall(async () => ({ ok: false, status: 500, json: { error: 'weather service unavailable (503)' } }), tool, { place: 'x' })).toBe(`${tool} failed: weather service unavailable (503)`)
})

test('two tools are specified', () => expect(WEATHER_SPECS.map(s => s.name)).toEqual([tool, 'set_location']))
