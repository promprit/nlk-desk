import type { Channel } from './channels.ts'

export const HEAL_AFTER_MS = 2 * 60_000
export const RECONNECT = '/mcp reconnect plugin:telegram:telegram'

export type HealState = { triedAt?: number }
export type HealObs = { now: number; telegram: Channel | null; sessionAgeMs: number | null; pane: string | null }

// A Claude Code menu in the last 25 lines of its screen would swallow what is typed.
const MENU = /Enter to (select|confirm)/

/**
 * One minute of watching its Telegram channel. After a restart its MCP server sometimes never starts; typing
 * `/mcp reconnect` into its own session brings it up. One try per episode (an episode ends when Telegram is ok),
 * never over a menu, and only for `stopped`: other reasons are not fixed by a reconnect.
 */
export function healStep(state: HealState, o: HealObs): { state: HealState; reconnect: boolean } {
  const t = o.telegram
  if (t?.ok) return { state: {}, reconnect: false }
  const due = t?.reason === 'stopped' && state.triedAt === undefined && o.sessionAgeMs !== null && o.sessionAgeMs >= HEAL_AFTER_MS
    && o.pane !== null && !MENU.test(o.pane.split('\n').slice(-25).join('\n'))
  return due ? { state: { triedAt: o.now }, reconnect: true } : { state, reconnect: false }
}
