/**
 * Behaviour tests for the peak/off-peak core. Run with the bundled Node
 * runtime: `node --test tests/pricing.test.mjs` after `node scripts/build.mjs`.
 *
 * Every instant is written as an explicit `+08:00` ISO string, so the tests
 * assert the Beijing wall-clock rule rather than the machine's local timezone.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_RULES, HOLIDAYS_2026, MODELS, beijingDate, classifyDay, dayLoad, estimateCost,
  formatBeijingClock, formatBeijingTime, formatCountdown, formatSpan, live, nextSwitch,
  parseBeijingMoment, periodAt, ratesFor, read, resolveRules, schedule, validateRules,
} from '../lib/shared/pricing.js'

/** Build the instant of one Beijing wall-clock moment. */
const bj = (text) => new Date(`${text}+08:00`)

test('the published rate card halves off-peak for every model', () => {
  for (const model of MODELS) {
    assert.equal(model.offPeak.cacheHit, model.peak.cacheHit / 2, `${model.model} cacheHit`)
    assert.equal(model.offPeak.cacheMiss, model.peak.cacheMiss / 2, `${model.model} cacheMiss`)
    assert.equal(model.offPeak.output, model.peak.output / 2, `${model.model} output`)
  }
})

test('a Monday morning before 09:00 is off-peak and 09:00 starts peak', () => {
  // 2026-03-02 is a Monday.
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-03-02T08:59:59')), 'off-peak')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-03-02T09:00:00')), 'peak')
})

test('the lunch gap 12:00-14:00 is off-peak and 14:00 resumes peak', () => {
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-03-02T11:59:59')), 'peak')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-03-02T12:00:00')), 'off-peak')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-03-02T13:59:59')), 'off-peak')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-03-02T14:00:00')), 'peak')
})

test('18:00 ends peak and the evening stays off-peak', () => {
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-03-02T17:59:59')), 'peak')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-03-02T18:00:00')), 'off-peak')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-03-02T23:30:00')), 'off-peak')
})

test('a weekend is off-peak all day, including inside the peak windows', () => {
  // 2026-03-07 is a Saturday, 2026-03-08 a Sunday.
  assert.equal(classifyDay(DEFAULT_RULES, '2026-03-07'), 'weekend')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-03-07T10:00:00')), 'off-peak')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-03-08T15:00:00')), 'off-peak')
})

test('a statutory holiday weekday is off-peak all day', () => {
  // 2026-05-01 (Friday) is 劳动节.
  assert.equal(classifyDay(DEFAULT_RULES, '2026-05-01'), 'holiday')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-05-01T10:00:00')), 'off-peak')
})

test('a 调休上班日 Sunday still bills off-peak all day', () => {
  // DeepSeek, 2026-09-19: "调休上班的周末、中国法定节假日全天均按空闲时段计费".
  // 2026-09-20 is a Sunday the State Council turned into a workday; the API does
  // not care — it is a weekend, so the whole day is off-peak, window included.
  assert.equal(classifyDay(DEFAULT_RULES, '2026-09-20'), 'weekend')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-09-20T10:00:00')), 'off-peak')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-09-20T15:00:00')), 'off-peak')
})

test('a 调休上班日 Saturday still bills off-peak all day', () => {
  // 2026-10-10 is a Saturday designated as a workday for 国庆节.
  assert.equal(classifyDay(DEFAULT_RULES, '2026-10-10'), 'weekend')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-10-10T10:00:00')), 'off-peak')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-10-10T15:00:00')), 'off-peak')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-10-10T23:30:00')), 'off-peak')
})

test('the makeup-workday list never changes a price', () => {
  // The list is display metadata; dropping it must not move a single instant.
  const withoutList = { ...DEFAULT_RULES, makeupWorkdays: [] }
  for (const instant of [
    '2026-10-10T10:00:00', '2026-09-20T15:00:00', '2026-10-09T15:00:00', '2026-10-11T10:00:00',
  ]) {
    assert.equal(periodAt(withoutList, bj(instant)), periodAt(DEFAULT_RULES, bj(instant)), instant)
  }
})

test('a whole 调休 week bills like the calendar week it really is', () => {
  // 10-09 Fri (workday), 10-10 Sat (调休 workday), 10-11 Sun (rest).
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-10-09T15:00:00')), 'peak')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-10-10T15:00:00')), 'off-peak')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-10-11T15:00:00')), 'off-peak')
  // And the next peak after Friday 18:00 is Monday 09:00, not Saturday 09:00.
  const next = nextSwitch(DEFAULT_RULES, bj('2026-10-09T18:30:00'))
  assert.ok(next)
  assert.equal(next.at.toISOString(), bj('2026-10-12T09:00:00').toISOString())
  assert.equal(next.reason, '高峰时段开始')
})

test('the Spring Festival block bills off-peak across its whole nine days', () => {
  assert.equal(classifyDay(DEFAULT_RULES, '2026-02-15'), 'holiday')
  assert.equal(classifyDay(DEFAULT_RULES, '2026-02-23'), 'holiday')
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-02-18T10:00:00')), 'off-peak')
  // 2026-02-24 is a Tuesday back at work.
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-02-24T10:00:00')), 'peak')
})

test('the next switch inside a peak window is that window end', () => {
  const next = nextSwitch(DEFAULT_RULES, bj('2026-03-02T09:30:00'))
  assert.ok(next)
  assert.equal(next.period, 'off-peak')
  assert.equal(next.at.toISOString(), bj('2026-03-02T12:00:00').toISOString())
})

test('the next switch from the Friday evening runs to Monday 09:00', () => {
  // 2026-03-06 is a Friday; the weekend intervenes, so the next peak is Monday.
  const next = nextSwitch(DEFAULT_RULES, bj('2026-03-06T18:30:00'))
  assert.ok(next)
  assert.equal(next.period, 'peak')
  assert.equal(next.at.toISOString(), bj('2026-03-09T09:00:00').toISOString())
  assert.equal(next.reason, '高峰时段开始')
})

test('the next switch from a peak weekday morning waits out the weekend', () => {
  const next = nextSwitch(DEFAULT_RULES, bj('2026-03-06T10:00:00'))
  assert.ok(next)
  assert.equal(next.period, 'off-peak')
  assert.equal(next.at.toISOString(), bj('2026-03-06T12:00:00').toISOString())
})

test('the next switch from a Friday afternoon is the 18:00 window end, not the holiday midnight', () => {
  // 2026-04-03 is the Friday before 清明节 (04-04..04-06). 18:00 already leaves
  // peak, and the holiday midnight after it changes nothing about the price, so
  // the announced switch is 18:00 — the boundary the price actually moves at.
  const next = nextSwitch(DEFAULT_RULES, bj('2026-04-03T17:00:00'))
  assert.ok(next)
  assert.equal(next.period, 'off-peak')
  assert.equal(next.at.toISOString(), bj('2026-04-03T18:00:00').toISOString())
  assert.equal(next.reason, '谷时开始')
})

test('the next switch from a Friday peak morning is that day lunch gap, not a later midnight', () => {
  // The off-peak stretch that begins at 12:00 runs unbroken to Tuesday 09:00
  // (lunch gap, 18:00, the weekend, and the 清明节 block all bill off-peak), so
  // the first switch is the 12:00 boundary itself.
  const next = nextSwitch(DEFAULT_RULES, bj('2026-04-03T11:00:00'))
  assert.ok(next)
  assert.equal(next.period, 'off-peak')
  assert.equal(next.at.toISOString(), bj('2026-04-03T12:00:00').toISOString())
  assert.equal(next.reason, '午间谷时开始')
})

test('an unbroken off-peak stretch does not announce its interiors as switches', () => {
  // 18:30 Friday is already off-peak, and so is every boundary until the first
  // workday 09:00 after the holiday block: the answer must skip the weekend and
  // holiday midnights that change nothing.
  const next = nextSwitch(DEFAULT_RULES, bj('2026-04-03T18:30:00'))
  assert.ok(next)
  assert.equal(next.at.toISOString(), bj('2026-04-07T09:00:00').toISOString())
  assert.equal(next.reason, '高峰时段开始')
})

test('the next switch from a workday lunch gap is the afternoon peak', () => {
  const next = nextSwitch(DEFAULT_RULES, bj('2026-04-07T12:30:00'))
  assert.ok(next)
  assert.equal(next.period, 'peak')
  assert.equal(next.at.toISOString(), bj('2026-04-07T14:00:00').toISOString())
})

test('a 调休上班日 Sunday has no peak window to switch into', () => {
  // 2026-09-20 is a 调休 workday by decree but a Sunday by the calendar, so the
  // next switch out of off-peak is the following Monday, not that day's 09:00.
  assert.equal(periodAt(DEFAULT_RULES, bj('2026-09-20T08:00:00')), 'off-peak')
  const next = nextSwitch(DEFAULT_RULES, bj('2026-09-20T08:00:00'))
  assert.ok(next)
  assert.equal(next.period, 'peak')
  assert.equal(next.at.toISOString(), bj('2026-09-21T09:00:00').toISOString())
})

test('rates resolve per period and per model', () => {
  assert.deepEqual(ratesFor(DEFAULT_RULES, 'deepseek-flash', 'peak'), {
    model: 'deepseek-flash', label: 'deepseek-flash', cacheHit: 0.04, cacheMiss: 2, output: 8,
  })
  assert.equal(ratesFor(DEFAULT_RULES, 'deepseek-v4-pro', 'off-peak')?.output, 13.5)
  assert.equal(ratesFor(DEFAULT_RULES, 'deepseek-flash', 'off-peak')?.cacheMiss, 1)
  assert.equal(ratesFor(DEFAULT_RULES, 'no-such-model', 'peak'), null)
})

test('countdown formatting stays readable at every scale', () => {
  assert.equal(formatCountdown(45_000), '00:45')
  assert.equal(formatCountdown(12 * 60_000 + 34_000), '12:34')
  assert.equal(formatCountdown(3 * 3_600_000 + 12 * 60_000 + 45_000), '03:12:45')
  assert.equal(formatCountdown(2 * 86_400_000 + 3 * 3_600_000 + 60_000), '2天03:01:00')
  assert.equal(formatCountdown(-1), '00:00')
})

test('span formatting names the unit a stretch is read in', () => {
  assert.equal(formatSpan(45 * 60_000), '45 分钟')
  assert.equal(formatSpan(3 * 3_600_000), '3 小时')
  assert.equal(formatSpan(30_000), '不到 1 分钟')
  assert.equal(formatSpan(2 * 86_400_000 + 3 * 3_600_000), '2 天 3 小时')
  assert.equal(formatSpan(86_400_000 + 2 * 3_600_000 + 30 * 60_000), '1 天 2 小时 30 分钟')
})

test('the Beijing clock is rendered from the instant, never from local time', () => {
  assert.equal(formatBeijingTime(new Date('2026-03-02T01:05:07Z')), '2026-03-02 09:05:07')
  assert.equal(formatBeijingClock(new Date('2026-03-02T01:05:07Z')), '03-02 09:05:07')
  assert.equal(beijingDate(new Date('2026-03-02T17:00:00Z')), '2026-03-03')
})

test('the built-in rule set validates clean, and typos are reported', () => {
  assert.deepEqual(validateRules(DEFAULT_RULES), [])
  assert.deepEqual(
    validateRules({ ...DEFAULT_RULES, holidays: [{ start: '2026-5-1', end: '2026-05-05', name: 'x' }] }),
    ['holiday x: start/end must be a real YYYY-MM-DD date'],
  )
  assert.deepEqual(
    validateRules({ ...DEFAULT_RULES, makeupWorkdays: ['2026/10/10'] }),
    ['makeupWorkday 2026/10/10 must be a real YYYY-MM-DD date'],
  )
  // A day that does not exist must not silently roll over into March.
  assert.deepEqual(
    validateRules({ ...DEFAULT_RULES, holidays: [{ start: '2026-02-30', end: '2026-02-30', name: '假' }] }),
    ['holiday 假: start/end must be a real YYYY-MM-DD date'],
  )
  assert.deepEqual(
    validateRules({ ...DEFAULT_RULES, peakWindows: [{ startMinute: 720, endMinute: 720 }] }),
    ['peakWindow 720-720 is not a valid half-open minute range'],
  )
})

test('a custom rule set overrides the built-in calendar', () => {
  const rules = {
    ...DEFAULT_RULES,
    holidays: [{ start: '2026-03-02', end: '2026-03-02', name: '自定义' }],
    makeupWorkdays: [],
  }
  assert.equal(periodAt(rules, bj('2026-03-02T10:00:00')), 'off-peak')
})

// ---------------------------------------------------------------------------
// Configuration resolution — the seam the Host and browser halves share
// ---------------------------------------------------------------------------

/** Build a live (volatile) reference the way schemastery parses a `.volatile()` field. */
const liveRef = (value) => Object.freeze({ [Symbol.for('cosmokit.volatile.write')]: () => {}, get: () => value })

test('resolveRules reads live references, so a config edit reaches running code', () => {
  const ref = liveRef([{ start: '2026-03-02', end: '2026-03-02', name: '自定义' }])
  assert.deepEqual(live(ref), [{ start: '2026-03-02', end: '2026-03-02', name: '自定义' }])
  const { rules, problems } = resolveRules({ holidays: ref })
  assert.deepEqual(problems, [])
  assert.equal(periodAt(rules, bj('2026-03-02T10:00:00')), 'off-peak')
  // An unconfigured field keeps the published calendar.
  assert.equal(rules.makeupWorkdays, DEFAULT_RULES.makeupWorkdays)
})

test('an unusable rule set falls back to the published calendar and says why', () => {
  const { rules, problems } = resolveRules({ holidays: [{ start: '2026-5-1', end: '2026-05-05', name: 'x' }] })
  assert.deepEqual(problems, ['holiday x: start/end must be a real YYYY-MM-DD date'])
  assert.equal(rules, DEFAULT_RULES)
  assert.equal(periodAt(rules, bj('2026-05-01T10:00:00')), 'off-peak')
})

test('resolveRules with nothing configured resolves the built-ins cleanly', () => {
  const { rules, problems } = resolveRules(undefined)
  assert.deepEqual(problems, [])
  assert.equal(rules.holidays, HOLIDAYS_2026)
})

// ---------------------------------------------------------------------------
// Timeline, day load, cost
// ---------------------------------------------------------------------------

test('the schedule walks the current stretch and the ones that follow it', () => {
  // From Monday 10:00: peak until 12:00, off-peak until 14:00, peak until 18:00.
  const entries = schedule(DEFAULT_RULES, bj('2026-03-02T10:00:00'), 3)
  assert.equal(entries.length, 3)
  assert.equal(entries[0].period, 'peak')
  assert.equal(entries[0].reason, '现在')
  assert.equal(entries[0].milliseconds, 2 * 3_600_000)
  assert.equal(entries[1].period, 'off-peak')
  assert.equal(entries[1].reason, '午间谷时开始')
  assert.equal(entries[1].until.toISOString(), bj('2026-03-02T14:00:00').toISOString())
  assert.equal(formatSpan(entries[1].milliseconds), '2 小时')
  assert.equal(entries[2].period, 'peak')
  assert.equal(entries[2].until.toISOString(), bj('2026-03-02T18:00:00').toISOString())
})

test('the schedule is contiguous: each stretch ends where the next begins', () => {
  const entries = schedule(DEFAULT_RULES, bj('2026-03-02T10:00:00'), 20)
  assert.equal(entries.length, 20)
  for (let index = 1; index < entries.length; index++) {
    assert.equal(entries[index - 1].until.getTime(), entries[index].at.getTime())
    assert.notEqual(entries[index].period, entries[index - 1].period)
  }
  // A real calendar always has a next boundary, so the walk never invents a stop.
  assert.ok(entries[entries.length - 1].until !== null)
})

test('a workday divides 7 hours peak to 17 hours off-peak, a rest day 0 to 24', () => {
  // 09:00-12:00 is 3 hours and 14:00-18:00 is 4.
  assert.deepEqual(dayLoad(DEFAULT_RULES, '2026-03-02'), { peakMinutes: 420, offPeakMinutes: 1020 })
  assert.deepEqual(dayLoad(DEFAULT_RULES, '2026-03-07'), { peakMinutes: 0, offPeakMinutes: 1440 })
  assert.deepEqual(dayLoad(DEFAULT_RULES, '2026-05-01'), { peakMinutes: 0, offPeakMinutes: 1440 })
  // Overlapping windows must not be counted twice.
  const overlapping = { ...DEFAULT_RULES, peakWindows: [{ startMinute: 540, endMinute: 720 }, { startMinute: 600, endMinute: 780 }] }
  assert.deepEqual(dayLoad(overlapping, '2026-03-02'), { peakMinutes: 240, offPeakMinutes: 1200 })
})

test('a reading folds the period, the day shape, and the countdown', () => {
  const reading = read(DEFAULT_RULES, bj('2026-03-02T10:00:00'))
  assert.equal(reading.period, 'peak')
  assert.equal(reading.kind, 'workday')
  assert.equal(reading.holiday, null)
  assert.equal(reading.makeupWorkday, false)
  assert.equal(reading.remaining, 2 * 3_600_000)
  assert.deepEqual(reading.load, { peakMinutes: 420, offPeakMinutes: 1020 })
  const holiday = read(DEFAULT_RULES, bj('2026-05-01T10:00:00'))
  assert.equal(holiday.kind, 'holiday')
  assert.equal(holiday.holiday, '劳动节')
})

test('a cost estimate prices the mix and halves it at the other period', () => {
  const tokens = { cacheHit: 1_000_000, cacheMiss: 1_000_000, output: 1_000_000 }
  const peak = estimateCost(DEFAULT_RULES, 'deepseek-flash', tokens, 'peak')
  const offPeak = estimateCost(DEFAULT_RULES, 'deepseek-flash', tokens, 'off-peak')
  assert.ok(peak && offPeak)
  assert.equal(peak.cost, 10.04)
  assert.equal(offPeak.cost, 5.02)
  assert.equal(peak.rates.cacheHit, 0.04)
  assert.equal(estimateCost(DEFAULT_RULES, 'nope', tokens, 'peak'), null)
  // Junk counts read as zero rather than producing NaN.
  assert.equal(estimateCost(DEFAULT_RULES, 'deepseek-flash', { output: -5 }, 'peak')?.cost, 0)
  assert.equal(estimateCost(DEFAULT_RULES, 'deepseek-flash', {}, 'peak')?.cost, 0)
})

test('a caller-supplied instant parses in Beijing terms', () => {
  const now = bj('2026-03-02T10:00:00')
  assert.equal(parseBeijingMoment('2026-10-12 10:00', now)?.toISOString(), bj('2026-10-12T10:00:00').toISOString())
  assert.equal(parseBeijingMoment('2026-10-12T10:00:30', now)?.toISOString(), bj('2026-10-12T10:00:30').toISOString())
  assert.equal(parseBeijingMoment('2026-10-12', now)?.toISOString(), bj('2026-10-12T00:00:00').toISOString())
  assert.equal(parseBeijingMoment('14:30', now)?.toISOString(), bj('2026-03-02T14:30:00').toISOString())
  assert.equal(parseBeijingMoment('2026-10-12T02:00:00Z', now)?.toISOString(), '2026-10-12T02:00:00.000Z')
  assert.equal(parseBeijingMoment('2026-02-30', now), null)
  assert.equal(parseBeijingMoment('25:00', now), null)
  assert.equal(parseBeijingMoment('随便写的', now), null)
  assert.equal(parseBeijingMoment('   ', now), null)
})
