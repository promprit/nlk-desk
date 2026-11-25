import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** What the service touches on disk and the clock; specs pass a fake. */
export type SvcIo = {
  home: string
  read(path: string): Promise<string | null>
  append(path: string, text: string): Promise<void>
  now(): number
}

export const nodeIo = (home: string): SvcIo => ({
  home,
  read: p => readFile(p, 'utf8').catch(() => null),
  append: async (p, text) => {
    await mkdir(dirname(p), { recursive: true })
    await appendFile(p, text)
  },
  now: () => Date.now(),
})

// Every service path derives from HOME: data root `~/.nlk`.
export const nlkHome = (home: string) => `${home}/.nlk`
export const svcTokenFile = (home: string) => `${nlkHome(home)}/svc.token`
export const memoryDir = (home: string) => `${nlkHome(home)}/memory`
export const modelsDir = (home: string) => `${nlkHome(home)}/models`
export const weatherDir = (home: string) => `${nlkHome(home)}/weather`
export const telegramState = (home: string) => `${nlkHome(home)}/claude/channels/telegram-nlk`
export const resumeFile = (home: string) => `${nlkHome(home)}/resume`
export const backupsDir = (home: string) => `${home}/NLK-backups`
export const SVC_PORT = 4330
export const TMUX_SOCKET = 'nlk'
export const TMUX_SESSION = 'nlk'
export const LABEL = 'com.nlk.session'
