/**
 * DeepSeek API peak / off-peak (错峰) billing rules — the single, dependency-free
 * rule core shared by this bundle's Host and browser halves.
 *
 * This file is imported by BOTH `src/host/index.ts` and `src/client/index.tsx`,
 * and esbuild inlines it into each artifact, so there is exactly one copy of the
 * rule in the repository. The Host half is the only place a deployment's
 * overrides enter; the browser half receives those same values through the
 * projected plugin config (see `resolveRules`), so the two halves can no longer
 * drift apart the way three hand-copied calendars would.
 *
 * Two authorities, because the pricing page alone is not quite the whole rule:
 *
 * 1. https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ — "空闲时段价格为
 *    高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、
 *    14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。"
 * 2. DeepSeek's 峰谷时间说明 of 2026-09-19 — "调休上班的周末、中国法定节假日全天
 *    均按空闲时段计费", restating the 2026-08-23 adjustment that "周六、周日全天
 *    不再区分峰谷时段".
 *
 * Two consequences drive this file's shape:
 * - The window is a *Beijing wall-clock* rule, so the caller must supply the
 *   instant and this module derives the Beijing calendar date from it. It never
 *   reads the host's local timezone.
 * - The weekday test is decisive and nothing overrides it. A 调休上班日 is a
 *   weekend date the State Council turned into a workday, and it still bills
 *   off-peak all day; an official holiday that lands on a weekday likewise bills
 *   off-peak all day. Only a genuine Monday-to-Friday date can bill peak.
 */

/** Billing period the API charges at the instant of a request. */
export type Period = 'peak' | 'off-peak'

/** One model's rates, in CNY per 1,000,000 tokens. */
export interface ModelRates {
  /** Input tokens served from the context cache. */
  readonly cacheHit: number
  /** Input tokens that missed the context cache. */
  readonly cacheMiss: number
  /** Generated output tokens. */
  readonly output: number
}

/** The published rate card for one model, already resolved for a period. */
export interface ModelPrice {
  /** Model name as sent in the `model` field. */
  readonly model: string
  /** Human label for the model. */
  readonly label: string
  /** Rates charged during peak hours. */
  readonly peak: ModelRates
  /** Rates charged off-peak; always exactly half of {@link peak}. */
  readonly offPeak: ModelRates
}

/**
 * The official rate card, CNY per million tokens. Off-peak is derived as half
 * of peak because that is the published relationship, not a coincidence: a page
 * edit that breaks it should fail the unit test rather than silently drift.
 */
export const MODELS: readonly ModelPrice[] = [
  {
    model: 'deepseek-flash',
    label: 'deepseek-flash',
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  },
  {
    model: 'deepseek-v4-pro',
    label: 'deepseek-v4-pro',
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
]

/** One inclusive `YYYY-MM-DD` holiday range. */
export interface DateRange {
  /** First day of the holiday, inclusive. */
  readonly start: string
  /** Last day of the holiday, inclusive. */
  readonly end: string
  /** Holiday name, for display. */
  readonly name: string
}

/** A half-open peak window inside one Beijing date, in wall-clock minutes. */
export interface PeakWindow {
  /** Minutes after Beijing midnight when peak billing starts. */
  readonly startMinute: number
  /** Minutes after Beijing midnight when peak billing ends (exclusive). */
  readonly endMinute: number
}

/** The complete rule set. Every member is overridable through the plugin Config. */
export interface PricingRules {
  /**
   * China statutory holiday ranges, inclusive, by Beijing date. A date inside
   * one of these bills off-peak for the whole day.
   */
  readonly holidays: readonly DateRange[]
  /**
   * Weekend dates the State Council designated as 调休上班日.
   *
   * Display metadata only — they deliberately do NOT affect the price.
   * DeepSeek bills every weekend off-peak all day regardless, so this list
   * exists so a UI can say "今天调休上班，但 API 仍按谷时计费" instead of leaving
   * a user to wonder why a workday shows the cheap price.
   */
  readonly makeupWorkdays: readonly string[]
  /** Peak windows applied on workdays. */
  readonly peakWindows: readonly PeakWindow[]
  /** The model rate card. */
  readonly models: readonly ModelPrice[]
}

/**
 * 2026 holiday arrangement, 国办发明电〔2025〕7号 (published 2025-11-04).
 * Spring Festival 2026 runs 9 days, the longest on record, and Mid-Autumn is
 * separate from National Day — unlike 2025, where the two were merged.
 */
export const HOLIDAYS_2026: readonly DateRange[] = [
  { start: '2026-01-01', end: '2026-01-03', name: '元旦' },
  { start: '2026-02-15', end: '2026-02-23', name: '春节' },
  { start: '2026-04-04', end: '2026-04-06', name: '清明节' },
  { start: '2026-05-01', end: '2026-05-05', name: '劳动节' },
  { start: '2026-06-19', end: '2026-06-21', name: '端午节' },
  { start: '2026-09-25', end: '2026-09-27', name: '中秋节' },
  { start: '2026-10-01', end: '2026-10-07', name: '国庆节' },
]

/**
 * 2026 调休上班日 — weekends the State Council turned into workdays.
 *
 * Price-neutral on purpose: DeepSeek bills 调休上班的周末 off-peak all day, like
 * any other weekend. 2026-09-20 (a Sunday) and 2026-10-10 (a Saturday) are the
 * two dates a user is most likely to question, so they stay listed for display.
 */
export const MAKEUP_WORKDAYS_2026: readonly string[] = [
  '2026-01-04',
  '2026-02-14',
  '2026-02-28',
  '2026-05-09',
  '2026-09-20',
  '2026-10-10',
]

/** Peak billing windows: 09:00–12:00 and 14:00–18:00 Beijing time. */
export const DEFAULT_PEAK_WINDOWS: readonly PeakWindow[] = [
  { startMinute: 9 * 60, endMinute: 12 * 60 },
  { startMinute: 14 * 60, endMinute: 18 * 60 },
]

/** The built-in rule set: the published DeepSeek card plus the 2026 calendar. */
export const DEFAULT_RULES: PricingRules = {
  holidays: HOLIDAYS_2026,
  makeupWorkdays: MAKEUP_WORKDAYS_2026,
  peakWindows: DEFAULT_PEAK_WINDOWS,
  models: MODELS,
}

/** Whether the browser half raises a notice when the billing period flips. */
export const DEFAULT_NOTIFY_ON_SWITCH = true

/** How many minutes before a peak window starts the browser half warns; 0 disables it. */
export const DEFAULT_REMIND_BEFORE_PEAK_MINUTES = 5

// ---------------------------------------------------------------------------
// Live configuration values
// ---------------------------------------------------------------------------

/**
 * A live configuration reference, as schemastery's `.volatile()` parses one
 * field: the plugin keeps the reference and reads `.get()` for the current
 * value, so a configuration edit reaches running code without a remount.
 */
export interface Live<T> {
  /** The current immutable value of the field. */
  get(): T
}

/** One configured value, either plain (from the browser) or live (from the Host). */
export type ConfigValue<T> = T | Live<T>

/** The cosmokit protocol symbol every live reference carries, across module copies. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Read a configured field, unwrapping a live reference when one was passed.
 *
 * The check is the shared protocol symbol rather than a class identity, because
 * the Host half resolves `@deepseek-ai/cosmokit` from its own install while the
 * reference was created by the runtime's copy.
 * @param value - the configured field, plain or live.
 * @returns the current plain value, or undefined when nothing was configured.
 */
export function live<T>(value: ConfigValue<T> | undefined): T | undefined {
  if (value === null || typeof value !== 'object') return value as T | undefined
  if (VOLATILE_WRITE in value) return (value as Live<T>).get()
  return value as T
}

/** Deployment overrides for the built-in rule set, as they arrive from config. */
export interface PricingOverrides {
  /**
   * Statutory holiday ranges, inclusive, by Beijing date. Replaces the built-in
   * calendar — pass the complete set you want in force.
   */
  readonly holidays?: ConfigValue<readonly DateRange[]>
  /**
   * 调休上班日 (`YYYY-MM-DD`). Replaces the built-in list; price-neutral, so it
   * only changes how the result explains itself.
   */
  readonly makeupWorkdays?: ConfigValue<readonly string[]>
  /** Peak windows in Beijing wall-clock minutes, half-open. Replaces the built-ins. */
  readonly peakWindows?: ConfigValue<readonly PeakWindow[]>
}

/** The outcome of folding configuration over the built-in rule set. */
export interface RuleResolution {
  /** The effective rule set; the built-ins whenever `problems` is non-empty. */
  readonly rules: PricingRules
  /** Human-readable configuration problems; empty when the rules are usable. */
  readonly problems: readonly string[]
}

/**
 * Fold deployment overrides over the built-in rule set and validate the result.
 *
 * A set with problems resolves to the built-ins rather than to a wrong price, so
 * a typo degrades to the published calendar instead of billing a workday at the
 * holiday rate. The Host half turns the same problem list into a startup error,
 * because a misconfigured deployment should fail loudly where it can be fixed.
 * @param overrides - configured fields, plain or live; absent means "built-ins".
 * @returns the effective rules plus any problems found.
 */
export function resolveRules(overrides?: PricingOverrides): RuleResolution {
  const rules: PricingRules = {
    holidays: live(overrides?.holidays) ?? DEFAULT_RULES.holidays,
    makeupWorkdays: live(overrides?.makeupWorkdays) ?? DEFAULT_RULES.makeupWorkdays,
    peakWindows: live(overrides?.peakWindows) ?? DEFAULT_RULES.peakWindows,
    models: MODELS,
  }
  const problems = validateRules(rules)
  return { rules: problems.length === 0 ? rules : DEFAULT_RULES, problems }
}

// ---------------------------------------------------------------------------
// The Beijing clock
// ---------------------------------------------------------------------------

/** The Beijing wall clock of an instant, as plain calendar fields. */
interface BeijingClock {
  /** Beijing calendar date, `YYYY-MM-DD`. */
  readonly date: string
  /** Minutes after Beijing midnight, 0–1439. */
  readonly minuteOfDay: number
  /** Seconds after the minute, 0–59. */
  readonly second: number
  /** Beijing weekday, 0 = Sunday. */
  readonly weekday: number
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000
const MS_PER_MINUTE = 60_000
/** Days of boundaries the next-switch search generates. */
const SEARCH_DAYS = 8

/** Zero-pad a calendar field to two digits. */
function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * Project an instant onto Beijing wall-clock fields without consulting the
 * host's local timezone. Asia/Shanghai has had a fixed +08:00 offset with no
 * DST since 1991, so a constant offset is exact rather than an approximation.
 * @param instant - the moment to project.
 * @returns the Beijing calendar fields.
 */
function beijingClock(instant: Date): BeijingClock {
  const shifted = new Date(instant.getTime() + BEIJING_OFFSET_MS)
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
  }
}

/** The Beijing calendar date of an instant, `YYYY-MM-DD`. */
export function beijingDate(instant: Date): string {
  return beijingClock(instant).date
}

/** The Beijing timestamp of one Beijing wall-clock moment. */
function beijingInstant(date: string, minuteOfDay = 0, second = 0): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day, 0, minuteOfDay, second) - BEIJING_OFFSET_MS)
}

/** The Beijing weekday (0 = Sunday) of a `YYYY-MM-DD` date. */
function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Whether `date` is a real `YYYY-MM-DD` calendar date. */
function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** The holiday range containing `date`, when there is one. */
export function holidayOn(rules: PricingRules, date: string): DateRange | undefined {
  return rules.holidays.find(range => date >= range.start && date <= range.end)
}

/**
 * Whether `date` is a designated 调休上班日. Exported because a surface may want
 * to explain the apparent mismatch between "today is a workday" and "the API is
 * charging the cheap price".
 * @param rules - the active rule set.
 * @param date - Beijing calendar date, `YYYY-MM-DD`.
 * @returns true when the State Council turned that date into a workday.
 */
export function isMakeupWorkday(rules: PricingRules, date: string): boolean {
  return rules.makeupWorkdays.includes(date)
}

/** Why one Beijing date bills the way it does; also the UI's explanation hook. */
export type DayKind = 'holiday' | 'weekend' | 'workday'

/**
 * Classify one Beijing date.
 *
 * A 调休上班日 does NOT make a weekend bill at peak. DeepSeek states it
 * explicitly (2026-09-19): "调休上班的周末、中国法定节假日全天均按空闲时段计费",
 * and the earlier adjustment that "周六、周日全天不再区分峰谷时段". So the
 * weekday test comes first and is decisive: Saturday and Sunday always bill
 * off-peak for the whole day, whatever the State Council did to the work
 * calendar.
 * @param rules - the active rule set.
 * @param date - Beijing calendar date, `YYYY-MM-DD`.
 * @returns the day classification that governs the whole day.
 */
export function classifyDay(rules: PricingRules, date: string): DayKind {
  if (holidayOn(rules, date) !== undefined) return 'holiday'
  const weekday = weekdayOf(date)
  return weekday === 0 || weekday === 6 ? 'weekend' : 'workday'
}

/**
 * The billing period at one instant.
 *
 * A date bills off-peak all day when it is a holiday or a weekend. On a
 * workday only the configured windows bill peak; every other minute, including
 * the lunch gap, bills off-peak.
 * @param rules - the active rule set.
 * @param instant - the moment being billed.
 * @returns which price the API charges for a request at that instant.
 */
export function periodAt(rules: PricingRules, instant: Date): Period {
  const { date, minuteOfDay } = beijingClock(instant)
  if (classifyDay(rules, date) !== 'workday') return 'off-peak'
  return rules.peakWindows.some(window => minuteOfDay >= window.startMinute && minuteOfDay < window.endMinute)
    ? 'peak'
    : 'off-peak'
}

// ---------------------------------------------------------------------------
// Boundaries and schedule
// ---------------------------------------------------------------------------

/**
 * Every Beijing instant in the look-ahead horizon where the period may change:
 * each peak window edge and each midnight. Midnights are included because a
 * weekend and a holiday both change a whole day's billing, so that change
 * always lands on a date boundary.
 * @param rules - the active rule set.
 * @param from - the instant the search starts at.
 * @returns ascending candidate boundaries, all at or after `from`.
 */
function candidateBoundaries(rules: PricingRules, from: Date): Date[] {
  const { date } = beijingClock(from)
  const midnightUtc = beijingInstant(date).getTime()
  const edges = new Set<number>()
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const dayStart = midnightUtc + offset * MS_PER_DAY
    edges.add(dayStart)
    for (const window of rules.peakWindows) {
      edges.add(dayStart + window.startMinute * MS_PER_MINUTE)
      edges.add(dayStart + window.endMinute * MS_PER_MINUTE)
    }
  }
  return [...edges]
    .sort((left, right) => left - right)
    .filter(time => time >= from.getTime())
    .map(time => new Date(time))
}

/** One upcoming boundary where {@link periodAt} changes value. */
export interface NextSwitch {
  /** The instant the period changes. */
  readonly at: Date
  /** The period in force from {@link at} onward. */
  readonly period: Period
  /**
   * Why the change happens, for copy: the boundary name plus, for a multi-day
   * gap, the date it falls on.
   */
  readonly reason: string
}

/**
 * Name the boundary in terms a reader recognises.
 * @param rules - the active rule set.
 * @param at - the boundary instant.
 * @param period - the period starting there.
 * @returns the reason copy.
 */
function describeSwitch(rules: PricingRules, at: Date, period: Period): string {
  const { date, minuteOfDay } = beijingClock(at)
  const kind = classifyDay(rules, date)
  if (minuteOfDay === 0) {
    if (kind === 'holiday') return `${holidayOn(rules, date)?.name ?? '法定节假日'}全天谷时`
    if (kind === 'weekend') {
      return isMakeupWorkday(rules, date) ? '调休上班日仍按周末全天谷时' : '周末全天谷时'
    }
    return '工作日开始'
  }
  if (period === 'peak') return '高峰时段开始'
  return minuteOfDay === 12 * 60 ? '午间谷时开始' : '谷时开始'
}

/**
 * The next instant the billing period changes, so a UI can count down to it.
 *
 * The boundary is the first candidate whose period differs from the period in
 * force just before it — not the first whose period differs from `from`. The two
 * differ whenever an off-peak stretch begins before `from` and runs past a
 * boundary: the later midnight inside that stretch changes nothing about the
 * price, so counting down to it would name a switch that does not happen. The
 * reason copy is chosen for whichever boundary is returned.
 * @param rules - the active rule set.
 * @param from - the instant the search starts at.
 * @returns the next boundary and the period it starts, or null when the rule
 * set flips nowhere within the search horizon.
 */
export function nextSwitch(rules: PricingRules, from: Date): NextSwitch | null {
  let previous = periodAt(rules, from)
  for (const candidate of candidateBoundaries(rules, from)) {
    const period = periodAt(rules, candidate)
    if (period !== previous) {
      return { at: candidate, period, reason: describeSwitch(rules, candidate, period) }
    }
    previous = period
  }
  return null
}

/** One stretch of constant billing inside the look-ahead schedule. */
export interface ScheduleEntry {
  /** The instant this stretch starts; the first entry starts at the queried instant. */
  readonly at: Date
  /** The price in force across the whole stretch. */
  readonly period: Period
  /** Why this stretch started, in reader-facing copy; `现在` for the first entry. */
  readonly reason: string
  /** The instant the stretch ends, or null when the horizon holds no further flip. */
  readonly until: Date | null
  /** Remaining length of the stretch in milliseconds; 0 when it never ends in-horizon. */
  readonly milliseconds: number
}

/**
 * The period timeline from one instant forward: the stretch in force now, then
 * each following stretch, so a UI or a model can see *when* the cheap window
 * opens and *how long* it lasts rather than only the next boundary.
 *
 * Every entry after the first starts exactly at the boundary {@link nextSwitch}
 * reports, so the countdown, the pill's copy, and this list can never disagree.
 * @param rules - the active rule set.
 * @param from - the instant the schedule starts at.
 * @param count - how many stretches to include, including the current one.
 * @returns the stretches in ascending time order.
 */
export function schedule(rules: PricingRules, from: Date, count: number): ScheduleEntry[] {
  const entries: ScheduleEntry[] = []
  let cursor = from
  let period = periodAt(rules, from)
  let reason = '现在'
  while (entries.length < Math.max(0, count)) {
    const next = nextSwitch(rules, cursor)
    const until = next === null ? null : next.at
    entries.push({
      at: cursor,
      period,
      reason,
      until,
      milliseconds: until === null ? 0 : Math.max(0, until.getTime() - cursor.getTime()),
    })
    if (next === null) break
    cursor = next.at
    period = next.period
    reason = next.reason
  }
  return entries
}

// ---------------------------------------------------------------------------
// Readings, cost, formatting
// ---------------------------------------------------------------------------

/** How one Beijing date divides between the two prices. */
export interface DayLoad {
  /** Minutes of that date billed at the peak rate. */
  readonly peakMinutes: number
  /** Minutes of that date billed at the off-peak rate. */
  readonly offPeakMinutes: number
}

/**
 * Merge overlapping or touching windows into disjoint ascending intervals.
 * @param windows - configured half-open minute ranges.
 * @returns clamped, merged `[start, end)` pairs.
 */
function mergedWindows(windows: readonly PeakWindow[]): Array<[number, number]> {
  const sorted = windows
    .map(window => [Math.max(0, window.startMinute), Math.min(1440, window.endMinute)] as [number, number])
    .filter(([start, end]) => start < end)
    .sort((left, right) => left[0] - right[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/**
 * How many minutes of one Beijing date bill at each price — the "today costs
 * full price for six hours" figure the panel shows above the rate card.
 * @param rules - the active rule set.
 * @param date - Beijing calendar date, `YYYY-MM-DD`.
 * @returns the two totals, always summing to 1440.
 */
export function dayLoad(rules: PricingRules, date: string): DayLoad {
  if (classifyDay(rules, date) !== 'workday') return { peakMinutes: 0, offPeakMinutes: 1440 }
  const peakMinutes = mergedWindows(rules.peakWindows)
    .reduce((total, [start, end]) => total + (end - start), 0)
  return { peakMinutes, offPeakMinutes: 1440 - peakMinutes }
}

/** One complete reading of the billing situation at an instant. */
export interface Reading {
  /** The instant the reading was taken. */
  readonly now: Date
  /** Beijing calendar date of {@link now}. */
  readonly date: string
  /** Which price a request issued now is charged at. */
  readonly period: Period
  /** Why the day bills the way it does. */
  readonly kind: DayKind
  /** Name of the statutory holiday covering the date, when there is one. */
  readonly holiday: string | null
  /** Whether the State Council turned this weekend date into a workday. */
  readonly makeupWorkday: boolean
  /** The next flip and its reason, when one is in the horizon. */
  readonly upcoming: NextSwitch | null
  /** Remaining time to the next flip in milliseconds; 0 when none is. */
  readonly remaining: number
  /** How the current Beijing date divides between the two prices. */
  readonly load: DayLoad
}

/**
 * Fold the active rules and one clock reading into everything a surface needs.
 *
 * Every consumer — the tool's text, the tool's structured value, and the pill —
 * derives from this one call, so no two of them can disagree about the period,
 * the countdown, or the day's shape.
 * @param rules - the active rule set.
 * @param now - the instant to read.
 * @returns the derived reading.
 */
export function read(rules: PricingRules, now: Date): Reading {
  const { date } = beijingClock(now)
  const upcoming = nextSwitch(rules, now)
  return {
    now,
    date,
    period: periodAt(rules, now),
    kind: classifyDay(rules, date),
    holiday: holidayOn(rules, date)?.name ?? null,
    makeupWorkday: isMakeupWorkday(rules, date),
    upcoming,
    remaining: upcoming === null ? 0 : Math.max(0, upcoming.at.getTime() - now.getTime()),
    load: dayLoad(rules, date),
  }
}

/** A model's rates resolved for one period. */
export interface ResolvedPrice extends ModelRates {
  /** Model name as sent in the `model` field. */
  readonly model: string
  /** Human label for the model. */
  readonly label: string
}

/**
 * Look up the rates a model bills at during one period.
 * @param rules - the active rule set.
 * @param model - model name, or any label matching it.
 * @param period - the period to resolve.
 * @returns the resolved rates, or null when the rate card has no such model.
 */
export function ratesFor(rules: PricingRules, model: string, period: Period): ResolvedPrice | null {
  const entry = rules.models.find(item => item.model === model || item.label === model)
  if (entry === undefined) return null
  return { model: entry.model, label: entry.label, ...(period === 'peak' ? entry.peak : entry.offPeak) }
}

/** Token counts to price, as a caller reports them. */
export interface TokenUsage {
  /** Input tokens served from the context cache. */
  readonly cacheHit?: number
  /** Input tokens that missed the context cache. */
  readonly cacheMiss?: number
  /** Generated output tokens. */
  readonly output?: number
}

/** One priced token mix at one period. */
export interface CostEstimate {
  /** Model name as sent in the `model` field. */
  readonly model: string
  /** Human label for the model. */
  readonly label: string
  /** The period the mix was priced at. */
  readonly period: Period
  /** The token counts actually used, with absent fields read as zero. */
  readonly tokens: Required<TokenUsage>
  /** The rates applied. */
  readonly rates: ModelRates
  /** Total cost in CNY, rounded to six decimals. */
  readonly cost: number
}

/** Read a token count as a non-negative integer, treating junk as zero. */
function tokenCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

/**
 * Price one token mix at one period, so a caller can answer "what would this
 * batch cost now, and what would it cost at the other rate".
 * @param rules - the active rule set.
 * @param model - model name, or any label matching it.
 * @param usage - token counts; absent fields count as zero.
 * @param period - the period to price at.
 * @returns the estimate, or null when the rate card has no such model.
 */
export function estimateCost(
  rules: PricingRules, model: string, usage: TokenUsage, period: Period,
): CostEstimate | null {
  const rates = ratesFor(rules, model, period)
  if (rates === null) return null
  const tokens: Required<TokenUsage> = {
    cacheHit: tokenCount(usage.cacheHit),
    cacheMiss: tokenCount(usage.cacheMiss),
    output: tokenCount(usage.output),
  }
  const cost = (tokens.cacheHit * rates.cacheHit
    + tokens.cacheMiss * rates.cacheMiss
    + tokens.output * rates.output) / 1_000_000
  return {
    model: rates.model,
    label: rates.label,
    period,
    tokens,
    rates: { cacheHit: rates.cacheHit, cacheMiss: rates.cacheMiss, output: rates.output },
    cost: Math.round(cost * 1e6) / 1e6,
  }
}

/**
 * Split a duration into whole hours, minutes, and seconds for a countdown.
 * @param milliseconds - remaining time; negative values clamp to zero.
 * @returns the three fields, ready to format.
 */
export function breakdown(milliseconds: number): { hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}

/**
 * Render a countdown compactly: `2天03:12:45`, `03:12:45`, or `12:45`.
 * @param milliseconds - remaining time.
 * @returns the display string.
 */
export function formatCountdown(milliseconds: number): string {
  const { hours, minutes, seconds } = breakdown(milliseconds)
  const days = Math.floor(hours / 24)
  const clock = `${pad(hours % 24)}:${pad(minutes)}:${pad(seconds)}`
  return days > 0 ? `${days}天${clock}` : (hours > 0 ? clock : `${pad(minutes)}:${pad(seconds)}`)
}

/**
 * Render a stretch length the way a schedule row reads: `3 小时`, `45 分钟`,
 * `2 天 3 小时`, or `1 天 2 小时 30 分钟`.
 * @param milliseconds - the stretch length.
 * @returns the display string.
 */
export function formatSpan(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 60_000))
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const minutes = total % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days} 天`)
  if (hours > 0) parts.push(`${hours} 小时`)
  if (minutes > 0) parts.push(`${minutes} 分钟`)
  return parts.length === 0 ? '不到 1 分钟' : parts.join(' ')
}

/**
 * The Beijing wall-clock reading of an instant, for display next to the rules.
 * @param instant - the moment to render.
 * @returns `YYYY-MM-DD HH:MM:SS` in Beijing time.
 */
export function formatBeijingTime(instant: Date): string {
  const { date, minuteOfDay, second } = beijingClock(instant)
  return `${date} ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:${pad(second)}`
}

/**
 * The compact Beijing reading the pill shows: `MM-DD HH:MM:SS`.
 * @param instant - the moment to render.
 * @returns the display string.
 */
export function formatBeijingClock(instant: Date): string {
  return formatBeijingTime(instant).slice(5)
}

/**
 * Parse a caller-supplied instant in Beijing terms.
 *
 * Accepted forms, in order of preference: `YYYY-MM-DD HH:MM[:SS]`,
 * `YYYY-MM-DDTHH:MM[:SS]` (no zone, read as Beijing), a bare `YYYY-MM-DD`
 * (midnight Beijing), a bare `HH:MM[:SS]` (today, Beijing), and finally any
 * absolute ISO-8601 string carrying its own offset or `Z`.
 * @param text - the raw text to parse.
 * @param now - the reference instant a bare time-of-day is resolved against.
 * @returns the parsed instant, or null when the text names no real moment.
 */
export function parseBeijingMoment(text: string, now: Date): Date | null {
  const input = text.trim()
  if (input === '') return null
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(input)
  if (time !== null) {
    const hour = Number(time[1])
    const minute = Number(time[2])
    const second = Number(time[3] ?? 0)
    if (hour > 23 || minute > 59 || second > 59) return null
    return beijingInstant(beijingClock(now).date, hour * 60 + minute, second)
  }
  const calendar = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(input)
  if (calendar !== null) {
    const [, date, hourText, minuteText, secondText] = calendar
    if (!isCalendarDate(date as string)) return null
    const hour = hourText === undefined ? 0 : Number(hourText)
    const minute = minuteText === undefined ? 0 : Number(minuteText)
    const second = secondText === undefined ? 0 : Number(secondText)
    if (hour > 23 || minute > 59 || second > 59) return null
    return beijingInstant(date as string, hour * 60 + minute, second)
  }
  const absolute = new Date(input)
  return Number.isNaN(absolute.getTime()) ? null : absolute
}

/**
 * Shallow-validate a rule set that arrived from configuration, so a typo in a
 * holiday date surfaces as a startup error instead of a wrong price.
 * @param rules - the candidate rule set.
 * @returns a list of human-readable problems; empty when the set is usable.
 */
export function validateRules(rules: PricingRules): string[] {
  const problems: string[] = []
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (rules.holidays.length === 0) problems.push('holidays must not be empty (pass at least the current year)')
  if (rules.peakWindows.length === 0) problems.push('peakWindows must not be empty')
  for (const range of rules.holidays) {
    if (!iso.test(range.start) || !iso.test(range.end) || !isCalendarDate(range.start) || !isCalendarDate(range.end)) {
      problems.push(`holiday ${range.name}: start/end must be a real YYYY-MM-DD date`)
    } else if (range.start > range.end) {
      problems.push(`holiday ${range.name}: start ${range.start} is after end ${range.end}`)
    }
  }
  for (const date of rules.makeupWorkdays) {
    if (!isCalendarDate(date)) problems.push(`makeupWorkday ${date} must be a real YYYY-MM-DD date`)
  }
  for (const window of rules.peakWindows) {
    if (!Number.isFinite(window.startMinute) || !Number.isFinite(window.endMinute)
      || window.startMinute < 0 || window.endMinute > 1440 || window.startMinute >= window.endMinute) {
      problems.push(`peakWindow ${window.startMinute}-${window.endMinute} is not a valid half-open minute range`)
    }
  }
  if (rules.models.length === 0) problems.push('models must not be empty')
  for (const model of rules.models) {
    for (const period of ['peak', 'offPeak'] as const) {
      const rates = model[period]
      for (const [field, value] of Object.entries(rates)) {
        if (!Number.isFinite(value) || value < 0) problems.push(`${model.model}.${period}.${field} must be a non-negative number`)
      }
    }
  }
  return problems
}
