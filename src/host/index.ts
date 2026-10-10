/**
 * DeepSeek API 峰谷计费提示 — Node half.
 *
 * The browser half owns the always-visible status pill and the switch notice.
 * This half owns the things the browser cannot do on its own: telling the
 * *model* which price a request bills at, letting a person run `/pricing`
 * without spending a turn, and letting a deployment move the calendar.
 *
 * Both halves run the exact same rule core (`src/shared/pricing.ts`, inlined
 * into each artifact by the build), and the configuration this half declares is
 * projected to the browser half through the plugin-config form, so an override
 * here moves the pill there. `Config` fields are declared `.volatile()`: the
 * Host keeps reading their current value, which is what makes an edit in the
 * Settings/Plugin page reach a running session without a restart.
 *
 * Authority for the rules: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * plus DeepSeek's 2026-09-19 峰谷时间说明 (调休上班的周末全天按空闲时段计费).
 *
 * @module dsh-deepseek-peak-pricing
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  DEFAULT_NOTIFY_ON_SWITCH,
  DEFAULT_PEAK_WINDOWS,
  DEFAULT_REMIND_BEFORE_PEAK_MINUTES,
  HOLIDAYS_2026,
  MAKEUP_WORKDAYS_2026,
  estimateCost,
  formatBeijingTime,
  formatCountdown,
  formatSpan,
  parseBeijingMoment,
  read,
  resolveRules,
  schedule,
} from '../shared/pricing'
import type { ConfigValue, DayKind, Period, PricingOverrides, TokenUsage } from '../shared/pricing'

// ---------------------------------------------------------------------------
// Plugin surface
// ---------------------------------------------------------------------------

/** Cordis plugin name, matched by the bundle patch's row id. */
export const name = 'deepseek-peak-pricing'

/** Required service: the tool registry this plugin contributes to. */
export const inject = ['tools']

/** Deployment overrides for the built-in rule set. */
export interface Config extends PricingOverrides {
  /**
   * Whether the browser half raises a notice when the billing period flips.
   * Read by the pill; the Host only carries it so it can be edited in one place.
   */
  notifyOnSwitch?: ConfigValue<boolean>
  /**
   * How many minutes before a peak window starts the browser half warns; `0`
   * turns the warning off. Read by the pill.
   */
  remindBeforePeakMinutes?: ConfigValue<number>
}

/**
 * Schemastery schema for {@link Config}.
 *
 * Every field is `.volatile()` and carries the built-in value as its default, so
 * the plugin-config form always shows a complete, editable calendar and the
 * browser half always receives a complete value instead of a partial override.
 */
export const Config = z.object({
  holidays: z.array(z.object({
    start: z.string().required(),
    end: z.string().required(),
    name: z.string().required(),
  })).default([...HOLIDAYS_2026]).volatile()
    .description('法定节假日区间（含首尾，北京日期 YYYY-MM-DD）；编辑后同时作用于工具与状态条'),
  makeupWorkdays: z.array(z.string()).default([...MAKEUP_WORKDAYS_2026]).volatile()
    .description('调休上班日 YYYY-MM-DD（仅用于说明，不影响计价：调休的周末仍全天谷时）'),
  peakWindows: z.array(z.object({
    startMinute: z.number().required(),
    endMinute: z.number().required(),
  })).default([...DEFAULT_PEAK_WINDOWS]).volatile()
    .description('高峰时段（北京时间的当日分钟数，左闭右开）；默认 09:00-12:00 / 14:00-18:00'),
  notifyOnSwitch: z.boolean().default(DEFAULT_NOTIFY_ON_SWITCH).volatile()
    .description('时段切换时在页面右下角弹一条自动消失的提醒'),
  remindBeforePeakMinutes: z.natural().default(DEFAULT_REMIND_BEFORE_PEAK_MINUTES).volatile()
    .description('进入高峰前多少分钟提醒一次；0 表示只提醒切换本身'),
})

// ---------------------------------------------------------------------------
// The model-facing tool
// ---------------------------------------------------------------------------

/** The published rule, echoed verbatim so an answer is self-contained. */
const RULE_TEXT =
  '北京时间周一至周五（不含中国法定节假日）09:00-12:00、14:00-18:00 为高峰时段；'
  + '其余时段，包括周末及中国法定节假日全天均为空闲时段。调休上班的周末同样全天按空闲时段计费。'
  + '空闲时段价格为高峰时段价格的一半（5 折）。'

/** Chinese label for a period, as both the tool and the pill write it. */
function periodLabel(period: Period): string {
  return period === 'peak' ? '高峰时段' : '空闲时段'
}

/** One upcoming stretch in the tool's timeline. */
interface StatusSwitch {
  /** Beijing time the stretch starts. */
  beijingTime: string
  /** The price in force across the stretch. */
  period: Period
  /** Chinese label for {@link period}. */
  periodLabel: string
  /** Why the stretch starts. */
  reason: string
  /** Human-readable length of the stretch. */
  span: string
  /** Beijing time the stretch ends, when the horizon holds a further flip. */
  until: string | null
}

/** Wire shape of the `deepseek_pricing_status` tool result. */
interface PricingStatusValue {
  /** Which price a request issued at the reported instant is charged at. */
  period: Period
  /** Beijing wall-clock reading of the reported instant. */
  beijingTime: string
  /** Chinese label for {@link period}. */
  periodLabel: string
  /** Why the reported day bills the way it does. */
  dayKind: DayKind
  /** Statutory holiday covering the reported date, when there is one. */
  holiday?: string
  /**
   * Whether the reported date is a 调休上班日. Price-neutral: the day still
   * bills off-peak all day, so this field exists to pre-empt a "workday should
   * be peak" reading.
   */
  makeupWorkday: boolean
  /** Milliseconds until the next flip; 0 when the horizon holds none. */
  msUntilSwitch: number
  /** Human countdown to the next flip. */
  countdown: string
  /** The period starting at the next flip, or `none` when the horizon holds none. */
  nextPeriod: Period | 'none'
  /** Why the next flip happens. */
  nextReason: string
  /** How the reported date divides between the two prices. */
  dayLoad: { peakMinutes: number; offPeakMinutes: number }
  /** The upcoming stretches, starting with the current one. */
  switches: StatusSwitch[]
  /** Per-model rates in force at the reported instant. */
  prices: Array<{ model: string; cacheHit: number; cacheMiss: number; output: number }>
  /** Cost of the requested token mix, when one was requested. */
  estimate?: {
    model: string
    period: Period
    periodLabel: string
    cost: number
    /** The same mix at the other period, for a wait-or-run comparison. */
    otherCost: number
    otherPeriodLabel: string
  }
  /** The rule text, echoed so the answer is self-contained. */
  rule: string
}

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
    `DeepSeek API 在 ${value.beijingTime}（北京时间）为${value.periodLabel}。`,
    value.period === 'peak' ? '高峰时段价格为谷时的 2 倍。' : '空闲时段价格为高峰的 5 折。',
  ]
  if (value.holiday !== undefined) lines.push(`当天是法定节假日「${value.holiday}」，全天按空闲时段计费。`)
  if (value.makeupWorkday) {
    lines.push('当天是调休上班日，但 DeepSeek 对调休上班的周末仍按空闲时段全天计费。')
  }
  lines.push(`当天共 ${hours(value.dayLoad.peakMinutes)} 小时高峰、${hours(value.dayLoad.offPeakMinutes)} 小时谷时。`)
  if (value.nextPeriod !== 'none') {
    lines.push(`距下一次切换（${value.nextReason}）还有 ${value.countdown}，之后为${periodLabel(value.nextPeriod)}。`)
  } else {
    lines.push('未来 8 天内没有切换。')
  }
  lines.push('')
  lines.push('时段表（北京时间）：')
  for (const item of value.switches) {
    lines.push(`- ${item.beijingTime} 起 ${item.periodLabel}（${item.reason}，持续 ${item.span}）`)
  }
  lines.push('')
  lines.push('当前单价（元 / 百万 tokens）：')
  for (const price of value.prices) {
    lines.push(`- ${price.model}：输入(缓存命中) ${price.cacheHit} ｜ 输入(缓存未命中) ${price.cacheMiss} ｜ 输出 ${price.output}`)
  }
  if (value.estimate !== undefined) {
    lines.push('')
    lines.push(
      `成本估算（${value.estimate.model}）：当前${value.estimate.periodLabel} ¥${value.estimate.cost}；`
      + `若换到${value.estimate.otherPeriodLabel}则 ¥${value.estimate.otherCost}。`,
    )
  }
  lines.push('')
  lines.push(`时段规则：${value.rule}`)
  return lines.join('\n')
}

/** Render whole hours compactly inside a sentence. */
function hours(minutes: number): string {
  if (minutes % 60 === 0) return String(minutes / 60)
  return (minutes / 60).toFixed(1)
}

/** Arguments the model may pass to `deepseek_pricing_status`. */
interface StatusArgs {
  /** Instant to inspect, in Beijing terms; absent means now. */
  readonly at?: string
  /** How many upcoming stretches to list, including the current one. */
  readonly switches?: number
  /** Model to price the supplied token mix with. */
  readonly model?: string
  /** Token counts to price. */
  readonly tokens?: TokenUsage
}

/** The count of upcoming stretches a call gets when it does not ask. */
const DEFAULT_SWITCH_COUNT = 3
/** Upper bound on the stretches one answer may carry, so a call cannot flood a context. */
const MAX_SWITCH_COUNT = 8

/**
 * Build one complete answer for a (possibly historical or future) instant.
 *
 * Shared by the tool and the `/pricing` command so the model and the person
 * looking at the same moment read byte-identical numbers.
 * @param overrides - the deployment's configured rule overrides.
 * @param args - the requested instant, timeline length, and optional token mix.
 * @param now - the reference instant an absent or time-only `at` resolves against.
 * @returns the canonical value, or an error string when the request cannot be answered.
 */
function answer(
  overrides: PricingOverrides | undefined, args: StatusArgs, now: Date,
): PricingStatusValue | { error: string } {
  const { rules, problems } = resolveRules(overrides)
  if (problems.length > 0) return { error: `deepseek-peak-pricing: invalid rules\n- ${problems.join('\n- ')}` }
  if ((args.model === undefined) !== (args.tokens === undefined)) {
    return { error: '成本估算需要同时提供 `model` 与 `tokens`（可含 cacheHit / cacheMiss / output）。' }
  }
  const requested = args.at === undefined || args.at.trim() === '' ? now : parseBeijingMoment(args.at, now)
  if (requested === null) {
    return {
      error: `无法解析时间「${args.at}」。可用格式：YYYY-MM-DD、YYYY-MM-DD HH:MM、HH:MM（今天）、或带时区的 ISO 8601。`,
    }
  }
  const reading = read(rules, requested)
  const count = Math.max(1, Math.min(MAX_SWITCH_COUNT, Math.trunc(args.switches ?? DEFAULT_SWITCH_COUNT)))
  const stretches = schedule(rules, requested, count)
  const value: PricingStatusValue = {
    period: reading.period,
    beijingTime: formatBeijingTime(reading.now),
    periodLabel: periodLabel(reading.period),
    dayKind: reading.kind,
    makeupWorkday: reading.makeupWorkday,
    msUntilSwitch: reading.remaining,
    countdown: formatCountdown(reading.remaining),
    nextPeriod: reading.upcoming === null ? 'none' : reading.upcoming.period,
    nextReason: reading.upcoming === null ? '' : reading.upcoming.reason,
    dayLoad: reading.load,
    switches: stretches.map(entry => ({
      beijingTime: formatBeijingTime(entry.at),
      period: entry.period,
      periodLabel: periodLabel(entry.period),
      reason: entry.reason,
      span: entry.until === null ? '8 天以上' : formatSpan(entry.milliseconds),
      until: entry.until === null ? null : formatBeijingTime(entry.until),
    })),
    prices: rules.models.map(model => ({
      model: model.label,
      ...(reading.period === 'peak' ? model.peak : model.offPeak),
    })),
    rule: RULE_TEXT,
  }
  if (reading.holiday !== null) value.holiday = reading.holiday
  if (args.model !== undefined && args.tokens !== undefined) {
    const here = estimateCost(rules, args.model, args.tokens, reading.period)
    const there = estimateCost(rules, args.model, args.tokens, reading.period === 'peak' ? 'off-peak' : 'peak')
    if (here === null || there === null) {
      return { error: `未知模型「${args.model}」。内置价目表：${rules.models.map(model => model.label).join('、')}。` }
    }
    value.estimate = {
      model: here.label,
      period: here.period,
      periodLabel: periodLabel(here.period),
      cost: here.cost,
      otherCost: there.cost,
      otherPeriodLabel: periodLabel(there.period),
    }
  }
  return value
}

// ---------------------------------------------------------------------------
// The `/pricing` command
// ---------------------------------------------------------------------------

/** One invocation of a user-facing slash command, as the command adapter passes it. */
interface CommandInvocation {
  /** Everything after the command name and its separator whitespace. */
  readonly rawInput: string
  /** Abort signal owned by the caller. */
  readonly signal?: AbortSignal
}

/** The outcome a command handler settles with. */
interface CommandResult {
  /** Whether the command did what it promised. */
  readonly kind: 'success' | 'error'
  /** Human-facing text the adapter renders outside the model history. */
  readonly text: string
}

/** The commands service this half contributes to, when the profile composes one. */
interface CommandsFace {
  register(definition: {
    readonly name: string
    readonly description: string
    readonly input?: { readonly hint?: string }
    readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
  }): () => void
}

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

/**
 * Register the `deepseek_pricing_status` tool and, when the profile composes a
 * command surface, the `/pricing` command.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - the deployment's calendar, window, and notice overrides; absent
 * means the built-in 2026 calendar and the published windows.
 * @throws {Error} when the configured rule set cannot produce a correct price.
 */
export function apply(ctx: Context, config?: Config): void {
  // Fail at startup, not at the first question: a mistyped holiday date must not
  // silently bill a workday at the holiday rate.
  const initial = resolveRules(config)
  if (initial.problems.length > 0) {
    throw new Error(`deepseek-peak-pricing: invalid rules\n- ${initial.problems.join('\n- ')}`)
  }

  // The overrides stay live: `resolveRules` is re-run per call so a settings-form
  // edit reaches the next answer without a restart.
  const overrides: PricingOverrides | undefined = config

  ctx.tools.register(defineTool({
    name: 'deepseek_pricing_status',
    description:
      'Report whether DeepSeek API requests bill at the peak (高峰) or off-peak (空闲/谷时) rate, when the rate changes next, '
      + 'how each day divides between the two prices, the upcoming peak/off-peak timeline, and the current CNY-per-million-token '
      + 'price of each model. Optionally inspect a future or past instant ("2026-10-12 10:00"), or price a token mix to compare '
      + 'running now against waiting for the cheap window. Call it before reasoning about cost, batch size, or scheduling '
      + 'non-urgent work: off-peak is exactly half price. The answer is computed from the published rule (Beijing time, Mon-Fri '
      + '09:00-12:00 and 14:00-18:00 excluding China statutory holidays; weekends and holidays are off-peak all day, and 调休上班的'
      + '周末 stay off-peak too).',
    parameters: {
      at: {
        type: 'string',
        description: 'Instant to inspect, in Beijing terms: "2026-10-12", "2026-10-12 10:00", "10:00" (today), or an ISO 8601 string with an offset. Omit for now.',
      },
      switches: {
        type: 'integer',
        description: `How many upcoming stretches to list, including the current one (1-${MAX_SWITCH_COUNT}, default ${DEFAULT_SWITCH_COUNT}).`,
      },
      model: {
        type: 'string',
        description: 'Model to price the supplied token counts with, e.g. "deepseek-flash". Required together with `tokens`.',
      },
      tokens: {
        type: 'object',
        additionalProperties: false,
        description: 'Token counts to price at the reported period, with the same mix priced at the other period for comparison.',
        properties: {
          cacheHit: { type: 'number', description: 'Input tokens served from the context cache.' },
          cacheMiss: { type: 'number', description: 'Input tokens that missed the context cache.' },
          output: { type: 'number', description: 'Generated output tokens.' },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          period: { type: 'string', required: true, enum: ['peak', 'off-peak'] },
          beijingTime: { type: 'string', required: true },
          periodLabel: { type: 'string', required: true },
          dayKind: { type: 'string', required: true, enum: ['holiday', 'weekend', 'workday'] },
          holiday: { type: 'string' },
          makeupWorkday: { type: 'boolean', required: true },
          msUntilSwitch: { type: 'integer', required: true },
          countdown: { type: 'string', required: true },
          nextPeriod: { type: 'string', required: true, enum: ['peak', 'off-peak', 'none'] },
          nextReason: { type: 'string', required: true },
          dayLoad: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              peakMinutes: { type: 'integer', required: true },
              offPeakMinutes: { type: 'integer', required: true },
            },
          },
          switches: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                beijingTime: { type: 'string', required: true },
                period: { type: 'string', required: true, enum: ['peak', 'off-peak'] },
                periodLabel: { type: 'string', required: true },
                reason: { type: 'string', required: true },
                span: { type: 'string', required: true },
                until: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              },
            },
          },
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
          estimate: {
            type: 'object',
            additionalProperties: false,
            properties: {
              model: { type: 'string', required: true },
              period: { type: 'string', required: true, enum: ['peak', 'off-peak'] },
              periodLabel: { type: 'string', required: true },
              cost: { type: 'number', required: true },
              otherCost: { type: 'number', required: true },
              otherPeriodLabel: { type: 'string', required: true },
            },
          },
          rule: { type: 'string', required: true },
        },
      },
      // The reading is computed once, in execute; render only formats it.
      render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
    },
    execute(args): Promise<PricingStatusValue> {
      const result = answer(overrides, args, new Date())
      if ('error' in result) throw new Error(result.error)
      return Promise.resolve(result)
    },
    presentCall: () => ({ card: 'generic', title: '查询 DeepSeek 峰谷计费', kind: 'other' }),
  }))

  // The command surface is optional: a headless or ACP profile composes no
  // command adapter, and this plugin still has to load there.
  ctx.inject(['commands'], (scope) => {
    const commands = (scope as unknown as { commands: CommandsFace }).commands
    commands.register({
      name: 'pricing',
      description: '查看 DeepSeek API 当前峰/谷计价、下一次切换与单价表',
      input: { hint: '[北京时间，可留空，如 2026-10-12 10:00]' },
      handler: (invocation) => {
        const result = answer(overrides, { at: invocation.rawInput, switches: DEFAULT_SWITCH_COUNT }, new Date())
        return 'error' in result
          ? { kind: 'error', text: result.error }
          : { kind: 'success', text: renderStatus(result) }
      },
    })
  })
}
