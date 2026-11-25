import { telegramState, svcTokenFile } from './paths.ts'

// One list of every root the assistant may not touch: the guard reads the `read` ones, the sandbox settings take all of them.
export type Sealed = { path: string; read: boolean; write: boolean }

// Credential stores in the home folder, and every Claude config dir (`~/.claude` also covers longer names such as `~/.claude-work`).
const HOME_SEALED = ['.ssh', '.aws', '.gnupg', '.claude', 'Library/Keychains']

export function sealedSpec(home: string): Sealed[] {
  const both = (path: string): Sealed => ({ path, read: true, write: true })
  return [
    ...HOME_SEALED.map(n => both(`${home}/${n}`)),
    both(`${telegramState(home)}/.env`),
    both(svcTokenFile(home)),
  ]
}
