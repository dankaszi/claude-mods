import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Register } from 'claude-code'

import { actionRisk, refsIn, sqlRisk, supabaseAction, supabaseCli } from '../hooks/classify'

type On = Parameters<Register>[0]

const HU = { options: { language: 'hu' } }
const OWN = 'aaaaaaaaaaaaaaaaaaaa'
const OTHER = 'bbbbbbbbbbbbbbbbbbbb'
const ROOT = '/work/shop'

// A mappa: a .env.local-ban a saját projekt URL-je.
function folder(on: On, files: Record<string, string> = { [`${ROOT}/.env.local`]: `NEXT_PUBLIC_SUPABASE_URL=https://${OWN}.supabase.co\n` }) {
  mock.store(on)
  on('session.cwd', () => ({ value: ROOT }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('fs.exists', (_$, e) => ({ value: e.path in files }))
  on('fs.read', (_$, e) => ({ value: files[e.path] ?? '' }))
}

// A felugró kérdés: a teszt megadja, melyik gombot „nyomja meg” a felhasználó.
function answer(on: On, label: string | null) {
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = (e as unknown as { questions: { question: string; options: { label: string }[] }[] }).questions[0]!
    asked.push(`${q.question} [${q.options.map(o => o.label).join(' | ')}]`)
    if (label === null) return { deny: 'dismissed' }
    return { result: { questions: [], answers: { [q.question]: label } } } as never
  })
  return asked
}

function ran(on: On) {
  const calls: string[] = []
  on('tool.call', ($, e) => {
    calls.push(e.tool)
    return { result: 'ok' } as never
  })
  return calls
}

const denied = (r: { deny?: string; isError?: boolean }) => r.deny !== undefined || r.isError === true

const sql = ($: Engine, project_id: string, query: string) =>
  $.tool.call({ tool: 'mcp__supabase__execute_sql', project_id, query } as never) as Promise<{ deny?: string; isError?: boolean; text?: string; context?: string[] }>

test('osztályozás: SQL, eszköznevek, CLI, ref-ek', {}, async () => {
  expect(sqlRisk('select * from users')).toBe('read')
  expect(sqlRisk('with x as (select 1) select * from x')).toBe('read')
  expect(sqlRisk('insert into t values (1)')).toBe('write')
  expect(sqlRisk('drop table users')).toBe('destructive')
  expect(sqlRisk('update users set role = 1')).toBe('destructive')
  expect(sqlRisk('update users set role = 1 where id = 2')).toBe('write')
  expect(sqlRisk('-- drop table x\nselect 1')).toBe('read')
  expect(supabaseAction('mcp__claude_ai_Supabase__apply_migration')).toBe('apply_migration')
  expect(supabaseAction('mcp__github__list_repos')).toBe(null)
  expect(actionRisk('list_tables', {})).toBe('read')
  expect(actionRisk('reset_branch', {})).toBe('destructive')
  expect(actionRisk('apply_migration', { query: 'create table x (id int)' })).toBe('write')
  expect(supabaseCli(`supabase db push --project-ref ${OTHER}`)).toEqual({ ref: OTHER, risk: 'write', what: 'db push' })
  expect(supabaseCli('npx supabase db reset --linked')?.risk).toBe('destructive')
  expect(supabaseCli('ls supabase/')).toBe(null)
  expect(refsIn(`Supabase Project ID: \`${OWN}\``)).toEqual([OWN])
})

test('SQL: szövegkonstans, komment, al-lekérdezés, CTE nem rejti el a rombolást', {}, async () => {
  expect(sqlRisk("select '--'; drop table users")).toBe('destructive')
  expect(sqlRisk('drop/**/table x')).toBe('destructive')
  expect(sqlRisk('update/**/t set a=1')).toBe('destructive')
  expect(sqlRisk("update users set plan = (select id from plans where name='free')")).toBe('destructive')
  expect(sqlRisk('with u as (update t set a=1 returning *) select 1')).toBe('destructive')
  expect(sqlRisk('merge into t using s on t.id = s.id when matched then delete')).toBe('destructive')
  for (const what of ['owned by authenticated', 'sequence s', 'domain d', 'procedure p', 'user u', 'foreign table f', 'subscription s']) {
    expect(sqlRisk(`drop ${what}`)).toBe('destructive')
  }
  expect(sqlRisk('select pg_terminate_backend(pid) from pg_stat_activity')).toBe('destructive')
  expect(sqlRisk('grant all on all tables in schema public to anon')).toBe('destructive')
  expect(sqlRisk('create policy p on t for select using (true)')).toBe('destructive')
  expect(sqlRisk('select * into newt from t')).toBe('write')
  expect(sqlRisk('do $$ begin drop table x; end $$')).toBe('destructive')
  // ami nem rombol, az nem is riaszt
  expect(sqlRisk("insert into logs values ('truncate failed')")).toBe('write')
  expect(sqlRisk("select 'drop table x'")).toBe('read')
  expect(sqlRisk('select * from t where id = 1 for update')).toBe('read')
  expect(sqlRisk('insert into t values (1) on conflict (id) do update set a = 2')).toBe('write')
})

test('CLI: npx/bunx/node_modules, --db-url, psql, link és a többi távoli parancs', {}, async () => {
  expect(supabaseCli('npx supabase@latest db push')?.risk).toBe('write')
  expect(supabaseCli('bunx supabase@2 db push')?.risk).toBe('write')
  expect(supabaseCli('./node_modules/.bin/supabase db push')?.risk).toBe('write')
  expect(supabaseCli(`supabase db push --db-url postgresql://postgres:x@db.${OTHER}.supabase.co:5432/postgres`)?.ref).toBe(OTHER)
  expect(supabaseCli(`supabase db reset --db-url postgresql://postgres.${OTHER}:x@aws-0.pooler.supabase.com:6543/postgres`)).toEqual({ ref: OTHER, risk: 'destructive', what: 'db reset' })
  expect(supabaseCli(`psql "postgresql://postgres:x@db.${OTHER}.supabase.co:5432/postgres" -c 'drop table x'`)).toEqual({ ref: OTHER, risk: 'destructive', what: 'psql' })
  expect(supabaseCli(`psql "postgresql://postgres:x@db.${OTHER}.supabase.co:5432/postgres"`)?.risk).toBe('write')
  expect(supabaseCli(`supabase link --project-ref ${OTHER}`)?.risk).toBe('write')
  expect(supabaseCli('supabase migration down --linked')?.risk).toBe('destructive')
  expect(supabaseCli('supabase storage rm -r ss:///bucket')?.risk).toBe('destructive')
  expect(supabaseCli('supabase ssl-enforcement update --enable-db-ssl-enforcement')?.risk).toBe('write')
  expect(supabaseCli('supabase migration list')?.risk).toBe('read')
  expect(supabaseCli('cd supabase && ls')).toBe(null)
  expect(actionRisk('merge_branch', { branch_id: 'x' })).toBe('destructive')
})

test('a mappa projektjén az olvasás és a sima írás kérdés nélkül fut', HU, async ($, on) => {
  folder(on)
  const asked = answer(on, 'Megtiltom')
  const calls = ran(on)
  expect((await sql($, OWN, 'select 1')).deny).toBe(undefined)
  expect((await sql($, OWN, 'insert into t values (1)')).deny).toBe(undefined)
  expect(asked).toEqual([])
  expect(calls).toEqual(['mcp__supabase__execute_sql', 'mcp__supabase__execute_sql'])
})

test('más projektre menő írásnál felugró kérdés; „Megtiltom” megállítja', HU, async ($, on) => {
  folder(on)
  const asked = answer(on, 'Megtiltom')
  const calls = ran(on)
  const r = await sql($, OTHER, 'insert into t values (1)')
  expect(denied(r)).toBe(true)
  expect(JSON.stringify(r)).toContain('supabase-guard megállította')
  expect(asked[0]).toContain('shop')
  expect(asked[0]).toContain('[Megtiltom | Engedélyezem | Ez a mappa projektje]')
  expect(calls).toEqual([])
})

test('„Ez a mappa projektje” megjegyzi, utána nem kérdez', HU, async ($, on) => {
  folder(on)
  const asked = answer(on, 'Ez a mappa projektje')
  const calls = ran(on)
  expect(denied(await sql($, OTHER, 'insert into t values (1)'))).toBe(false)
  expect(denied(await sql($, OTHER, 'insert into t values (2)'))).toBe(false)
  expect(asked.length).toBe(1)
  expect(calls.length).toBe(2)
})

test('romboló SQL a saját projekten is kérdez; bezárt kérdés = tiltás', HU, async ($, on) => {
  folder(on)
  const asked = answer(on, null)
  const calls = ran(on)
  const r = await sql($, OWN, 'drop table users')
  expect(denied(r)).toBe(true)
  expect(asked[0]).toContain('Romboló művelet')
  expect(asked[0]).toContain('[Megtiltom | Engedélyezem]')
  expect(calls).toEqual([])
})

test('más projekt olvasása fut, de a modell figyelmeztetést kap', HU, async ($, on) => {
  folder(on)
  const asked = answer(on, 'Megtiltom')
  ran(on)
  const r = await sql($, OTHER, 'select 1')
  expect(denied(r)).toBe(false)
  expect(asked).toEqual([])
  expect(JSON.stringify(r)).toContain('Figyelem (supabase-guard)')
})

test('ismeretlen mappában az írás kérdez; „session végéig” után nem', HU, async ($, on) => {
  folder(on, {})
  const asked = answer(on, 'Engedem a session végéig')
  ran(on)
  await sql($, OTHER, 'insert into t values (1)')
  await sql($, OTHER, 'insert into t values (2)')
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('nem találtam Supabase-projektet')
})

test('kikapcsolva nem kérdez', HU, async ($, on) => {
  folder(on)
  const asked = answer(on, 'Megtiltom')
  ran(on)
  await $.command.run({ command: 'supaor', args: 'ki', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as never)
  expect(denied(await sql($, OTHER, 'drop table x'))).toBe(false)
  expect(asked).toEqual([])
})

test('a supabase CLI más projektre: kérdez', HU, async ($, on) => {
  folder(on)
  const asked = answer(on, 'Megtiltom')
  ran(on)
  const r = (await $.tool.call({ tool: 'Bash', command: `supabase db push --project-ref ${OTHER}` } as never)) as { isError?: boolean }
  expect(denied(r)).toBe(true)
  expect(asked[0]).toContain('supabase db push')
})

test('a „session végéig” engedély mappához kötött', HU, async ($, on) => {
  let cwd = '/work/unknown'
  const files: Record<string, string> = { [`${ROOT}/.env.local`]: `NEXT_PUBLIC_SUPABASE_URL=https://${OWN}.supabase.co\n` }
  mock.store(on)
  on('session.cwd', () => ({ value: cwd }))
  on('session.repo', () => ({ value: { root: cwd, remote: null, internal: false, name: null } }))
  on('fs.exists', (_$, e) => ({ value: e.path in files }))
  on('fs.read', (_$, e) => ({ value: files[e.path] ?? '' }))
  const asked = answer(on, 'Engedem a session végéig')
  ran(on)
  await sql($, OTHER, 'insert into t values (1)')
  cwd = ROOT
  await sql($, OTHER, 'insert into t values (2)')
  expect(asked.length).toBe(2)
  expect(asked[1]).toContain('shop')
})
