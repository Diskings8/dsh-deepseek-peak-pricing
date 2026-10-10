/**
 * DeepSeek API 峰谷计费提示 — Node half.
 *
 * The browser half owns the always-visible status pill and recomputes the
 * period locally from the same published rule set (it must keep ticking through
 * a host restart, and the rules need no per-request data). This half owns the
 * one thing the browser cannot do on its own: telling the *model* which price a
 * request bills at, and letting a deployment move the calendar without editing
 * the client bundle.
 *
 * Authority for the rules: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 *
 * @module dsh-deepseek-peak-pricing
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

// ---------------------------------------------------------------------------
// Rule set, ported verbatim from src/shared/pricing.ts so this half has no
// intra-package runtime import (the Loader's plugin namespace wants named
// exports, and a re-export layer would add a seam for no benefit). The browser
// bundle consumes that same source through the package's `./pricing` export,
// and tests/pricing.test.mjs executes the CommonJS build of it.
// ---------------------------------------------------------------------------

/** Billing period the API charges at the instant of a request. */
type Period = 'peak' | 'off-peak'

/** One model's rates, in CNY per 1,000,000 tokens. */
interface ModelRates {
  /** Input tokens served from the context cache. */
  readonly cacheHit: number
  /** Input tokens that missed the context cache. */
  readonly cacheMiss: number
  /** Generated output tokens. */
  readonly output: number
}

/** The published rate card for one model. */
interface ModelPrice {
  /** Model name as sent in the `model` field. */
  readonly model: string
  /** Human label for the model. */
  readonly label: string
  /** Rates charged during peak hours. */
  readonly peak: ModelRates
  /** Rates charged off-peak; always exactly half of {@link peak}. */
  readonly offPeak: ModelRates
}

/** One inclusive `YYYY-MM-DD` holiday range. */
interface DateRange {
  /** First day of the holiday, inclusive. */
  readonly start: string
  /** Last day of the holiday, inclusive. */
  readonly end: string
  /** Holiday name, for display. */
  readonly name: string
}

/** A half-open peak window inside one Beijing date, in wall-clock minutes. */
interface PeakWindow {
  /** Minutes after Beijing midnight when peak billing starts. */
  readonly startMinute: number
  /** Minutes after Beijing midnight when peak billing ends (exclusive). */
  readonly endMinute: number
}

/** The complete rule set. */
interface PricingRules {
  /** China statutory holiday ranges, inclusive, by Beijing date. */
  readonly holidays: readonly DateRange[]
  /**
   * Weekend dates designated as 调休上班日. Display metadata only — DeepSeek
   * bills 调休上班的周末 off-peak all day, so this list never moves a price.
   */
  readonly makeupWorkdays: readonly string[]
  /** Peak windows applied on workdays. */
  readonly peakWindows: readonly PeakWindow[]
  /** The model rate card. */
  readonly models: readonly ModelPrice[]
}

/** 2026 holiday arrangement, 国办发明电〔2025〕7号 (published 2025-11-04). */
const HOLIDAYS_2026: readonly DateRange[] = [
  { start: '2026-01-01', end: '2026-01-03', name: '元旦' },
  { start: '2026-02-15', end: '2026-02-23', name: '春节' },
  { start: '2026-04-04', end: '2026-04-06', name: '清明节' },
  { start: '2026-05-01', end: '2026-05-05', name: '劳动节' },
  { start: '2026-06-19', end: '2026-06-21', name: '端午节' },
  { start: '2026-09-25', end: '2026-09-27', name: '中秋节' },
  { start: '2026-10-01', end: '2026-10-07', name: '国庆节' },
]

/** 2026 调休上班日; 2026-09-20 is a Sunday that is nonetheless a workday. */
const MAKEUP_WORKDAYS_2026: readonly string[] = [
  '2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10',
]

/** Peak billing windows: 09:00–12:00 and 14:00–18:00 Beijing time. */
const DEFAULT_PEAK_WINDOWS: readonly PeakWindow[] = [
  { startMinute: 9 * 60, endMinute: 12 * 60 },
  { startMinute: 14 * 60, endMinute: 18 * 60 },
]

/** The official rate card, CNY per million tokens. */
const MODELS: readonly ModelPrice[] = [
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

/** The built-in rule set: the published rate card plus the 2026 calendar. */
const DEFAULT_RULES: PricingRules = {
  holidays: HOLIDAYS_2026,
  makeupWorkdays: MAKEUP_WORKDAYS_2026,
  peakWindows: DEFAULT_PEAK_WINDOWS,
  models: MODELS,
}

/** Asia/Shanghai has held a fixed +08:00 offset with no DST since 1991. */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000
/** Longest span the next-switch search needs to look ahead. */
const SEARCH_DAYS = 8

/** How one Beijing date is classified for billing. */
type DayKind = 'holiday' | 'weekend' | 'workday'

/** Zero-pad a calendar field to two digits. */
function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** The Beijing wall clock of an instant, derived without the host timezone. */
function beijingClock(instant: Date): { date: string; minuteOfDay: number } {
  const shifted = new Date(instant.getTime() + BEIJING_OFFSET_MS)
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

/** The Beijing weekday (0 = Sunday) of a `YYYY-MM-DD` date. */
function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** The holiday range containing `date`, when there is one. */
function holidayOn(rules: PricingRules, date: string): DateRange | undefined {
  return rules.holidays.find(range => date >= range.start && date <= range.end)
}

/** Whether `date` is a designated 调休上班日 (display metadata; price-neutral). */
function isMakeupWorkday(rules: PricingRules, date: string): boolean {
  return rules.makeupWorkdays.includes(date)
}

/**
 * Classify one Beijing date.
 *
 * A 调休上班日 does NOT make a weekend bill at peak: DeepSeek states (2026-09-19)
 * that "调休上班的周末、中国法定节假日全天均按空闲时段计费", and the 2026-08-23
 * adjustment made 周六、周日 off-peak all day. The weekday test is decisive.
 * @param rules - the active rule set.
 * @param date - Beijing calendar date, `YYYY-MM-DD`.
 * @returns the day classification governing the whole day.
 */
function classifyDay(rules: PricingRules, date: string): DayKind {
  if (holidayOn(rules, date) !== undefined) return 'holiday'
  const weekday = weekdayOf(date)
  return weekday === 0 || weekday === 6 ? 'weekend' : 'workday'
}

/**
 * The billing period at one instant.
 * @param rules - the active rule set.
 * @param instant - the moment being billed.
 * @returns which price the API charges for a request at that instant.
 */
function periodAt(rules: PricingRules, instant: Date): Period {
  const { date, minuteOfDay } = beijingClock(instant)
  if (classifyDay(rules, date) !== 'workday') return 'off-peak'
  return rules.peakWindows.some(window => minuteOfDay >= window.startMinute && minuteOfDay < window.endMinute)
    ? 'peak'
    : 'off-peak'
}

/**
 * Every Beijing boundary in the look-ahead horizon where the period may flip:
 * each peak window edge and each midnight (a holiday, weekend, or makeup
 * workday changes a whole day, so those flips land on a date boundary).
 * @param rules - the active rule set.
 * @param from - the instant the search starts at.
 * @returns ascending candidate boundaries at or after `from`.
 */
function candidateBoundaries(rules: PricingRules, from: Date): Date[] {
  const { date } = beijingClock(from)
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const midnightUtc = Date.UTC(year, month - 1, day) - BEIJING_OFFSET_MS
  const edges = new Set<number>()
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const dayStart = midnightUtc + offset * MS_PER_DAY
    edges.add(dayStart)
    for (const window of rules.peakWindows) {
      edges.add(dayStart + window.startMinute * 60_000)
      edges.add(dayStart + window.endMinute * 60_000)
    }
  }
  return [...edges]
    .sort((left, right) => left - right)
    .filter(time => time >= from.getTime())
    .map(time => new Date(time))
}

/** One upcoming boundary where the period changes value. */
interface NextSwitch {
  /** The instant the period changes. */
  readonly at: Date
  /** The period in force from {@link at} onward. */
  readonly period: Period
  /** Why the change happens, in reader-facing copy. */
  readonly reason: string
}

/**
 * Name a boundary in terms a reader recognises.
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
 * The next instant the billing period changes. The boundary is the first
 * candidate whose period differs from the period in force just before it, not
 * the first whose period differs from `from`: a later midnight inside an
 * off-peak stretch that began before `from` changes nothing about the price.
 * @param rules - the active rule set.
 * @param from - the instant the search starts at.
 * @returns the next boundary, or null when nothing flips in the horizon.
 */
function nextSwitch(rules: PricingRules, from: Date): NextSwitch | null {
  let previous = periodAt(rules, from)
  for (const candidate of candidateBoundaries(rules, from)) {
    const period = periodAt(rules, candidate)
    if (period !== previous) return { at: candidate, period, reason: describeSwitch(rules, candidate, period) }
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
  const clock = `${pad(hours % 24)}:${pad(minutes)}:${pad(seconds)}`
  const days = Math.floor(hours / 24)
  return days > 0 ? `${days}天${clock}` : (hours > 0 ? clock : `${pad(minutes)}:${pad(seconds)}`)
}

/**
 * The Beijing wall-clock reading of an instant.
 * @param instant - the moment to render.
 * @returns `YYYY-MM-DD HH:MM:SS` in Beijing time.
 */
function formatBeijingTime(instant: Date): string {
  const { date, minuteOfDay } = beijingClock(instant)
  const shifted = new Date(instant.getTime() + BEIJING_OFFSET_MS)
  return `${date} ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:${pad(shifted.getUTCSeconds())}`
}

/**
 * Shallow-validate a configured rule set so a typo surfaces as a startup error
 * rather than as a silently wrong price.
 * @param rules - the candidate rule set.
 * @returns human-readable problems; empty when the set is usable.
 */
function validateRules(rules: PricingRules): string[] {
  const problems: string[] = []
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (rules.holidays.length === 0) problems.push('holidays must not be empty (pass at least the current year)')
  if (rules.peakWindows.length === 0) problems.push('peakWindows must not be empty')
  for (const range of rules.holidays) {
    if (!iso.test(range.start) || !iso.test(range.end)) {
      problems.push(`holiday ${range.name}: start/end must be YYYY-MM-DD`)
    } else if (range.start > range.end) {
      problems.push(`holiday ${range.name}: start ${range.start} is after end ${range.end}`)
    }
  }
  for (const date of rules.makeupWorkdays) {
    if (!iso.test(date)) problems.push(`makeupWorkday ${date} must be YYYY-MM-DD`)
  }
  for (const window of rules.peakWindows) {
    if (window.startMinute < 0 || window.endMinute > 1440 || window.startMinute >= window.endMinute) {
      problems.push(`peakWindow ${window.startMinute}-${window.endMinute} is not a valid half-open minute range`)
    }
  }
  if (rules.models.length === 0) problems.push('models must not be empty')
  return problems
}

// ---------------------------------------------------------------------------
// Plugin surface
// ---------------------------------------------------------------------------

/** Cordis plugin name, matched by the bundle patch's row id. */
export const name = 'deepseek-peak-pricing'

/** Required service: the tool registry this plugin contributes to. */
export const inject = ['tools']

/** Deployment overrides for the built-in rule set. */
export interface Config {
  /**
   * Statutory holiday ranges `{ start, end, name }`, inclusive, by Beijing date.
   * Replaces the built-in calendar — pass the complete set you want in force,
   * including a new year's dates as they are published.
   */
  holidays?: Array<{ start: string; end: string; name: string }>
  /**
   * 调休上班日 (`YYYY-MM-DD`), the weekends the State Council turns into
   * workdays. Replaces the built-in list.
   *
   * Price-neutral: DeepSeek bills 调休上班的周末 off-peak all day, so this list
   * only affects how the result explains itself, never the period it reports.
   */
  makeupWorkdays?: string[]
  /**
   * Peak windows in Beijing wall-clock minutes after midnight, as half-open
   * `[startMinute, endMinute)` pairs. Replaces the built-in 09:00–12:00 and
   * 14:00–18:00 windows.
   */
  peakWindows?: Array<{ startMinute: number; endMinute: number }>
}

/** Schemastery schema for {@link Config}; every field is an optional override. */
export const Config: z<Config> = z.object({
  holidays: z.array(z.object({
    start: z.string().required(),
    end: z.string().required(),
    name: z.string().required(),
  })).description('法定节假日区间（含首尾，北京日期 YYYY-MM-DD）；设置后替换内置日历'),
  makeupWorkdays: z.array(z.string()).description('调休上班日 YYYY-MM-DD（仅用于说明，不影响计价：调休的周末仍全天谷时）；设置后替换内置列表'),
  peakWindows: z.array(z.object({
    startMinute: z.number().required(),
    endMinute: z.number().required(),
  })).description('高峰时段（北京时间的当日分钟数，左闭右开）；设置后替换内置 09:00-12:00 / 14:00-18:00'),
})

/**
 * Merge the deployment's overrides over the built-in rule set and reject a set
 * that cannot produce a correct price.
 * @param config - the validated plugin config; absent means "use the built-ins".
 * @returns the effective rule set.
 * @throws {Error} when the merged set has structural problems.
 */
function resolveRules(config: Config | undefined): PricingRules {
  const rules: PricingRules = {
    holidays: config?.holidays ?? DEFAULT_RULES.holidays,
    makeupWorkdays: config?.makeupWorkdays ?? DEFAULT_RULES.makeupWorkdays,
    peakWindows: config?.peakWindows ?? DEFAULT_RULES.peakWindows,
    models: DEFAULT_RULES.models,
  }
  const problems = validateRules(rules)
  if (problems.length > 0) throw new Error(`deepseek-peak-pricing: invalid rules\n- ${problems.join('\n- ')}`)
  return rules
}

/** One complete reading of the billing situation at an instant. */
interface Reading {
  /** The instant the reading was taken. */
  now: Date
  /** Which price a request issued now is charged at. */
  period: Period
  /** Why the day bills the way it does. */
  kind: DayKind
  /** Whether the State Council turned this weekend date into a workday. */
  makeupWorkday: boolean
  /** The next flip and its reason, when one is in the horizon. */
  upcoming: NextSwitch | null
  /** Remaining time to the next flip in milliseconds; 0 when none is. */
  remaining: number
}

/**
 * Fold the active rules and one clock reading into everything the report needs.
 *
 * Both {@link renderStatus} and `execute` share this, so the rendered text and
 * the structured value can never disagree — including across the midnight
 * between them, which a second `new Date()` inside `render` would allow.
 * @param rules - the active rule set.
 * @param now - the instant to read.
 * @returns the derived reading.
 */
function read(rules: PricingRules, now: Date): Reading {
  const { date } = beijingClock(now)
  const upcoming = nextSwitch(rules, now)
  return {
    now,
    period: periodAt(rules, now),
    kind: classifyDay(rules, date),
    makeupWorkday: isMakeupWorkday(rules, date),
    upcoming,
    remaining: upcoming === null ? 0 : Math.max(0, upcoming.at.getTime() - now.getTime()),
  }
}

/** The published rule, echoed verbatim so an answer is self-contained. */
const RULE_TEXT =
  '北京时间周一至周五（不含中国法定节假日）09:00-12:00、14:00-18:00 为高峰时段；'
  + '其余时段，包括周末及中国法定节假日全天均为空闲时段。调休上班的周末同样全天按空闲时段计费。'

/**
 * Render one reading as the tool's model-facing text.
 *
 * It formats the same fields the structured value carries rather than
 * recomputing anything: a second clock read here could disagree with the value
 * across a midnight.
 * @param value - the canonical result `execute` produced.
 * @returns the compact report.
 */
function renderStatus(value: PricingStatusValue): string {
  const lines = [
    `DeepSeek API 当前为${value.periodLabel}（北京时间 ${value.beijingTime}）。`,
    value.period === 'peak'
      ? '高峰时段价格为谷时的 2 倍。'
      : '空闲时段价格为高峰的 5 折。',
  ]
  if (value.makeupWorkday) {
    lines.push('今天是调休上班日，但 DeepSeek 对调休上班的周末仍按空闲时段全天计费。')
  }
  if (value.nextPeriod !== 'none') {
    lines.push(`距下一次切换（${value.nextReason}）还有 ${value.countdown}，之后为${value.nextPeriod === 'peak' ? '高峰时段' : '空闲时段'}。`)
  }
  lines.push('')
  lines.push('当前单价（元 / 百万 tokens）：')
  for (const price of value.prices) {
    lines.push(`- ${price.model}：输入(缓存命中) ${price.cacheHit} ｜ 输入(缓存未命中) ${price.cacheMiss} ｜ 输出 ${price.output}`)
  }
  lines.push('')
  lines.push(`时段规则：${value.rule}`)
  return lines.join('\n')
}

/** Wire shape of the `deepseek_pricing_status` tool result. */
interface PricingStatusValue {
  /** Which price a request issued now is charged at. */
  period: Period
  /** Beijing wall-clock reading of the reported instant. */
  beijingTime: string
  /** Key the UI and tests use to identify the current period copy. */
  periodLabel: string
  /** Why the current day bills the way it does. */
  dayKind: DayKind
  /**
   * Whether today is a 调休上班日. Price-neutral: the day still bills off-peak
   * all day, so this field exists to pre-empt a "workday should be peak" reading.
   */
  makeupWorkday: boolean
  /** Milliseconds until the next flip; 0 when the horizon holds none. */
  msUntilSwitch: number
  /** Human countdown to the next flip. */
  countdown: string
  /** The period starting at the next flip. */
  nextPeriod: Period
  /** Why the next flip happens. */
  nextReason: string
  /** Per-model rates in force right now. */
  prices: Array<{ model: string; cacheHit: number; cacheMiss: number; output: number }>
  /** The rule text, echoed so the answer is self-contained. */
  rule: string
}

/**
 * Register the `deepseek_pricing_status` tool.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - the deployment's calendar and window overrides; absent means
 * the built-in 2026 calendar and the published windows.
 */
export function apply(ctx: Context, config?: Config): void {
  const rules = resolveRules(config)
  ctx.tools.register(defineTool({
    name: 'deepseek_pricing_status',
    description:
      'Report whether DeepSeek API requests right now bill at the peak (高峰) or off-peak (空闲/谷时) rate, '
      + 'how long until the rate changes, and the current CNY-per-million-token price of each model. '
      + 'Call it before reasoning about cost, batch size, or scheduling non-urgent work: off-peak is exactly half price. '
      + 'The answer is computed from the published rule (Beijing time, Mon-Fri 09:00-12:00 and 14:00-18:00 excluding '
      + 'China statutory holidays; weekends and holidays are off-peak all day, and 调休上班的周末 stay off-peak too) '
      + 'and needs no arguments.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          period: { type: 'string', required: true, enum: ['peak', 'off-peak'] },
          beijingTime: { type: 'string', required: true },
          periodLabel: { type: 'string', required: true },
          dayKind: { type: 'string', required: true, enum: ['holiday', 'weekend', 'workday'] },
          makeupWorkday: { type: 'boolean', required: true },
          msUntilSwitch: { type: 'integer', required: true },
          countdown: { type: 'string', required: true },
          nextPeriod: { type: 'string', required: true, enum: ['peak', 'off-peak', 'none'] },
          nextReason: { type: 'string', required: true },
          prices: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                model: { type: 'string', required: true },
                cacheHit: { type: 'number', required: true },
                cacheMiss: { type: 'number', required: true },
                output: { type: 'number', required: true },
              },
            },
          },
          rule: { type: 'string', required: true },
        },
      },
      // The reading is computed once, in execute; render only formats it.
      render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
    },
    execute(): Promise<PricingStatusValue> {
      const reading = read(rules, new Date())
      return Promise.resolve({
        period: reading.period,
        beijingTime: formatBeijingTime(reading.now),
        periodLabel: reading.period === 'peak' ? '高峰时段' : '空闲时段',
        dayKind: reading.kind,
        makeupWorkday: reading.makeupWorkday,
        msUntilSwitch: reading.remaining,
        countdown: formatCountdown(reading.remaining),
        nextPeriod: reading.upcoming === null ? 'none' : reading.upcoming.period,
        nextReason: reading.upcoming === null ? '' : reading.upcoming.reason,
        prices: rules.models.map(model => ({
          model: model.label,
          ...(reading.period === 'peak' ? model.peak : model.offPeak),
        })),
        rule: RULE_TEXT,
      })
    },
    presentCall: () => ({ card: 'generic', title: '查询 DeepSeek 峰谷计费', kind: 'other' }),
  }))
}
