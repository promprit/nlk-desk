import type { Register } from 'claude-code'

export type On = Parameters<Register>[0]
// What register.tsx hands every wire. Atoms cannot travel here: the engine's scan needs each atom as a const
// of the file that reads it (a wire that needs the gate declares `atom({ plugin: 'nlk', key: 'gate' }, null)` itself).
export type Ctx = Record<never, never>
