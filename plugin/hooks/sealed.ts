import { telegramState, svcTokenFile } from './paths.ts'

export type Sealed = { path: string; read: boolean; write: boolean }

const HOME_SEALED = ['.ssh', '.aws', '.gnupg', '.claude', 'Library/Keychains']

export function sealedSpec(home: string): Sealed[] {
  const both = (path: string): Sealed => ({ path, read: true, write: true })
  return [
    ...HOME_SEALED.map(n => both(`${home}/${n}`)),
    both(`${telegramState(home)}/.env`),
    both(svcTokenFile(home)),
  ]
}
