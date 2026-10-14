import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const LIMITS = [
  { kind: 'five_hour', percentUsed: 34, resetsAt: '2026-10-05T14:20:00Z' },
  { kind: 'seven_day', percentUsed: 92.5, resetsAt: '2026-10-09T08:00:00Z' },
]

const HU = { options: { language: 'hu' } }

// A motor helyett: a measure-t visszhangozza, a modellnevet megadja, a státuszsort és a toastokat gyűjti.
function engine(on: On, modelName = 'Opus') {
  const status: (string | undefined)[] = []
  const toasts: string[] = []
  mock.store(on)
  on('command.register', ($, e) => ({ value: { command: e.name } }) as never)
  on('session.model', () => ({ value: modelName }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.status', ($, e) => { status.push(e.text); return { value: undefined } })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  return { status, toasts, last: () => status.at(-1) }
}

test('a státuszsorban a modell, a kontextus és mindkét limit', HU, async ($, on) => {
  const s = engine(on, 'Opus 5.5 (1M context)')
  await $.session.measure({
    context: { tokens: 420_000, window: 1_000_000, percent: 42 },
    rateLimits: LIMITS,
    changed: ['context', 'rateLimits'],
  })
  const line = s.last() ?? ''
  expect(line).toStartWith('🤖 Opus 5.5 (1M context)')
  expect(line).toContain('Ctx ███░░░░░ 42% 420k/1M')
  expect(line).toMatch(/5h ███░░░░░ 34% → \d\d:\d\d/)
  expect(line).toMatch(/Hét ███████░ 93% ⚠ → (V|H|K|Sze|Cs|P|Szo) \d\d:\d\d/)
})

test('limitek nélkül csak modell és kontextus (nem előfizetéses fiók)', HU, async ($, on) => {
  const s = engine(on)
  await $.session.measure({ context: { tokens: 5000, window: 200_000, percent: 3 }, rateLimits: [], changed: ['context'] })
  expect(s.last()).toBe('🤖 Opus  │  Ctx ░░░░░░░░ 3% 5k/200k')
})

test('90% fölött egyszer szól, resetenként', HU, async ($, on) => {
  const s = engine(on)
  const measure = (rateLimits: typeof LIMITS) =>
    $.session.measure({ context: {} as never, rateLimits, changed: ['rateLimits'] })

  await measure(LIMITS)
  expect(s.toasts.length).toBe(1)
  expect(s.toasts[0]).toStartWith('⚠ Hét limit: 93% → ')

  // Tovább nő ugyanabban az ablakban: nincs újabb toast.
  await measure([LIMITS[0]!, { ...LIMITS[1]!, percentUsed: 97 }])
  expect(s.toasts.length).toBe(1)

  // Új ablak (új resetsAt) és újra 90 fölött: megint szól.
  await measure([LIMITS[0]!, { ...LIMITS[1]!, percentUsed: 91, resetsAt: '2026-10-16T08:00:00Z' }])
  expect(s.toasts.length).toBe(2)
})

test('angolul is megy', { options: { language: 'en' } }, async ($, on) => {
  const s = engine(on)
  await $.session.measure({ context: {} as never, rateLimits: LIMITS, changed: ['rateLimits'] })
  expect(s.last()).toMatch(/Week ███████░ 93% ⚠ → (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d/)
  expect(s.toasts[0]).toStartWith('⚠ Week limit: 93%')
})

for (const [lang, expected] of [['hu_HU.UTF-8', 'Hét'], ['en_US.UTF-8', 'Week']] as const) {
  test(`auto: ${lang} → ${expected}`, async ($, on) => {
    const s = engine(on)
    mock.env(on, { LANG: lang })
    on('session.start', ($, e) => e as never)
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: LIMITS } }))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
    expect(s.last()).toContain(`${expected} `)
  })
}

test('a sávba már nem rajzol', HU, async ($, on) => {
  engine(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine' }) as never)
  await $.session.measure({ context: {} as never, rateLimits: LIMITS, changed: ['rateLimits'] })
  const ui = await $.ui.mount({
    plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false } as never,
  })
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()
  await ui.unmount()
})

test('/limitsav ki: üres státuszsor, be: újra kiírja', HU, async ($, on) => {
  const s = engine(on)
  await $.session.measure({ context: { tokens: 5000, window: 200_000, percent: 3 }, rateLimits: [], changed: ['context'] })
  expect((await $.command.run({ command: 'limitsav', args: 'ki' } as never)).text).toBe('Limitsáv kikapcsolva.')
  expect(s.last()).toBeUndefined()
  await $.session.measure({ context: { tokens: 6000, window: 200_000, percent: 3 }, rateLimits: [], changed: ['context'] })
  expect(s.last()).toBeUndefined()
  await $.command.run({ command: 'limitsav', args: 'be' } as never)
  expect(s.last()).toContain('Ctx')
})

test('a reset időpont a gép időzónájában (TZ), nem UTC-ben', HU, async ($, on) => {
  const s = engine(on)
  on('env.get', ($, e) => ({ value: e.name === 'TZ' ? 'Europe/Budapest' : undefined }))
  on('session.start', ($, e) => e as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  await $.session.measure({
    context: {} as never,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 34, resetsAt: '2026-10-05T14:20:00Z' },
      { kind: 'seven_day', percentUsed: 50, resetsAt: '2026-10-11T23:30:00Z' },
    ],
    changed: ['rateLimits'],
  })
  // nyári idő (UTC+2): 14:20 → 16:20; vasárnap 23:30 UTC → hétfő 01:30
  expect(s.last()).toContain('5h ███░░░░░ 34% → 16:20')
  expect(s.last()).toContain('Hét ████░░░░ 50% → H 01:30')
})

test('TZ nélkül a /etc/localtime linkből, végül a date +%z eltéréséből', HU, async ($, on) => {
  const s = engine(on)
  on('process.run', ($, e) => {
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'readlink') return out('', 1)
    if (e.argv[0] === 'date') return out('-0500\n')
    return out('', 1)
  })
  on('session.start', ($, e) => e as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true } as never)
  await $.session.measure({ context: {} as never, rateLimits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: '2026-10-05T14:20:00Z' }], changed: ['rateLimits'] })
  expect(s.last()).toContain('→ 09:20')
})

test('89,6% már 90%-nak látszik, és ⚠-t is kap', HU, async ($, on) => {
  const s = engine(on)
  await $.session.measure({ context: {} as never, rateLimits: [{ kind: 'seven_day', percentUsed: 89.6, resetsAt: '2026-10-09T08:00:00Z' }], changed: ['rateLimits'] })
  expect(s.last()).toContain('90% ⚠')
  expect(s.toasts.length).toBe(1)
})
