import { expect, mock, test } from 'claude-code/testing'
import type { Register } from 'claude-code'

import { addedLines, envFiles, githubRepo, goesPublic, parsePush, parsePushes, prefilter, scanLines } from '../hooks/scan'

type On = Parameters<Register>[0]

const HU = { options: { language: 'hu' } }
// A tesztadatokat darabokból rakjuk össze, hogy maga a teszt fájl ne akadjon fenn a saját őrén.
const REF = 'qwertyuiop' + 'asdfghjklz'
const JWT = 'eyJ' + 'hbGciOiJIUzI1NiIs.eyJ' + 'yb2xlIjoic2VydmljZV9yb2xl.abcdefghijklmnop'
const KEY = 'sk_' + 'live_' + 'abcdefghijklmnopqrst'

const CTX = { home: '/Users/me', privateRepos: ['me/secret-app', 'secret-app'], watch: [], allow: [], ownEmail: 'me@example.com' }

const LOG = [
  '\u001eabc123',
  'Add config',
  '',
  'Co-Authored-By: Claude <noreply@anthropic.com>',
  '\u001f',
  'diff --git a/src/config.ts b/src/config.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/config.ts',
  '@@ -0,0 +1,4 @@',
  `+export const url = 'https://${REF}.supabase.co'`,
  `+export const key = '${JWT}'`,
  '+// see /Users/me/Programok/x and me/secret-app',
  `+const mail = '${'nagy.janos' + '@kft-partner.hu'}'`,
  'diff --git a/.env.local b/.env.local',
  '--- /dev/null',
  '+++ b/.env.local',
  '@@ -0,0 +1 @@',
  `+STRIPE=${KEY}`,
].join('\n')

const ref = (src: string, dst: string | null = null) => ({ src, dst })

test('a push parancs értelmezése', {}, async () => {
  expect(parsePush('git push')).toEqual({ dir: null, remote: null, refs: [ref('HEAD')], all: false })
  expect(parsePush('cd ~/x && git push -u origin feature')).toEqual({ dir: '~/x', remote: 'origin', refs: [ref('feature')], all: false })
  expect(parsePush('git -C /r push origin develop:main')).toEqual({ dir: '/r', remote: 'origin', refs: [ref('develop', 'main')], all: false })
  expect(parsePush('git push --force origin +HEAD:refs/heads/main')).toEqual({ dir: null, remote: 'origin', refs: [ref('HEAD', 'main')], all: false })
  expect(parsePush('git push --dry-run')).toBe(null)
  expect(parsePush('git push origin :old')).toBe(null)
  expect(parsePush('git status')).toBe(null)
  expect(goesPublic('gh repo edit me/x --visibility public --accept-visibility-change-consequences')).toBe(true)
  expect(goesPublic('gh repo create me/x --public --source . --push')).toBe(true)
  expect(githubRepo('git@github.com:me/x.git')).toBe('me/x')
  expect(githubRepo('https://github.com/me/x')).toBe('me/x')
})

test('a push nem csúszik át az átirányításon, a láncon és a kapcsolókon', {}, async () => {
  const origin = (refs = [ref('HEAD')], all = false) => ({ dir: null, remote: 'origin', refs, all })
  expect(parsePush('git push origin 2>&1')).toEqual(origin())
  expect(parsePush('git push 2>&1 | tail -5')?.remote).toBe(null)
  expect(parsePush('git push origin main > /tmp/out.log')).toEqual(origin([ref('main')]))
  expect(parsePush('git push --signed origin main')).toEqual(origin([ref('main')]))
  expect(parsePush('git push --repo upstream')?.remote).toBe('upstream')
  expect(parsePushes('git push --dry-run && git push origin main')).toEqual([origin([ref('main')])])
  expect(parsePushes('git push origin --delete old && git push -u origin new')).toEqual([origin([ref('new')])])
  expect(parsePush('git push origin main dev')?.refs).toEqual([ref('main'), ref('dev')])
  expect(parsePush('git push --all origin')).toEqual(origin([], true))
  expect(parsePush('git push origin "refs/heads/*:refs/heads/*"')?.all).toBe(true)
  expect(parsePush('(cd sub && /usr/bin/git push)')).toEqual({ dir: 'sub', remote: null, refs: [ref('HEAD')], all: false })
  expect(goesPublic('gh repo edit me/x --visibility "public"')).toBe(true)
  expect(goesPublic('gh api -X PATCH repos/me/x -f private=false')).toBe(true)
  expect(goesPublic('gh api -X PATCH repos/me/x -F visibility=public')).toBe(true)
  expect(goesPublic('gh repo view me/x')).toBe(false)
  expect(githubRepo('git@github-work:me/x.git')).toBe('me/x')
  expect(githubRepo('ssh://git@github.com:22/me/x.git')).toBe('me/x')
})

test('a Telegram-, github_pat- és retina-esetek', {}, async () => {
  const pat = 'github_' + 'pat_' + 'A'.repeat(40)
  const kinds = (text: string) => scanLines([{ file: 'a', line: 1, text }], CTX).map(f => f.kind)
  expect(kinds(`TOKEN=${pat}`)).toEqual(['apiKey'])
  expect(kinds('<img src="logo@2x.png">')).toEqual([])
  expect(kinds(`write to ${'info'}@kft-partner.hu`)).toEqual(['email'])
  // az előszűrő (első push) sem ejti el őket
  const pre = new RegExp(prefilter('/root'), 'i')
  expect(pre.test(`BOT=${'1234567890'}:AA${'b'.repeat(33)}`)).toBe(true)
  expect(pre.test(`TOKEN=${pat}`)).toBe(true)
  expect(pre.test('see /root/notes.txt')).toBe(true)
})

test('a hozzáadott sorokban megtalálja a kiszivárgó adatokat', {}, async () => {
  const lines = addedLines(LOG)
  expect(lines.find(l => l.text.includes('supabase'))).toEqual({ file: 'src/config.ts', line: 1, text: `export const url = 'https://${REF}.supabase.co'` })
  const kinds = scanLines(lines, CTX).map(f => `${f.kind}:${f.file}`)
  expect(kinds).toContain('supabaseRef:src/config.ts')
  expect(kinds).toContain('jwt:src/config.ts')
  expect(kinds).toContain('localPath:src/config.ts')
  expect(kinds).toContain('privateRepo:src/config.ts')
  expect(kinds).toContain('email:src/config.ts')
  expect(kinds).toContain('apiKey:.env.local')
  // a noreply címet és a saját e-mailt nem jelzi
  expect(kinds.join(' ')).not.toContain('commit abc123')
  expect(envFiles(LOG)).toEqual(['.env.local'])
  // a kivételként megjegyzett értéket nem jelzi
  expect(scanLines(lines, { ...CTX, allow: [REF] }).some(f => f.value === REF)).toBe(false)
  // egy táblázatsor Supabase-szel és puszta ID-vel
  expect(scanLines([{ file: 'README.md', line: 3, text: `| Supabase | \`${REF}\` |` }], CTX)[0]?.kind).toBe('supabaseRef')
})

// A git és a gh hívások: nyilvános repó, egy commit a távoli ág fölött.
function repo(on: On, visibility: string, log = LOG, extra: (cmd: string) => string | null = () => null) {
  mock.store(on)
  const ran: string[] = []
  on('session.cwd', () => ({ value: '/work/x' }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/Users/me' : e.name === 'LANG' ? 'hu_HU.UTF-8' : undefined }))
  on('process.run', (_$, e) => {
    const cmd = e.argv.join(' ')
    ran.push(cmd)
    const special = extra(cmd)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (special !== null) return out(special)
    if (cmd.startsWith('git remote get-url')) return out('git@github.com:me/x.git\n')
    if (cmd.startsWith('gh repo view')) return out(`${visibility}\n`)
    if (cmd.startsWith('gh repo list')) return out('me/secret-app\n')
    if (cmd.startsWith('git rev-parse --abbrev-ref')) return out('main\n')
    if (cmd.startsWith('git for-each-ref')) return out('refs/remotes/origin/main\n')
    if (cmd.startsWith('git log')) return out(log)
    if (cmd.startsWith('git config user.email')) return out('me@example.com\n')
    return out('', 1)
  })
  return ran
}

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

function shell(on: On) {
  const commands: string[] = []
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    commands.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })
  return commands
}

const bash = async ($: { tool: { call: (i: never) => Promise<unknown> } }, command: string) =>
  (await $.tool.call({ tool: 'Bash', command } as never)) as { deny?: string; isError?: boolean; text?: string }
const denied = (r: { deny?: string; isError?: boolean }) => r.deny !== undefined || r.isError === true

test('nyilvános repóba push: felugró kérdés; „Megtiltom” megállítja és a modell megkapja a listát', HU, async ($, on) => {
  repo(on, 'PUBLIC')
  const asked = answer(on, 'Megtiltom')
  const commands = shell(on)
  const r = await bash($, 'git push origin main')
  expect(denied(r)).toBe(true)
  expect(JSON.stringify(r)).toContain('Supabase projekt-ID')
  expect(asked[0]).toContain('Nyilvános repóba menne (me/x)')
  expect(asked[0]).toContain('.env fájl: .env.local')
  expect(asked[0]).toContain('[Megtiltom | Pushold így is | Pushold, jegyezd meg]')
  // a titkot maszkolva mutatja
  expect(asked[0]).not.toContain(REF)
  expect(commands).toEqual([])
})

test('„Pushold, jegyezd meg” után ugyanezért nem kérdez újra', HU, async ($, on) => {
  repo(on, 'PUBLIC')
  const asked = answer(on, 'Pushold, jegyezd meg')
  const commands = shell(on)
  expect(denied(await bash($, 'git push'))).toBe(false)
  expect(denied(await bash($, 'git push'))).toBe(false)
  expect(asked.length).toBe(1)
  expect(commands).toEqual(['git push', 'git push'])
})

test('privát repóba push: nem néz semmit, nem kérdez', HU, async ($, on) => {
  const ran = repo(on, 'PRIVATE')
  const asked = answer(on, 'Megtiltom')
  shell(on)
  expect(denied(await bash($, 'git push'))).toBe(false)
  expect(asked).toEqual([])
  expect(ran.some(c => c.startsWith('git log'))).toBe(false)
})

test('tiszta változás nyilvános repóba: nem kérdez', HU, async ($, on) => {
  repo(on, 'PUBLIC', ['diff --git a/a.ts b/a.ts', '+++ b/a.ts', '@@ -0,0 +1 @@', '+export const x = 1'].join('\n'))
  const asked = answer(on, 'Megtiltom')
  shell(on)
  expect(denied(await bash($, 'git push'))).toBe(false)
  expect(asked).toEqual([])
})

test('bezárt kérdés = tiltás; kikapcsolva nem kérdez', HU, async ($, on) => {
  repo(on, 'PUBLIC')
  const asked = answer(on, null)
  shell(on)
  expect(denied(await bash($, 'git push'))).toBe(true)
  await $.command.run({ command: 'pushor', args: 'ki', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as never)
  expect(denied(await bash($, 'git push'))).toBe(false)
  expect(asked.length).toBe(1)
})

test('nem push parancs: átengedi', HU, async ($, on) => {
  const ran = repo(on, 'PUBLIC')
  shell(on)
  expect(denied(await bash($, 'git status'))).toBe(false)
  expect(ran).toEqual([])
})

test('ha az ellenőrzés elhasal, a push nem megy ki (fail closed)', HU, async ($, on) => {
  mock.store(on)
  on('session.cwd', () => ({ value: '/work/x' }))
  on('process.run', () => ({ deny: 'no process here' }))
  const commands = shell(on)
  expect(denied(await bash($, 'git push'))).toBe(true)
  expect(denied(await bash($, 'ls'))).toBe(false)
  expect(commands).toEqual(['ls'])
})

test('`git push 2>&1` is átnézésre kerül', HU, async ($, on) => {
  repo(on, 'PUBLIC')
  const asked = answer(on, 'Megtiltom')
  const commands = shell(on)
  expect(denied(await bash($, 'git push origin main 2>&1 | tail -5'))).toBe(true)
  expect(asked.length).toBe(1)
  expect(commands).toEqual([])
})

test('a git hibája nem enged át ellenőrizetlenül (fail closed)', HU, async ($, on) => {
  mock.store(on)
  on('session.cwd', () => ({ value: '/work/x' }))
  on('env.get', (_$, e) => ({ value: e.name === 'LANG' ? 'hu_HU.UTF-8' : undefined }))
  on('process.run', (_$, e) => {
    const cmd = e.argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd.startsWith('git remote get-url')) return out('git@github.com:me/x.git\n')
    if (cmd.startsWith('gh repo view')) return out('PUBLIC\n')
    if (cmd.startsWith('git for-each-ref')) return out('refs/remotes/origin/main\n')
    if (cmd.startsWith('git log')) return out('', 128)
    return out('', 1)
  })
  const commands = shell(on)
  expect(denied(await bash($, 'git push origin main'))).toBe(true)
  expect(commands).toEqual([])
})

test('a pushRemote-ot követi, nem vakon az origint', HU, async ($, on) => {
  const ran = repo(on, 'PUBLIC', LOG, cmd => (cmd === 'git config --get branch.main.pushRemote' ? 'public\n' : null))
  answer(on, 'Megtiltom')
  shell(on)
  await bash($, 'git push')
  expect(ran).toContain('git remote get-url --push public')
})

test('a „jegyezd meg” repónként szól, nem mindenhol', HU, async ($, on) => {
  let url = 'git@github.com:me/x.git\n'
  repo(on, 'PUBLIC', LOG, cmd => (cmd.startsWith('git remote get-url') ? url : null))
  const asked = answer(on, 'Pushold, jegyezd meg')
  shell(on)
  await bash($, 'git push')
  url = 'git@github.com:me/y.git\n'
  await bash($, 'git push')
  expect(asked.length).toBe(2)
})
