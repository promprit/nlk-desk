export type Gate = { phase: 'checking' | 'open' | 'muted'; reason: string | null; since: number }

declare module 'claude-code' {
  interface PluginState {
    nlk: { gate: Gate | null }
  }
}
