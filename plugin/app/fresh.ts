export const FRESH_ACK = 'Starting fresh. I keep my memory, but this conversation is cleared. Give me a minute.'

export type RestartDeps = {
  setResume(on: boolean): Promise<void>
  tmux(...args: string[]): Promise<unknown>
  launchctl(...args: string[]): Promise<unknown>
  target: string
  session: string
}

/** The chat session only: restarting the service too would stop it mid-run. With `resume` the conversation carries on (--continue); without, it starts clean. */
export async function restartSession(d: RestartDeps, resume: boolean): Promise<void> {
  await d.setResume(resume)
  await d.tmux('kill-session', '-t', d.session).catch(() => {})
  await d.launchctl('kickstart', '-k', d.target)
}

/** `/fresh`: the owner asked for a clean conversation. Memory stays; only the chat is cleared. */
export function freshRoutes(d: { send(text: string): Promise<void>; restart(resume: boolean): Promise<void> }): Record<string, (body: unknown) => Promise<unknown>> {
  return {
    '/fresh': async () => {
      await d.send(FRESH_ACK).catch(() => {})
      await d.restart(false)
      return { sent: true }
    },
  }
}
