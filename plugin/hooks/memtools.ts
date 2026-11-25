import { dateOf } from './recall.ts'

export const OWN = 'mcp__nlk__'

export const MEM_DOWN = 'my service is down; try again in a minute'

const prop = (description: string) => ({ type: 'string', description })

export const MEM_SPECS = [
  {
    name: 'memory_save',
    description: 'Remember something about the owner or what happened. One short sentence per memory.',
    inputSchema: { type: 'object', properties: { text: prop('what to remember'), kind: { type: 'string', enum: ['fact', 'preference', 'decision', 'promise', 'feeling', 'event'] } }, required: ['text', 'kind'] },
    isDeferred: false,
  },
  {
    name: 'memory_search',
    description: 'Search your memories for something specific.',
    inputSchema: { type: 'object', properties: { query: prop('what to look for'), k: { type: 'number' } }, required: ['query'] },
    isDeferred: false,
  },
  {
    name: 'memory_forget',
    description: 'Delete one memory by its id (from memory_search or memory_about).',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    isDeferred: false,
  },
  {
    name: 'memory_about',
    description: 'List every current memory that mentions a topic, newest first.',
    inputSchema: { type: 'object', properties: { topic: prop('the topic') }, required: ['topic'] },
    isDeferred: false,
  },
] as const

type Reply = { ok: boolean; status: number; json: unknown }
export type Svc = (path: string, body: unknown) => Promise<Reply>
type Row = { id?: number; text?: string; created?: number }

const lines = (rows: unknown): string => {
  const list = Array.isArray(rows) ? (rows as Row[]) : []
  return list.length ? list.map(m => `#${m.id} ${dateOf(Number(m.created))} ${m.text}`).join('\n') : 'nothing found'
}

/** One tool call: a thin service call, rendered as text for the model. Its saves are always normal mode; `source` says which session saved. */
export async function memCall(svc: Svc, name: string, input: Record<string, unknown>, source: 'chat' | 'worker' = 'chat'): Promise<string> {
  const path = `/mem/${name.slice('memory_'.length)}`
  const body = name === 'memory_save' ? { text: input.text, kind: input.kind, mode: 'normal', source }
    : name === 'memory_search' ? { q: input.query, k: typeof input.k === 'number' ? input.k : 5 }
    : name === 'memory_forget' ? { id: input.id }
    : { topic: input.topic }
  const r = await svc(path, body)
  if (r.status === 0) return MEM_DOWN
  const j = r.json as Record<string, unknown> | null
  if (!r.ok) return `${name} failed: ${typeof j?.error === 'string' ? j.error : r.status}`
  if (name === 'memory_save') return `remembered (id ${String(j?.id)})`
  if (name === 'memory_forget') return `forgot memory ${String(input.id)}`
  return lines(name === 'memory_search' ? j?.hits : j?.memories)
}
