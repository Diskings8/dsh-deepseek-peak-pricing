/**
 * DeepSeek API 峰谷计费提示 — browser half.
 *
 * A status reading in the composer's dock row, beside ui-chat's output-speed and
 * 缓存命中 pills: it answers, at a glance and without asking anyone, whether the
 * next request bills at the peak or the off-peak rate, and how long that lasts.
 *
 * The seam is `conversation.composer.dock` (a root-scoped list under the
 * composer card) rather than `shell.overlay`, because that is where the shipped
 * usage readings live — a floating corner badge would be a second, competing
 * place to look for the same kind of number.
 *
 * Why the rules are recomputed here instead of fetched from the Host half: the
 * countdown must keep ticking across a Host restart and needs no per-request
 * data, so a local pure function is strictly more robust than a Remote. The
 * Host half owns the model-facing tool and the deployment's calendar overrides;
 * this half owns the published card compiled into the bundle.
 *
 * Built to `lib/client.js` as a CommonJS closure factory consumed by
 * `window.__ModuleLoader__.load`. React is resolved through the loader's
 * injected `require` because `react` is a shell platform module.
 *
 * Authority: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ plus
 * DeepSeek's 2026-09-19 峰谷时间说明 (调休上班的周末全天按空闲时段计费).
 *
 * @module dsh-deepseek-peak-pricing/client
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/**
 * The dock row under the composer: a root-scoped list slot that ui-chat's
 * `StatsPills` (order 0) already occupies. Declared by ui-conversation.
 */
const COMPOSER_DOCK_SLOT = 'conversation.composer.dock'

/** The slot registry face this plugin consumes from the client context. */
interface SlotsFace {
  register: (
    entry: { name: typeof COMPOSER_DOCK_SLOT; id: string; order?: number },
    component: () => ReactElement | null,
  ) => () => void
  inject: (name: typeof COMPOSER_DOCK_SLOT, callback: () => () => void) => () => void
}

/** The slice of the client context this plugin uses. */
interface PeakPricingContext {
  slots?: SlotsFace
  effect?: (callback: () => (() => void) | void, label?: string) => () => void
}

// ---------------------------------------------------------------------------
// Prices and rules
// ---------------------------------------------------------------------------

/** One model's rates in CNY per 1,000,000 tokens at a single period. */
interface Rates {
  /** Input tokens served from the context cache. */
  cacheHit: number
  /** Input tokens that missed the context cache. */
  cacheMiss: number
  /** Generated output tokens. */
  output: number
}

/** One model's two-column rate card. */
interface ModelCard {
  /** Model name as sent in the `model` field. */
  model: string
  /** Rates charged during peak hours. */
  peak: Rates
  /** Rates charged off-peak; exactly half of `peak`. */
  offPeak: Rates
}

/** Official rate card. Off-peak is half of peak by publication. */
const MODELS: ModelCard[] = [
  { model: 'deepseek-flash', peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 }, offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 } },
  { model: 'deepseek-v4-pro', peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 }, offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 } },
]

/** China statutory holidays: `[name, firstDay, lastDay]`, inclusive, Beijing dates. */
type Holiday = [name: string, start: string, end: string]

/** 2026 holiday arrangement, 国办发明电〔2025〕7号 (published 2025-11-04). */
const HOLIDAYS: Holiday[] = [
  ['元旦', '2026-01-01', '2026-01-03'],
  ['春节', '2026-02-15', '2026-02-23'],
  ['清明节', '2026-04-04', '2026-04-06'],
  ['劳动节', '2026-05-01', '2026-05-05'],
  ['端午节', '2026-06-19', '2026-06-21'],
  ['中秋节', '2026-09-25', '2026-09-27'],
  ['国庆节', '2026-10-01', '2026-10-07'],
]

/**
 * 2026 调休上班日 — weekends the State Council turned into workdays.
 *
 * Price-neutral on purpose: DeepSeek bills 调休上班的周末 off-peak all day, so
 * 2026-09-20 (a Sunday) and 2026-10-10 (a Saturday) are ordinary weekends here.
 * The set stays so the panel can explain why a "workday" shows the cheap price.
 */
const MAKEUP_WORKDAYS = new Set([
  '2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10',
])

/** Peak windows as `[startMinute, endMinute)` after Beijing midnight. */
const PEAK_WINDOWS: Array<[number, number]> = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]]

/** Asia/Shanghai has held a fixed +08:00 offset with no DST since 1991. */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000
/** Days of boundaries the next-switch search generates. */
const SEARCH_DAYS = 8

/** Zero-pad a calendar field. */
function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** Beijing wall-clock fields of an instant, derived without the browser timezone. */
function beijingClock(instant: Date): { date: string; minuteOfDay: number; second: number } {
  const shifted = new Date(instant.getTime() + BEIJING_OFFSET_MS)
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  }
}

/** The Beijing weekday (0 = Sunday) of a `YYYY-MM-DD` date. */
function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Why one Beijing date bills the way it does. */
type DayKind = 'holiday' | 'weekend' | 'workday'

/** The holiday entry containing `date`, when there is one. */
function holidayOn(date: string): Holiday | undefined {
  return HOLIDAYS.find(([, start, end]) => date >= start && date <= end)
}

/**
 * Classify one Beijing date.
 *
 * A 调休上班日 does NOT make a weekend bill at peak: DeepSeek states (2026-09-19)
 * that "调休上班的周末、中国法定节假日全天均按空闲时段计费". The weekday test is
 * decisive — Saturday and Sunday always bill off-peak for the whole day.
 * @param date - Beijing calendar date, `YYYY-MM-DD`.
 * @returns the classification governing the whole day.
 */
function classifyDay(date: string): DayKind {
  if (holidayOn(date) !== undefined) return 'holiday'
  const weekday = weekdayOf(date)
  return weekday === 0 || weekday === 6 ? 'weekend' : 'workday'
}

/** Which price a request issued at an instant is charged at. */
type Period = 'peak' | 'off-peak'

/**
 * The billing period at one instant.
 * @param instant - the moment being billed.
 * @returns the applicable period.
 */
function periodAt(instant: Date): Period {
  const { date, minuteOfDay } = beijingClock(instant)
  if (classifyDay(date) !== 'workday') return 'off-peak'
  return PEAK_WINDOWS.some(([start, end]) => minuteOfDay >= start && minuteOfDay < end) ? 'peak' : 'off-peak'
}

/** One upcoming boundary where the period changes value. */
interface NextSwitch {
  /** The instant the period changes. */
  at: Date
  /** The period in force from `at` onward. */
  period: Period
  /** Why it changes, in reader-facing copy. */
  reason: string
}

/**
 * Every Beijing boundary in the horizon where the period may flip.
 * @param from - the instant the search starts at.
 * @returns ascending candidate boundaries at or after `from`.
 */
function candidateBoundaries(from: Date): Date[] {
  const { date } = beijingClock(from)
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const midnightUtc = Date.UTC(year, month - 1, day) - BEIJING_OFFSET_MS
  const edges = new Set<number>()
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const dayStart = midnightUtc + offset * MS_PER_DAY
    edges.add(dayStart)
    for (const [start, end] of PEAK_WINDOWS) {
      edges.add(dayStart + start * 60_000)
      edges.add(dayStart + end * 60_000)
    }
  }
  return [...edges].sort((left, right) => left - right).filter(time => time >= from.getTime()).map(time => new Date(time))
}

/**
 * Name a boundary in terms a reader recognises.
 * @param at - the boundary instant.
 * @param period - the period starting there.
 * @returns the reason copy.
 */
function describeSwitch(at: Date, period: Period): string {
  const { date, minuteOfDay } = beijingClock(at)
  const kind = classifyDay(date)
  if (minuteOfDay === 0) {
    if (kind === 'holiday') return `${holidayOn(date)?.[0] ?? '法定节假日'}全天谷时`
    if (kind === 'weekend') return MAKEUP_WORKDAYS.has(date) ? '调休上班日仍按周末全天谷时' : '周末全天谷时'
    return '工作日开始'
  }
  if (period === 'peak') return '高峰时段开始'
  return minuteOfDay === 12 * 60 ? '午间谷时开始' : '谷时开始'
}

/**
 * The next instant the billing period changes.
 *
 * The boundary is the first candidate whose period differs from the period in
 * force just before it, not the first whose period differs from `from`: a later
 * midnight inside an off-peak stretch that began before `from` changes nothing
 * about the price, so counting down to it would misname the switch.
 * @param from - the instant the search starts at.
 * @returns the next boundary, or null when nothing flips in the horizon.
 */
function nextSwitch(from: Date): NextSwitch | null {
  let previous = periodAt(from)
  for (const candidate of candidateBoundaries(from)) {
    const period = periodAt(candidate)
    if (period !== previous) return { at: candidate, period, reason: describeSwitch(candidate, period) }
    previous = period
  }
  return null
}

/**
 * Render a countdown compactly: `2天03:12:45`, `03:12:45`, or `12:45`.
 * @param milliseconds - remaining time; negative values clamp to zero.
 * @returns the display string.
 */
function formatCountdown(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const days = Math.floor(hours / 24)
  const clock = `${pad(hours % 24)}:${pad(minutes)}:${pad(seconds)}`
  return days > 0 ? `${days}天${clock}` : (hours > 0 ? clock : `${pad(minutes)}:${pad(seconds)}`)
}

/**
 * The Beijing wall-clock reading of an instant.
 * @param instant - the moment to render.
 * @returns `MM-DD HH:MM:SS` in Beijing time.
 */
function formatBeijingClock(instant: Date): string {
  const { date, minuteOfDay, second } = beijingClock(instant)
  return `${date.slice(5)} ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:${pad(second)}`
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * Every class this plugin renders, namespaced so it can never collide.
 *
 * The resting pill deliberately copies ui-chat's StatsPills skin — transparent
 * background, tertiary-tier type, `1px 8px` padding, transparent hover wash —
 * because it renders as a sibling in the same `conversation.composer.dock` row
 * as the 缓存命中 pill. Anything louder reads as a foreign control bolted onto
 * the composer instead of a third reading beside the other two.
 */
const CSS = `
.dspp-root { position: relative; display: inline-flex; min-width: 0;
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px)); }
.dspp-pill { display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box;
  max-width: 100%; padding: 1px 8px; border: none; border-radius: 999px;
  corner-shape: round; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-variant-numeric: tabular-nums; line-height: inherit; white-space: nowrap;
  cursor: pointer; }
.dspp-pill:hover, .dspp-pill[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  color: var(--dsw-alias-label-primary); }
.dspp-pill:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dspp-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dspp-root[data-period="peak"] .dspp-dot { background: var(--dsw-alias-state-warn-primary); }
.dspp-root[data-period="off-peak"] .dspp-dot { background: var(--dsw-alias-state-success-primary); }
.dspp-root[data-period="peak"] .dspp-label { color: var(--dsw-alias-state-warn-primary); font-weight: 600; }
.dspp-count { color: var(--dsw-alias-label-secondary); }
.dspp-panel { position: absolute; left: 50%; transform: translateX(-50%);
  bottom: calc(100% + 10px); z-index: 40;
  width: max-content; max-width: min(340px, calc(100vw - 32px));
  padding: 12px 13px; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 1.5; text-align: left;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22); }
.dspp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.dspp-head strong { font-size: 13px; }
.dspp-clock { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dspp-next { margin-bottom: 10px; color: var(--dsw-alias-label-secondary); }
.dspp-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
.dspp-table th, .dspp-table td { padding: 3px 6px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dspp-table th:first-child, .dspp-table td:first-child { text-align: left; font-variant-numeric: normal; }
.dspp-table thead th { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.dspp-table tbody tr + tr td { border-top: 1px solid var(--dsw-alias-border-l1); }
.dspp-table td.is-now { font-weight: 600; color: var(--dsw-alias-brand-primary); }
.dspp-note { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; }
.dspp-note b { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dspp-holidays { margin-top: 6px; }
`

/** One rendered price row. */
interface PriceRow {
  /** Model key. */
  model: string
  /** Rate in force right now. */
  now: Rates
  /** Rates charged at the other period. */
  other: Rates
}

/** Everything the pill and its panel render from one clock reading. */
interface Reading {
  /** The instant the reading was taken. */
  now: Date
  /** Which price a request issued now is charged at. */
  period: Period
  /** Why the current day bills this way. */
  kind: DayKind
  /**
   * Whether today is a 调休上班日. Price-neutral — the day bills off-peak all
   * day either way — but the panel says so, because a user who knows the State
   * Council declared today a workday will otherwise read the cheap price as a bug.
   */
  makeupWorkday: boolean
  /** The next boundary and its reason, when one is in the horizon. */
  upcoming: NextSwitch | null
  /** Remaining time to the next boundary in milliseconds. */
  remaining: number
  /** Per-model comparison of the current and other period. */
  rows: PriceRow[]
}

/**
 * Fold one clock reading into everything the UI shows.
 * @param now - the instant to read.
 * @returns the derived reading.
 */
function read(now: Date): Reading {
  const period = periodAt(now)
  const { date } = beijingClock(now)
  const upcoming = nextSwitch(now)
  return {
    now,
    period,
    kind: classifyDay(date),
    makeupWorkday: MAKEUP_WORKDAYS.has(date),
    upcoming,
    remaining: upcoming === null ? 0 : Math.max(0, upcoming.at.getTime() - now.getTime()),
    rows: MODELS.map(card => ({
      model: card.model,
      now: period === 'peak' ? card.peak : card.offPeak,
      other: period === 'peak' ? card.offPeak : card.peak,
    })),
  }
}

/** Copy for the current period. */
const PERIOD_COPY: Record<Period, { label: string; hint: string; next: string }> = {
  peak: {
    label: '高峰时段',
    hint: '高峰价为谷时的 2 倍，非紧急的批量请求可以等到谷时。',
    next: '转入谷时',
  },
  'off-peak': {
    label: '空闲时段',
    hint: '谷时为高峰价的 5 折，适合跑批量与长任务。',
    next: '转入高峰',
  },
}

/** Copy explaining why the current day bills the way it does. */
const KIND_COPY: Record<DayKind, string> = {
  holiday: '法定节假日 · 全天谷时',
  weekend: '周末 · 全天谷时',
  workday: '工作日 · 仅 09:00-12:00、14:00-18:00 为高峰',
}

/**
 * The day explanation for one reading: the plain classification, plus the
 * 调休 note when it applies.
 * @param reading - the reading to explain.
 * @returns the panel's leading explanation line.
 */
function dayCopy(reading: Reading): string {
  if (!reading.makeupWorkday) return KIND_COPY[reading.kind]
  return `${KIND_COPY[reading.kind]}（今天调休上班，但 API 仍按周末计费）`
}

/**
 * The status pill: a compact resting reading of the current period and the
 * countdown to the next switch, expanding to the full rate card and rule text.
 *
 * It renders in the composer's dock row beside ui-chat's speed and 缓存命中
 * pills, so the four readings — speed, cache hit, period, countdown — read as
 * one strip rather than as a floating control in the corner.
 * @returns the rendered pill, or its expanded panel.
 */
function PeakPricingPill(): ReactElement {
  const [tick, setTick] = useState(() => Date.now())
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => { setTick(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [])

  const reading = useMemo(() => read(new Date(tick)), [tick])
  const copy = PERIOD_COPY[reading.period]
  const countdown = reading.upcoming === null ? null : formatCountdown(reading.remaining)
  const toggle = useCallback(() => { setOpen(value => !value) }, [])
  const onKeyDown = useCallback((event: { key: string; preventDefault: () => void }) => {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
  }, [])

  return (
    <span className="dspp-root" data-period={reading.period}>
      {open && (
        <div className="dspp-panel" role="dialog" aria-label="DeepSeek API 峰谷计费">
          <div className="dspp-head">
            <strong>{copy.label}</strong>
            <span className="dspp-clock">{formatBeijingClock(reading.now)} 北京</span>
          </div>
          <div className="dspp-next">
            {reading.upcoming === null
              ? '未来 8 天内没有切换。'
              : `距${copy.next}（${reading.upcoming.reason}）还有 ${countdown}`}
          </div>
          <table className="dspp-table">
            <thead>
              <tr>
                <th>元 / 百万 tokens</th>
                <th>缓存命中</th>
                <th>缓存未命中</th>
                <th>输出</th>
              </tr>
            </thead>
            <tbody>
              {reading.rows.map(row => (
                <tr key={row.model}>
                  <td>{row.model}</td>
                  <td className="is-now">{row.now.cacheHit}</td>
                  <td className="is-now">{row.now.cacheMiss}</td>
                  <td className="is-now">{row.now.output}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dspp-note">
            <b>{dayCopy(reading)}</b>
            <div>{copy.hint}</div>
            <div className="dspp-holidays">
              高峰：周一至周五 09:00-12:00、14:00-18:00（北京时间，不含中国法定节假日）；
              其余时段、周末与法定节假日全天均为谷时，<b>调休上班的周末也按谷时</b>。
              已内置 2026 年节假日与 6 个调休上班日。
            </div>
          </div>
        </div>
      )}
      <button
        type="button"
        className="dspp-pill"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`DeepSeek API 当前${copy.label}${countdown === null ? '' : `，距切换 ${countdown}`}`}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span className="dspp-dot" aria-hidden />
        <span className="dspp-label">{copy.label}</span>
        {countdown !== null && <span className="dspp-count">{countdown}</span>}
      </button>
    </span>
  )
}

/**
 * Required client service. Cordis throws on any `ctx.<service>` read the plugin
 * did not declare, so this is what makes `ctx.slots` reachable at all — without
 * it the fiber fails with `cannot get property "slots" without inject`.
 */
export const inject = ['slots']

/**
 * Client plugin body: install the pill under the composer, beside the shipped
 * usage readings. The stylesheet is inserted once and removed with the fiber, so
 * an unloaded plugin leaves no DOM behind.
 * @param ctx - the client root context.
 */
export function apply(ctx: PeakPricingContext): void {
  // No `ctx.slots` guard: `inject` names the service, so Cordis only activates
  // this fiber once `slots` exists. A missing service here is a real failure and
  // should surface as one rather than silently disabling the surface.
  const slots = ctx.slots as SlotsFace
  const installStyle = () => {
    // Resolved through the global object rather than the module binding so the
    // effect reads the document in force when it runs; a bundler-rewritten
    // bare `document` would freeze whichever object existed at load time.
    const target = (globalThis as { document?: Document }).document
    if (target === undefined) return () => {}
    const tag = target.createElement('style')
    tag.dataset.plugin = 'dsh-deepseek-peak-pricing'
    tag.textContent = CSS
    target.head.appendChild(tag)
    return () => { tag.remove() }
  }
  if (typeof ctx.effect === 'function') ctx.effect(installStyle, 'deepseek-peak-pricing: stylesheet')
  else installStyle()
  slots.inject(COMPOSER_DOCK_SLOT, () => slots.register({
    name: COMPOSER_DOCK_SLOT,
    id: 'deepseek-peak-pricing',
    // After ui-chat's stats entry (order 0), so the strip reads
    // speed · cache hit · period · countdown.
    order: 10,
  }, PeakPricingPill))
}

/**
 * The rule functions and the pill, re-exported for `tests/client.test.mjs`.
 *
 * `lib/client.js` is a closed module-loader closure, so a test can only reach
 * this logic by loading that artifact with a stub `__ModuleLoader__` and a stub
 * `require`. These exports exist for that harness and add no product surface:
 * the shell never imports the bundle, it instantiates the factory.
 */
export {
  MODELS, PEAK_WINDOWS, classifyDay, formatBeijingClock, formatCountdown, nextSwitch, periodAt, read, PeakPricingPill,
}
export type { Period, Reading }
