import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { sendText, tgOpts } from '../telegram.ts'

function state(paired: boolean) {
  const dir = mkdtempSync(`${tmpdir()}/nlktg-`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/.env`, 'TELEGRAM_BOT_TOKEN=000:fixture\n')
  if (paired) writeFileSync(`${dir}/access.json`, JSON.stringify({ allowFrom: ['777'] }))
  return dir
}

// Fake that answers sendMessage with `reply`, like Telegram.
async function fakeSend(reply: string) {
  const hits: { url: string; body: any }[] = []
  const srv = createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => { hits.push({ url: req.url ?? '', body: body ? JSON.parse(body) : null }); res.end(reply) })
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  return { hits, api: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, close: () => new Promise<void>(r => srv.close(() => r())) }
}

test('sendText sends no reply_markup and returns the message_id', async () => {
  const api = await fakeSend('{"ok":true,"result":{"message_id":41}}')
  const o = await tgOpts(state(true), api.api)
  assert.equal(await sendText(o, 'hi'), 41)
  assert.deepEqual(api.hits, [{ url: '/bot000:fixture/sendMessage', body: { chat_id: '777', text: 'hi' } }])
  await api.close()
})

test('sendText returns null when Telegram gives no message_id', async () => {
  const api = await fakeSend('{"ok":true}')
  const o = await tgOpts(state(true), api.api)
  assert.equal(await sendText(o, 'hi'), null)
  await api.close()
})

test('not paired: refuses and sends nothing', async () => {
  const api = await fakeSend('{"ok":true}')
  await assert.rejects(tgOpts(state(false), api.api), /not paired/)
  assert.equal(api.hits.length, 0)
  await api.close()
})
