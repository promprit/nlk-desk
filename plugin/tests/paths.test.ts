import { test, expect } from 'claude-code/testing'
import * as P from '../hooks/paths.ts'
import { roleOf } from '../hooks/role.ts'

test('every runtime path derives from HOME', () => {
  const h = '/H'
  expect(P.nlkHome(h)).toBe('/H/.nlk')
  expect(P.deskDir(h)).toBe('/H/.nlk/desk')
  expect(P.privateDir(h)).toBe('/H/.nlk/desk/private')
  expect(P.configDir(h)).toBe('/H/.nlk/claude')
  expect(P.telegramState(h)).toBe('/H/.nlk/claude/channels/telegram-nlk')
  expect(P.appDir(h)).toBe('/H/.nlk/app')
  expect(P.logsDir(h)).toBe('/H/.nlk/logs')
  expect(P.svcTokenFile(h)).toBe('/H/.nlk/svc.token')
  expect(P.configFile(h)).toBe('/H/.nlk/config.json')
  expect(P.scheduleFile(h)).toBe('/H/.nlk/schedule.json')
  expect(P.statusFile(h)).toBe('/H/.nlk/status.json')
  expect(P.deniesFile(h)).toBe('/H/.nlk/logs/denies.log')
  expect(P.inboundLog(h)).toBe('/H/.nlk/logs/inbound.jsonl')
  expect(P.filesDir(h)).toBe('/H/.nlk/files')
  expect(P.backupsDir(h)).toBe('/H/NLK-backups')
  expect(P.launcherSettingsFile(h)).toBe('/H/.nlk/settings.json')
  expect(P.lockDir(h)).toBe('/H/.nlk/lock')
})

test('fixed names', () => {
  expect(P.SVC_PORT).toBe(4330)
  expect(P.SVC_URL).toBe('http://127.0.0.1:4330')
  expect(P.TMUX_SOCKET).toBe('nlk')
  expect(P.TMUX_SESSION).toBe('nlk')
  expect(P.LABEL).toBe('com.nlk.session')
  expect(P.SVC_LABEL).toBe('com.nlk.svc')
  expect(P.AWAKE_LABEL).toBe('com.nlk.awake')
  expect(P.TG_REPLY).toBe('mcp__plugin_telegram_telegram__reply')
  expect(P.TG_REACT).toBe('mcp__plugin_telegram_telegram__react')
  expect(P.TG_EDIT).toBe('mcp__plugin_telegram_telegram__edit_message')
  expect(P.TG_DOWNLOAD).toBe('mcp__plugin_telegram_telegram__download_attachment')
  expect(roleOf('1')).toBe('host')
  expect(roleOf(undefined)).toBe('remote')
  expect(roleOf('1', 'worker')).toBe('worker')
})

test('no export holds a fixed volume path', () => {
  const values = Object.values(P).map(v => (typeof v === 'function' ? (v as (h: string) => unknown)('/H') : v))
  expect(values.length > 20).toBe(true)
  expect(values.filter(v => String(v).includes('/Volumes'))).toEqual([])
})
