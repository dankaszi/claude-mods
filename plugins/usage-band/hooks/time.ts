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

async function out($: EngineInterface, argv: string[]): Promise<string> {
  try {
    const r = await $.process.run(argv, { timeoutMs: 3_000 })
    return r.exitCode === 0 ? r.stdout.trim() : ''
  } catch {
    return ''
  }
}

// TZ, aztán a /etc/localtime link (macOS, Linux), aztán a `date +%z` eltérése.
export async function localZone($: EngineInterface): Promise<Zone> {
  const tz = await Promise.resolve($.env.get('TZ')).catch(() => undefined)
  const fromEnv = validName(tz?.replace(/^:/, ''))
  if (fromEnv !== null) return { name: fromEnv }
  const link = /zoneinfo\/(.+)$/.exec(await out($, ['readlink', '/etc/localtime']))?.[1]
  const fromLink = validName(link)
  if (fromLink !== null) return { name: fromLink }
  const offset = /^([+-])(\d\d)(\d\d)$/.exec(await out($, ['date', '+%z']))
  if (offset === null) return UTC
  const minutes = Number(offset[2]) * 60 + Number(offset[3])
  return { offsetMinutes: offset[1] === '-' ? -minutes : minutes }
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
