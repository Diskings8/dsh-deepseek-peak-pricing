/**
 * DeepSeek API 峰谷计费提示 — browser half.
 *
 * Three surfaces, all derived from one clock reading:
 *
 * - a status reading in the composer's dock row
 *   (`conversation.composer.dock`), beside ui-chat's output-speed and 缓存命中
 *   pills, answering at a glance whether the next request bills at the peak or
 *   the off-peak rate and how long that lasts;
 * - an expanded panel with both price columns, the day's peak/off-peak split,
 *   and the upcoming switch timeline;
 * - a transient notice in `shell.overlay` when the period flips, or shortly
 *   before a peak window opens, so a batch run can be pushed into the cheap
 *   window without watching the pill.
 *
 * The dock seam is a root-scoped list under the composer card rather than
 * `shell.overlay`, because that is where the shipped usage readings live — a
 * floating corner badge would be a second, competing place to look for the same
 * kind of number. The notice *is* an overlay, because it is transient news that
 * must not become a permanent fixture.
 *
 * The rules come from `src/shared/pricing.ts`, inlined into this bundle, and the
 * deployment's calendar reaches this half through the plugin-config form
 * (`ctx.configForms`). When that form is unavailable — a non-loopback page, or a
 * profile without the settings surface — the built-in published calendar is
 * used, so the pill keeps ticking either way.
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

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import {
  DEFAULT_NOTIFY_ON_SWITCH,
  DEFAULT_PEAK_WINDOWS,
  DEFAULT_REMIND_BEFORE_PEAK_MINUTES,
  DEFAULT_RULES,
  HOLIDAYS_2026,
  MAKEUP_WORKDAYS_2026,
  classifyDay as classifyDayCore,
  formatBeijingClock,
  formatCountdown,
  formatSpan,
  nextSwitch as nextSwitchCore,
  periodAt as periodAtCore,
  read as readCore,
  resolveRules,
  schedule as scheduleCore,
} from '../shared/pricing'
import type {
  DateRange, DayKind, ModelRates, NextSwitch, PeakWindow, Period, PricingOverrides, PricingRules, ScheduleEntry,
} from '../shared/pricing'

/** The dock row under the composer: a root-scoped list slot ui-chat's `StatsPills` occupies. */
const COMPOSER_DOCK_SLOT = 'conversation.composer.dock'

/** The frame-wide overlay list declared by ui-layout, where transient notices live. */
const SHELL_OVERLAY_SLOT = 'shell.overlay'

/**
 * The profile entry id this plugin is inserted as, which is also the namespace
 * the Host projects its live configuration under.
 */
export const SETTINGS_NAMESPACE = 'deepseek-peak-pricing'

/** How many upcoming stretches the expanded panel lists. */
const TIMELINE_LENGTH = 4

// ---------------------------------------------------------------------------
// Live settings: the Host's calendar, projected into this half
// ---------------------------------------------------------------------------

/** A minimal synchronous snapshot store, shared by the surfaces below. */
export interface SnapshotStore<T> {
  /** The current value; the reference is stable until it changes. */
  getSnapshot(): T
  /** Observe replacements; returns the disposer. */
  subscribe(listener: () => void): () => void
  /** Replace the value and notify listeners. */
  set(value: T): void
}

/**
 * Create a snapshot store, the shape React's `useSyncExternalStore` and the
 * settings form both expect.
 * @param initial - the value before anything arrives.
 * @returns the store.
 */
export function createStore<T>(initial: T): SnapshotStore<T> {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (value) => {
      if (value === current) return
      current = value
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Everything the browser surfaces read from configuration. */
export interface ClientSettings {
  /** The effective rule set. */
  rules: PricingRules
  /** Whether a period flip raises a notice. */
  notifyOnSwitch: boolean
  /** Minutes before a peak window to warn; 0 disables the warning. */
  remindBeforePeakMinutes: number
  /** Configuration problems the Host reported; non-empty means the built-ins are in force. */
  problems: readonly string[]
  /** Where {@link rules} came from, purely so the panel can be honest about it. */
  source: 'host' | 'built-in'
}

/** The built-in published calendar, in force until the Host's form arrives. */
const BUILT_IN_SETTINGS: ClientSettings = {
  rules: DEFAULT_RULES,
  notifyOnSwitch: DEFAULT_NOTIFY_ON_SWITCH,
  remindBeforePeakMinutes: DEFAULT_REMIND_BEFORE_PEAK_MINUTES,
  problems: [],
  source: 'built-in',
}

/** The configuration the surfaces render from. */
export const liveSettings = createStore<ClientSettings>(BUILT_IN_SETTINGS)

/** The value shape one projected plugin-config form carries. */
interface SettingsValue extends PricingOverrides {
  /** Whether a period flip raises a notice. */
  readonly notifyOnSwitch?: unknown
  /** Minutes before a peak window to warn. */
  readonly remindBeforePeakMinutes?: unknown
}

/**
 * Turn one projected configuration value into the settings the surfaces use.
 *
 * An unreadable or invalid calendar falls back to the published one rather than
 * to a wrong price, and keeps the reason so the panel can say why.
 * @param value - the Host's projected config value, or anything at all.
 * @returns the resolved settings.
 */
export function applyClientSettings(value: unknown): ClientSettings {
  if (value === null || typeof value !== 'object') return BUILT_IN_SETTINGS
  const source = value as SettingsValue
  const { rules, problems } = resolveRules(source)
  return {
    rules,
    notifyOnSwitch: typeof source.notifyOnSwitch === 'boolean' ? source.notifyOnSwitch : DEFAULT_NOTIFY_ON_SWITCH,
    remindBeforePeakMinutes: typeof source.remindBeforePeakMinutes === 'number'
      && Number.isFinite(source.remindBeforePeakMinutes) && source.remindBeforePeakMinutes >= 0
      ? Math.floor(source.remindBeforePeakMinutes)
      : DEFAULT_REMIND_BEFORE_PEAK_MINUTES,
    problems,
    source: 'host',
  }
}

/** The slice of a projected config form this plugin reads. */
export interface ConfigFormLike {
  /** The current form snapshot; `value` is absent until the Host answers. */
  getSnapshot(): { value?: unknown }
  /** Observe snapshot replacements. */
  subscribe(listener: () => void): () => void
}

/**
 * Keep the live settings in step with one projected plugin-config form.
 * @param form - the form for this plugin's namespace.
 * @returns the disposer removing the subscription.
 */
export function watchSettings(form: ConfigFormLike): () => void {
  const sync = (): void => {
    const snapshot = form.getSnapshot()
    liveSettings.set(snapshot?.value === undefined ? BUILT_IN_SETTINGS : applyClientSettings(snapshot.value))
  }
  sync()
  return form.subscribe(sync)
}

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

/** One rendered price row: the model with both periods it can bill at. */
export interface PriceRow {
  /** Model name as sent in the `model` field. */
  model: string
  /** Rates in force right now. */
  now: ModelRates
  /** Rates charged at the other period. */
  other: ModelRates
  /** Which period {@link now} is. */
  period: Period
}

/** Everything the pill and its panel render from one clock reading. */
export interface Reading {
  /** The instant the reading was taken. */
  now: Date
  /** Beijing calendar date of {@link now}. */
  date: string
  /** Which price a request issued now is charged at. */
  period: Period
  /** Why the current day bills this way. */
  kind: DayKind
  /** Statutory holiday covering the date, when there is one. */
  holiday: string | null
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
  /** How the current Beijing date divides between the two prices. */
  load: { peakMinutes: number; offPeakMinutes: number }
  /** Per-model comparison of the current and other period. */
  rows: PriceRow[]
  /** The stretches after the current one, for the panel's timeline. */
  timeline: ScheduleEntry[]
}

/**
 * The billing period at one instant, read against the live rules unless a rule
 * set is supplied.
 * @param instant - the moment being billed.
 * @param rules - the rule set to read against; defaults to the live one.
 * @returns the applicable period.
 */
export function periodAt(instant: Date, rules: PricingRules = liveSettings.getSnapshot().rules): Period {
  return periodAtCore(rules, instant)
}

/**
 * Classify one Beijing date against the live rules unless a rule set is supplied.
 * @param date - Beijing calendar date, `YYYY-MM-DD`.
 * @param rules - the rule set to read against; defaults to the live one.
 * @returns the classification governing the whole day.
 */
export function classifyDay(date: string, rules: PricingRules = liveSettings.getSnapshot().rules): DayKind {
  return classifyDayCore(rules, date)
}

/**
 * The next instant the billing period changes, against the live rules unless a
 * rule set is supplied.
 * @param from - the instant the search starts at.
 * @param rules - the rule set to read against; defaults to the live one.
 * @returns the next boundary, or null when nothing flips in the horizon.
 */
export function nextSwitch(from: Date, rules: PricingRules = liveSettings.getSnapshot().rules): NextSwitch | null {
  return nextSwitchCore(rules, from)
}

/**
 * The period timeline from one instant forward, against the live rules unless a
 * rule set is supplied.
 * @param from - the instant the schedule starts at.
 * @param count - how many stretches to include, including the current one.
 * @param rules - the rule set to read against; defaults to the live one.
 * @returns the stretches in ascending time order.
 */
export function schedule(
  from: Date, count: number, rules: PricingRules = liveSettings.getSnapshot().rules,
): ScheduleEntry[] {
  return scheduleCore(rules, from, count)
}

/**
 * Fold one clock reading into everything the UI shows.
 * @param now - the instant to read.
 * @param rules - the rule set to read against; defaults to the live one.
 * @returns the derived reading.
 */
export function read(now: Date, rules: PricingRules = liveSettings.getSnapshot().rules): Reading {
  const core = readCore(rules, now)
  return {
    ...core,
    rows: rules.models.map(card => ({
      model: card.model,
      now: core.period === 'peak' ? card.peak : card.offPeak,
      other: core.period === 'peak' ? card.offPeak : card.peak,
      period: core.period,
    })),
    timeline: scheduleCore(rules, now, TIMELINE_LENGTH + 1).slice(1),
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

/** Render a minute count as hours inside a sentence. */
function hours(minutes: number): string {
  if (minutes % 60 === 0) return String(minutes / 60)
  return (minutes / 60).toFixed(1)
}

/** The `MM-DD HH:MM` form of a Beijing instant, without seconds. */
function shortClock(instant: Date): string {
  return formatBeijingClock(instant).slice(0, 11)
}

// ---------------------------------------------------------------------------
// The period-flip notice
// ---------------------------------------------------------------------------

/** One transient notice on screen. */
export interface Notice {
  /** Stable identity for React keys and for de-duplicating a boundary. */
  id: string
  /** Whether this is a flip that happened or a warning about one about to happen. */
  kind: 'switch' | 'before-peak'
  /** The period the notice is about. */
  period: Period
  /** Headline. */
  title: string
  /** One sentence of context. */
  body: string
  /** When it was raised, for expiry. */
  at: number
}

/** What the notice surface remembers between ticks. */
export interface NoticeState {
  /** Billing period on the previous tick; null before the first tick. */
  lastPeriod: Period | null
  /** Boundary instant already warned about, so a lead warning fires once. */
  remindedFor: number | null
  /** The notice currently on screen, if any. */
  active: Notice | null
}

/** The state the notice surface starts from: no observed period, nothing on screen. */
export const INITIAL_NOTICE_STATE: NoticeState = { lastPeriod: null, remindedFor: null, active: null }

/** How long a notice stays on screen before clearing itself. */
export const NOTICE_TTL_MS = 12_000

/** The switch and lead-warning decisions, as one pure transition. */
export interface NoticeOptions {
  /** Whether a flip raises a notice. */
  readonly notifyOnSwitch: boolean
  /** Minutes before a peak window to warn; 0 disables the warning. */
  readonly remindBeforePeakMinutes: number
}

/**
 * Advance the notice state by one tick.
 *
 * Pure and hook-free so the transitions are testable without a renderer. The
 * first tick only records the period: mounting the page mid-window must not
 * announce a flip that happened before the user arrived.
 * @param rules - the active rule set.
 * @param state - the state after the previous tick.
 * @param now - this tick's instant.
 * @param options - notice switches and lead time.
 * @returns the next state.
 */
export function advanceNotice(
  rules: PricingRules, state: NoticeState, now: Date, options: NoticeOptions,
): NoticeState {
  const at = now.getTime()
  const stillVisible = state.active !== null && at - state.active.at <= NOTICE_TTL_MS ? state.active : null
  const period = periodAtCore(rules, now)
  if (state.lastPeriod === null) return { lastPeriod: period, remindedFor: state.remindedFor, active: stillVisible }
  if (period !== state.lastPeriod) {
    const notice: Notice = period === 'off-peak'
      ? {
        id: `switch:${at}`, kind: 'switch', period, at,
        title: '已进入谷时（高峰价的 5 折）',
        body: '适合跑批量与长任务；单价已在下方的价目表里切换。',
      }
      : {
        id: `switch:${at}`, kind: 'switch', period, at,
        title: '已进入高峰时段（价格为谷时 2 倍）',
        body: '非紧急的批量请求可以等到下一次谷时。',
      }
    return { lastPeriod: period, remindedFor: state.remindedFor, active: options.notifyOnSwitch ? notice : stillVisible }
  }
  const lead = options.remindBeforePeakMinutes * 60_000
  const upcoming = nextSwitchCore(rules, now)
  const due = upcoming !== null && upcoming.period === 'peak' ? upcoming.at.getTime() - at : Number.POSITIVE_INFINITY
  if (lead > 0 && due >= 0 && due <= lead && state.remindedFor !== upcoming?.at.getTime()) {
    const minutes = Math.max(1, Math.ceil(due / 60_000))
    return {
      lastPeriod: period,
      remindedFor: upcoming === null ? state.remindedFor : upcoming.at.getTime(),
      active: {
        id: `before-peak:${upcoming?.at.getTime() ?? at}`,
        kind: 'before-peak',
        period: 'peak',
        at,
        title: `${minutes} 分钟后进入高峰`,
        body: '高峰价为谷时的 2 倍，长任务要么现在起，要么等谷时。',
      },
    }
  }
  return { lastPeriod: period, remindedFor: state.remindedFor, active: stillVisible }
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * Styles for the dock reading and its panel.
 *
 * The resting pill deliberately copies ui-chat's StatsPills skin — transparent
 * background, tertiary-tier type, `1px 8px` padding, transparent hover wash —
 * because it renders as a sibling in the same `conversation.composer.dock` row
 * as the 缓存命中 pill. Anything louder reads as a foreign control bolted onto
 * the composer instead of a third reading beside the other two.
 */
export const PILL_CSS = `
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
/* The lamp: amber while peak bills, green while off-peak does. The fill follows
   the theme token and falls back to that token's literal value, so the light
   still reads as 黄/绿 if a theme ever drops the alias. The halo is the same
   hue at low opacity, which is what makes it look lit rather than printed. */
.dspp-dot, .dspp-lamp { border-radius: 50%; flex: none; }
.dspp-dot { width: 8px; height: 8px; }
.dspp-lamp { width: 9px; height: 9px; display: inline-block; margin-right: 6px; vertical-align: middle; }
.dspp-root[data-period="peak"] .dspp-dot,
.dspp-panel[data-period="peak"] .dspp-lamp,
.dspp-notice[data-period="peak"] .dspp-lamp {
  background: var(--dsw-alias-state-warn-primary, #f59e0b); box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.22); }
.dspp-root[data-period="off-peak"] .dspp-dot,
.dspp-panel[data-period="off-peak"] .dspp-lamp,
.dspp-notice[data-period="off-peak"] .dspp-lamp {
  background: var(--dsw-alias-state-success-primary, #22c55e); box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.22); }
/* Only the peak label is coloured on the resting pill: the amber is the anomaly
   worth pulling the eye, while the green lamp carries the off-peak reading
   without making the third dock reading louder than its two siblings. */
.dspp-root[data-period="peak"] .dspp-label { color: var(--dsw-alias-state-warn-primary, #f59e0b); font-weight: 600; }
.dspp-count { color: var(--dsw-alias-label-secondary); }
.dspp-panel { position: absolute; left: 50%; transform: translateX(-50%);
  bottom: calc(100% + 10px); z-index: 40;
  width: max-content; max-width: min(380px, calc(100vw - 32px));
  padding: 12px 13px; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 1.5; text-align: left;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22); }
.dspp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.dspp-head strong { font-size: 13px; }
.dspp-clock { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dspp-next { color: var(--dsw-alias-label-secondary); }
.dspp-load { margin-bottom: 10px; color: var(--dsw-alias-label-secondary); }
.dspp-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
.dspp-table th, .dspp-table td { padding: 3px 6px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dspp-table th:first-child, .dspp-table td:first-child { text-align: left; font-variant-numeric: normal; }
.dspp-table thead th { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.dspp-table td.dspp-model { vertical-align: top; padding-top: 4px; }
.dspp-table td.dspp-tag { text-align: left; color: var(--dsw-alias-label-secondary); }
.dspp-table tr + tr td { border-top: 1px solid var(--dsw-alias-border-l1); }
.dspp-table tr.dspp-group td { border-top: 1px solid var(--dsw-alias-border-l1); }
.dspp-table tr.is-current td { color: var(--dsw-alias-brand-primary); font-weight: 600; }
.dspp-section { margin-bottom: 4px; color: var(--dsw-alias-label-secondary); }
.dspp-timeline { margin-bottom: 10px; }
.dspp-timeline-row { display: flex; gap: 8px; justify-content: space-between; }
.dspp-timeline-row span:first-child { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.dspp-timeline-row span:last-child { color: var(--dsw-alias-label-secondary); }
.dspp-note { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; }
.dspp-note b { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dspp-warn { margin-top: 6px; color: var(--dsw-alias-state-warn-primary); }
`

/**
 * Styles for the transient period-flip notice.
 *
 * It is a fixed corner toast on purpose: unlike the pill it reports an event,
 * not a standing reading, so it must not occupy the composer row.
 */
export const NOTICE_CSS = `
.dspp-notice { position: fixed; right: 16px; bottom: 16px; z-index: 60;
  display: flex; align-items: flex-start; gap: 10px;
  max-width: min(320px, calc(100vw - 32px)); padding: 10px 12px; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 1.5; text-align: left;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22); }
.dspp-notice[data-period="peak"] { border-color: var(--dsw-alias-state-warn-primary); }
.dspp-notice strong { display: block; margin-bottom: 2px; font-size: 13px; }
.dspp-notice[data-kind="switch"][data-period="off-peak"] strong { color: var(--dsw-alias-state-success-primary); }
.dspp-notice[data-kind="switch"][data-period="peak"] strong { color: var(--dsw-alias-state-warn-primary); }
.dspp-notice-text > div { color: var(--dsw-alias-label-secondary); }
.dspp-notice-close { flex: none; border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 16px; line-height: 1; padding: 0 2px; }
.dspp-notice-close:hover { color: var(--dsw-alias-label-primary); }
`

/**
 * Styles for the plugin-manager configuration page.
 *
 * It renders inside someone else's panel, so it owns no layout beyond a column
 * of fieldsets and inherits type from the host page.
 */
export const CONFIG_CSS = `
.dspp-cfg { display: flex; flex-direction: column; gap: 12px; max-width: 640px;
  color: var(--dsw-alias-label-primary); font-size: 13px; text-align: left; }
.dspp-cfg fieldset { margin: 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; }
.dspp-cfg legend { padding: 0 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dspp-cfg-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.dspp-cfg-row:last-child { margin-bottom: 0; }
.dspp-cfg input[type="date"], .dspp-cfg input[type="time"], .dspp-cfg input[type="text"], .dspp-cfg input[type="number"] {
  padding: 4px 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
  background: transparent; color: inherit; font: inherit; }
.dspp-cfg input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dspp-cfg button { padding: 4px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
  background: transparent; color: inherit; font: inherit; cursor: pointer; }
.dspp-cfg button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)); }
.dspp-cfg button:disabled { opacity: 0.5; cursor: not-allowed; }
.dspp-cfg-note { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dspp-cfg-problem { margin: 0; color: var(--dsw-alias-state-warn-primary); font-size: 12px; }
.dspp-cfg-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dspp-cfg-status { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dspp-cfg-grow { flex: 1 1 auto; min-width: 96px; }
.dspp-cfg-check { gap: 6px; }
`

/** The complete stylesheet this plugin installs. */
const CSS = `${PILL_CSS}\n${NOTICE_CSS}\n${CONFIG_CSS}`

/**
 * The expanded panel: the same reading the pill rests on, spelled out.
 *
 * Exported so a test can render it directly — the pill only reveals it after a
 * click, and a broken row here would otherwise stay invisible until a person
 * clicked in the GUI.
 * @param props - the reading to render and the settings it was read against.
 * @returns the panel.
 */
export function PeakPricingPanel(
  { reading, settings }: { reading: Reading; settings: ClientSettings },
): ReactElement {
  const copy = PERIOD_COPY[reading.period]
  const countdown = reading.upcoming === null ? null : formatCountdown(reading.remaining)
  return (
    <div className="dspp-panel" role="dialog" aria-label="DeepSeek API 峰谷计费" data-period={reading.period}>
      <div className="dspp-head">
        <strong>
          <span className="dspp-lamp" aria-hidden />
          {copy.label}
        </strong>
        <span className="dspp-clock">{formatBeijingClock(reading.now)} 北京</span>
      </div>
      <div className="dspp-next">
        {reading.upcoming === null
          ? '未来 8 天内没有切换。'
          : `距${copy.next}（${reading.upcoming.reason}）还有 ${countdown}`}
      </div>
      <div className="dspp-load">
        今天：高峰 {hours(reading.load.peakMinutes)} 小时 · 谷时 {hours(reading.load.offPeakMinutes)} 小时
      </div>
      <table className="dspp-table">
        <thead>
          <tr>
            <th>元 / 百万 tokens</th>
            <th>时段</th>
            <th>缓存命中</th>
            <th>缓存未命中</th>
            <th>输出</th>
          </tr>
        </thead>
        <tbody>
          {reading.rows.map(row => {
            const columns = [
              { label: '谷时', active: row.period === 'off-peak', rates: row.period === 'off-peak' ? row.now : row.other },
              { label: '高峰', active: row.period === 'peak', rates: row.period === 'peak' ? row.now : row.other },
            ]
            return (
              <Fragment key={row.model}>
                {columns.map((column, index) => (
                  <tr
                    key={column.label}
                    className={[index === 0 ? 'dspp-group' : '', column.active ? 'is-current' : ''].join(' ').trim() || undefined}
                  >
                    {index === 0 && <td className="dspp-model" rowSpan={2}>{row.model}</td>}
                    <td className="dspp-tag">{column.active ? `${column.label} ★` : column.label}</td>
                    <td>{column.rates.cacheHit}</td>
                    <td>{column.rates.cacheMiss}</td>
                    <td>{column.rates.output}</td>
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {reading.timeline.length > 0 && (
        <div className="dspp-timeline">
          <div className="dspp-section">接下来</div>
          {reading.timeline.map(entry => (
            <div className="dspp-timeline-row" key={entry.at.getTime()}>
              <span>{shortClock(entry.at)}</span>
              <span>{entry.reason}</span>
              <span>{formatSpan(entry.milliseconds)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="dspp-note">
        <b>{dayCopy(reading)}</b>
        <div>{copy.hint}</div>
        <div>
          高峰：周一至周五 09:00-12:00、14:00-18:00（北京时间，不含中国法定节假日）；
          其余时段、周末与法定节假日全天均为谷时，<b>调休上班的周末也按谷时</b>。
        </div>
        <div>
          {settings.source === 'host'
            ? '日历与时段来自 Host 的插件配置（在「插件」页里改，或改 profile 的 cordis.patch.yml）。'
            : '日历来自内置的 2026 年节假日（Host 的插件配置未送达）。'}
        </div>
        {settings.problems.length > 0 && (
          <div className="dspp-warn">
            配置有问题，已回退到内置日历：{settings.problems[0]}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The status pill: a compact resting reading of the current period and the
 * countdown to the next switch, expanding to both price columns, the day's
 * peak/off-peak split, and the upcoming timeline.
 *
 * It renders in the composer's dock row beside ui-chat's speed and 缓存命中
 * pills, so the readings — speed, cache hit, period, countdown — read as one
 * strip rather than as a floating control in the corner.
 * @returns the rendered pill, or its expanded panel.
 */
export function PeakPricingPill(): ReactElement {
  const settings = useSyncExternalStore(liveSettings.subscribe, liveSettings.getSnapshot, liveSettings.getSnapshot)
  const [tick, setTick] = useState(() => Date.now())
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => { setTick(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [])

  const reading = useMemo(() => read(new Date(tick), settings.rules), [tick, settings.rules])
  const copy = PERIOD_COPY[reading.period]
  const countdown = reading.upcoming === null ? null : formatCountdown(reading.remaining)
  const toggle = useCallback(() => { setOpen(value => !value) }, [])
  const onKeyDown = useCallback((event: { key: string; preventDefault: () => void }) => {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
  }, [])

  return (
    <span className="dspp-root" data-period={reading.period} data-source={settings.source}>
      {open && <PeakPricingPanel reading={reading} settings={settings} />}
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
 * One notice, rendered. Split out of {@link SwitchNotice} so a test can render
 * a notice without waiting for a real period flip.
 * @param props - the notice and its dismiss handler.
 * @returns the toast.
 */
export function NoticeCard({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }): ReactElement {
  return (
    <div className="dspp-notice" role="status" data-kind={notice.kind} data-period={notice.period}>
      <div className="dspp-notice-text">
        <strong>
          <span className="dspp-lamp" aria-hidden />
          {notice.title}
        </strong>
        <div>{notice.body}</div>
      </div>
      <button type="button" className="dspp-notice-close" aria-label="关闭提醒" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}

/**
 * The transient notice: a corner toast that appears when the billing period
 * flips, or shortly before a peak window opens, and clears itself.
 *
 * Its state lives in this component rather than in a store, so a remount (a
 * session switch) starts from "no notice" instead of replaying the last flip.
 * @returns the notice, or null while there is nothing to say.
 */
export function SwitchNotice(): ReactElement | null {
  const settings = useSyncExternalStore(liveSettings.subscribe, liveSettings.getSnapshot, liveSettings.getSnapshot)
  const [state, setState] = useState<NoticeState>(INITIAL_NOTICE_STATE)

  useEffect(() => {
    const tick = (): void => {
      setState(current => advanceNotice(
        settings.rules,
        current,
        new Date(),
        { notifyOnSwitch: settings.notifyOnSwitch, remindBeforePeakMinutes: settings.remindBeforePeakMinutes },
      ))
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => { window.clearInterval(timer) }
  }, [settings])

  const notice = state.active
  if (notice === null) return null
  return <NoticeCard notice={notice} onDismiss={() => { setState(current => ({ ...current, active: null })) }} />
}

// ---------------------------------------------------------------------------
// The plugin-manager configuration page
// ---------------------------------------------------------------------------

/**
 * The slot a bundle's row configuration registers into, and the key the Plugin
 * Manager dispatches for this bundle: `<package name>#<row id>`. Registering
 * here is what gives the row a 配置 control that opens this page.
 */
const ROW_CONFIG_SLOT = 'plugins.row.config'
/** This bundle's package name, which the Plugin Manager keys that row by. */
const PACKAGE_NAME = 'dsh-deepseek-peak-pricing'

/** The exact key the Plugin Manager dispatches for this bundle's row. */
export const ROW_CONFIG_KEY = `${PACKAGE_NAME}#${SETTINGS_NAMESPACE}`

/** One write the settings service applies to this plugin's config. */
export interface ConfigOp {
  /** `set` writes a value at the path; `unset` restores the inherited one. */
  readonly op: 'set' | 'unset'
  /** Field path inside the config section, e.g. `['peakWindows', 0, 'startMinute']`. */
  readonly path: ReadonlyArray<string | number>
  /** The value to write; ignored by `unset`. */
  readonly value?: unknown
}

/** The projected form state the Plugin Manager hands a row-config page. */
export interface ConfigPageState {
  /** `loading` before the Host answers, `ready` once it has, `unavailable` when it cannot. */
  readonly status?: string
  /** The current configuration value, absent until the Host answers. */
  readonly value?: unknown
  /** Revision the value was read at; a write quotes it so a stale save fails. */
  readonly revision?: number
  /** Whether the active profile accepts form writes. */
  readonly writable?: boolean
}

/** The face one row-config page receives from the Plugin Manager. */
export interface ConfigPageForm {
  /** The value and revision at render time, as the Plugin Manager passes it. */
  readonly state?: ConfigPageState
  /** A store-shaped alternative some owners pass instead of `state`. */
  getSnapshot?(): ConfigPageState
  /** Apply ordered edits, quoting the revision read. */
  mutate(ops: ConfigOp[], revision?: number): Promise<boolean>
}

/** Everything the configuration page edits, as one plain object. */
export interface CalendarDraft {
  /** Statutory holiday ranges, inclusive. */
  holidays: Array<{ start: string; end: string; name: string }>
  /** 调休上班日 dates. */
  makeupWorkdays: string[]
  /** Peak windows as wall-clock minutes after Beijing midnight. */
  peakWindows: Array<{ startMinute: number; endMinute: number }>
  /** Whether a period flip raises a notice. */
  notifyOnSwitch: boolean
  /** Minutes before a peak window to warn; 0 disables the warning. */
  remindBeforePeakMinutes: number
}

/** Zero-pad one clock field. */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** Render minutes after midnight as the value a time input wants. */
function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.trunc(minutes)))
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`
}

/** Read a time input as minutes after midnight, or null when it is not a time. */
function timeToMinutes(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text.trim())
  if (match === null) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/** Read a configured holiday list, or undefined when the value is not one. */
function holidayList(value: unknown): CalendarDraft['holidays'] | undefined {
  if (!Array.isArray(value)) return undefined
  const ranges: CalendarDraft['holidays'] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue
    const range = entry as Partial<DateRange>
    if (typeof range.start !== 'string' || typeof range.end !== 'string') continue
    ranges.push({ start: range.start, end: range.end, name: typeof range.name === 'string' ? range.name : '' })
  }
  return ranges
}

/** Read a configured peak-window list, or undefined when the value is not one. */
function windowList(value: unknown): CalendarDraft['peakWindows'] | undefined {
  if (!Array.isArray(value)) return undefined
  const windows: CalendarDraft['peakWindows'] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue
    const window = entry as Partial<PeakWindow>
    if (typeof window.startMinute !== 'number' || typeof window.endMinute !== 'number') continue
    windows.push({ startMinute: window.startMinute, endMinute: window.endMinute })
  }
  return windows
}

/** Read a configured date list, or undefined when the value is not one. */
function dateList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Turn one projected config value into the editable draft.
 *
 * Every field falls back to the built-in value — the same fallbacks
 * {@link applyClientSettings} uses — so the page never opens on an empty form.
 * @param value - the Host's projected config value, or anything at all.
 * @returns the draft the form edits.
 */
export function draftFromValue(value: unknown): CalendarDraft {
  const source = (value !== null && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const reminder = source.remindBeforePeakMinutes
  return {
    holidays: holidayList(source.holidays) ?? HOLIDAYS_2026.map(range => ({ ...range })),
    makeupWorkdays: dateList(source.makeupWorkdays) ?? [...MAKEUP_WORKDAYS_2026],
    peakWindows: windowList(source.peakWindows) ?? DEFAULT_PEAK_WINDOWS.map(window => ({ ...window })),
    notifyOnSwitch: typeof source.notifyOnSwitch === 'boolean' ? source.notifyOnSwitch : DEFAULT_NOTIFY_ON_SWITCH,
    remindBeforePeakMinutes: typeof reminder === 'number' && Number.isFinite(reminder) && reminder >= 0
      ? Math.floor(reminder)
      : DEFAULT_REMIND_BEFORE_PEAK_MINUTES,
  }
}

/**
 * Turn one draft into the writes that make it the Host's configuration.
 *
 * One `set` per declared field, so a save restates the whole section rather than
 * depending on what a previous writer left behind.
 * @param draft - the edited values.
 * @returns the ordered writes.
 */
export function draftToOps(draft: CalendarDraft): ConfigOp[] {
  return [
    { op: 'set', path: ['holidays'], value: draft.holidays.map(range => ({ ...range })) },
    { op: 'set', path: ['makeupWorkdays'], value: [...draft.makeupWorkdays] },
    { op: 'set', path: ['peakWindows'], value: draft.peakWindows.map(window => ({ ...window })) },
    { op: 'set', path: ['notifyOnSwitch'], value: draft.notifyOnSwitch },
    { op: 'set', path: ['remindBeforePeakMinutes'], value: draft.remindBeforePeakMinutes },
  ]
}

/**
 * Everything wrong with one draft, in the order a reader would fix it.
 *
 * The rule problems come from the same validator the Host runs at startup, so
 * the page cannot save a calendar the Host would refuse; the reminder bound is
 * page-only because the Host never reads it.
 * @param draft - the edited values.
 * @returns human-readable problems; empty when the draft is saveable.
 */
export function validateDraft(draft: CalendarDraft): string[] {
  const problems = [...resolveRules(draft).problems]
  if (!Number.isInteger(draft.remindBeforePeakMinutes) || draft.remindBeforePeakMinutes < 0 || draft.remindBeforePeakMinutes > 1440) {
    problems.push('remindBeforePeakMinutes 必须是 0-1440 的整数')
  }
  return problems
}

/**
 * The row-configuration page.
 *
 * It renders twice per row: as the one-line summary in the row's description,
 * and as the page behind the row's 配置 control. The page edits the Host's
 * configuration through the form the Plugin Manager supplies, so a save lands in
 * the profile patch and every surface — tool, `/pricing`, pill, notice — follows
 * without a restart.
 * @param props - the requested view and, on the page view, the configuration form.
 * @returns the summary line, or the editor.
 */
export function PricingConfigPage(
  props: { view?: 'summary' | 'page'; form?: ConfigPageForm },
): ReactElement {
  if ((props.view ?? 'page') === 'summary') {
    return <span className="dspp-cfg-note">峰谷日历、高峰时段与切换提醒，都在这里改。</span>
  }
  const form = props.form
  if (form === undefined || typeof form.mutate !== 'function') {
    return <p className="dspp-cfg-note">配置界面暂不可用：Host 没有提供这个插件的配置投影。</p>
  }
  return <PricingConfigEditor form={form} />
}

/**
 * The editor behind {@link PricingConfigPage}.
 * @param props - the configuration form to read and write.
 * @returns the fieldset stack.
 */
function PricingConfigEditor({ form }: { form: ConfigPageForm }): ReactElement {
  const state = form.state ?? form.getSnapshot?.() ?? {}
  const [draft, setDraft] = useState<CalendarDraft>(() => draftFromValue(state.value))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const seen = useRef(state.value)

  // The Host answers after the first render (and after every accepted write).
  // Re-seed from each new value so the form never shows a stale calendar.
  useEffect(() => {
    if (seen.current === state.value) return
    seen.current = state.value
    setDraft(draftFromValue(state.value))
    setStatus('idle')
  }, [state.value])

  const problems = validateDraft(draft)
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFromValue(state.value))
  const writable = state.writable !== false && state.status !== 'unavailable'
  const patch = (change: Partial<CalendarDraft>): void => {
    setDraft(current => ({ ...current, ...change }))
    setStatus('idle')
  }
  const patchHoliday = (index: number, change: Partial<CalendarDraft['holidays'][number]>): void => {
    patch({ holidays: draft.holidays.map((range, at) => (at === index ? { ...range, ...change } : range)) })
  }
  const patchWindow = (index: number, change: Partial<CalendarDraft['peakWindows'][number]>): void => {
    patch({ peakWindows: draft.peakWindows.map((window, at) => (at === index ? { ...window, ...change } : window)) })
  }
  const save = (): void => {
    setStatus('saving')
    form.mutate(draftToOps(draft), state.revision).then(
      (ok) => { setStatus(ok ? 'saved' : 'failed') },
      () => { setStatus('failed') },
    )
  }

  const statusText = status === 'saving'
    ? '正在写入 Host…'
    : status === 'saved'
      ? '已保存：工具、/pricing 与状态条已换用这份日历。'
      : status === 'failed'
        ? '保存失败：配置可能已被别处改动，请重新载入后再试。'
        : !writable
          ? '当前 profile 不允许表单写入，请直接编辑 cordis.patch.yml。'
          : dirty
            ? '有未保存的修改。'
            : '与 Host 当前配置一致。'

  return (
    <div className="dspp-cfg">
      <p className="dspp-cfg-note">
        这里改的是 Host 那一份配置（写进 profile 的 cordis.patch.yml）。保存后工具、`/pricing` 与状态条一起换日历。
      </p>

      <fieldset>
        <legend>高峰时段（北京时间，左闭右开）</legend>
        {draft.peakWindows.map((window, index) => (
          <div className="dspp-cfg-row" key={`window-${index}`}>
            <input
              type="time"
              value={minutesToTime(window.startMinute)}
              aria-label={`第 ${index + 1} 个高峰时段的开始时间`}
              onChange={(event) => {
                const minutes = timeToMinutes(event.target.value)
                if (minutes !== null) patchWindow(index, { startMinute: minutes })
              }}
            />
            <span>–</span>
            <input
              type="time"
              value={minutesToTime(window.endMinute)}
              aria-label={`第 ${index + 1} 个高峰时段的结束时间`}
              onChange={(event) => {
                const minutes = timeToMinutes(event.target.value)
                if (minutes !== null) patchWindow(index, { endMinute: minutes })
              }}
            />
            <span className="dspp-cfg-status">
              {window.endMinute > window.startMinute ? `持续 ${formatSpan((window.endMinute - window.startMinute) * 60_000)}` : '区间无效'}
            </span>
            <button
              type="button"
              disabled={draft.peakWindows.length <= 1}
              onClick={() => { patch({ peakWindows: draft.peakWindows.filter((_, at) => at !== index) }) }}
            >
              删除
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => { patch({ peakWindows: [...draft.peakWindows, { startMinute: 9 * 60, endMinute: 12 * 60 }] }) }}
        >
          添加时段
        </button>
      </fieldset>

      <fieldset>
        <legend>法定节假日（含首尾，全天谷时）</legend>
        {draft.holidays.map((range, index) => (
          <div className="dspp-cfg-row" key={`holiday-${index}`}>
            <input
              type="text"
              className="dspp-cfg-grow"
              placeholder="名称"
              value={range.name}
              aria-label={`第 ${index + 1} 个节假日的名称`}
              onChange={(event) => { patchHoliday(index, { name: event.target.value }) }}
            />
            <input
              type="date"
              value={range.start}
              aria-label={`第 ${index + 1} 个节假日的开始日期`}
              onChange={(event) => { patchHoliday(index, { start: event.target.value }) }}
            />
            <span>–</span>
            <input
              type="date"
              value={range.end}
              aria-label={`第 ${index + 1} 个节假日的结束日期`}
              onChange={(event) => { patchHoliday(index, { end: event.target.value }) }}
            />
            <button
              type="button"
              onClick={() => { patch({ holidays: draft.holidays.filter((_, at) => at !== index) }) }}
            >
              删除
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => { patch({ holidays: [...draft.holidays, { start: '', end: '', name: '' }] }) }}
        >
          添加节假日
        </button>
      </fieldset>

      <fieldset>
        <legend>调休上班日（仅用于说明：调休的周末仍全天谷时）</legend>
        {draft.makeupWorkdays.map((date, index) => (
          <div className="dspp-cfg-row" key={`makeup-${index}`}>
            <input
              type="date"
              value={date}
              aria-label={`第 ${index + 1} 个调休上班日`}
              onChange={(event) => {
                patch({ makeupWorkdays: draft.makeupWorkdays.map((at, position) => (position === index ? event.target.value : at)) })
              }}
            />
            <button
              type="button"
              onClick={() => { patch({ makeupWorkdays: draft.makeupWorkdays.filter((_, at) => at !== index) }) }}
            >
              删除
            </button>
          </div>
        ))}
        <button type="button" onClick={() => { patch({ makeupWorkdays: [...draft.makeupWorkdays, ''] }) }}>
          添加调休日
        </button>
      </fieldset>

      <fieldset>
        <legend>提醒（仅状态条的浏览器半）</legend>
        <label className="dspp-cfg-row dspp-cfg-check">
          <input
            type="checkbox"
            checked={draft.notifyOnSwitch}
            onChange={(event) => { patch({ notifyOnSwitch: event.target.checked }) }}
          />
          时段切换时弹一条提醒
        </label>
        <label className="dspp-cfg-row dspp-cfg-check">
          进入高峰前
          <input
            type="number"
            min={0}
            max={120}
            value={draft.remindBeforePeakMinutes}
            aria-label="进入高峰前多少分钟预告"
            onChange={(event) => { patch({ remindBeforePeakMinutes: Number(event.target.value) }) }}
          />
          分钟预告一次（0 = 不预告）
        </label>
      </fieldset>

      {problems.length > 0 && (
        <p className="dspp-cfg-problem">还不能保存：{problems.join('；')}</p>
      )}
      <div className="dspp-cfg-actions">
        <button
          type="button"
          disabled={!writable || !dirty || problems.length > 0 || status === 'saving'}
          onClick={save}
        >
          {status === 'saving' ? '保存中…' : '保存'}
        </button>
        <button type="button" disabled={!dirty} onClick={() => { setDraft(draftFromValue(state.value)); setStatus('idle') }}>
          放弃修改
        </button>
        <span className="dspp-cfg-status">{statusText}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

/** The slot registry face this plugin consumes from the client context. */
interface SlotsFace {
  /**
   * Register one entry into a declared slot. A `list` slot keys entries by `id`;
   * a `keyed` slot keys them by `key`, which is what the owner dispatches.
   */
  register: (
    entry: { name: string; id?: string; key?: string; order?: number },
    component: (props: never) => ReactElement | null,
  ) => () => void
  /** Run `callback` once the named slot is declared. */
  inject: (name: string, callback: () => () => void) => () => void
}

/** The slice of the client context this plugin uses. */
interface PeakPricingContext {
  /** The slot registry; required, and named by {@link inject}. */
  slots?: SlotsFace
  /** Cordis effect registration, used to own the stylesheet. */
  effect?: (callback: () => (() => void) | void, label?: string) => () => void
  /** Optional child injection, used to reach the settings form without requiring it. */
  inject?: (
    deps: readonly string[],
    callback: (scope: { configForms: { get(id: string): ConfigFormLike } }) => void,
  ) => unknown
}

/**
 * Required client service. Cordis throws on any `ctx.<service>` read the plugin
 * did not declare, so this is what makes `ctx.slots` reachable at all — without
 * it the fiber fails with `cannot get property "slots" without inject`.
 *
 * `configForms` is deliberately NOT listed: it is reached through an optional
 * child injection, so a profile without the settings surface still gets the pill.
 */
export const inject = ['slots']

/**
 * Client plugin body: install the pill under the composer, the notice in the
 * frame overlay, and the subscription that keeps both on the Host's calendar.
 * The stylesheet is inserted once and removed with the fiber, so an unloaded
 * plugin leaves no DOM behind.
 * @param ctx - the client root context.
 */
export function apply(ctx: PeakPricingContext): void {
  // No `ctx.slots` guard: `inject` names the service, so Cordis only activates
  // this fiber once `slots` exists. A missing service here is a real failure and
  // should surface as one rather than silently disabling the surface.
  const slots = ctx.slots as SlotsFace
  const installStyle = (): (() => void) => {
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

  slots.inject(SHELL_OVERLAY_SLOT, () => slots.register({
    name: SHELL_OVERLAY_SLOT,
    id: 'deepseek-peak-pricing-notice',
    order: 10,
  }, SwitchNotice))

  // The Plugin Manager page: the row for this bundle gains a 配置 control that
  // opens the calendar editor. The key is `<package name>#<row id>`, which is
  // what the manager dispatches for the row our own bundle patch inserts.
  slots.inject(ROW_CONFIG_SLOT, () => slots.register({
    name: ROW_CONFIG_SLOT,
    key: ROW_CONFIG_KEY,
  }, PricingConfigPage))

  // The settings form is optional: it carries the deployment's calendar when the
  // profile composes the settings surface, and is simply absent otherwise.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['configForms'], (scope) => {
      watchSettings(scope.configForms.get(SETTINGS_NAMESPACE))
    })
  }
}

/**
 * The rule functions and the surfaces, re-exported for `tests/client.test.mjs`.
 *
 * `lib/client.js` is a closed module-loader closure, so a test can only reach
 * this logic by loading that artifact with a stub `__ModuleLoader__` and a stub
 * `require`. These exports exist for that harness and add no product surface:
 * the shell never imports the bundle, it instantiates the factory.
 */
export {
  DEFAULT_RULES,
  formatBeijingClock,
  formatCountdown,
  formatSpan,
}
export type { ScheduleEntry }
