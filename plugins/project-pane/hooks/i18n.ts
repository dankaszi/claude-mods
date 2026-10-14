const hu = {
  title: (name: string) => `Projekt: ${name}`,
  commandDescription: 'Projekt-panel be/ki (alapból megnyitja és frissíti)',
  opened: 'Projekt-panel megnyitva.',
  closed: 'Projekt-panel kikapcsolva (/project be: újra be).',
  usage: 'Használat: /project [be|ki]',
  waiting: (reason: string) => `A projekt-panel szélesebb terminálra vár (${reason}) — /project most megnyitja`,
  notRepo: 'Ez a mappa nem git repó, nincs mit mutatni.',
  loading: 'Betöltés…',
  refresh: 'Frissítés',
  updated: (ago: string) => `↻ ${ago}`,
  git: 'GIT',
  dirty: (n: number) => `${n} módosított fájl`,
  clean: 'tiszta',
  lastCommit: (hash: string, ago: string) => `utolsó commit: ${hash} · ${ago}`,
  noFetch: 'még nem volt fetch',
  fetched: (ago: string) => `fetch: ${ago}`,
  upToDate: '✔ naprakész a GitHubbal',
  behindPull: (n: number, branch: string) => `⚠ az origin/${branch} ${n} committal előrébb jár`,
  behindSwitch: (to: string, n: number, branch: string) =>
    `⚠ a ${to} ${n} committal előrébb jár, te a ${branch} branch-en vagy`,
  diverged: (a: number, b: number) => `⚠ szétvált: ${a} helyi és ${b} távoli commit — ezt kézzel kell rendezni`,
  pull: (n: number) => `Pull (${n})`,
  switchTo: (to: string) => `Váltás: ${to} + frissítés`,
  dirtyBlocks: 'Előbb commitold a módosításokat, vagy tedd félre őket:',
  stashSync: 'Stash + szinkron',
  syncing: '⏳ szinkronizálás…',
  syncDone: (stashedFrom?: string) =>
    `Szinkron kész${stashedFrom === undefined ? '' : ` — a módosításaid a stash-ben: git switch ${stashedFrom} && git stash pop`}`,
  syncFailed: (step: string, stashedFrom?: string) =>
    `Szinkron sikertelen (${step})${stashedFrom === undefined ? '' : ', a módosításaid a stash-ben'} — a részletek a promptban`,
  syncAsk: (step: string, detail: string, stashedFrom?: string) =>
    `A projekt-panel szinkronja elakadt a(z) "${step}" lépésnél:\n\n${detail}\n\n` +
    (stashedFrom === undefined ? '' : `A commitolatlan módosítások a stash-ben vannak (a ${stashedFrom} branch-ről; git stash list), nem vesztek el. Csak a ${stashedFrom} branch-en állítsd vissza őket (git stash pop).\n\n`) +
    'Nézd meg, mi a gond, és javasolj megoldást.',
  detached: '⚠ leválasztott HEAD (nem branch-en vagy) — a szinkron gomb itt nem fut, előbb válts branch-re',
  deploy: 'DEPLOY (Netlify)',
  netlifyNoCli: 'Netlify CLI kell: npm i -g netlify-cli && netlify login',
  netlifyError: 'Nem sikerült lekérni (netlify login?)',
  noDeploys: 'Még nincs deploy',
  deployFailed: (branch: string) => `Netlify deploy hiba: ${branch}`,
  prs: 'PULL REQUESTEK',
  noPrs: 'Nincs nyitott PR',
  ghMissing: 'gh CLI kell: brew install gh && gh auth login',
  ci: 'CI (GitHub Actions)',
  noRuns: 'Nincs futás',
  ask: 'Kérdezd Claude-ot',
  askRun: (name: string, branch: string, id: number, url: string) =>
    `A "${name}" GitHub Actions futás elbukott a ${branch} branch-en (${url}).\n` +
    `Nézd meg a hibát (gh run view ${id} --log-failed), és mondd meg, mi okozza és hogyan javítsuk.`,
  runFailed: (name: string) => `CI hiba: ${name}`,
  supabase: 'SUPABASE',
  migrations: (n: number, latest?: string) => `${n} migráció${latest ? ` · utolsó: ${latest}` : ''}`,
  supabaseLogin: 'supabase login → projekt állapota',
  links: 'LINKEK',
  ago: (ms: number) => {
    const m = Math.round(ms / 60_000)
    if (m < 1) return 'most'
    if (m < 60) return `${m} perce`
    const h = Math.round(m / 60)
    if (h < 24) return `${h} órája`
    const d = Math.round(h / 24)
    return d < 45 ? `${d} napja` : `${Math.round(d / 30)} hónapja`
  },
}

export type Strings = typeof hu

const en: Strings = {
  title: name => `Project: ${name}`,
  commandDescription: 'Project pane on/off (by default opens and refreshes it)',
  opened: 'Project pane opened.',
  closed: 'Project pane off (/project on: back on).',
  usage: 'Usage: /project [on|off]',
  waiting: reason => `The project pane waits for a wider terminal (${reason}) — /project opens it now`,
  notRepo: 'This folder is not a git repository; nothing to show.',
  loading: 'Loading…',
  refresh: 'Refresh',
  updated: ago => `↻ ${ago}`,
  git: 'GIT',
  dirty: n => `${n} changed file${n === 1 ? '' : 's'}`,
  clean: 'clean',
  lastCommit: (hash, ago) => `last commit: ${hash} · ${ago}`,
  noFetch: 'not fetched yet',
  fetched: ago => `fetched ${ago}`,
  upToDate: '✔ up to date with GitHub',
  behindPull: (n, branch) => `⚠ origin/${branch} is ${n} commit${n === 1 ? '' : 's'} ahead`,
  behindSwitch: (to, n, branch) => `⚠ ${to} is ${n} commit${n === 1 ? '' : 's'} ahead; you are on ${branch}`,
  diverged: (a, b) => `⚠ diverged: ${a} local and ${b} remote commits — sort this out by hand`,
  pull: n => `Pull (${n})`,
  switchTo: to => `Switch to ${to} + update`,
  dirtyBlocks: 'Commit your changes first, or set them aside:',
  stashSync: 'Stash + sync',
  syncing: '⏳ syncing…',
  syncDone: stashedFrom =>
    `Sync done${stashedFrom === undefined ? '' : ` — your changes are stashed: git switch ${stashedFrom} && git stash pop`}`,
  syncFailed: (step, stashedFrom) =>
    `Sync failed (${step})${stashedFrom === undefined ? '' : ', your changes are stashed'} — details in the prompt`,
  syncAsk: (step, detail, stashedFrom) =>
    `The project pane's sync stopped at "${step}":\n\n${detail}\n\n` +
    (stashedFrom === undefined ? '' : `The uncommitted changes are in the stash (from branch ${stashedFrom}; git stash list), not lost. Restore them only on ${stashedFrom} (git stash pop).\n\n`) +
    'Look into it and suggest a fix.',
  detached: '⚠ detached HEAD (not on a branch) — the sync button does not run here; switch to a branch first',
  deploy: 'DEPLOY (Netlify)',
  netlifyNoCli: 'Needs the Netlify CLI: npm i -g netlify-cli && netlify login',
  netlifyError: 'Could not fetch (netlify login?)',
  noDeploys: 'No deploys yet',
  deployFailed: branch => `Netlify deploy failed: ${branch}`,
  prs: 'PULL REQUESTS',
  noPrs: 'No open PRs',
  ghMissing: 'Needs gh: brew install gh && gh auth login',
  ci: 'CI (GitHub Actions)',
  noRuns: 'No runs',
  ask: 'Ask Claude',
  askRun: (name, branch, id, url) =>
    `The "${name}" GitHub Actions run failed on ${branch} (${url}).\n` +
    `Look at the failure (gh run view ${id} --log-failed) and tell me what causes it and how to fix it.`,
  runFailed: name => `CI failed: ${name}`,
  supabase: 'SUPABASE',
  migrations: (n, latest) => `${n} migration${n === 1 ? '' : 's'}${latest ? ` · latest: ${latest}` : ''}`,
  supabaseLogin: 'supabase login → project status',
  links: 'LINKS',
  ago: ms => {
    const m = Math.round(ms / 60_000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m} min ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h} h ago`
    const d = Math.round(h / 24)
    return d < 45 ? `${d} days ago` : `${Math.round(d / 30)} months ago`
  },
}

export const STRINGS = { hu, en }

export function languageFor(setting: unknown, locale: string): Strings {
  if (setting === 'hu' || setting === 'en') return STRINGS[setting]
  return locale.toLowerCase().startsWith('hu') ? hu : en
}
