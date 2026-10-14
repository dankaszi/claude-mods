// Tiszta függvények: melyik Supabase-hívás milyen veszélyes, és melyik projekthez tartozik a mappa.

export type Risk = 'read' | 'write' | 'destructive'

// Projekt-ref: a Supabase 20 kisbetűs azonosítója.
const REF = /^[a-z]{20}$/

export const isRef = (value: unknown): value is string => typeof value === 'string' && REF.test(value)

// mcp__supabase__execute_sql, mcp__claude_ai_Supabase__execute_sql, … → execute_sql
export function supabaseAction(tool: string): string | null {
  const m = /^mcp__([^_].*?)__(.+)$/.exec(tool)
  if (m === null || !/supabase/i.test(m[1] ?? '')) return null
  return m[2] ?? null
}

const READ_ACTIONS = /^(list_|get_|search_docs$|generate_typescript_types$|query_logs$|confirm_cost$)/
// Ezek a megegyező projekten is mindig kérdeznek. A merge_branch a branch migrációit élesbe viszi.
const DESTRUCTIVE_ACTIONS = new Set(['delete_branch', 'reset_branch', 'merge_branch', 'rebase_branch', 'pause_project', 'restore_project'])

// DROP (bármi), TRUNCATE, DELETE, MERGE … DELETE, ALTER … DROP, jogosultság-visszavonás vagy -megnyitás,
// a kapcsolatokat bontó és objektumot törlő függvények.
const DESTRUCTIVE_SQL = [
  /\bdrop\s+\w/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\bmerge\b[\s\S]*\bdelete\b/i,
  /\balter\s+table\b[^;]*\bdrop\b/i,
  /\brevoke\b/i,
  /\bgrant\b[^;]*\bto\s+(public|anon|authenticated)\b/i,
  /\b(create|alter)\s+policy\b[^;]*\b(using|with\s+check)\s*\(\s*true\s*\)/i,
  /\bdisable\s+row\s+level\s+security\b/i,
  /\bpg_(terminate|cancel)_backend\b|\blo_unlink\b|\bpg_drop_replication_slot\b/i,
]
const READ_SQL = /^\s*(select|with|explain|show|values|table)\b/i

// A szövegkonstansokat kiürítjük, a kommenteket szóközre cseréljük, így `select '--'; drop table x`
// és `drop/**/table x` sem csúszik át. A $$ … $$ törzs kód marad (egy DO blokk azonnal fut).
export function normalizeSql(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const two = sql.slice(i, i + 2)
    if (two === '--') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end
      out += ' '
    } else if (two === '/*') {
      // A Postgres blokk-kommentjei egymásba ágyazhatók.
      let depth = 0
      while (i < sql.length) {
        if (sql.startsWith('/*', i)) {
          depth++
          i += 2
        } else if (sql.startsWith('*/', i)) {
          depth--
          i += 2
          if (depth === 0) break
        } else i++
      }
      out += ' '
    } else if (c === "'") {
      i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2
        else if (sql[i] === "'") break
        else i++
      }
      i++
      out += "''"
    } else if (c === '"') {
      const end = sql.indexOf('"', i + 1)
      out += sql.slice(i, end === -1 ? sql.length : end + 1)
      i = end === -1 ? sql.length : end + 1
    } else if (c === '$' && /^\$[A-Za-z_]*\$/.test(sql.slice(i))) {
      // A dollár-idézőjel jelölőit eldobjuk, a törzset megtartjuk.
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0] ?? '$$'
      out += ' '
      i += tag.length
    } else {
      out += c
      i++
    }
  }
  return out
}

// A zárójeles részeket külön „hatókörként” nézzük: a felső szintű szöveg () helyőrzőkkel, plusz minden zárójel belseje.
function scopes(sql: string): string[] {
  const found: string[] = []
  const stack: number[] = []
  let top = ''
  const inner: string[] = []
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (c === '(') {
      stack.push(i)
      if (stack.length === 1) top += '()'
    } else if (c === ')' && stack.length > 0) {
      const start = stack.pop() ?? 0
      if (stack.length === 0) inner.push(sql.slice(start + 1, i))
    } else if (stack.length === 0) top += c
  }
  found.push(top)
  for (const part of inner) found.push(...scopes(part))
  return found
}

// UPDATE … SET a saját hatókörében WHERE nélkül (al-lekérdezés WHERE-je nem számít; a CTE-ben lévő UPDATE is).
// A `FOR UPDATE`, `ON UPDATE CASCADE`, `ON CONFLICT DO UPDATE` nem tábla-szintű UPDATE.
function updateWithoutWhere(sql: string): boolean {
  return scopes(sql).some(scope =>
    scope.split(';').some(stmt => /(?<!\b(?:for|on|do|key)\s+)\bupdate\s+[^;]*?\bset\b/i.test(stmt) && !/\bwhere\b/i.test(stmt)),
  )
}

export function sqlRisk(sql: string): Risk {
  const clean = normalizeSql(sql)
  if (DESTRUCTIVE_SQL.some(re => re.test(clean)) || updateWithoutWhere(clean)) return 'destructive'
  const statements = clean.split(';').filter(s => s.trim() !== '')
  const writes = /\b(insert|update|delete|merge|into|call|do)\b/i
  if (statements.length > 0 && statements.every(s => READ_SQL.test(s) && !writes.test(s.replace(/\bfor\s+(no\s+key\s+)?update\b/gi, '')))) return 'read'
  return 'write'
}

export function actionRisk(action: string, input: Record<string, unknown>): Risk {
  if (action === 'execute_sql') return sqlRisk(typeof input.query === 'string' ? input.query : '')
  if (DESTRUCTIVE_ACTIONS.has(action)) return 'destructive'
  if (action === 'apply_migration' && typeof input.query === 'string' && sqlRisk(input.query) === 'destructive') return 'destructive'
  if (READ_ACTIONS.test(action)) return 'read'
  return 'write'
}

// Postgres kapcsolati URL-ből a projekt: db.<ref>.supabase.co, vagy a pooler felhasználóneve: postgres.<ref>
export function refFromDbUrl(text: string): string | null {
  return /\bdb\.([a-z]{20})\.supabase\.(?:co|in)\b/.exec(text)?.[1] ?? /\bpostgres\.([a-z]{20})[:@]/.exec(text)?.[1] ?? null
}

// A Bash-ban futó supabase CLI: --project-ref / --db-url és a veszélyes alparancsok; meg a Supabase adatbázisra menő psql.
export type CliCall = { ref: string | null; risk: Risk; what: string }

const CLI = /(?:^|[\s;&|(])(?:(?:npx|bunx|pnpx)\s+(?:-y\s+|--yes\s+)?|(?:pnpm|yarn)\s+(?:dlx\s+|exec\s+)?)?(?:\S*\/)?supabase(?:@\S+)?\s+((?:[a-z][a-z-]*\s*){1,2})/

export function supabaseCli(command: string): CliCall | null {
  const psql = psqlCall(command)
  if (psql !== null) return psql
  const m = CLI.exec(command)
  if (m === null) return null
  const ref = /--project-ref[=\s]+["']?([a-z]{20})\b/.exec(command)?.[1] ?? refFromDbUrl(command)
  const what = m[1]?.trim() || 'supabase'
  const remote = /--linked|--db-url/.test(command)
  let risk: Risk = 'read'
  if (
    (remote && /\bdb\s+reset\b|\bmigration\s+down\b/.test(command)) ||
    /\bprojects\s+delete\b|\bbranches\s+delete\b|\bmigration\s+repair\b|\bstorage\s+rm\b|\bdomains\s+delete\b|\bvanity-subdomains\s+delete\b|\bsso\s+remove\b|\bpostgres-config\s+delete\b/.test(command)
  ) {
    risk = 'destructive'
  } else if (
    (remote && /\bmigration\s+up\b|\bdb\s+execute\b|\bseed\b/.test(command)) ||
    /\bdb\s+push\b|\bfunctions\s+(deploy|delete)\b|\bsecrets\s+(set|unset)\b|\bconfig\s+push\b|\blink\b|\bstorage\s+(cp|mv)\b|\bnetwork-(restrictions|bans)\s+(update|remove)\b|\bssl-enforcement\s+update\b|\bpostgres-config\s+update\b|\bsso\s+(add|update)\b|\bdomains\s+(create|activate|reverify)\b|\bvanity-subdomains\s+activate\b|\bbranches\s+(create|update)\b/.test(command)
  ) {
    risk = 'write'
  }
  return { ref, risk, what }
}

// psql "postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres" -c '…'
function psqlCall(command: string): CliCall | null {
  if (!/(?:^|[\s;&|(])(?:\S*\/)?psql\s/.test(command) || !/supabase\.(?:co|com|in)\b/.test(command)) return null
  const ref = refFromDbUrl(command)
  const sql = /(?:-c|--command)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(command)
  // Fájlból vagy interaktívan futó SQL-t nem látunk: írásnak vesszük.
  const risk: Risk = sql === null ? 'write' : sqlRisk(sql[1] ?? sql[2] ?? '')
  return { ref, risk, what: 'psql' }
}

// A mappa fájljaiból kiolvasható projekt-ref-ek.
export const LOOK_IN = [
  'supabase/.temp/project-ref',
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  'frontend/.env',
  'frontend/.env.local',
  'web/.env.local',
  'app/.env.local',
  'CLAUDE.md',
]

export function refsIn(text: string): string[] {
  const found = new Set<string>()
  const trimmed = text.trim()
  if (isRef(trimmed)) found.add(trimmed)
  for (const m of text.matchAll(/https?:\/\/([a-z]{20})\.supabase\.(co|in)\b/g)) found.add(m[1] ?? '')
  for (const m of text.matchAll(/project[ _-]?(?:id|ref)\W{1,6}([a-z]{20})\b/gi)) found.add(m[1] ?? '')
  for (const m of text.matchAll(/SUPABASE_(?:PROJECT_)?(?:ID|REF)\s*=\s*["']?([a-z]{20})\b/g)) found.add(m[1] ?? '')
  return [...found].filter(isRef)
}

export function short(ref: string): string {
  return `${ref.slice(0, 6)}…`
}
