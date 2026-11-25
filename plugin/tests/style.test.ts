import { test, expect } from 'claude-code/testing'
import { styleBlock, mergeStyle, styleCall } from '../hooks/style.ts'
import { parseConfig } from '../hooks/schedule.ts'

test('style block for a younger male who calls the owner Nok', () => {
  const b = styleBlock({ gender: 'male', age: 'younger', tone: 'warm', emoji: 'some', lang: 'mix', callOwner: 'Nok' })
  expect(b.startsWith('<style>')).toBe(true)
  expect(b.endsWith('</style>')).toBe(true)
  expect(b).toContain('ครับ')
  expect(b).toContain('ผม')
  expect(b).toContain('พี่Nok')
  expect(b).not.toContain('ค่ะ')
})

const full = { gender: 'female', age: 'same', tone: 'warm', emoji: 'some', lang: 'mix', callOwner: 'Nok' } as const

test('age and gender pick the particles, self word and address', () => {
  const fy = styleBlock({ ...full, age: 'younger' })
  for (const s of ['ค่ะ', 'หนู', 'พี่Nok']) expect(fy).toContain(s)
  const fs = styleBlock(full)
  for (const s of ['ค่ะ', 'เรา', 'the owner Nok']) expect(fs).toContain(s)
  const mo = styleBlock({ ...full, gender: 'male', age: 'older' })
  for (const s of ['ครับ', 'พี่', 'น้องNok']) expect(mo).toContain(s)
  const fo = styleBlock({ ...full, age: 'older' })
  for (const s of ['ค่ะ', 'พี่', 'น้องNok']) expect(fo).toContain(s)
})

test('a full style block overrides persona.md rules on particles, self word, address, tone and language', () => {
  const b = styleBlock(full)
  expect(b).toContain('overrides any particle, self word, form of address, tone or language rule in persona.md')
})

test('each tone, emoji and lang adds its own line', () => {
  expect(styleBlock({ ...full, tone: 'playful' })).toContain('teas')
  expect(styleBlock({ ...full, tone: 'warm' })).toContain('encouraging')
  expect(styleBlock({ ...full, tone: 'polite' })).toContain('formal')
  expect(styleBlock({ ...full, tone: 'direct' })).toContain('no small talk')
  expect(styleBlock({ ...full, emoji: 'lots' })).toContain('plenty of emoji')
  expect(styleBlock({ ...full, emoji: 'none' })).toContain('no emoji')
  expect(styleBlock({ ...full, lang: 'english' })).toContain('English')
  expect(styleBlock({ ...full, lang: 'thai' })).toContain('Thai by default')
})

test('an unset style asks for onboarding and names the missing keys', () => {
  expect(styleBlock(undefined)).toContain('[nlk:onboarding]')
  const b = styleBlock({ gender: 'female' })
  expect(b).toContain('[nlk:onboarding]')
  expect(b).toContain('missing: age, tone, emoji, lang, callOwner')
})

test('mergeStyle validates and merges', () => {
  const bad = mergeStyle({}, { gender: 'robot' }) as { error: string }
  expect(bad.error).toContain('gender')
  expect(bad.error).toContain('female, male')
  expect(mergeStyle({}, {})).toEqual({ error: 'nothing to set' })
  expect(mergeStyle({ tone: 'warm' }, { tone: 'direct' })).toEqual({ style: { tone: 'direct' } })
  expect('error' in mergeStyle({}, { callOwner: '' })).toBe(true)
  expect('error' in mergeStyle({}, { callOwner: 'x'.repeat(41) })).toBe(true)
})

test('parseConfig keeps a valid style and drops bad keys', () => {
  expect(parseConfig(JSON.stringify({ style: { gender: 'male', tone: 'loud', callOwner: 'Nok' } })).style).toEqual({ gender: 'male', callOwner: 'Nok' })
  expect('style' in parseConfig('{"name":"A"}')).toBe(false)
})

test('styleCall writes the whole config back', async () => {
  const run = async (text: string | null, input: Record<string, unknown>) => {
    const w: string[] = []
    const out = await styleCall(async () => text, async t => { w.push(t) }, input)
    return { w, out }
  }
  expect(JSON.parse((await run(null, { tone: 'warm' })).w[0]!)).toEqual({ style: { tone: 'warm' } })
  const kept = JSON.parse((await run('{"name":"A","tools":{"allow":["x"]}}', { tone: 'warm' })).w[0]!)
  expect(kept).toEqual({ name: 'A', tools: { allow: ['x'] }, style: { tone: 'warm' } })
  expect(JSON.parse((await run('not json', { tone: 'warm' })).w[0]!)).toEqual({ style: { tone: 'warm' } })
  const bad = await run('{}', { tone: 'loud' })
  expect(bad.w).toEqual([])
  expect(bad.out).toContain('tone')
})
