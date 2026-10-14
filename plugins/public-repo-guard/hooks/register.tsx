import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { addedLines, envFiles, githubRepo, grepLines, parsePushes, prefilter, publicTarget, scanLines } from './scan'
import type { Finding, Line } from './scan'

const isOn = atom({ plugin: 'public-repo-guard', key: 'isOn' } as const, true)
// Az éppen feltett kérdés szövege: a decision-popup ez alapján rajzol piros „őr” keretet.
const asking = atom({ plugin: 'public-repo-guard', key: 'asking' } as const, null)

type Lang = 'hu' | 'en'

const KINDS = {
  hu: {
    supabaseRef: 'Supabase projekt-ID',
    jwt: 'JWT / Supabase-kulcs',
    privateKey: 'privát kulcs',
    apiKey: 'API-kulcs',
    email: 'e-mail-cím',
    localPath: 'helyi útvonal',
    privateRepo: 'privát repó neve',
    watched: 'figyelt szöveg',
    envFile: '.env fájl',
    historyUnchecked: 'túl nagy history, csak a mostani fájlokat néztem át',
    unchecked: 'más repót tennél nyilvánossá, a tartalmát innen nem látom',
  },
  en: {
    supabaseRef: 'Supabase project ID',
    jwt: 'JWT / Supabase key',
    privateKey: 'private key',
    apiKey: 'API key',
    email: 'email address',
    localPath: 'local path',
    privateRepo: 'private repo name',
    watched: 'watched text',
    envFile: '.env file',
    historyUnchecked: 'history too large, only the current files were checked',
    unchecked: 'a different repo goes public; its content cannot be checked from here',
  },
} as const

const STRINGS = {
  hu: {
    header: 'Push-őr',
    command: 'Push-őr: nyilvános repóba push előtt titkok, ID-k, e-mailek keresése',
    hint: '[be|ki|figyel <szöveg>]',
    on: 'Push-őr bekapcsolva.',
    off: 'Push-őr kikapcsolva: a pushok ellenőrzés nélkül mennek.',
    watching: (w: string) => `Figyelem mostantól: „${w}”.`,
    usage: 'Használat: /pushor [be|ki|figyel <szöveg>]',
    deny: 'Megtiltom',
    push: 'Pushold így is',
    remember: 'Pushold, jegyezd meg',
    question: (repo: string, n: number, list: string) => `Nyilvános repóba menne (${repo}), és ${n} gyanús dolgot találtam:\n${list}\nMehet?`,
    more: (n: number) => `  … és még ${n}`,
    denied: (repo: string, list: string) =>
      `A public-repo-guard megállította a pusht (${repo} nyilvános), mert ezek kerülnének ki:\n${list}\nTávolítsd el vagy anonimizáld őket, és írd át az érintett commitokat is (a historyban is benne vannak), aztán kérdezd meg a felhasználót, mielőtt újra pusholsz.`,
    dismissed: 'A public-repo-guard megállította a pusht: a felhasználó bezárta a kérdést. Ne pushold újra kérdés nélkül.',
    other: (answer: string) => `A public-repo-guard megállította a pusht; a felhasználó válasza: „${answer}”`,
    failed: 'public-repo-guard: az ellenőrzés nem sikerült, ezért a push nem ment ki. /pushor ki után kézzel engedhető.',
  },
  en: {
    header: 'Push guard',
    command: 'Push guard: look for secrets, IDs and emails before pushing to a public repo',
    hint: '[on|off|figyel <text>]',
    on: 'Push guard on.',
    off: 'Push guard off: pushes go out unchecked.',
    watching: (w: string) => `Now watching for "${w}".`,
    usage: 'Usage: /pushor [on|off|figyel <text>]',
    deny: 'Deny',
    push: 'Push anyway',
    remember: 'Push, remember these',
    question: (repo: string, n: number, list: string) => `This goes to a public repo (${repo}), and I found ${n} suspicious items:\n${list}\nGo ahead?`,
    more: (n: number) => `  … and ${n} more`,
    denied: (repo: string, list: string) =>
      `public-repo-guard stopped the push (${repo} is public) because these would be published:\n${list}\nRemove or anonymise them, rewrite the commits that carry them (they are in the history too), then ask the user before pushing again.`,
    dismissed: 'public-repo-guard stopped the push: the user closed the question. Do not push again without asking.',
    other: (answer: string) => `public-repo-guard stopped the push; the user answered: "${answer}"`,
    failed: 'public-repo-guard: the check failed, so the push did not go out. /pushor off lets it through by hand.',
  },
}

let lang: Lang = 'en'
const t = () => STRINGS[lang]

async function pickLanguage($: EngineInterface, setting: unknown): Promise<Lang> {
  if (setting === 'hu' || setting === 'en') return setting
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LANG')) || ''
  return locale.toLowerCase().startsWith('hu') ? 'hu' : 'en'
}

async function strings($: EngineInterface, key: string): Promise<string[]> {
  const value = await $.store.get(key)
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

// Láthatóság repónként, 10 percig.
const visibility = new Map<string, { at: number; value: string }>()
const VISIBILITY_MS = 10 * 60_000
const PRIVATE_LIST_MS = 24 * 60 * 60_000

async function run($: EngineInterface, argv: string[], cwd: string) {
  return $.process.run(argv, { cwd, timeoutMs: 20_000 })
}

async function visibilityOf($: EngineInterface, repo: string, cwd: string): Promise<string> {
  const hit = visibility.get(repo)
  if (hit !== undefined && Date.now() - hit.at < VISIBILITY_MS) return hit.value
  const r = await run($, ['gh', 'repo', 'view', repo, '--json', 'visibility', '-q', '.visibility'], cwd)
  const value = r.exitCode === 0 ? r.stdout.trim().toUpperCase() : 'UNKNOWN'
  visibility.set(repo, { at: Date.now(), value })
  return value
}

// A felhasználó privát repóinak nevei (owner/name és a jellegzetes rövid név), naponta frissítve.
async function privateRepos($: EngineInterface, owner: string, cwd: string): Promise<string[]> {
  const saved = (await $.store.get('privateRepos')) as { at?: number; owner?: string; list?: string[] } | undefined
  let list = saved?.owner === owner && Date.now() - (saved.at ?? 0) < PRIVATE_LIST_MS ? (saved.list ?? []) : null
  if (list === null) {
    const r = await run($, ['gh', 'repo', 'list', owner, '--visibility', 'private', '--limit', '300', '--json', 'nameWithOwner', '-q', '.[].nameWithOwner'], cwd)
    list = r.exitCode === 0 ? r.stdout.split('\n').map(s => s.trim()).filter(s => s !== '') : (saved?.list ?? [])
    if (r.exitCode === 0) await $.store.set('privateRepos', { at: Date.now(), owner, list })
  }
  const bare = list.map(full => full.split('/')[1] ?? '').filter(name => /[-_]/.test(name) || name.length >= 10)
  return [...list, ...bare]
}

function resolveDir(cwd: string, dir: string | null, home: string | null): string {
  if (dir === null) return cwd
  const expanded = home !== null ? dir.replace(/^~(?=\/|$)/, home) : dir
  return expanded.startsWith('/') ? expanded : `${cwd}/${expanded}`
}

type Scan = { repo: string; findings: Finding[] }

// A git saját sorrendje: branch.<b>.pushRemote, remote.pushDefault, branch.<b>.remote, végül origin.
async function defaultRemote($: EngineInterface, dir: string): Promise<string> {
  const branch = (await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], dir)).stdout.trim()
  for (const key of [`branch.${branch}.pushRemote`, 'remote.pushDefault', `branch.${branch}.remote`]) {
    if (branch === '' && key.startsWith('branch.')) continue
    const value = (await run($, ['git', 'config', '--get', key], dir)).stdout.trim()
    if (value !== '' && value !== '.') return value
  }
  return 'origin'
}

// A git hibája vagy csonkolt kimenete nem jelentheti azt, hogy „nincs mit nézni”: ilyenkor a push nem megy ki.
async function must($: EngineInterface, argv: string[], cwd: string, okCodes: readonly number[] = [0]) {
  const r = await run($, argv, cwd)
  if (!okCodes.includes(r.exitCode)) throw new Error(`${argv.join(' ')}: exit ${r.exitCode}`)
  return r
}

type Target = { dir: string; remote: string; repo: string | null; label: string; tips: string[]; history: boolean }

// Mi menne ki: a távoli repón még nem lévő commitok (üzenet + hozzáadott sorok). Ha a távolinak még
// nincs egy ága sem (első push, nyilvánossá tétel), a teljes history gyanús sorait nézzük.
async function scanTarget($: EngineInterface, target: Target, home: string | null): Promise<Finding[]> {
  const { dir, remote, tips } = target
  let lines: Line[] = []
  let envs: string[] = []
  const known = target.history
    ? ''
    : (await run($, ['git', 'for-each-ref', '--count=1', '--format=%(refname)', `refs/remotes/${remote}/`], dir)).stdout.trim()
  const exclude = known === '' ? [] : ['--not', `--remotes=${remote}`]
  const format = ['--no-color', '--no-ext-diff']

  // A commit üzenetek mindig mind (kicsik), a változások a távoli ágakhoz képest.
  const messages = await must($, ['git', 'log', ...format, '--format=%x1e%h%n%B%x1f', ...tips, ...exclude], dir)
  if (messages.isStdoutTruncated) throw new Error('git log: output truncated')
  if (messages.stdout.trim() === '') return []
  lines.push(...addedLines(messages.stdout))

  const patchArgs = known === '' ? ['-i', '-G', prefilter(home)] : []
  const patches = await must($, ['git', 'log', '-p', ...format, '--format=', ...patchArgs, ...tips, ...exclude], dir)
  const found: Finding[] = []
  if (patches.isStdoutTruncated) {
    // Túl nagy history: a mostani fát nézzük át, és szólunk, hogy a régebbi commitok átnézetlenek.
    for (const tip of tips.filter(t => !t.startsWith('-'))) {
      const grep = await must($, ['git', 'grep', '-I', '-n', '-i', '-E', prefilter(home), tip], dir, [0, 1])
      if (grep.isStdoutTruncated) throw new Error('git grep: output truncated')
      lines.push(...grepLines(grep.stdout, tip))
      const tree = (await must($, ['git', 'ls-tree', '-r', '--name-only', tip], dir)).stdout
      envs.push(...envFiles(tree.split('\n').map(f => `+++ b/${f}`).join('\n')))
    }
    found.push({ kind: 'historyUnchecked', file: target.label, line: 0, value: `history:${target.label}`, shown: '' })
  } else {
    lines.push(...addedLines(patches.stdout))
    envs.push(...envFiles(patches.stdout))
  }
  if (known === '') {
    // A .env fájl akkor is kimegy, ha nincs benne gyanús sor.
    const tree = await must($, ['git', 'log', '--no-color', '--format=', '--name-only', '--diff-filter=AM', ...tips], dir)
    envs.push(...envFiles(tree.stdout.split('\n').filter(f => f !== '').map(f => `+++ b/${f}`).join('\n')))
  }
  lines = lines.filter(l => l.text !== '')
  envs = [...new Set(envs)]

  const repo = target.repo
  const owner = repo?.split('/')[0] ?? null
  const allow = await allowed($, repo)
  found.push(
    ...scanLines(lines, {
      home,
      privateRepos: owner === null ? [] : (await privateRepos($, owner, dir)).filter(r => r.toLowerCase() !== repo?.toLowerCase() && r.toLowerCase() !== repo?.split('/')[1]?.toLowerCase()),
      watch: await strings($, 'watch'),
      allow,
      ownEmail: (await run($, ['git', 'config', 'user.email'], dir)).stdout.trim() || null,
    }),
  )
  const allowSet = new Set(allow.map(a => a.toLowerCase()))
  for (const file of envs) {
    if (!allowSet.has(file.toLowerCase())) found.unshift({ kind: 'envFile', file, line: 0, value: file, shown: file })
  }
  return found.filter(f => !allowSet.has(f.value.toLowerCase()))
}

async function scan($: EngineInterface, command: string): Promise<Scan | null> {
  const pushes = parsePushes(command)
  const flip = publicTarget(command)
  if (pushes.length === 0 && flip === null) return null

  // Windowson a HOME gyakran nincs beállítva: ott a USERPROFILE a home.
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || null
  const cwd = await $.session.cwd()
  const targets: Target[] = []

  if (flip !== null) {
    const dir = resolveDir(cwd, flip.source, home)
    const url = (await run($, ['git', 'remote', 'get-url', '--push', 'origin'], dir)).stdout.trim()
    const local = githubRepo(url)
    const isGit = (await run($, ['git', 'rev-parse', '--git-dir'], dir)).exitCode === 0
    if (flip.create) {
      // `gh repo create --public` --push nélkül üres repót hoz létre: nincs mit nézni.
      if (flip.source !== null && isGit) targets.push({ dir, remote: 'origin', repo: flip.repo, label: flip.repo ?? dir, tips: ['--all'], history: true })
    } else if (isGit && (flip.repo === null || flip.repo.toLowerCase() === local?.toLowerCase())) {
      targets.push({ dir, remote: 'origin', repo: local, label: local ?? url, tips: ['--all'], history: true })
    } else {
      // Más repót tennénk nyilvánossá, mint ami ebben a mappában van: a tartalmát innen nem látjuk.
      const label = flip.repo ?? '?'
      if ((await allowed($, label)).includes(`unchecked:${label}`)) return null
      return { repo: label, findings: [{ kind: 'unchecked', file: label, line: 0, value: `unchecked:${label}`, shown: label }] }
    }
  }

  for (const push of pushes) {
    const dir = resolveDir(cwd, push.dir, home)
    const remote = push.remote ?? (await defaultRemote($, dir))
    const url = /[:/]/.test(remote) ? remote : (await run($, ['git', 'remote', 'get-url', '--push', remote], dir)).stdout.trim()
    // Ismeretlen távoli: a git push úgyis elhasal, nincs mit kivinni.
    if (url === '') continue
    const repo = githubRepo(url)
    if (repo !== null && flip === null && ['PRIVATE', 'INTERNAL'].includes(await visibilityOf($, repo, dir))) continue
    const tips = push.all ? ['--branches', '--tags'] : push.refs.map(r => r.src)
    // Közvetlen URL-re pusholva nincs távoli követő ág, amihez mérhetnénk: a teljes history-t nézzük.
    targets.push({ dir, remote, repo, label: repo ?? url, tips, history: /[:/]/.test(remote) })
  }

  const findings: Finding[] = []
  const seen = new Set<string>()
  for (const target of targets) {
    for (const f of await scanTarget($, target, home)) {
      const key = `${f.kind}|${f.value}`
      if (seen.has(key)) continue
      seen.add(key)
      findings.push(f)
    }
  }
  return findings.length === 0 ? null : { repo: targets.map(t => t.label).filter((l, i, a) => a.indexOf(l) === i).join(', '), findings }
}

// Repónként megjegyzett kivételek, plusz a régi, közös lista (korábbi verziókból).
async function allowed($: EngineInterface, repo: string | null): Promise<string[]> {
  const byRepo = ((await $.store.get('allowByRepo')) ?? {}) as Record<string, unknown>
  const own = repo === null ? [] : byRepo[repo.toLowerCase()]
  return [...(await strings($, 'allow')), ...(Array.isArray(own) ? own.filter((v): v is string => typeof v === 'string') : [])]
}

async function remember($: EngineInterface, repo: string, values: readonly string[]): Promise<void> {
  const byRepo = { ...(((await $.store.get('allowByRepo')) ?? {}) as Record<string, string[]>) }
  for (const r of repo.split(', ')) {
    const key = r.toLowerCase()
    byRepo[key] = [...new Set([...(byRepo[key] ?? []), ...values])]
  }
  await $.store.set('allowByRepo', byRepo)
}

function listOf(findings: readonly Finding[], max: number): string {
  const kinds = KINDS[lang]
  const rows = findings.slice(0, max).map(f => {
    const where = f.line > 0 ? `${f.file}:${f.line}` : f.file
    return `• ${kinds[f.kind as keyof typeof kinds] ?? f.kind}: ${f.shown}  (${where})`
  })
  if (findings.length > max) rows.push(t().more(findings.length - max))
  return rows.join('\n')
}

async function setOn($: EngineInterface, value: boolean): Promise<void> {
  await update($, isOn, () => value)
  await $.store.set('isOn', value)
}

export const register: Register = (on, options) => {
  if (options.language === 'hu' || options.language === 'en') lang = options.language

  on('session.start', async ($, e, next) => {
    lang = await pickLanguage($, options.language)
    const saved = await $.store.get('isOn')
    await update($, isOn, () => saved !== false)
    await $.command.register({ name: 'pushor', description: t().command, argumentHint: t().hint, immediate: true })
    return next(e)
  })

  on('command.run', { command: 'pushor' }, async ($, e) => {
    const args = e.args.trim()
    const [verb, ...rest] = args.split(/\s+/)
    const arg = (verb ?? '').toLowerCase()
    if (arg === 'figyel' || arg === 'watch') {
      const text = rest.join(' ').trim()
      if (text === '') return { text: t().usage }
      await $.store.set('watch', [...new Set([...(await strings($, 'watch')), text])])
      return { text: t().watching(text) }
    }
    const wanted = ['be', 'on'].includes(arg) ? true : ['ki', 'off'].includes(arg) ? false : arg === '' ? !(await read($, isOn)) : null
    if (wanted === null) return { text: t().usage }
    await setOn($, wanted)
    return { text: wanted ? t().on : t().off }
  })

  on('state.set', { plugin: 'tool-hub', key: 'request' }, async ($, e, next) => {
    const done = await next(e)
    if (e.value?.tool === 'pushguard') await setOn($, e.value.on)
    return done
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    // A láthatóság-váltás után a tárolt „privát” eredmény már nem igaz.
    if (publicTarget(e.command) !== null) visibility.clear()
    const found = await scan($, e.command)
    if (found === null) return next(e)

    let answer: string
    const question = t().question(found.repo, found.findings.length, listOf(found.findings, 8))
    try {
      await update($, asking, () => question)
      answer = await $.ui.ask(question, {
        header: t().header,
        options: [t().deny, t().push, t().remember],
      })
    } catch {
      return { deny: t().dismissed }
    } finally {
      await update($, asking, () => null).catch(() => undefined)
    }
    if (answer === t().push) return next(e)
    if (answer === t().remember) {
      await remember($, found.repo, found.findings.map(f => f.value))
      return next(e)
    }
    if (answer === t().deny) return { deny: t().denied(found.repo, listOf(found.findings, 40)) }
    return { deny: t().other(answer) }
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    // Hibánál csak a push és a láthatóság-váltás áll meg; minden más parancs fut tovább.
    try {
      if (parsePushes(e.command).length === 0 && publicTarget(e.command) === null) return next(e)
    } catch {
      if (!/\bgit\b[^;&|]*\bpush\b|\bgh\s+repo\b/.test(e.command)) return next(e)
    }
    return { deny: t().failed }
  })
}
