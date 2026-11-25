import { test, expect } from 'claude-code/testing'
import { statusReport, type StatusFile } from '../hooks/status.ts'

const NOW = 50_000_000
const base = (o: Partial<StatusFile> = {}): StatusFile => ({
  at: NOW - 60_000,
  gate: 'paired' as StatusFile['gate'],
  reason: null,
  channels: { telegram: { at: NOW - 60_000, ok: true } },
  claude: '2.3.0',
  ...o,
})

// Defect caught: the status line hides the poller state or a newer-than-tested Claude Code version.
test('status report shows paired, poller and versions', () => {
  const lines = statusReport(base(), NOW, '2.2.0').split('\n')
  expect(lines).toContain('Telegram: connected')
  expect(lines).toContain('Claude Code 2.3.0 (tested with 2.2.0) — newer than tested; if NLK misbehaves, send this line to whoever gave you NLK')
  const same = statusReport(base({ claude: '2.2.0' }), NOW, '2.2.0')
  expect(same).toContain('Claude Code 2.2.0')
  expect(same).not.toContain('newer')
  expect(statusReport(base({ at: NOW - 6 * 60_000 }), NOW, '2.2.0')).toContain('NLK is not running')
})
