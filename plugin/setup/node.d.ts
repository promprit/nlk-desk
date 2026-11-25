// The few Node names the setup helpers use; the type-check runs without @types/node.
declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
  execPath: string
  stdout: { write(s: string): void }
  exit(code?: number): never
  getuid(): number
}
declare const console: { log(...a: unknown[]): void; error(...a: unknown[]): void }
interface ImportMeta { url: string; main: boolean }
declare module 'node:fs' {
  export function readFileSync(path: string | number, enc: 'utf8'): string
  export function writeFileSync(path: string, data: string, opts?: { mode?: number }): void
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void
  export function existsSync(path: string): boolean
  export function chmodSync(path: string, mode: number): void
  export function cpSync(from: string, to: string, opts?: { recursive?: boolean; filter?: (src: string) => boolean }): void
}
declare module 'node:child_process' {
  export function spawnSync(cmd: string, args: string[], opts: { encoding: 'utf8' }): { status: number | null; stdout: string }
}
