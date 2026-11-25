import { test, expect } from 'claude-code/testing'
import { styleBlock } from '../hooks/style.ts'

test('style block for a younger male who calls the owner Nok', () => {
  const b = styleBlock({ gender: 'male', age: 'younger', tone: 'warm', emoji: 'some', lang: 'mix', callOwner: 'Nok' })
  expect(b.startsWith('<style>')).toBe(true)
  expect(b.endsWith('</style>')).toBe(true)
  expect(b).toContain('ครับ')
  expect(b).toContain('ผม')
  expect(b).toContain('พี่Nok')
  expect(b).not.toContain('ค่ะ')
})
