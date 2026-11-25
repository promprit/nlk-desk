import { filesDir, TG, TG_DOWNLOAD } from './paths.ts'
import { sealedSpec } from './sealed.ts'

export type GuardPaths = {
  home: string; desk: string; tgState: string; ownerChat: string | null; sealed: readonly string[]
}
export type Verdict = { decision: 'allow' | 'deny'; reason?: string }

const PATH_KEYS = new Set(['file_path', 'path', 'notebook_path'])
// Free text, never opened as a path (a Glob pattern is checked on its own).
const TEXT_KEYS = new Set(['content', 'old_string', 'new_string', 'new_source', 'text', 'prompt', 'query', 'description', 'pattern'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const WILD = /[*?[\]{}]/
// macOS spellings of `/`: the Data firmlink and the boot volume's /Volumes link.
const ALIAS = /^\/(system\/volumes\/data|volumes\/macintosh hd)(?=\/|$)/
const ALIAS_IN = /\/(system\/volumes\/data|volumes\/macintosh hd)(?=[/\s]|$)/g
// Words in front of the real command word.
const PREFIX = new Set(['sudo', 'doas', 'command', 'builtin', 'exec', 'nice', 'nohup', 'time', 'env', 'caffeinate'])
const RM = new Set(['rm', 'rmdir', 'unlink', 'trash', 'shred', 'srm'])
const DEL_WORD = /(?<![\w.-])(rm|rmdir|unlink|trash|shred|srm)\b(?![./-])/
const DEL_OTHER = /\b(rmtree|rmsync|rmdirsync|unlinksync|os\.remove|os\.unlink|fs\.rm)\b|\.unlink\(|(^|\s)-delete\b|--delete|\bgit\b[^;&|]*\bclean\b|\.trash\b/
// Commands that walk a folder tree or move/copy/link it somewhere else (`cp`, `grep`, `ls` only with their recursive flag).
const TREE = new Set(['rg', 'ag', 'ack', 'find', 'fd', 'tar', 'bsdtar', 'gtar', 'zip', '7z', 'rsync', 'du', 'tree', 'ditto', 'mv', 'ln', 'cpio', 'pax', 'scp', 'mdfind'])
const RELOCATE = new Set(['mv', 'ln', 'cp', 'rsync', 'ditto', 'scp'])
const READ_ONLY = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'rg', 'jq', 'wc', 'ls', 'stat', 'file', 'diff', 'bat', 'echo'])
const SEND = /(osascript[^|;&]*\bsend\b|\bmail\b|\bsendmail\b|\bmsmtp\b|\bmutt\b|\bswaks\b|api\.telegram\.org|hooks\.slack\.com|discord(app)?\.com\/api\/webhooks|\bmailto:|\bimessage:|\bsms:|(127\.0\.0\.1|localhost|\[::1\]):4330\b)/
const OUTBOUND = /(^|_)(send|post|reply|publish|tweet|comment|invite|share|forward)/i
const INSTALL = /^(brew (install|reinstall|upgrade|tap|bundle)|pip[\d.]* install|python[\d.]* -m pip install|pipx install|uv tool install|gem install|cargo install|go install|mas install|port install|yarn global add)\b/
const GLOBAL_PM = /^(npm|pnpm|bun) (.* )?(i|install|add)\b/

const allow = (): Verdict => ({ decision: 'allow' })
const deny = (reason: string): Verdict => ({ decision: 'deny', reason })

export function normalize(path: string): string {
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return `/${parts.join('/')}`
}

export function under(path: string, root: string): boolean {
  const n = normalize(path)
  return n === root || n.startsWith(`${root}/`)
}

// Prefix roots (the last segment also covers longer names).
export function sealedRoots(home: string): string[] {
  return sealedSpec(home).filter(x => x.read).map(x => x.path)
}

const climbs = (rel: string): boolean => rel.split('/').includes('..')

// Lowercased absolute path (APFS is case-insensitive); `~` and `~user` are home, a relative path starts at `cwd` (null: unknown).
function expand(raw: string, home: string, cwd: string | null): string | null {
  let s = raw.replace(/^file:\/\//i, '')
  if (s.startsWith('~')) {
    const i = s.indexOf('/')
    s = home + (i < 0 ? '' : s.slice(i))
  } else if (!s.startsWith('/')) {
    if (cwd === null) return null
    s = `${cwd}/${s}`
  }
  let n = normalize(s.toLowerCase())
  while (ALIAS.test(n)) n = normalize(n.replace(ALIAS, '/'))
  return n
}

// Whether one path segment (maybe a glob) can name the root's segment `want`; `prefix`: `want` also covers longer names.
// `dots` false: shell globs, where a leading wildcard skips dot names.
function segMatch(seg: string, want: string, prefix: boolean, dots: boolean): boolean {
  if (!WILD.test(seg)) return prefix ? seg.startsWith(want) : seg === want
  if (!dots && want.startsWith('.') && !seg.startsWith('.')) return false
  if (!prefix) return globRe(seg).test(want)
  const head = seg.slice(0, seg.search(WILD))
  return head.startsWith(want) || want.startsWith(head)
}

type Rel = 'inside' | 'ancestor' | null
// Where `path` (globs allowed, `**` reaches everything below) sits relative to a sealed root;.
function relation(path: string, root: string, dots: boolean): Rel {
  const t = path.split('/').filter(Boolean)
  const r = root.split('/').filter(Boolean)
  for (let i = 0; i < r.length; i++) {
    const seg = t[i]
    if (seg === undefined) return 'ancestor'
    if (seg.includes('**')) return 'inside'
    if (!segMatch(seg, r[i] ?? '', i === r.length - 1, dots)) return null
  }
  return 'inside'
}

type Ctx = { home: string; desk: string; files: string; roots: string[]; inbox: string }
const ctxOf = (p: GuardPaths): Ctx => ({
  home: normalize(p.home.toLowerCase()),
  desk: normalize(p.desk.toLowerCase()),
  files: normalize(filesDir(p.home).toLowerCase()),
  roots: [...p.sealed, p.tgState, '/.vol'].map(r => normalize(r.toLowerCase())),
  inbox: `${normalize(p.tgState.toLowerCase())}/inbox`,
})
const relationIn = (abs: string, r: string, dots: boolean) => relation(abs, r, dots)

const sealedHit = (abs: string, c: Ctx, dots = true) => c.roots.find(r => relationIn(abs, r, dots) === 'inside')
// Read alone may open a file below the Telegram inbox (photos and files the owner sends); globs never.
const readHit = (abs: string, c: Ctx) => (abs.startsWith(`${c.inbox}/`) && !WILD.test(abs) ? undefined : sealedHit(abs, c))
const nearSealed = (abs: string, c: Ctx, dots = true) => c.roots.some(r => relationIn(abs, r, dots) !== null)
// Where deletes may happen: the desk and the files folder, never the folder itself.
const inWritable = (abs: string | null, c: Ctx) => abs !== null && (abs.startsWith(`${c.desk}/`) || abs.startsWith(`${c.files}/`))
// The desk files the assistant reads but never writes (the same list the launcher settings seal).
function deskSealedPath(abs: string, c: Ctx): boolean {
  if (!abs.startsWith(`${c.desk}/`)) return false
  const rel = abs.slice(c.desk.length + 1)
  const top = rel.split('/')[0] ?? ''
  return top === 'claude.md' || top === '.claude' || top === 'claude.local.md' || top === '.mcp.json' || top === '.git' || top === '.gitignore'
    || rel === 'private/persona.md' || rel === 'private/core.md' || rel.endsWith('/claude.md')
}

function globRe(seg: string): RegExp {
  const body = seg.replace(/\[[^\]]*\]/g, '\u0001').replace(/\{[^}]*\}/g, '\u0002').replace(/[.+^$()|\\[\]{}]/g, '\\$&')
    .replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '.').replace(/\u0002/g, '.*')
  return new RegExp(`^${body}$`)
}
const SETTINGS = ['settings.json', 'settings.local.json']
// A glob counts only with a literal letter in it: a bare `*` names every file.
const isSettings = (path: string) => {
  const b = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (!WILD.test(b)) return SETTINGS.includes(b)
  return /[a-z]/.test(b.replace(/\[[^\]]*\]|\{[^}]*\}/g, '')) && SETTINGS.some(s => globRe(b).test(s))
}
// A git config file can alias `push` to another word.
const isGitConfig = (abs: string) => /\/\.gitconfig$|\/\.?git\/config$/.test(abs)

// Collects [key, value] for every string in a tool input (array items take their parent's key).
function strings(v: unknown, key: string, out: [string, string][], depth = 0): [string, string][] {
  if (depth > 5) return out
  if (typeof v === 'string') out.push([key, v])
  else if (Array.isArray(v)) for (const item of v) strings(item, key, out, depth + 1)
  else if (v && typeof v === 'object') for (const [k, item] of Object.entries(v)) strings(item, k, out, depth + 1)
  return out
}

function fileVerdict(tool: string, x: Record<string, unknown>, c: Ctx, real?: { path: string }): Verdict {
  const pathOf = (raw: string): string | null => (!/^[~/]|^file:\/\//i.test(raw) && climbs(raw) ? null : expand(raw, c.home, c.desk))
  const hitOf = (abs: string) => (tool === 'Read' ? readHit(abs, c) : sealedHit(abs, c))
  for (const [k, v] of strings(x, '', [])) {
    const pathish = PATH_KEYS.has(k) || (!TEXT_KEYS.has(k) && !v.includes('\n') && /^([~/]|file:\/\/)/i.test(v))
    if (!pathish) continue
    const abs = pathOf(v)
    if (abs === null) return deny('a relative path may not climb with ..')
    const hit = hitOf(abs)
    if (hit) return deny(`${hit} is sealed`)
  }
  const realAbs = real ? expand(real.path, c.home, null) : null
  if (realAbs !== null && hitOf(realAbs)) return deny('the link leads into a sealed folder')
  if (WRITE_TOOLS.has(tool)) {
    for (const t of [typeof x.file_path === 'string' ? x.file_path : typeof x.notebook_path === 'string' ? x.notebook_path : '', real?.path ?? '']) {
      if (!t) continue
      if (isSettings(t)) return deny('settings.json is account config')
      const abs = expand(t, c.home, c.desk)
      if (abs !== null && isGitConfig(abs)) return deny('git config can alias push')
    }
  }
  if (WRITE_TOOLS.has(tool)) {
    for (const t of [typeof x.file_path === 'string' ? x.file_path : typeof x.notebook_path === 'string' ? x.notebook_path : '', real?.path ?? '']) {
      const abs = t ? expand(t, c.home, c.desk) : null
      if (abs !== null && deskSealedPath(abs, c)) return deny('that desk file is read-only')
    }
  }
  if (tool === 'Glob' || tool === 'Grep') {
    const base = typeof x.path === 'string' && x.path ? pathOf(x.path) : c.desk
    if (base === null || nearSealed(base, c) || (realAbs !== null && nearSealed(realAbs, c))) return deny('search inside one folder, not a parent of a sealed one')
    if (tool === 'Glob' && typeof x.pattern === 'string') {
      const pat = /^[~/]/.test(x.pattern) ? expand(x.pattern, c.home, null) : expand(`${base}/${x.pattern}`, c.home, null)
      if (pat === null || sealedHit(pat, c)) return deny('the pattern reaches a sealed folder')
    }
  }
  return allow()
}

// The command word: skips VAR=value words and prefixes such as sudo or env (with their flags).
function commandAt(words: string[]): number {
  let i = 0
  while (i < words.length) {
    const w = words[i] ?? ''
    if (/^[\w-]+=/.test(w)) i++
    else if (PREFIX.has(w.slice(w.lastIndexOf('/') + 1))) {
      i++
      while ((words[i] ?? '').startsWith('-')) i++
    } else break
  }
  return i
}
const base = (w: string) => w.slice(w.lastIndexOf('/') + 1)
const segmentsOf = (s: string) => s.split(/[\n;&|()`]/).map(x => x.trim().split(/\s+/).filter(Boolean)).filter(w => w.length > 0)
const flat = (cmd: string) => cmd.toLowerCase().replace(/\\/g, '').replace(/['"]/g, '')

export function installKey(command: string): string | null {
  for (const words of segmentsOf(flat(command))) {
    const i = commandAt(words)
    const line = [base(words[i] ?? ''), ...words.slice(i + 1)].join(' ')
    if (INSTALL.test(line) || (GLOBAL_PM.test(line) && /(^|\s)(-g|--global)(\s|$)/.test(line))) return command.trim().replace(/\s+/g, ' ')
  }
  return null
}

type Seg = { name: string; args: string[]; paths: string[] }

const recursive = (s: Seg): boolean => {
  const flags = s.args.filter(a => a.startsWith('-'))
  const short = (re: RegExp) => flags.some(f => /^-[^-]/.test(f) && re.test(f.slice(1)))
  if (TREE.has(s.name)) return true
  if (['grep', 'egrep', 'fgrep', 'zgrep'].includes(s.name)) return short(/r/) || flags.some(f => /^--(recursive|dereference-recursive|directories=recurse)$/.test(f)) || s.args.join(' ').includes('-d recurse')
  if (s.name === 'cp') return short(/[ra]/) || flags.some(f => /^--(recursive|archive)$/.test(f))
  if (s.name === 'ls') return short(/r/) || flags.includes('--recursive')
  return false
}

function deleteVerdict(segs: Seg[], s: string, c: Ctx): Verdict {
  if (!DEL_WORD.test(s) && !DEL_OTHER.test(s)) return allow()
  if (segs.some(g => ['cd', 'pushd', 'popd'].includes(g.name))) return deny('a delete after cd cannot be proven to stay in the desk or files folder')
  for (const g of segs) {
    const line = [g.name, ...g.args].join(' ')
    const outside = deny('deletes stay inside the desk or files folder (absolute paths under them)')
    if (RM.has(g.name)) {
      const targets = g.args.filter(a => !a.startsWith('-'))
      if (targets.length === 0 || !targets.every(a => inWritable(expand(a, c.home, null), c))) return outside
    } else if (g.name === 'find' && (DEL_WORD.test(line) || DEL_OTHER.test(line))) {
      const roots: string[] = []
      for (const a of g.args) { if (/^[-(!]/.test(a)) break; roots.push(a) }
      if (roots.length === 0 || !roots.every(a => inWritable(expand(a, c.home, null), c)) || !g.paths.every(a => inWritable(a, c))) return outside
    } else if (DEL_WORD.test(line) || DEL_OTHER.test(line)) return deny('only rm or find -delete with desk or files paths may delete')
  }
  return allow()
}

// Words are lowercased by `flat`, so `-X` reads `-x` and `-F` reads `-f`.
const ghApiWrites = (args: string[]): boolean => args.some((a, i) =>
  /^(-f|--field|--raw-field|--input)(=|$)/.test(a) || /^-f./.test(a)
  || ((a === '-x' || a === '--method') && args[i + 1] !== 'get') || (/^(-x|--method=)./.test(a) && !/^(-x|--method=)get$/.test(a)))
// gh is allow-listed: anything else may post, change or publish on GitHub in the owner's name.
const GH_READ = /^(view|list|status|diff|checks)$/

// The non-flag words of a gh call, `-R/--repo <repo>` skipped.
function ghWords(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (a === '-r' || a === '--repo') i++
    else if (!a.startsWith('-')) out.push(a)
  }
  return out
}

function ghVerdict(segs: Seg[]): Verdict {
  for (const g of segs.filter(s => s.name === 'gh')) {
    const [group = '', sub = ''] = ghWords(g.args)
    if (group === 'api') {
      if (ghApiWrites(g.args.slice(g.args.indexOf('api') + 1))) return deny('a GitHub API write goes out in the owner\'s name')
      continue
    }
    const read = group === 'status' || group === 'search' || (group === 'browse' && g.args.includes('--no-browser'))
      || (group === 'run' ? /^(list|view|watch)$/.test(sub) : group !== 'browse' && GH_READ.test(sub))
    if (!read) return deny('only gh reads are allowed; the rest goes out in the owner\'s name')
  }
  return allow()
}

const WEB = new Set(['curl', 'wget', 'http', 'xh'])
const WRITE_METHOD = /^(post|put|patch|delete)$/i
const POST_HOST = /(^|[\s/@])(api\.github\.com|uploads\.github\.com|hooks\.slack\.com|slack\.com\/api|discord(app)?\.com\/api|graph\.facebook\.com|api\.twitter\.com|api\.x\.com|(smtp|mail)\.[\w-]+(\.[\w-]+)+)(?![\w.-])|\bsmtps?:\/\//i

// Read on the case-kept command: curl's `-X`/`-F` differ from its `-x` (proxy) and `-f` (fail).
const webWrites = (name: string, args: string[]): boolean => args.some((a, i) =>
  ((a === '-X' || a === '--request' || a === '--method') && WRITE_METHOD.test(args[i + 1] ?? '')) || /^(-X|--request=|--method=)(post|put|patch|delete)$/i.test(a)
  || /^(-d|--data|-F|--form|--json|-T|--upload-file|--post-data|--post-file|--body-data|--body-file)/.test(a)
  || ((name === 'http' || name === 'xh') && (WRITE_METHOD.test(a) || a === '-f' || (!a.startsWith('-') && !/^[^=]+==/.test(a) && /^[^=:@/]+(:=|=|@)/.test(a)))))

// curl, wget, httpie and xh may read anywhere but may not write to a host that posts in the owner's name.
function webVerdict(command: string): Verdict {
  for (const words of segmentsOf(command.replace(/\\/g, '').replace(/['"]/g, ''))) {
    const i = commandAt(words)
    const name = base(words[i] ?? '').toLowerCase()
    const args = words.slice(i + 1)
    if (WEB.has(name) && POST_HOST.test(args.join(' ')) && webWrites(name, args)) return deny('a write to that host goes out in the owner\'s name')
  }
  return allow()
}

function bashVerdict(command: unknown, c: Ctx): Verdict {
  if (typeof command !== 'string' || !command.trim()) return deny('no command')
  const s = flat(command).replace(/\$\{home\}|\$home\b/g, c.home).replace(ALIAS_IN, '/')
  const hasVar = /[$`]/.test(s)
  // The guard reads globs as a default shell does: no dot matching, no zsh qualifiers like *(D).
  if (/dotglob|glob_?dots|[*?\]]\(/.test(s)) return deny('glob options and qualifiers the guard cannot read')
  const segs: Seg[] = []
  let cwd: string | null = null
  for (const words of segmentsOf(s)) {
    const i = commandAt(words)
    const g: Seg = { name: base(words[i] ?? ''), args: words.slice(i + 1), paths: [] }
    // Paths in this segment at or above a sealed root, a relocating command's destination (its last word) left out.
    let near = false
    const dest = RELOCATE.has(g.name) && !g.args.some(a => a === '-t' || a.startsWith('--target-directory')) ? words.length - 1 : -1
    for (const [n, w] of words.entries()) {
      for (const part of w.split(/[<>=]/)) {
        const cands = /^[~/]/.test(part) ? [part] : part.includes('/') ? [part.slice(part.indexOf('/')), part] : [part]
        for (const cand of cands) {
          if (!cand || (cand.startsWith('-') && !/^[~/]/.test(cand)) || cand.includes('://') || cand.startsWith('$')) continue
          const abs = expand(cand, c.home, cwd)
          if (abs === null) {
            if (climbs(cand)) return deny('a relative path may not climb with .. from an unknown folder')
            continue
          }
          const hit = sealedHit(abs, c, false)
          if (hit) return deny(`${hit} is sealed`)
          if (n > i) g.paths.push(abs)
          if (n !== dest && nearSealed(abs, c, false)) near = true
        }
      }
    }
    if (g.name === 'cd' || g.name === 'pushd') {
      const target = g.args.find(a => !a.startsWith('-') || a === '-') ?? '~'
      if (target === '-' || /[$`*?[{]/.test(target)) return deny('cd to a folder the guard cannot read')
      const abs = expand(target, c.home, cwd)
      if (abs === null && climbs(target)) return deny('cd .. from an unknown folder')
      if (abs !== null && nearSealed(abs, c)) return deny('cd into a parent of a sealed folder')
      cwd = abs
    }
    if (g.name === 'popd') cwd = null
    if (recursive(g) && near) return deny('a recursive command over a parent of a sealed folder')
    if (g.name === 'mdfind' && !g.args.includes('-onlyin')) return deny('mdfind needs -onlyin <folder>')
    if (g.name === 'locate') return deny('locate searches the whole disk')
    if (near && hasVar) return deny('variables next to a parent of a sealed folder')
    segs.push(g)
  }
  if (/\bsecurity\b/.test(s)) return deny('the keychain is sealed')
  // ps e / ps -E prints another process's environment, tokens included. A text heuristic over the
  // whole command, so bash -c "ps e" and xargs ps e count too: the word ps, then any later option word with e in it
  // (dash form -E, -ef or BSD letters e, auxe). It fails safe (ps -o etime, ps aux | grep node are denied too) and
  // does not stop an interpreter such as python -c from reading process info another way.
  if (/(^|[\s/;|&(`])ps\s(.*\s)?-?[a-z]*e[a-z]*([\s;|&)`]|$)/s.test(s)) return deny('ps with environment output is sealed; use ps ax or ps -p <pid> -o pid,comm')
  const noStash = s.replace(/\bstash\s+push\b/g, '')
  if (/\bgit/.test(noStash) && /\bpush\b|send-pack|http-push/.test(noStash)) return deny('git push is outward-facing')
  const del = deleteVerdict(segs, s, c)
  if (del.decision === 'deny') return del
  const settings = /settings(\.local)?\.json/.test(s) || segs.some(g => g.args.some(a => WILD.test(a) && isSettings(a)))
  if (settings && (/>|\btee\b/.test(s) || segs.some(g => !READ_ONLY.has(g.name)))) return deny('settings.json is account config')
  if (SEND.test(s)) return deny('NLK sends only to the owner on Telegram')
  const gh = ghVerdict(segs)
  if (gh.decision === 'deny') return gh
  const web = webVerdict(command)
  if (web.decision === 'deny') return web
  if (/--no-index\b/.test(s)) return deny('diff --no-index reads any file')
  if (installKey(command) !== null) return deny('installs are blocked; the owner can run it themselves')
  return allow()
}

// `real` is where a file tool's target lands after symlinks, as the wiring resolves it. Any error denies.
export function guardCheck(tool: string, input: unknown, p: GuardPaths & { allow: string[] }, real?: { path: string }): Verdict {
  try {
    const x = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    const c = ctxOf(p)
    if (tool === 'Bash') return bashVerdict(x.command, c)
    const v = fileVerdict(tool, x, c, real)
    if (v.decision === 'deny') return v
    // 7. Telegram only to the owner chat; any other MCP tool only when the owner listed it and it does not send.
    if (tool.startsWith(TG) && tool !== TG_DOWNLOAD) {
      const chat = x.chat_id
      if (p.ownerChat === null || (typeof chat !== 'string' && typeof chat !== 'number') || String(chat) !== p.ownerChat) return deny('Telegram goes only to the owner\'s chat')
    } else if (tool.startsWith('mcp__') && !tool.startsWith(TG)) {
      if (OUTBOUND.test(tool.slice(tool.lastIndexOf('__') + 2))) return deny('NLK sends only to the owner on Telegram')
      if (!p.allow.includes(tool)) return deny('that tool is not on the owner\'s tools.allow list')
    }
    return allow()
  } catch {
    return deny('guard error')
  }
}
