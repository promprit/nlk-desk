export type Style = {
  gender?: 'female' | 'male'
  age?: 'younger' | 'same' | 'older'
  tone?: 'playful' | 'warm' | 'polite' | 'direct'
  emoji?: 'lots' | 'some' | 'none'
  lang?: 'thai' | 'english' | 'mix'
  callOwner?: string
}

export const STYLE_KEYS = ['gender', 'age', 'tone', 'emoji', 'lang', 'callOwner'] as const

const ENUMS = {
  gender: ['female', 'male'],
  age: ['younger', 'same', 'older'],
  tone: ['playful', 'warm', 'polite', 'direct'],
  emoji: ['lots', 'some', 'none'],
  lang: ['thai', 'english', 'mix'],
} as const

const nameOk = (v: unknown): v is string => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 40 && !/[\r\n]/.test(v)

export function parseStyle(j: unknown): Style {
  const o = (typeof j === 'object' && j !== null ? j : {}) as Record<string, unknown>
  const s: Record<string, string> = {}
  for (const k of Object.keys(ENUMS) as (keyof typeof ENUMS)[]) {
    const v = o[k]
    if (typeof v === 'string' && (ENUMS[k] as readonly string[]).includes(v)) s[k] = v
  }
  if (nameOk(o.callOwner)) s.callOwner = o.callOwner.trim()
  return s as Style
}

export function mergeStyle(prev: Style, input: Record<string, unknown>): { style: Style } | { error: string } {
  const next: Record<string, string> = { ...prev }
  let any = false
  for (const k of STYLE_KEYS) {
    const v = input[k]
    if (v === undefined || v === null) continue
    if (k === 'callOwner') {
      if (!nameOk(v)) return { error: 'callOwner must be 1-40 characters on one line' }
      next[k] = v.trim()
    } else {
      if (typeof v !== 'string' || !(ENUMS[k] as readonly string[]).includes(v)) return { error: `${k} must be one of: ${ENUMS[k].join(', ')}` }
      next[k] = v
    }
    any = true
  }
  return any ? { style: next as Style } : { error: 'nothing to set' }
}

export const isComplete = (s: Style): boolean => STYLE_KEYS.every(k => s[k] !== undefined)

const TONE = {
  playful: 'Tone: playful. Joke and tease, always kindly.',
  warm: 'Tone: warm. Be caring and encouraging.',
  polite: 'Tone: polite. Stay calm and formal, with full polite particles.',
  direct: 'Tone: direct. Give the shortest answer, no small talk.',
}
const EMOJI = {
  lots: 'Emoji: use plenty of emoji.',
  some: 'Emoji: use a few emoji now and then.',
  none: 'Emoji: use no emoji.',
}
const LANG = {
  thai: 'Language: thai. Mirror the owner\'s language; Thai by default.',
  english: 'Language: english. Mirror the owner\'s language; English by default.',
  mix: 'Language: mix. Mirror the owner\'s language, and mix Thai and English when it comes naturally.',
}

export function styleBlock(s: Style | undefined): string {
  const st = s ?? {}
  if (!isComplete(st)) {
    const missing = STYLE_KEYS.filter(k => st[k] === undefined).join(', ')
    return `<style>\n[nlk:onboarding] Your style is not set yet (missing: ${missing}). Before anything else, run the getting-to-know-you chat from your rules, then answer what the owner asked.\n</style>`
  }
  const name = st.callOwner ?? ''
  const self = { younger: st.gender === 'female' ? 'หนู' : 'ผม', same: 'เรา', older: 'พี่' }[st.age!]
  const addr = { younger: `พี่${name}`, same: name, older: `น้อง${name}` }[st.age!]
  return [
    '<style>',
    'This style overrides any particle, self word, form of address, tone or language rule in persona.md.',
    st.gender === 'female' ? 'End Thai sentences with ค่ะ (คะ in questions).' : 'End Thai sentences with ครับ.',
    `Call yourself ${self} and the owner ${addr}.`,
    TONE[st.tone!],
    EMOJI[st.emoji!],
    LANG[st.lang!],
    '</style>',
  ].join('\n')
}

export const STYLE_SPEC = {
  name: 'style_set',
  description: 'Save how you speak to the owner. Call it after each onboarding answer and whenever the owner asks you to change your style (e.g. more polite, no emoji). Only the fields given change.',
  inputSchema: {
    type: 'object',
    properties: {
      gender: { type: 'string', enum: [...ENUMS.gender] },
      age: { type: 'string', enum: [...ENUMS.age], description: 'your age relative to the owner' },
      tone: { type: 'string', enum: [...ENUMS.tone] },
      emoji: { type: 'string', enum: [...ENUMS.emoji] },
      lang: { type: 'string', enum: [...ENUMS.lang] },
      callOwner: { type: 'string', description: 'the name or nickname to call the owner, 1-40 characters' },
    },
  },
  isDeferred: false,
} as const

export async function styleCall(read: () => Promise<string | null>, write: (text: string) => Promise<void>, input: Record<string, unknown>): Promise<string> {
  const text = await read().catch(() => null)
  let cfg: Record<string, unknown> = {}
  try {
    const j = JSON.parse(text ?? '')
    if (typeof j === 'object' && j !== null && !Array.isArray(j)) cfg = j
  } catch {}
  const r = mergeStyle(parseStyle(cfg.style), input)
  if ('error' in r) return r.error
  await write(JSON.stringify({ ...cfg, style: r.style }, null, 2) + '\n')
  return `style saved: ${Object.entries(r.style).map(([k, v]) => `${k}=${v}`).join(', ')}`
}
