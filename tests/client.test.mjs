/**
 * Behaviour tests for the browser half.
 *
 * `lib/client.js` is not an ordinary module: it is a module-loader closure that
 * calls `window.__ModuleLoader__.load({ id, factory })` and resolves its bare
 * imports through the injected `require`. This harness supplies both plus the
 * DOM surface the module touches, so the tests run against the exact bytes the
 * GUI fetches rather than a re-implementation.
 *
 * All hook-free logic is asserted here: the rule projection, the reading the
 * pill renders from, and the registration `apply()` performs. The pill's own
 * body is pure formatting of one `read()` result, so pinning `read()` pins it.
 * The rule core likewise stays covered by tests/pricing.test.mjs against the
 * Host half's shipped copy.
 *
 * Run: `node --test tests/client.test.mjs` after `node scripts/build.mjs`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)

/** Build the instant of one Beijing wall-clock moment. */
const bj = (text) => new Date(`${text}+08:00`)

/**
 * Instantiate the built client bundle with the loader contract the shell uses.
 * @returns the factory's exports.
 */
async function loadClientBundle() {
  const source = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  let factory
  // The bundle registers itself at load time exactly as it does in the browser.
  globalThis.window = {
    __ModuleLoader__: { load: (registration) => { factory = registration.factory } },
  }
  globalThis.document = { createElement: () => ({ dataset: {}, textContent: '', remove() {} }), head: { appendChild() {} } }
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', source)(globalThis.window, globalThis.document)
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
  assert.ok(factory, 'the bundle must register a factory with __ModuleLoader__')
  // React arrives through the loader's require, as it does in the shell.
  return factory((specifier) => require(specifier))
}

const client = await loadClientBundle()

test('the bundle registers a CommonJS module with the pill as its component', () => {
  assert.equal(typeof client.apply, 'function')
  assert.equal(typeof client.PeakPricingPill, 'function')
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

test('a reading folds the period, the countdown, and both rate columns', () => {
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
  })
  assert.deepEqual(reading.rows[1].now, { cacheHit: 0.3, cacheMiss: 9, output: 27 })
})

test('an off-peak reading shows the discounted column as the current one', () => {
  const reading = client.read(bj('2026-03-02T12:30:00'))
  assert.equal(reading.period, 'off-peak')
  assert.equal(reading.kind, 'workday')
  assert.deepEqual(reading.rows[0].now, { cacheHit: 0.02, cacheMiss: 1, output: 4 })
  assert.deepEqual(reading.rows[0].other, { cacheHit: 0.04, cacheMiss: 2, output: 8 })
})

test('a holiday and a weekend reading carry the day-long reason', () => {
  assert.equal(client.read(bj('2026-05-01T10:00:00')).kind, 'holiday')
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

test('apply() installs the reading into the composer dock and a stylesheet effect', () => {
  const registrations = []
  const injected = []
  const effects = []
  const inserted = []
  const previousDocument = globalThis.document
  globalThis.document = {
    createElement: () => ({ dataset: {}, textContent: '', remove() { inserted.pop() } }),
    head: { appendChild: (tag) => { inserted.push(tag) } },
  }
  let dispose
  try {
    client.apply({
      effect: (callback, label) => { effects.push({ callback, label }); return () => {} },
      slots: {
        inject: (name, callback) => { injected.push(name); callback(); return () => {} },
        register: (entry, component) => { registrations.push({ entry, component }); return () => {} },
      },
    })

    assert.deepEqual(injected, ['conversation.composer.dock'])
    assert.equal(registrations.length, 1)
    assert.deepEqual(registrations[0].entry, {
      name: 'conversation.composer.dock',
      id: 'deepseek-peak-pricing',
      // After ui-chat's stats entry, so period + countdown read as the third and
      // fourth members of the same strip.
      order: 10,
    })
    assert.equal(registrations[0].component, client.PeakPricingPill)
    assert.equal(effects.length, 1)
    assert.equal(effects[0].label, 'deepseek-peak-pricing: stylesheet')

    // The stylesheet effect inserts one tagged style; its disposer removes it.
    // Both run while the stub document is installed: the effect reads the
    // document in force when it executes, not the one at module load.
    dispose = effects[0].callback()
    assert.equal(inserted.length, 1)
    assert.equal(inserted[0].dataset.plugin, 'dsh-deepseek-peak-pricing')
    assert.match(inserted[0].textContent, /\.dspp-pill/)
    // It must not float: the resting pill is a dock-row sibling, not an overlay.
    assert.doesNotMatch(inserted[0].textContent, /position:\s*fixed/)
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
  assert.match(markup, /^<span class="dspp-root" data-period="(peak|off-peak)">/)
  assert.match(markup, /<button type="button" class="dspp-pill" aria-expanded="false" aria-haspopup="dialog"/)
  assert.match(markup, /<span class="dspp-dot" aria-hidden="true"><\/span>/)
  assert.match(markup, /<span class="dspp-label">(高峰时段|空闲时段)<\/span>/)
  // The countdown is present, and the collapsed state renders no panel.
  assert.match(markup, /<span class="dspp-count">/)
  assert.doesNotMatch(markup, /dspp-panel/)
  // The accessible name carries both the period and the countdown.
  assert.match(markup, /aria-label="DeepSeek API 当前(高峰时段|空闲时段)，距切换 /)
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

test('apply() fails loudly when the injected service is missing', () => {
  // `inject: ['slots']` makes Cordis wait for the service, so its absence is a
  // real defect. Swallowing it would leave a silently missing surface.
  assert.throws(() => { client.apply({}) }, TypeError)
})
