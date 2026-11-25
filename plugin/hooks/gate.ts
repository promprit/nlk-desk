import { configDir, deskDir } from './paths.ts'

export type Phase = 'checking' | 'open' | 'muted'
export type Gate = { phase: Phase; reason: string | null; since: number }

export function staticCheck(s: { configDir?: string; home?: string; cwd: string }): string | null {
  if (!s.home) return 'HOME is not set'
  if (s.configDir !== configDir(s.home)) return 'not its config dir (~/.nlk/claude)'
  if (s.cwd !== deskDir(s.home)) return 'not started in its desk (~/.nlk/desk)'
  return null
}

export const openOrMute = (reason: string | null, now: number): Gate => (reason === null ? { phase: 'open', reason: null, since: now } : { phase: 'muted', reason, since: now })
