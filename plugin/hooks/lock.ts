export type LockIo = {
  mkdir(path: string): Promise<boolean>
  writeOwner(path: string, token: string): Promise<void>
  readOwner(path: string): Promise<string | null>
  /** Atomic: true only for the one caller that moved the folder. */
  rename(from: string, to: string): Promise<boolean>
  /** Removes the owner file, then the folder. */
  rmdir(path: string): Promise<void>
  ageMs(path: string): Promise<number | null>
  sleep(ms: number): Promise<void>
  token(): string
}
export const STALE_LOCK_MS = 30_000

/**
 * One folder as a lock between writers: mkdir is atomic, so only one process creates it.
 * Best effort: a lock older than 30 s may be taken while its holder still runs. It is taken over by
 * renaming it away (only one taker wins); every failed attempt sleeps,
 * so a late taker finds no folder to rename, and release only removes a lock that still carries our token.
 */
export async function withFileLock<T>(io: LockIo, path: string, fn: () => Promise<T>, waitMs = 10_000): Promise<T> {
  for (let waited = 0; !(await io.mkdir(path)); waited += 100) {
    const age = await io.ageMs(path)
    if (age !== null && age > STALE_LOCK_MS) {
      const stale = `${path}.stale.${io.token()}`
      if (await io.rename(path, stale)) await io.rmdir(stale).catch(() => {})
    }
    if (waited >= waitMs) throw new Error('desk is busy')
    await io.sleep(100)
  }
  const me = io.token()
  try {
    await io.writeOwner(path, me)
    return await fn()
  } finally {
    if ((await io.readOwner(path).catch(() => null)) === me) await io.rmdir(path).catch(() => {})
  }
}
