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
  DEFAULT_RULES, MODELS, classifyDay, formatCountdown, nextSwitch, periodAt, ratesFor, validateRules,
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

test('the built-in rule set validates clean, and typos are reported', () => {
  assert.deepEqual(validateRules(DEFAULT_RULES), [])
  assert.deepEqual(
    validateRules({ ...DEFAULT_RULES, holidays: [{ start: '2026-5-1', end: '2026-05-05', name: 'x' }] }),
    ['holiday x: start/end must be YYYY-MM-DD'],
  )
  assert.deepEqual(
    validateRules({ ...DEFAULT_RULES, makeupWorkdays: ['2026/10/10'] }),
    ['makeupWorkday 2026/10/10 must be YYYY-MM-DD'],
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
