/**
 * Behaviour tests for the Host half, including the cross-half check that both
 * built artifacts answer the same question the same way.
 *
 * `lib/index.js` is loaded as the Loader loads it (ESM, with `@deepseek-ai/*`
 * resolved from the install), and `lib/client.js` through the module-loader
 * harness. Comparing the two is what locks the single rule source: three
 * hand-copied calendars could drift, one shared core cannot.
 *
 * Run: `node --test tests/host.test.mjs` after `node scripts/build.mjs`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as host from '../lib/index.js'
import { resolveRules } from '../lib/shared/pricing.js'
import { bj, loadClientBundle } from './harness.mjs'

const client = await loadClientBundle()

/** A context that records what the Host half registers. */
function stubContext() {
  const tools = []
  const commands = []
  return {
    tools,
    commands,
    ctx: {
      tools: { register: (definition) => { tools.push(definition); return () => {} } },
      // The real Cordis child injection only runs the callback once the named
      // services exist; this stub always finds a command registry.
      inject: (deps, callback) => {
        assert.deepEqual(deps, ['commands'])
        callback({ commands: { register: (definition) => { commands.push(definition); return () => {} } } })
        return () => {}
      },
    },
  }
}

/** Apply the Host half against a fresh recording context. */
function mount(config) {
  const { ctx, tools, commands } = stubContext()
  host.apply(ctx, config)
  assert.equal(tools.length, 1, 'exactly one tool is registered')
  assert.equal(commands.length, 1, 'exactly one command is registered')
  return { tool: tools[0], command: commands[0] }
}

test('the Host half registers the pricing tool and the /pricing command', () => {
  const { tool, command } = mount(undefined)
  assert.equal(host.name, 'deepseek-peak-pricing')
  assert.deepEqual(host.inject, ['tools'])
  assert.equal(tool.name, 'deepseek_pricing_status')
  assert.match(tool.description, /peak/i)
  assert.equal(command.name, 'pricing')
  assert.match(command.description, /峰/)
})

test('both halves answer the same question identically', async () => {
  const { tool } = mount(undefined)
  const value = await tool.execute({ at: '2026-10-12 10:30' })
  const reading = client.read(bj('2026-10-12T10:30:00'))

  assert.equal(value.period, reading.period)
  assert.equal(value.periodLabel, reading.period === 'peak' ? '高峰时段' : '空闲时段')
  assert.equal(value.beijingTime, '2026-10-12 10:30:00')
  assert.equal(value.dayKind, reading.kind)
  assert.equal(value.countdown, client.formatCountdown(reading.remaining))
  assert.equal(value.nextPeriod, reading.upcoming.period)
  assert.equal(value.nextReason, reading.upcoming.reason)
  assert.deepEqual(value.dayLoad, reading.load)
  assert.deepEqual(
    value.prices.map(price => [price.model, price.cacheMiss, price.output]),
    reading.rows.map(row => [row.model, row.now.cacheMiss, row.now.output]),
  )
  // The first timeline row is the stretch after the current one, in both halves.
  assert.equal(value.switches[1].beijingTime, '2026-10-12 12:00:00')
  assert.equal(value.switches[1].reason, reading.timeline[0].reason)
})

test('the 调休 weekend answers off-peak in both halves', async () => {
  const { tool } = mount(undefined)
  const value = await tool.execute({ at: '2026-10-10 15:00' })
  assert.equal(value.period, 'off-peak')
  assert.equal(value.dayKind, 'weekend')
  assert.equal(value.makeupWorkday, true)
  assert.match(tool.output.render({}, value)[0].text, /调休上班日/)
  assert.equal(client.read(bj('2026-10-10T15:00:00')).period, 'off-peak')
})

test('the declared schemas compile into the registry JSON Schema subset', () => {
  const { tool } = mount(undefined)
  // `defineTool` compiles both schemas at definition time, so this asserts the
  // exact shape the registry validates calls and results against.
  assert.deepEqual(Object.keys(tool.parameters.properties), ['at', 'switches', 'model', 'tokens'])
  assert.deepEqual(
    Object.keys(tool.parameters.properties.tokens.properties),
    ['cacheHit', 'cacheMiss', 'output'],
  )
  assert.equal(tool.output.schema.additionalProperties, false)
  assert.deepEqual(tool.output.schema.properties.switches.items.properties.until, {
    oneOf: [{ type: 'string' }, { type: 'null' }],
  })
  // `estimate` is declared but optional: absent unless a token mix was priced.
  assert.ok(tool.output.schema.required.includes('prices'))
  assert.ok(!tool.output.schema.required.includes('estimate'))
})

test('an absent instant answers for now', async () => {
  const { tool } = mount(undefined)
  const value = await tool.execute({})
  assert.match(value.beijingTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  assert.equal(value.switches.length, 3)
})

test('the timeline length is honoured and bounded', async () => {
  const { tool } = mount(undefined)
  assert.equal((await tool.execute({ at: '2026-10-12 10:30', switches: 1 })).switches.length, 1)
  assert.equal((await tool.execute({ at: '2026-10-12 10:30', switches: 99 })).switches.length, 8)
  assert.equal((await tool.execute({ at: '2026-10-12 10:30', switches: 0 })).switches.length, 1)
})

test('a token mix is priced now and at the other period', async () => {
  const { tool } = mount(undefined)
  const value = await tool.execute({
    at: '2026-10-12 10:30',
    model: 'deepseek-flash',
    tokens: { cacheHit: 1_000_000, cacheMiss: 1_000_000, output: 1_000_000 },
  })
  assert.ok(value.estimate)
  assert.equal(value.estimate.period, 'peak')
  assert.equal(value.estimate.cost, 10.04)
  assert.equal(value.estimate.otherCost, 5.02)
  assert.equal(value.estimate.otherPeriodLabel, '空闲时段')
  const text = tool.output.render({}, value)[0].text
  assert.match(text, /成本估算/)
  assert.match(text, /¥10\.04/)
})

test('an unusable request fails with an actionable message', async () => {
  const { tool } = mount(undefined)
  await assert.rejects(() => tool.execute({ at: '昨天下午' }), /无法解析时间/)
  await assert.rejects(() => tool.execute({ model: 'deepseek-flash' }), /同时提供/)
  await assert.rejects(() => tool.execute({ tokens: { output: 1 } }), /同时提供/)
  await assert.rejects(
    () => tool.execute({ model: 'no-such-model', tokens: { output: 1 } }),
    /未知模型/,
  )
})

test('the command answers a person without spending a turn', () => {
  const { command } = mount(undefined)
  const success = command.handler({ rawInput: ' 2026-10-12 10:30 ' })
  assert.equal(success.kind, 'success')
  assert.match(success.text, /2026-10-12 10:30:00/)
  assert.match(success.text, /高峰时段/)
  assert.match(success.text, /元 \/ 百万 tokens/)
  // An empty argument means "now", and a bad one is a human-facing error.
  assert.equal(command.handler({ rawInput: '' }).kind, 'success')
  const failure = command.handler({ rawInput: 'nonsense' })
  assert.equal(failure.kind, 'error')
  assert.match(failure.text, /无法解析时间/)
})

test('the Config schema carries the built-in calendar as a live default', () => {
  // Schemastery parses `.volatile()` fields into references; the shared
  // resolver must read through them, or the pill and the tool would both lose
  // the calendar the moment a deployment stopped overriding it.
  //
  // The row config is empty in the shipped patch, so all three of these are the
  // shapes the Loader can hand `apply`: an absent config, an explicitly empty
  // object, and `config:` with nothing under it (YAML null).
  for (const raw of [undefined, null, {}]) {
    const parsed = host.Config(raw)
    const { rules, problems } = resolveRules(parsed)
    assert.deepEqual(problems, [])
    assert.equal(rules.holidays.length, 7)
    assert.equal(periodAtFor(rules, '2026-05-01T10:00:00'), 'off-peak')
    assert.equal(periodAtFor(rules, '2026-10-10T10:00:00'), 'off-peak')
    // The fields the browser half reads arrive as complete values, not as
    // partial overrides: the pill would otherwise fall back silently.
    assert.equal(typeof parsed.notifyOnSwitch.get(), 'boolean')
    assert.equal(typeof parsed.remindBeforePeakMinutes.get(), 'number')
  }
})

test('a configured calendar reaches the tool answer', async () => {
  const parsed = host.Config({ holidays: [{ start: '2026-03-02', end: '2026-03-02', name: '自定义' }] })
  const { tool } = mount(parsed)
  const value = await tool.execute({ at: '2026-03-02 10:00' })
  assert.equal(value.period, 'off-peak')
  assert.equal(value.holiday, '自定义')
})

test('an invalid rule set fails at startup, not at the first question', () => {
  assert.throws(
    () => host.apply(stubContext().ctx, { holidays: [{ start: '2026-5-1', end: '2026-05-05', name: 'x' }] }),
    /invalid rules/,
  )
})

/** Read the period for one Beijing instant through a rule set. */
function periodAtFor(rules, instant) {
  return client.periodAt(bj(instant), rules)
}
