// Every runtime path derives from HOME; nothing here is a fixed absolute path.
export const nlkHome = (home: string) => `${home}/.nlk`
export const deskDir = (home: string) => `${nlkHome(home)}/desk`
export const privateDir = (home: string) => `${deskDir(home)}/private`
// Its Claude config dir belongs to Claude Code; the mod owns only the Telegram channel state inside it.
export const configDir = (home: string) => `${nlkHome(home)}/claude`
export const telegramState = (home: string) => `${configDir(home)}/channels/telegram-nlk`
export const appDir = (home: string) => `${nlkHome(home)}/app`
export const logsDir = (home: string) => `${nlkHome(home)}/logs`
export const svcTokenFile = (home: string) => `${nlkHome(home)}/svc.token`
export const configFile = (home: string) => `${nlkHome(home)}/config.json`
export const scheduleFile = (home: string) => `${nlkHome(home)}/schedule.json`
export const statusFile = (home: string) => `${nlkHome(home)}/status.json`
export const deniesFile = (home: string) => `${logsDir(home)}/denies.log`
export const inboundLog = (home: string) => `${logsDir(home)}/inbound.jsonl`
export const filesDir = (home: string) => `${nlkHome(home)}/files`
export const backupsDir = (home: string) => `${home}/NLK-backups`
export const launcherSettingsFile = (home: string) => `${nlkHome(home)}/settings.json`
// One folder as a lock between writers of the files above (see lock.ts).
export const lockDir = (home: string) => `${nlkHome(home)}/lock`

export const SVC_PORT = 4330
export const SVC_URL = `http://127.0.0.1:${SVC_PORT}`
// Its own tmux server: the default one would hand its CLAUDE_CONFIG_DIR and TELEGRAM_STATE_DIR to every other tmux session.
export const TMUX_SOCKET = 'nlk'
export const TMUX_SESSION = 'nlk'
export const LABEL = 'com.nlk.session'
export const SVC_LABEL = 'com.nlk.svc'
export const AWAKE_LABEL = 'com.nlk.awake'

export const TG = 'mcp__plugin_telegram_telegram__'
export const TG_REPLY = `${TG}reply`
export const TG_EDIT = `${TG}edit_message`
export const TG_REACT = `${TG}react`
export const TG_DOWNLOAD = `${TG}download_attachment`
