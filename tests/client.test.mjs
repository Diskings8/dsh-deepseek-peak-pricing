/**
 * Behaviour tests for the browser half.
 *
 * `lib/client.js` is not an ordinary module: it is a module-loader closure that
 * calls `window.__ModuleLoader__.load({ id, factory })` and resolves its bare
 * imports through the injected `require`. This harness supplies both plus the
 * DOM surface the module touches, so the tests run against the exact bytes the
 * GUI fetches rather than a re-implementation.
 *
 * Covered here: the rule projection, the reading the pill renders from, the
 * period-flip notice transitions, the configuration that arrives from the Host,
 * and the registrations `apply()` performs. The rule core itself is covered by
 * tests/pricing.test.mjs, and the two halves are compared against each other by
 * tests/host.test.mjs.
 *
 * Run: `node --test tests/client.test.mjs` after `node scripts/build.mjs`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { bj, loadClientBundle, require } from './harness.mjs'

/** The built browser bundle, loaded exactly as the shell loads it. */
const client = await loadClientBundle()

test('the bundle registers a CommonJS module with the surfaces as components', () => {
  assert.equal(typeof client.apply, 'function')
  assert.equal(typeof client.PeakPricingPill, 'function')
  assert.equal(typeof client.PeakPricingPanel, 'function')
  assert.equal(typeof client.SwitchNotice, 'function')
  assert.equal(typeof client.NoticeCard, 'function')
  assert.equal(typeof client.PricingConfigPage, 'function')
})

test('the browser half applies the same calendar as the Host half', () => {
  // 2026-05-01 (Friday) is 劳动节; 2026-09-20 and 2026-10-10 are 调休 weekend
  // workdays, which DeepSeek still bills off-peak all day.
  assert.equal(client.periodAt(bj('2026-05-01T10:00:00')), 'off-peak')
  assert.equal(client.periodAt(bj('2026-09-20T10:00:00')), 'off-peak')
  assert.equal(client.periodAt(bj('2026-10-10T15:00:00')), 'off-peak')
  assert.equal(client.classifyDay('2026-09-20'), 'weekend')
  assert.equal(client.classifyDay('2026-10-10'), 'weekend')
  assert.equal(client.periodAt(bj('2026-03-02T10:00:00')), 'peak')
  assert.equal(client.periodAt(bj('2026-03-02T12:30:00')), 'off-peak')
})

test('a 调休 day reads as a weekend and says so', () => {
  const reading = client.read(bj('2026-10-10T15:00:00'))
  assert.equal(reading.period, 'off-peak')
  assert.equal(reading.kind, 'weekend')
  assert.equal(reading.makeupWorkday, true)
  // An ordinary weekend day reports the same period but not the 调休 flag.
  const plain = client.read(bj('2026-10-11T15:00:00'))
  assert.equal(plain.period, 'off-peak')
  assert.equal(plain.kind, 'weekend')
  assert.equal(plain.makeupWorkday, false)
})

test('the browser half reports the same next switch as the Host half', () => {
  const next = client.nextSwitch(bj('2026-04-03T18:30:00'))
  assert.ok(next)
  assert.equal(next.at.toISOString(), bj('2026-04-07T09:00:00').toISOString())
  assert.equal(next.period, 'peak')
  assert.equal(next.reason, '高峰时段开始')
})

test('a reading folds the period, the countdown, both rate columns, and the timeline', () => {
  const reading = client.read(bj('2026-03-02T10:00:00'))
  assert.equal(reading.period, 'peak')
  assert.equal(reading.kind, 'workday')
  assert.equal(reading.remaining, 2 * 60 * 60 * 1000)
  assert.equal(reading.rows.length, 2)
  // The current column is peak; `other` carries the comparison the panel shows.
  assert.deepEqual(reading.rows[0], {
    model: 'deepseek-flash',
    now: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    other: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
    period: 'peak',
  })
  assert.deepEqual(reading.rows[1].now, { cacheHit: 0.3, cacheMiss: 9, output: 27 })
  // The panel's timeline lists the next stretches, the first being 12:00-14:00.
  assert.equal(reading.timeline.length, 4)
  assert.equal(reading.timeline[0].period, 'off-peak')
  assert.equal(reading.timeline[0].reason, '午间谷时开始')
  assert.equal(reading.timeline[0].until.toISOString(), bj('2026-03-02T14:00:00').toISOString())
})

test('an off-peak reading shows the discounted column as the current one', () => {
  const reading = client.read(bj('2026-03-02T12:30:00'))
  assert.equal(reading.period, 'off-peak')
  assert.equal(reading.kind, 'workday')
  assert.deepEqual(reading.rows[0].now, { cacheHit: 0.02, cacheMiss: 1, output: 4 })
  assert.deepEqual(reading.rows[0].other, { cacheHit: 0.04, cacheMiss: 2, output: 8 })
})

test('a holiday and a weekend reading carry the day-long reason', () => {
  const holiday = client.read(bj('2026-05-01T10:00:00'))
  assert.equal(holiday.kind, 'holiday')
  assert.equal(holiday.holiday, '劳动节')
  assert.deepEqual(holiday.load, { peakMinutes: 0, offPeakMinutes: 1440 })
  assert.equal(client.read(bj('2026-03-07T10:00:00')).kind, 'weekend')
})

test('the Beijing clock is derived without the machine timezone', () => {
  assert.equal(client.formatBeijingClock(bj('2026-03-02T09:05:07')), '03-02 09:05:07')
  assert.equal(client.formatBeijingClock(new Date('2026-03-02T01:05:07Z')), '03-02 09:05:07')
})

test('the countdown copy stays readable at every scale', () => {
  assert.equal(client.formatCountdown(45_000), '00:45')
  assert.equal(client.formatCountdown(12 * 60_000 + 34_000), '12:34')
  assert.equal(client.formatCountdown(3 * 3_600_000 + 12 * 60_000 + 45_000), '03:12:45')
  assert.equal(client.formatCountdown(2 * 86_400_000), '2天00:00:00')
  assert.equal(client.formatCountdown(-1), '00:00')
})

// ---------------------------------------------------------------------------
// Configuration arriving from the Host
// ---------------------------------------------------------------------------

test('a projected Host config replaces the built-in calendar', () => {
  const settings = client.applyClientSettings({
    holidays: [{ start: '2026-03-02', end: '2026-03-02', name: '自定义' }],
    makeupWorkdays: [],
    peakWindows: [{ startMinute: 540, endMinute: 720 }],
    notifyOnSwitch: false,
    remindBeforePeakMinutes: 15,
  })
  assert.equal(settings.source, 'host')
  assert.deepEqual(settings.problems, [])
  assert.equal(settings.notifyOnSwitch, false)
  assert.equal(settings.remindBeforePeakMinutes, 15)
  // 2026-03-02 is now a holiday, and only the morning window can bill peak.
  assert.equal(client.periodAt(bj('2026-03-02T10:00:00'), settings.rules), 'off-peak')
  assert.equal(client.periodAt(bj('2026-03-05T10:00:00'), settings.rules), 'peak')
  assert.equal(client.periodAt(bj('2026-03-05T15:00:00'), settings.rules), 'off-peak')
})

test('an unusable Host config falls back to the published calendar and names the problem', () => {
  const settings = client.applyClientSettings({ holidays: [{ start: '2026-5-1', end: '2026-05-05', name: 'x' }] })
  assert.equal(settings.source, 'host')
  assert.equal(settings.problems.length, 1)
  assert.equal(client.periodAt(bj('2026-05-01T10:00:00'), settings.rules), 'off-peak')
})

test('watchSettings follows the form and falls back before it answers', () => {
  let value
  const listeners = new Set()
  const form = {
    getSnapshot: () => ({ value }),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  try {
    const dispose = client.watchSettings(form)
    // The form has not answered yet, so the published calendar stays in force.
    assert.equal(client.liveSettings.getSnapshot().source, 'built-in')
    value = { peakWindows: [{ startMinute: 600, endMinute: 660 }], holidays: [{ start: '2026-01-01', end: '2026-01-01', name: '元旦' }] }
    for (const listener of listeners) listener()
    assert.equal(client.liveSettings.getSnapshot().source, 'host')
    // 10:00-11:00 is now the only peak window; 09:30 is off-peak and 10:30 peak.
    assert.equal(client.read(bj('2026-03-02T09:30:00')).period, 'off-peak')
    assert.equal(client.read(bj('2026-03-02T10:30:00')).period, 'peak')
    dispose()
    assert.equal(listeners.size, 0)
  } finally {
    client.liveSettings.set(client.applyClientSettings(undefined))
  }
  assert.equal(client.liveSettings.getSnapshot().source, 'built-in')
})

// ---------------------------------------------------------------------------
// The period-flip notice
// ---------------------------------------------------------------------------

/** Notice options with switches on and no lead warning. */
const SWITCH_ONLY = { notifyOnSwitch: true, remindBeforePeakMinutes: 0 }

test('the first tick only records the period, so mounting mid-window stays quiet', () => {
  const state = client.advanceNotice(client.DEFAULT_RULES, client.INITIAL_NOTICE_STATE, bj('2026-03-02T10:00:00'), SWITCH_ONLY)
  assert.equal(state.active, null)
  assert.equal(state.lastPeriod, 'peak')
})

test('a flip raises one notice, which clears itself', () => {
  let state = client.advanceNotice(client.DEFAULT_RULES, client.INITIAL_NOTICE_STATE, bj('2026-03-02T08:59:59'), SWITCH_ONLY)
  assert.equal(state.active, null)
  state = client.advanceNotice(client.DEFAULT_RULES, state, bj('2026-03-02T09:00:00'), SWITCH_ONLY)
  assert.equal(state.active?.kind, 'switch')
  assert.equal(state.active?.period, 'peak')
  assert.match(state.active.title, /高峰/)
  const raised = state.active.id
  // The notice is not re-raised on every tick, and not before its TTL.
  state = client.advanceNotice(client.DEFAULT_RULES, state, bj('2026-03-02T09:00:05'), SWITCH_ONLY)
  assert.equal(state.active?.id, raised)
  // After the TTL it clears, without announcing anything new.
  state = client.advanceNotice(client.DEFAULT_RULES, state, bj('2026-03-02T09:00:20'), SWITCH_ONLY)
  assert.equal(state.active, null)
  assert.equal(state.lastPeriod, 'peak')
})

test('a flip into the cheap window says what it is worth', () => {
  let state = client.advanceNotice(client.DEFAULT_RULES, client.INITIAL_NOTICE_STATE, bj('2026-03-02T11:59:59'), SWITCH_ONLY)
  state = client.advanceNotice(client.DEFAULT_RULES, state, bj('2026-03-02T12:00:00'), SWITCH_ONLY)
  assert.equal(state.active?.period, 'off-peak')
  assert.match(state.active.title, /谷时/)
  assert.match(state.active.title, /5 折/)
})

test('notifyOnSwitch=false keeps the flip silent', () => {
  let state = client.advanceNotice(client.DEFAULT_RULES, client.INITIAL_NOTICE_STATE, bj('2026-03-02T08:59:59'), { notifyOnSwitch: false, remindBeforePeakMinutes: 0 })
  state = client.advanceNotice(client.DEFAULT_RULES, state, bj('2026-03-02T09:00:00'), { notifyOnSwitch: false, remindBeforePeakMinutes: 0 })
  assert.equal(state.active, null)
  assert.equal(state.lastPeriod, 'peak')
})

test('the lead warning fires once per peak boundary', () => {
  const options = { notifyOnSwitch: false, remindBeforePeakMinutes: 5 }
  let state = client.advanceNotice(client.DEFAULT_RULES, client.INITIAL_NOTICE_STATE, bj('2026-03-02T08:50:00'), options)
  assert.equal(state.active, null, 'the first tick never warns')
  state = client.advanceNotice(client.DEFAULT_RULES, state, bj('2026-03-02T08:56:00'), options)
  assert.equal(state.active?.kind, 'before-peak')
  assert.equal(state.active?.title, '4 分钟后进入高峰')
  assert.equal(state.remindedFor, bj('2026-03-02T09:00:00').getTime())
  // Past the TTL the warning does not come back for the same boundary.
  const late = client.advanceNotice(client.DEFAULT_RULES, state, bj('2026-03-02T08:58:40'), options)
  assert.equal(late.active, null)
  assert.equal(late.remindedFor, bj('2026-03-02T09:00:00').getTime())
  // A window that is not a peak start never warns.
  let quiet = client.advanceNotice(client.DEFAULT_RULES, client.INITIAL_NOTICE_STATE, bj('2026-03-02T11:50:00'), options)
  quiet = client.advanceNotice(client.DEFAULT_RULES, quiet, bj('2026-03-02T11:56:00'), options)
  assert.equal(quiet.active, null)
})

// ---------------------------------------------------------------------------
// Registration and rendering
// ---------------------------------------------------------------------------

test('apply() installs the reading into the composer dock, the notice into the overlay, the config page, and one stylesheet', () => {
  const registrations = []
  const injected = []
  const effects = []
  const inserted = []
  const namespaceAsked = []
  const previousDocument = globalThis.document
  globalThis.document = {
    createElement: () => ({ dataset: {}, textContent: '', remove() { inserted.pop() } }),
    head: { appendChild: (tag) => { inserted.push(tag) } },
  }
  try {
    client.apply({
      effect: (callback, label) => { effects.push({ callback, label }); return () => {} },
      slots: {
        inject: (name, callback) => { injected.push(name); callback(); return () => {} },
        register: (entry, component) => { registrations.push({ entry, component }); return () => {} },
      },
      inject: (deps, callback) => {
        namespaceAsked.push(deps)
        callback({ configForms: { get: (id) => { namespaceAsked.push(id); return { getSnapshot: () => ({}), subscribe: () => () => {} } } } })
        return () => {}
      },
    })

    assert.deepEqual(injected, ['conversation.composer.dock', 'shell.overlay', 'plugins.row.config'])
    assert.equal(registrations.length, 3)
    assert.deepEqual(registrations[0].entry, {
      name: 'conversation.composer.dock',
      id: 'deepseek-peak-pricing',
      // After ui-chat's stats entry, so period + countdown read as the third and
      // fourth members of the same strip.
      order: 10,
    })
    assert.equal(registrations[0].component, client.PeakPricingPill)
    assert.deepEqual(registrations[1].entry, {
      name: 'shell.overlay',
      id: 'deepseek-peak-pricing-notice',
      order: 10,
    })
    assert.equal(registrations[1].component, client.SwitchNotice)
    // The keyed slot is dispatched by `<package name>#<row id>`.
    assert.deepEqual(registrations[2].entry, {
      name: 'plugins.row.config',
      key: 'dsh-deepseek-peak-pricing#deepseek-peak-pricing',
    })
    assert.equal(registrations[2].component, client.PricingConfigPage)
    assert.equal(client.ROW_CONFIG_KEY, 'dsh-deepseek-peak-pricing#deepseek-peak-pricing')
    assert.deepEqual(namespaceAsked, [['configForms'], 'deepseek-peak-pricing'])
    assert.equal(effects.length, 1)
    assert.equal(effects[0].label, 'deepseek-peak-pricing: stylesheet')

    // The stylesheet effect inserts one tagged style; its disposer removes it.
    // Both run while the stub document is installed: the effect reads the
    // document in force when it executes, not the one at module load.
    const dispose = effects[0].callback()
    assert.equal(inserted.length, 1)
    assert.equal(inserted[0].dataset.plugin, 'dsh-deepseek-peak-pricing')
    assert.match(inserted[0].textContent, /\.dspp-pill/)
    // The resting pill must not float: it is a dock-row sibling, not an overlay.
    // Only the transient notice is allowed to be positioned fixed.
    assert.doesNotMatch(client.PILL_CSS, /position:\s*fixed/)
    assert.match(client.NOTICE_CSS, /\.dspp-notice\s*\{[^}]*position:\s*fixed/)
    dispose()
    assert.equal(inserted.length, 0)
  } finally {
    globalThis.document = previousDocument
  }
})

test('the pill renders as a dock-row reading, not a floating badge', async () => {
  // A real React render of the component: it catches a hook-order or props
  // mistake that the non-rendering assertions above cannot see.
  const { renderToStaticMarkup } = require('react-dom/server')
  const markup = renderToStaticMarkup(createElement(client.PeakPricingPill))
  assert.match(markup, /^<span class="dspp-root" data-period="(peak|off-peak)" data-source="(host|built-in)">/)
  assert.match(markup, /<button type="button" class="dspp-pill" aria-expanded="false" aria-haspopup="dialog"/)
  assert.match(markup, /<span class="dspp-dot" aria-hidden="true"><\/span>/)
  assert.match(markup, /<span class="dspp-label">(高峰时段|空闲时段)<\/span>/)
  // The countdown is present, and the collapsed state renders no panel.
  assert.match(markup, /<span class="dspp-count">/)
  assert.doesNotMatch(markup, /dspp-panel/)
  // The accessible name carries both the period and the countdown.
  assert.match(markup, /aria-label="DeepSeek API 当前(高峰时段|空闲时段)，距切换 /)
})

test('the notice renders nothing until a flip happens', () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  assert.equal(renderToStaticMarkup(createElement(client.SwitchNotice)), '')
})

test('the expanded panel renders both price columns, the day load, and the timeline', () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  const settings = client.liveSettings.getSnapshot()
  const markup = renderToStaticMarkup(createElement(client.PeakPricingPanel, {
    reading: client.read(bj('2026-03-02T10:00:00')),
    settings,
  }))
  assert.match(markup, /class="dspp-panel" role="dialog" aria-label="DeepSeek API 峰谷计费" data-period="peak"/)
  // The panel carries the same lamp as the pill, inside its heading.
  assert.match(markup, /<strong><span class="dspp-lamp" aria-hidden="true"><\/span>高峰时段<\/strong>/)
  assert.match(markup, /03-02 10:00:00 北京/)
  assert.match(markup, /距转入谷时（午间谷时开始）还有 02:00:00/)
  assert.match(markup, /今天：高峰 7 小时 · 谷时 17 小时/)
  // Both models, both periods, and the ★ on the one in force right now.
  assert.match(markup, /deepseek-flash/)
  assert.match(markup, /deepseek-v4-pro/)
  assert.ok(markup.includes('高峰 ★'))
  assert.ok(markup.includes('>谷时<'))
  // The timeline names the next stretch and how long it lasts.
  assert.match(markup, /接下来/)
  assert.match(markup, /午间谷时开始/)
  assert.match(markup, /2 小时/)
  assert.match(markup, /工作日 · 仅 09:00-12:00、14:00-18:00 为高峰/)
  // The panel is honest about where its calendar came from.
  assert.match(markup, /日历来自内置的 2026 年节假日/)
})

test('the panel explains a 调休 weekend and warns about a broken Host calendar', () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  const makeup = renderToStaticMarkup(createElement(client.PeakPricingPanel, {
    reading: client.read(bj('2026-10-10T15:00:00')),
    settings: client.liveSettings.getSnapshot(),
  }))
  assert.match(makeup, /调休上班，但 API 仍按周末计费/)
  assert.match(makeup, /空闲时段/)

  const broken = client.applyClientSettings({ holidays: [{ start: '2026-5-1', end: '2026-05-05', name: 'x' }] })
  const warned = renderToStaticMarkup(createElement(client.PeakPricingPanel, {
    reading: client.read(bj('2026-03-02T10:00:00'), broken.rules),
    settings: broken,
  }))
  assert.match(warned, /配置有问题，已回退到内置日历：holiday x/)
  assert.match(warned, /日历与时段来自 Host 的插件配置/)
})

test('the lamp is amber for peak and green for off-peak', () => {
  // The two states must be distinguishable by colour alone: peak bills at twice
  // the price. The fill follows the theme's state tokens, with each token's
  // literal value as the fallback so the light survives a theme without them.
  assert.match(client.PILL_CSS, /data-period="peak"\]\s*\.dspp-dot[\s\S]{0,200}--dsw-alias-state-warn-primary,\s*#f59e0b/)
  assert.match(client.PILL_CSS, /data-period="off-peak"\]\s*\.dspp-dot[\s\S]{0,200}--dsw-alias-state-success-primary,\s*#22c55e/)
  // Both lamps glow in their own hue rather than being flat dots.
  assert.match(client.PILL_CSS, /rgba\(245, 158, 11, 0\.22\)/)
  assert.match(client.PILL_CSS, /rgba\(34, 197, 94, 0\.22\)/)
  // The panel and the notice reuse the same lamp, scoped to their own period.
  assert.match(client.PILL_CSS, /data-period="peak"\]\s*\.dspp-lamp/)
  assert.match(client.PILL_CSS, /data-period="off-peak"\]\s*\.dspp-lamp/)
})

test('a notice card renders its headline, body, and dismiss control', () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  const notice = {
    id: 'switch:1',
    kind: 'switch',
    period: 'off-peak',
    title: '已进入谷时（高峰价的 5 折）',
    body: '适合跑批量与长任务。',
    at: 0,
  }
  const markup = renderToStaticMarkup(createElement(client.NoticeCard, { notice, onDismiss: () => {} }))
  assert.match(markup, /class="dspp-notice" role="status" data-kind="switch" data-period="off-peak"/)
  assert.match(markup, /<span class="dspp-lamp" aria-hidden="true"><\/span>/)
  assert.match(markup, /已进入谷时（高峰价的 5 折）/)
  assert.match(markup, /适合跑批量与长任务。/)
  assert.match(markup, /aria-label="关闭提醒"/)
})

// ---------------------------------------------------------------------------
// The plugin-manager configuration page
// ---------------------------------------------------------------------------

test('a config value round-trips through the draft and the Host write shape', () => {
  const value = {
    holidays: [{ start: '2026-01-01', end: '2026-01-03', name: '元旦' }],
    makeupWorkdays: ['2026-10-10'],
    peakWindows: [{ startMinute: 540, endMinute: 720 }, { startMinute: 840, endMinute: 1080 }],
    notifyOnSwitch: false,
    remindBeforePeakMinutes: 3,
  }
  const draft = client.draftFromValue(value)
  assert.deepEqual(draft, value)
  assert.deepEqual(client.draftToOps(draft), [
    { op: 'set', path: ['holidays'], value: value.holidays },
    { op: 'set', path: ['makeupWorkdays'], value: ['2026-10-10'] },
    { op: 'set', path: ['peakWindows'], value: value.peakWindows },
    { op: 'set', path: ['notifyOnSwitch'], value: false },
    { op: 'set', path: ['remindBeforePeakMinutes'], value: 3 },
  ])
  // An absent or junk value opens the built-in calendar instead of an empty form.
  const fallback = client.draftFromValue(undefined)
  assert.equal(fallback.holidays.length, 7)
  assert.equal(fallback.peakWindows.length, 2)
  assert.equal(fallback.notifyOnSwitch, true)
  assert.equal(fallback.remindBeforePeakMinutes, 5)
  const junk = client.draftFromValue({
    holidays: 'nope',
    peakWindows: [{}],
    makeupWorkdays: [1, '2026-01-04'],
    notifyOnSwitch: 'yes',
    remindBeforePeakMinutes: -5,
  })
  assert.equal(junk.holidays.length, 7)
  // A present-but-unusable list is shown as it really is (empty), and the
  // validator then refuses the save, rather than being papered over with defaults.
  assert.deepEqual(junk.peakWindows, [])
  assert.match(client.validateDraft(junk)[0], /peakWindows must not be empty/)
  assert.deepEqual(junk.makeupWorkdays, ['2026-01-04'])
  assert.equal(junk.notifyOnSwitch, true)
  assert.equal(junk.remindBeforePeakMinutes, 5)
})

test('a draft is refused when the Host would refuse it', () => {
  const draft = client.draftFromValue(undefined)
  assert.deepEqual(client.validateDraft(draft), [])
  assert.deepEqual(
    client.validateDraft({ ...draft, holidays: [] }),
    ['holidays must not be empty (pass at least the current year)'],
  )
  assert.match(client.validateDraft({ ...draft, peakWindows: [{ startMinute: 720, endMinute: 720 }] })[0], /peakWindow 720-720/)
  assert.match(client.validateDraft({ ...draft, holidays: [{ start: '2026-5-1', end: '2026-05-05', name: 'x' }] })[0], /holiday x/)
  assert.match(client.validateDraft({ ...draft, remindBeforePeakMinutes: -1 })[0], /remindBeforePeakMinutes/)
  // Whatever the problems are, the set is always the Host's own validator's.
  assert.deepEqual(client.validateDraft({ ...draft, holidays: [], remindBeforePeakMinutes: 2.5 }).length, 2)
})

test('the configuration page renders the summary line and the editor', () => {
  const { renderToStaticMarkup } = require('react-dom/server')
  const summary = renderToStaticMarkup(createElement(client.PricingConfigPage, { view: 'summary' }))
  assert.match(summary, /峰谷日历、高峰时段与切换提醒/)
  assert.match(
    renderToStaticMarkup(createElement(client.PricingConfigPage, { view: 'page' })),
    /配置界面暂不可用/,
  )

  const form = {
    state: {
      status: 'ready',
      revision: 3,
      writable: true,
      value: {
        holidays: [{ start: '2026-01-01', end: '2026-01-03', name: '元旦' }],
        makeupWorkdays: ['2026-10-10'],
        peakWindows: [{ startMinute: 540, endMinute: 720 }],
        notifyOnSwitch: false,
        remindBeforePeakMinutes: 0,
      },
    },
    mutate: () => Promise.resolve(true),
  }
  const markup = renderToStaticMarkup(createElement(client.PricingConfigPage, { view: 'page', form }))
  assert.match(markup, /高峰时段（北京时间，左闭右开）/)
  assert.match(markup, /value="09:00"/)
  assert.match(markup, /value="12:00"/)
  assert.match(markup, /持续 3 小时/)
  assert.match(markup, /法定节假日（含首尾，全天谷时）/)
  assert.match(markup, /value="2026-01-01"/)
  assert.match(markup, /value="元旦"/)
  assert.match(markup, /调休上班日（仅用于说明：调休的周末仍全天谷时）/)
  assert.match(markup, /value="2026-10-10"/)
  assert.match(markup, /进入高峰前/)
  assert.match(markup, /与 Host 当前配置一致。/)
  assert.match(markup, /<button type="button" disabled=""[^>]*>保存<\/button>/)
})

test('the stylesheet effect is a no-op without a document', () => {
  const effects = []
  const previousDocument = globalThis.document
  // eslint-disable-next-line no-global-assign
  globalThis.document = undefined
  try {
    client.apply({
      effect: (callback) => { effects.push(callback); return () => {} },
      slots: { inject: (name, callback) => { callback(); return () => {} }, register: () => () => {} },
    })
    assert.doesNotThrow(() => { effects[0]() })
  } finally {
    globalThis.document = previousDocument
  }
})

test('apply() works without an optional settings surface', () => {
  // A profile that composes no settings surface must still get the pill.
  assert.doesNotThrow(() => {
    client.apply({
      slots: { inject: (name, callback) => { callback(); return () => {} }, register: () => () => {} },
    })
  })
})

test('apply() fails loudly when the injected service is missing', () => {
  // `inject: ['slots']` makes Cordis wait for the service, so its absence is a
  // real defect. Swallowing it would leave a silently missing surface.
  assert.throws(() => { client.apply({}) }, TypeError)
})
