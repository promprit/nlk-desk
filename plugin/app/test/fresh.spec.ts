import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshRoutes, restartSession, FRESH_ACK } from '../fresh.ts'

const setup = () => {
  const steps: string[] = []
  const deps = {
    send: async (t: string) => { steps.push(`send ${t}`) },
    restart: async (resume: boolean) => { steps.push(`restart ${resume}`) },
  }
  return { steps, deps }
}

// Defect caught: /fresh keeps the poisoned conversation (--continue) or says nothing while the session restarts.
test('/fresh acknowledges, then restarts the session without resume', async () => {
  const { steps, deps } = setup()
  assert.deepEqual(await freshRoutes(deps)['/fresh']({}), { sent: true })
  assert.deepEqual(steps, [`send ${FRESH_ACK}`, 'restart false'])
  assert.equal(FRESH_ACK, 'Starting fresh. I keep my memory, but this conversation is cleared. Give me a minute.')
})

test('restartSession: resume marker, kill the tmux session, kick the main job, in that order', async () => {
  const steps: string[] = []
  const d = {
    setResume: async (on: boolean) => { steps.push(`resume ${on}`) },
    tmux: async (...a: string[]) => { steps.push(`tmux ${a.join(' ')}`) },
    launchctl: async (...a: string[]) => { steps.push(`launchctl ${a.join(' ')}`) },
    target: 'gui/501/com.nlk.session', session: 'nlk',
  }
  await restartSession(d, false)
  assert.deepEqual(steps, ['resume false', 'tmux kill-session -t nlk', 'launchctl kickstart -k gui/501/com.nlk.session'])
  steps.length = 0
  await restartSession(d, true)
  assert.equal(steps[0], 'resume true')
})
