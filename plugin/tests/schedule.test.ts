import { test, expect } from 'claude-code/testing'
import { due, next, quiet, bangkok, parseSchedule, parseConfig, reminderFrom, BRIEF_PROMPT, REMIND_SPEC, type Reminder } from '../hooks/schedule.ts'

const at = (hhmm: string, day = '2026-10-21') => Date.parse(`${day}T${hhmm}:00+07:00`)
const empty = { reminders: [] }
const on = (t: string) => ({ brief: { on: true, at: t } })

test('brief is off unless config turns it on', () => {
  expect(due(at('09:00'), empty, {}).brief).toBe(false)
  expect(due(at('09:00'), empty, parseConfig(null)).brief).toBe(false)
  expect(due(at('09:00'), empty, { brief: { on: false, at: '09:00' } }).brief).toBe(false)
})
test('brief fires at the configured time', () => {
  expect(due(at('07:29'), empty, on('07:30')).brief).toBe(false)
  expect(due(at('07:30'), empty, on('07:30')).brief).toBe(true)
})
test('brief window is 3 hours', () => {
  expect(due(at('10:29'), empty, on('07:30')).brief).toBe(true)
  expect(due(at('10:31'), empty, on('07:30')).brief).toBe(false)
})
test('no brief in quiet hours', () => {
  for (const t of ['23:30', '00:30', '02:00']) expect(due(at(t), empty, on('23:30')).brief).toBe(false)
})
test('no double brief after restart', () => expect(due(at('09:05'), { briefDate: '2026-10-21', reminders: [] }, on('09:00')).brief).toBe(false))
test('yesterday brief does not block today', () => expect(due(at('09:05'), { briefDate: '2026-10-20', reminders: [] }, on('09:00')).brief).toBe(true))

test('quiet hours hold the brief but not reminders', () => {
  const r = due(at('23:30'), { reminders: [{ id: 'r1', text: 'x', at: at('23:29') }] }, on('23:30'))
  expect(r.brief).toBe(false)
  expect(r.reminders.length).toBe(1)
})
test('a future reminder is not due', () => expect(due(at('12:00'), { reminders: [{ id: 'r', text: 'x', at: at('12:01') }] }, {}).reminders).toEqual([]))
test('quiet is 23:00 to 08:00', () => {
  expect([quiet(22 * 60 + 59), quiet(23 * 60), quiet(7 * 60 + 59), quiet(8 * 60)]).toEqual([false, true, true, false])
})
test('repeating reminder moves forward', () => {
  const r: Reminder = { id: 'r', text: 'x', at: at('09:00'), every: 'day' }
  expect(next(r, at('09:01'))).toEqual({ ...r, at: at('09:00', '2026-10-22') })
  expect(next({ ...r, every: 'week' }, at('09:01'))?.at).toBe(at('09:00', '2026-10-28'))
  expect(next({ ...r, every: 'month' }, at('09:01'))?.at).toBe(at('09:00', '2026-11-21'))
})
test('a repeating reminder missed for days fires once, then lands in the future', () => {
  expect(next({ id: 'r', text: 'x', at: at('09:00', '2026-10-15'), every: 'day' }, at('12:00'))?.at).toBe(at('09:00', '2026-10-22'))
})
test('a one-off reminder is dropped after firing', () => expect(next({ id: 'r', text: 'x', at: at('09:00') }, at('09:01'))).toBeNull())
test('bangkok reads the local date and minutes', () => expect(bangkok(Date.parse('2026-10-20T17:30:00Z'))).toEqual({ date: '2026-10-21', minutes: 30 }))

test('reminderFrom validates input', () => {
  expect(reminderFrom({ text: ' call ', at: '2026-10-21T09:00', every: 'week' }, 'r1')).toEqual({ id: 'r1', text: 'call', at: at('09:00'), every: 'week' })
  expect(typeof reminderFrom({ text: '', at: '2026-10-21T09:00' }, 'r1')).toBe('string')
  expect(typeof reminderFrom({ text: 'x', at: 'tomorrow' }, 'r1')).toBe('string')
  expect(typeof reminderFrom({ text: 'x', at: '2026-10-21T09:00', every: 'hour' }, 'r1')).toBe('string')
})

test('prompts say what to do', () => {
  expect(BRIEF_PROMPT.startsWith('[nlk:brief]')).toBe(true)
  expect(BRIEF_PROMPT).toContain('weather_today')
  expect(REMIND_SPEC.name).toBe('remind')
})

test('parseConfig reads the brief and survives damage', () => {
  expect(parseConfig('{"brief":{"on":true,"at":"07:30"},"city":{"name":"Chiang Mai","lat":18.8,"lon":99}}')).toMatchObject({ brief: { on: true, at: '07:30' }, city: { name: 'Chiang Mai' } })
  expect(parseConfig('not json')).toEqual({})
  expect(parseConfig(null)).toEqual({})
})

test('the schedule keeps the light-turn fields', () => {
  const s = parseSchedule(JSON.stringify({ reminders: [], lastCheckAt: 5, briefRetry: '2026-10-21', briefFailAt: 7 }))
  expect(s).toMatchObject({ lastCheckAt: 5, briefRetry: '2026-10-21', briefFailAt: 7 })
})
