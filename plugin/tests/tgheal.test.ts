import { test, expect } from 'claude-code/testing'
import { healStep, type HealState } from '../hooks/tgheal.ts'
import type { Channel } from '../hooks/channels.ts'

const NOW = 1_000_000
const MIN = 60_000
const STOPPED: Channel = { at: NOW, ok: false, reason: 'stopped' }
const IDLE = '❯ \n  ⏵⏵ auto mode on'
const MENU = 'Do you want to proceed?\n ❯ 1. Yes\n Enter to select · Esc to cancel'
const obs = (o: Partial<Parameters<typeof healStep>[1]> = {}) => ({ now: NOW, telegram: STOPPED, sessionAgeMs: 2 * MIN, pane: IDLE, ...o })

// Defect caught: NLK comes up deaf to Telegram and stays that way until the owner types /mcp reconnect by hand.
test('stopped for 2 min on an idle pane: one reconnect, attempt recorded', () => {
  const r = healStep({}, obs())
  expect(r.reconnect).toBe(true)
  expect(r.state.triedAt).toBe(NOW)
})

test('not before the session is 2 min old, nor when its age is unknown', () => {
  expect(healStep({}, obs({ sessionAgeMs: 2 * MIN - 1 })).reconnect).toBe(false)
  expect(healStep({}, obs({ sessionAgeMs: null })).reconnect).toBe(false)
})

test('not while a menu is on screen, nor when the screen is unknown', () => {
  expect(healStep({}, obs({ pane: MENU })).reconnect).toBe(false)
  expect(healStep({}, obs({ pane: 'Enter to confirm' })).reconnect).toBe(false)
  expect(healStep({}, obs({ pane: null })).reconnect).toBe(false)
})

test('a menu older than the last 25 lines does not block it', () => {
  const old = `${MENU}\n${Array(30).fill('x').join('\n')}`
  expect(healStep({}, obs({ pane: old })).reconnect).toBe(true)
})

test('only once per episode', () => {
  const r1 = healStep({}, obs())
  const r2 = healStep(r1.state, obs({ now: NOW + MIN }))
  expect(r2.reconnect).toBe(false)
})

test('ok ends the episode, so a later outage gets its own reconnect', () => {
  const tried: HealState = { triedAt: NOW }
  const ok = healStep(tried, obs({ telegram: { at: NOW, ok: true } }))
  expect(ok.state.triedAt).toBeUndefined()
  expect(healStep(ok.state, obs({ now: NOW + 9 * MIN })).reconnect).toBe(true)
})

test('other reasons and no reading never reconnect', () => {
  for (const reason of ['token rejected', 'network', 'rate limited', 'conflict'] as const)
    expect(healStep({}, obs({ telegram: { at: NOW, ok: false, reason } })).reconnect).toBe(false)
  expect(healStep({}, obs({ telegram: null })).reconnect).toBe(false)
})
