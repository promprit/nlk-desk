export type RecallMem = { text: string; created: number }
type Reply = { ok: boolean; status: number; json: unknown }
type Svc = (path: string, body: unknown) => Promise<Reply>

export const RECALL_K = 3
export const RECALL_MAX = 600

// Asia/Bangkok date, YYYY-MM-DD (UTC+7, no DST).
export const dateOf = (at: number) => new Date(at + 7 * 3600_000).toISOString().slice(0, 10)

/** The block appended to an owner message: up to 3 memories, one line each, cut to 600 characters at a line boundary. Empty when there is nothing. */
export function recallBlock(mems: RecallMem[]): string {
  const one = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 300)
  const out: string[] = []
  for (const m of mems.slice(0, RECALL_K)) {
    const row = `- ${dateOf(m.created)} ${one(m.text)}`
    if (['<recall>', ...out, row, '</recall>'].join('\n').length > RECALL_MAX) break
    out.push(row)
  }
  return out.length ? ['<recall>', ...out, '</recall>'].join('\n') : ''
}

const hitsOf = <T>(r: Reply): T[] => {
  const h = (r.json as { hits?: unknown } | null)?.hits
  return r.ok && Array.isArray(h) ? (h as T[]) : []
}

/** Top 3 memories for what the owner just said; '' on any failure or no result. */
export async function recallFor(svc: Svc, q: string): Promise<string> {
  if (!q.trim()) return ''
  try {
    return recallBlock(hitsOf<RecallMem>(await svc('/mem/search', { q, k: RECALL_K })))
  } catch {
    return ''
  }
}
