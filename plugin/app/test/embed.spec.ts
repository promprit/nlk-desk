import { test } from 'node:test'
import assert from 'node:assert/strict'
import { e5Embedder } from '../embed.ts'

function rig() {
  const log: string[] = []
  const batches: number[] = []
  let armed: (() => void) | undefined
  let release: (() => void) | undefined
  let gate: Promise<void> | undefined
  const opts = {
    idleMs: 600_000,
    timer: { set: (fn: () => void, ms: number) => { log.push(`arm ${ms}`); armed = fn; return fn }, clear: () => { armed = undefined } },
    load: async () => {
      log.push('load')
      if (gate) await gate
      return { run: async (t: string[]) => { batches.push(t.length); return t.map(() => new Float32Array(1)) }, dispose: async () => { log.push('dispose') } }
    },
  }
  return {
    log, batches, opts,
    fire: () => { const f = armed; armed = undefined; f?.() },
    hold: () => { gate = new Promise<void>(r => { release = r }) },
    release: () => release?.(),
  }
}

test('back-to-back calls load the model once', async () => {
  const r = rig()
  const e = e5Embedder('/c', r.opts)
  await e(['a']); await e(['b'])
  assert.equal(r.log.filter(l => l === 'load').length, 1)
})

test('idle for ten minutes disposes it, and the next call loads again', async () => {
  const r = rig()
  const e = e5Embedder('/c', r.opts)
  await e(['a'])
  assert.ok(r.log.includes('arm 600000'))
  r.fire()
  await new Promise(res => setImmediate(res))
  assert.deepEqual(r.log.filter(l => l === 'dispose'), ['dispose'])
  await e(['b'])
  assert.equal(r.log.filter(l => l === 'load').length, 2)
})

test('a call during the load waits for that load instead of starting another', async () => {
  const r = rig()
  r.hold()
  const e = e5Embedder('/c', r.opts)
  const a = e(['a']); const b = e(['b'])
  r.release()
  const [x, y] = await Promise.all([a, b])
  assert.equal(x.length, 1); assert.equal(y.length, 1)
  assert.equal(r.log.filter(l => l === 'load').length, 1)
})

test('the idle timer does not dispose while a call is running', async () => {
  const r = rig()
  r.hold()
  const e = e5Embedder('/c', r.opts)
  const a = e(['a'])
  r.fire()
  r.release()
  await a
  await new Promise(res => setImmediate(res))
  assert.equal(r.log.includes('dispose'), false)
})

test('a file of 40 chunks runs the model in batches of at most 16, in order', async () => {
  const r = rig()
  const e = e5Embedder('/c', r.opts)
  const out = await e(Array.from({ length: 40 }, (_, i) => `t${i}`))
  assert.equal(out.length, 40)
  assert.deepEqual(r.batches, [16, 16, 8])
})
