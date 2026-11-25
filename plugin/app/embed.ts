export const E5_MODEL = 'Xenova/multilingual-e5-small'

export type Embed = (texts: string[], kind?: 'query' | 'passage') => Promise<Float32Array[]>

type Runner = { run: (texts: string[]) => Promise<Float32Array[]>; dispose?: () => unknown }
type Timer = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void }

const BATCH = 16
const IDLE_MS = 600_000

/** Real loader. transformers.js passes `session_options` (an onnxruntime InferenceSession.SessionOptions) to the session;
 * the thread limits are `intraOpNumThreads` and `interOpNumThreads`. */
const realLoad = (cacheDir: string) => async (): Promise<Runner> => {
  const { env, pipeline } = await import('@huggingface/transformers')
  env.cacheDir = cacheDir
  const extractor = await pipeline('feature-extraction', E5_MODEL, { dtype: 'q8', session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } })
  return {
    run: async texts => {
      const out = await extractor(texts, { pooling: 'mean', normalize: true })
      return (out.tolist() as number[][]).map(r => Float32Array.from(r))
    },
    dispose: () => extractor.dispose(),
  }
}

/** multilingual-e5-small on at most 2 threads, loaded on first use from `cacheDir`, disposed after `idleMs` without a call and
 * reloaded on the next one. Texts run in batches of at most 16. e5 wants `query: ` / `passage: ` prefixes. */
export function e5Embedder(cacheDir: string, opts: { load?: () => Promise<Runner>; idleMs?: number; timer?: Timer } = {}): Embed {
  const load = opts.load ?? realLoad(cacheDir)
  const idleMs = opts.idleMs ?? IDLE_MS
  const timer: Timer = opts.timer ?? { set: (fn, ms) => { const h = setTimeout(fn, ms); h.unref(); return h }, clear: h => clearTimeout(h as NodeJS.Timeout) }
  let ready: Promise<Runner> | undefined
  let busy = 0
  let handle: unknown
  const arm = () => {
    if (handle !== undefined) timer.clear(handle)
    handle = timer.set(() => {
      handle = undefined
      if (busy || !ready) return
      const gone = ready
      ready = undefined
      gone.then(r => r.dispose?.()).catch(() => {})
    }, idleMs)
  }
  return async (texts, kind = 'passage') => {
    if (!texts.length) return []
    busy++
    try {
      ready ??= load().catch(e => { ready = undefined; throw e })
      const runner = await ready
      const out: Float32Array[] = []
      for (let i = 0; i < texts.length; i += BATCH) out.push(...await runner.run(texts.slice(i, i + BATCH).map(t => `${kind}: ${t}`)))
      return out
    } finally {
      busy--
      arm()
    }
  }
}
