// A mod környezete UTC-ben fut (a Date helyi ideje ott UTC): a reset időpontot a gép saját időzónájában kell kiírni.
import type { EngineInterface } from 'claude-code'

// IANA név (DST-helyes), vagy ha az nem derül ki, a mostani eltérés percben.
export type Zone = { name: string } | { offsetMinutes: number }

export const UTC: Zone = { offsetMinutes: 0 }

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
export async function localZone($: EngineInterface): Promise<Zone> {
  const tz = await Promise.resolve($.env.get('TZ')).catch(() => undefined)
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
export function wallClock(at: Date, zone: Zone): { day: number; hhmm: string } {
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
