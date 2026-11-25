import { test, expect } from 'claude-code/testing'
import { staticCheck, openOrMute } from '../hooks/gate.ts'

test('open only in its own config dir and desk', () => {
  expect(staticCheck({ configDir: '/H/.nlk/claude', home: '/H', cwd: '/H/.nlk/desk' })).toBe(null)
})

test('muted in the default Claude config dir', () => {
  expect(typeof staticCheck({ configDir: '/H/.claude', home: '/H', cwd: '/H/.nlk/desk' })).toBe('string')
  expect(typeof staticCheck({ home: '/H', cwd: '/H/.nlk/desk' })).toBe('string')
})

test('muted without HOME', () => {
  expect(typeof staticCheck({ configDir: '/H/.nlk/claude', cwd: '/H/.nlk/desk' })).toBe('string')
  expect(typeof staticCheck({ configDir: '/.nlk/claude', home: '', cwd: '/.nlk/desk' })).toBe('string')
})

test('muted in another folder', () => {
  expect(typeof staticCheck({ configDir: '/H/.nlk/claude', home: '/H', cwd: '/H' })).toBe('string')
  expect(typeof staticCheck({ configDir: '/H/.nlk/claude', home: '/H', cwd: '/H/.nlk/desk/sub' })).toBe('string')
})

test('openOrMute maps a reason to a phase', () => {
  expect(openOrMute(null, 5)).toEqual({ phase: 'open', reason: null, since: 5 })
  expect(openOrMute('x', 5)).toEqual({ phase: 'muted', reason: 'x', since: 5 })
})
