export const WEATHER_DOWN = 'my service is down; try again in a minute'
export const WEATHER_ASK = 'I do not know which city yet: ask the owner for their city, then call set_location or pass place'

export const WEATHER_SPECS = [
  {
    name: 'weather_today',
    description: 'Today\'s weather and what to carry (umbrella, rain jacket, mask, sunscreen). With no place it uses the owner\'s city.',
    inputSchema: { type: 'object', properties: { place: { type: 'string', description: 'a city, only when the owner asks about another place' } } },
    isDeferred: false,
  },
  {
    name: 'set_location',
    description: 'Remember where the owner is for the weather, when they say they are somewhere else ("I\'m in Chiang Mai this week").',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'the city' } }, required: ['name'] },
    isDeferred: false,
  },
] as const

type Reply = { ok: boolean; status: number; json: unknown }
export type Svc = (path: string, body: unknown) => Promise<Reply>

const errorOf = (r: Reply) => String((r.json as { error?: unknown } | null)?.error ?? r.status)

/** One tool call: a thin service call, rendered as text for the model. `city` is the configured default place. */
export async function weatherCall(svc: Svc, name: string, input: Record<string, unknown>, city?: { name: string }): Promise<string> {
  const setting = name === 'set_location'
  const given = typeof input.place === 'string' && input.place.trim() ? input.place.trim() : city?.name
  if (!setting && !given) return WEATHER_ASK
  const r = await svc(setting ? '/weather/place' : '/weather', setting ? { name: input.name } : { place: given })
  if (r.status === 0) return WEATHER_DOWN
  if (!r.ok) return `${name} failed: ${errorOf(r)}`
  const w = r.json as { place: string; now: number; high: number; low: number; rainWindow: string | null; advice: string[]; pm25Max: number | null; uvMax: number }
  if (setting) return `location set to ${w.place}`
  return [
    `${w.place}: ${w.now}C now, high ${w.high}C, low ${w.low}C`,
    w.rainWindow ? `rain likely ${w.rainWindow}` : 'no rain expected',
    `carry: ${w.advice.length ? w.advice.join(', ') : 'nothing'}`,
    `PM2.5 max ${w.pm25Max ?? 'unknown'}, UV max ${w.uvMax}`,
  ].join('; ')
}
