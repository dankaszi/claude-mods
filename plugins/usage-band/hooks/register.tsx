import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage } from 'claude-code'

import type { Context, Limit } from '../types'

// A mod környezete UTC-ben fut (a Date helyi ideje ott UTC): a reset időpontot a gép saját időzónájában kell kiírni.
// (A register.tsx-ben kell lennie: a motor csak a hooks modulban engedi a $-hívásokat.)

// IANA név (DST-helyes), vagy ha az nem derül ki, a mostani eltérés percben.
type Zone = { name: string } | { offsetMinutes: number }

const UTC: Zone = { offsetMinutes: 0 }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function validName(name: string | undefined): string | null {
  if (name === undefined || name === '') return null
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: name })
    return name
  } catch {
    return null
  }
}

// A Windows saját időzóna-nevei (Get-TimeZone / TimeZoneInfo.Local.Id) → IANA név, a gyakoriak.
const WINDOWS_ZONES: Record<string, string> = {
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'GTB Standard Time': 'Europe/Bucharest',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'UTC': 'UTC',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
}

// "+02:00" vagy "+0200" → percek
function offsetMinutes(text: string): number | null {
  const m = /^([+-])(\d\d):?(\d\d)$/.exec(text.trim())
  if (m === null) return null
  const minutes = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -minutes : minutes
}

async function out($: EngineInterface, argv: string[], timeoutMs = 3_000): Promise<string> {
  try {
    const r = await $.process.run(argv, { timeoutMs })
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

// TZ, aztán a /etc/localtime link (macOS, Linux), Windowson a PowerShell időzóna-neve,
// végül az eltérés: `date +%z`, vagy Windowson a PowerShell `zzz` formátuma.
async function localZone($: EngineInterface): Promise<Zone> {
  let tz: string | undefined
  try {
    tz = await $.env.get('TZ')
  } catch {
    tz = undefined
  }
  const fromEnv = validName(tz?.replace(/^:/, ''))
  if (fromEnv !== null) return { name: fromEnv }
  const link = /zoneinfo\/(.+)$/.exec(await out($, ['readlink', '/etc/localtime']))?.[1]
  const fromLink = validName(link)
  if (fromLink !== null) return { name: fromLink }
  const fromDate = offsetMinutes(await out($, ['date', '+%z']))
  if (fromDate !== null) return { offsetMinutes: fromDate }
  // Windows: egy PowerShell-hívás adja a zóna nevét és a mostani eltérést is (az indulása lassabb, ezért több idő).
  const ps = (await out($, ['powershell', '-NoProfile', '-NonInteractive', '-Command', "[TimeZoneInfo]::Local.Id; (Get-Date).ToString('zzz')"], 8_000)).split(/\r?\n/)
  const fromWindows = validName(WINDOWS_ZONES[ps[0]?.trim() ?? ''])
  if (fromWindows !== null) return { name: fromWindows }
  const fromPowerShell = offsetMinutes(ps[1] ?? '')
  return fromPowerShell === null ? UTC : { offsetMinutes: fromPowerShell }
}

// A hét napja (0 = vasárnap) és az óra:perc a megadott időzónában.
function wallClock(at: Date, zone: Zone): { day: number; hhmm: string } {
  if ('name' in zone) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone.name, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
    return { day: Math.max(0, DAYS.indexOf(get('weekday'))), hhmm: `${get('hour').padStart(2, '0')}:${get('minute').padStart(2, '0')}` }
  }
  const shifted = new Date(at.getTime() + zone.offsetMinutes * 60_000)
  return {
    day: shifted.getUTCDay(),
    hhmm: `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`,
  }
}

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, [])
// Ablak + reset párosok, amikre már szóltunk: így egy ablakra resetenként egyszer jön toast.
const warned = atom({ plugin: 'usage-band', key: 'warned' } as const, [])
const context = atom({ plugin: 'usage-band', key: 'context' } as const, null)
const model = atom({ plugin: 'usage-band', key: 'model' } as const, null)
// Kikapcsolva üres a státuszsor; az eszköztár (tool-hub) is ezt olvassa.
const isOn = atom({ plugin: 'usage-band', key: 'isOn' } as const, true)

const WARN_AT = 90

type Strings = { labels: Record<string, string>; days: string[]; limit: string; command: string; on: string; off: string; usage: string }

const STRINGS: Record<'hu' | 'en', Strings> = {
  hu: {
    labels: { five_hour: '5h', seven_day: 'Hét' },
    days: ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'],
    limit: 'limit',
    command: 'Limit- és kontextussáv be/ki',
    on: 'Limitsáv bekapcsolva.',
    off: 'Limitsáv kikapcsolva.',
    usage: 'Használat: /limitsav [be|ki]',
  },
  en: {
    labels: { five_hour: '5h', seven_day: 'Week' },
    days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    limit: 'limit',
    command: 'Usage and context bar on/off',
    on: 'Usage bar on.',
    off: 'Usage bar off.',
    usage: 'Usage: /limitsav [on|off]',
  },
}

// A modul minden beállításváltáskor újratöltődik, így elég egyszer, induláskor eldönteni.
let t: Strings = STRINGS.en
let zone: Zone = UTC
const LABELS = (): Record<string, string> => t.labels
const WIDTH = 8

function bar(percent: number): string {
  const filled = Math.min(WIDTH, Math.round((percent / 100) * WIDTH))
  return '█'.repeat(filled) + '░'.repeat(WIDTH - filled)
}

// A kiírt (kerekített) értékhez mérünk: ami 90%-nak látszik, az ⚠-t is kap.
const atWarn = (percent: number) => Math.round(percent) >= WARN_AT
const warnMark = (percent: number) => (atWarn(percent) ? ' ⚠' : '')

function resetText(kind: string, resetsAt?: string): string {
  if (resetsAt === undefined) return ''
  const { day, hhmm } = wallClock(new Date(resetsAt), zone)
  if (kind === 'five_hour') return ` → ${hhmm}`
  return ` → ${t.days[day]} ${hhmm}`
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

// Csak akkor van mit mutatni, ha már jött válasz, amiből a telítettség kiderül.
function toContext(usage: SessionContextUsage): Context | null {
  if (usage.percent === undefined) return null
  return { percent: usage.percent, tokens: usage.tokens, window: usage.window }
}

async function refreshModel($: EngineInterface): Promise<void> {
  const current = await $.session.model()
  await update($, model, () => current)
}

// A státuszsor sima szöveg (színt nem visz): a 90% fölötti értéket ⚠ jelzi.
async function pushStatus($: EngineInterface): Promise<void> {
  if (!(await read($, isOn))) {
    $.ui.status(undefined)
    return
  }
  const name = await read($, model)
  const ctx = await read($, context)
  const shown = (await read($, limits)).filter(l => l.kind in LABELS())

  const parts: string[] = []
  if (name !== null) parts.push(`🤖 ${name}`)
  if (ctx !== null) {
    const used = ctx.tokens === undefined ? '' : ` ${tokens(ctx.tokens)}/${tokens(ctx.window)}`
    parts.push(`Ctx ${bar(ctx.percent)} ${ctx.percent}%${used}${warnMark(ctx.percent)}`)
  }
  for (const l of shown) {
    const pct = Math.round(l.percentUsed)
    parts.push(`${LABELS()[l.kind]} ${bar(l.percentUsed)} ${pct}%${warnMark(l.percentUsed)}${resetText(l.kind, l.resetsAt)}`)
  }
  $.ui.status(parts.length === 0 ? undefined : parts.join('  │  '))
}

async function warnPast90($: EngineInterface, current: Limit[]): Promise<void> {
  // Ami visszaesett 90% alá, arra újra szólhatunk (akkor is, ha nincs reset időpontja).
  const below = new Set(current.filter(l => !atWarn(l.percentUsed)).map(l => `${l.kind}@${l.resetsAt}`))
  if ((await read($, warned)).some(k => below.has(k))) await update($, warned, list => list.filter(k => !below.has(k)))
  const already = await read($, warned)
  const fresh = current.filter(
    l => l.kind in LABELS() && atWarn(l.percentUsed) && !already.includes(`${l.kind}@${l.resetsAt}`),
  )
  if (fresh.length === 0) return

  for (const l of fresh) {
    $.ui.toast(
      `⚠ ${LABELS()[l.kind]} ${t.limit}: ${Math.round(l.percentUsed)}%${resetText(l.kind, l.resetsAt)}`,
      { timeoutMs: 10000 },
    )
  }
  await update($, warned, list => [...list, ...fresh.map(l => `${l.kind}@${l.resetsAt}`)])
}

async function setOn($: EngineInterface, wanted: boolean): Promise<void> {
  await update($, isOn, () => wanted)
  await $.store.set('isOn', wanted)
  await pushStatus($)
}

async function pickLanguage($: EngineInterface, setting: unknown): Promise<Strings> {
  if (setting === 'hu' || setting === 'en') return STRINGS[setting]
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LANG')) || ''
  return locale.toLowerCase().startsWith('hu') ? STRINGS.hu : STRINGS.en
}

export const register: Register = (on, options) => {
  if (options.language === 'hu' || options.language === 'en') t = STRINGS[options.language]

  on('session.start', async ($, e, next) => {
    t = await pickLanguage($, options.language)
    const result = await next(e)
    zone = await localZone($)
    const saved = (await $.store.get('isOn')) !== false
    await update($, isOn, () => saved)
    await $.command.register({ name: 'limitsav', description: t.command, argumentHint: t === STRINGS.hu ? '[be|ki]' : '[on|off]', immediate: true })
    const usage = await $.session.usage()
    await update($, limits, () => usage.rateLimits)
    await update($, context, () => toContext(usage.context))
    await warnPast90($, usage.rateLimits)
    await refreshModel($)
    await pushStatus($)
    return result
  })

  on('command.run', { command: 'limitsav' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const wanted = ['be', 'on'].includes(arg) ? true : ['ki', 'off'].includes(arg) ? false : arg === '' ? !(await read($, isOn)) : null
    if (wanted === null) return { text: t.usage }
    await setOn($, wanted)
    return { text: wanted ? t.on : t.off }
  })

  // Az eszköztár gombja parancs nélkül kapcsol (így nem marad parancssor a transcriptben).
  on('state.set', { plugin: 'tool-hub', key: 'request' }, async ($, e, next) => {
    const done = await next(e)
    if (e.value?.tool === 'limits') await setOn($, e.value.on)
    return done
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    await refreshModel($)
    await pushStatus($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      const current = toContext(e.context)
      await update($, context, () => current)
    }
    // Turn végén is ránézünk: így az automatikus fallback is látszik.
    await refreshModel($)
    if (e.changed.includes('rateLimits')) {
      const current: Limit[] = e.rateLimits
      await update($, limits, () => current)
      await warnPast90($, current)
    }
    await pushStatus($)
    return next(e)
  })
}
