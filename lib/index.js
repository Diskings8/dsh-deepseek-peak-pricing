// src/host/index.ts → lib/index.js

// src/host/index.ts
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
var HOLIDAYS_2026 = [
  { start: "2026-01-01", end: "2026-01-03", name: "\u5143\u65E6" },
  { start: "2026-02-15", end: "2026-02-23", name: "\u6625\u8282" },
  { start: "2026-04-04", end: "2026-04-06", name: "\u6E05\u660E\u8282" },
  { start: "2026-05-01", end: "2026-05-05", name: "\u52B3\u52A8\u8282" },
  { start: "2026-06-19", end: "2026-06-21", name: "\u7AEF\u5348\u8282" },
  { start: "2026-09-25", end: "2026-09-27", name: "\u4E2D\u79CB\u8282" },
  { start: "2026-10-01", end: "2026-10-07", name: "\u56FD\u5E86\u8282" }
];
var MAKEUP_WORKDAYS_2026 = [
  "2026-01-04",
  "2026-02-14",
  "2026-02-28",
  "2026-05-09",
  "2026-09-20",
  "2026-10-10"
];
var DEFAULT_PEAK_WINDOWS = [
  { startMinute: 9 * 60, endMinute: 12 * 60 },
  { startMinute: 14 * 60, endMinute: 18 * 60 }
];
var MODELS = [
  {
    model: "deepseek-flash",
    label: "deepseek-flash",
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 }
  },
  {
    model: "deepseek-v4-pro",
    label: "deepseek-v4-pro",
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
  }
];
var DEFAULT_RULES = {
  holidays: HOLIDAYS_2026,
  makeupWorkdays: MAKEUP_WORKDAYS_2026,
  peakWindows: DEFAULT_PEAK_WINDOWS,
  models: MODELS
};
var BEIJING_OFFSET_MS = 8 * 60 * 60 * 1e3;
var MS_PER_DAY = 24 * 60 * 60 * 1e3;
var SEARCH_DAYS = 8;
function pad(value) {
  return value < 10 ? `0${value}` : String(value);
}
function beijingClock(instant) {
  const shifted = new Date(instant.getTime() + BEIJING_OFFSET_MS);
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  };
}
function weekdayOf(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
function holidayOn(rules, date) {
  return rules.holidays.find((range) => date >= range.start && date <= range.end);
}
function isMakeupWorkday(rules, date) {
  return rules.makeupWorkdays.includes(date);
}
function classifyDay(rules, date) {
  if (holidayOn(rules, date) !== void 0) return "holiday";
  const weekday = weekdayOf(date);
  return weekday === 0 || weekday === 6 ? "weekend" : "workday";
}
function periodAt(rules, instant) {
  const { date, minuteOfDay } = beijingClock(instant);
  if (classifyDay(rules, date) !== "workday") return "off-peak";
  return rules.peakWindows.some((window) => minuteOfDay >= window.startMinute && minuteOfDay < window.endMinute) ? "peak" : "off-peak";
}
function candidateBoundaries(rules, from) {
  const { date } = beijingClock(from);
  const [year, month, day] = date.split("-").map(Number);
  const midnightUtc = Date.UTC(year, month - 1, day) - BEIJING_OFFSET_MS;
  const edges = /* @__PURE__ */ new Set();
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const dayStart = midnightUtc + offset * MS_PER_DAY;
    edges.add(dayStart);
    for (const window of rules.peakWindows) {
      edges.add(dayStart + window.startMinute * 6e4);
      edges.add(dayStart + window.endMinute * 6e4);
    }
  }
  return [...edges].sort((left, right) => left - right).filter((time) => time >= from.getTime()).map((time) => new Date(time));
}
function describeSwitch(rules, at, period) {
  const { date, minuteOfDay } = beijingClock(at);
  const kind = classifyDay(rules, date);
  if (minuteOfDay === 0) {
    if (kind === "holiday") return `${holidayOn(rules, date)?.name ?? "\u6CD5\u5B9A\u8282\u5047\u65E5"}\u5168\u5929\u8C37\u65F6`;
    if (kind === "weekend") {
      return isMakeupWorkday(rules, date) ? "\u8C03\u4F11\u4E0A\u73ED\u65E5\u4ECD\u6309\u5468\u672B\u5168\u5929\u8C37\u65F6" : "\u5468\u672B\u5168\u5929\u8C37\u65F6";
    }
    return "\u5DE5\u4F5C\u65E5\u5F00\u59CB";
  }
  if (period === "peak") return "\u9AD8\u5CF0\u65F6\u6BB5\u5F00\u59CB";
  return minuteOfDay === 12 * 60 ? "\u5348\u95F4\u8C37\u65F6\u5F00\u59CB" : "\u8C37\u65F6\u5F00\u59CB";
}
function nextSwitch(rules, from) {
  let previous = periodAt(rules, from);
  for (const candidate of candidateBoundaries(rules, from)) {
    const period = periodAt(rules, candidate);
    if (period !== previous) return { at: candidate, period, reason: describeSwitch(rules, candidate, period) };
    previous = period;
  }
  return null;
}
function formatCountdown(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 1e3));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  const clock = `${pad(hours % 24)}:${pad(minutes)}:${pad(seconds)}`;
  const days = Math.floor(hours / 24);
  return days > 0 ? `${days}\u5929${clock}` : hours > 0 ? clock : `${pad(minutes)}:${pad(seconds)}`;
}
function formatBeijingTime(instant) {
  const { date, minuteOfDay } = beijingClock(instant);
  const shifted = new Date(instant.getTime() + BEIJING_OFFSET_MS);
  return `${date} ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:${pad(shifted.getUTCSeconds())}`;
}
function validateRules(rules) {
  const problems = [];
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (rules.holidays.length === 0) problems.push("holidays must not be empty (pass at least the current year)");
  if (rules.peakWindows.length === 0) problems.push("peakWindows must not be empty");
  for (const range of rules.holidays) {
    if (!iso.test(range.start) || !iso.test(range.end)) {
      problems.push(`holiday ${range.name}: start/end must be YYYY-MM-DD`);
    } else if (range.start > range.end) {
      problems.push(`holiday ${range.name}: start ${range.start} is after end ${range.end}`);
    }
  }
  for (const date of rules.makeupWorkdays) {
    if (!iso.test(date)) problems.push(`makeupWorkday ${date} must be YYYY-MM-DD`);
  }
  for (const window of rules.peakWindows) {
    if (window.startMinute < 0 || window.endMinute > 1440 || window.startMinute >= window.endMinute) {
      problems.push(`peakWindow ${window.startMinute}-${window.endMinute} is not a valid half-open minute range`);
    }
  }
  if (rules.models.length === 0) problems.push("models must not be empty");
  return problems;
}
var name = "deepseek-peak-pricing";
var inject = ["tools"];
var Config = z.object({
  holidays: z.array(z.object({
    start: z.string().required(),
    end: z.string().required(),
    name: z.string().required()
  })).description("\u6CD5\u5B9A\u8282\u5047\u65E5\u533A\u95F4\uFF08\u542B\u9996\u5C3E\uFF0C\u5317\u4EAC\u65E5\u671F YYYY-MM-DD\uFF09\uFF1B\u8BBE\u7F6E\u540E\u66FF\u6362\u5185\u7F6E\u65E5\u5386"),
  makeupWorkdays: z.array(z.string()).description("\u8C03\u4F11\u4E0A\u73ED\u65E5 YYYY-MM-DD\uFF08\u4EC5\u7528\u4E8E\u8BF4\u660E\uFF0C\u4E0D\u5F71\u54CD\u8BA1\u4EF7\uFF1A\u8C03\u4F11\u7684\u5468\u672B\u4ECD\u5168\u5929\u8C37\u65F6\uFF09\uFF1B\u8BBE\u7F6E\u540E\u66FF\u6362\u5185\u7F6E\u5217\u8868"),
  peakWindows: z.array(z.object({
    startMinute: z.number().required(),
    endMinute: z.number().required()
  })).description("\u9AD8\u5CF0\u65F6\u6BB5\uFF08\u5317\u4EAC\u65F6\u95F4\u7684\u5F53\u65E5\u5206\u949F\u6570\uFF0C\u5DE6\u95ED\u53F3\u5F00\uFF09\uFF1B\u8BBE\u7F6E\u540E\u66FF\u6362\u5185\u7F6E 09:00-12:00 / 14:00-18:00")
});
function resolveRules(config) {
  const rules = {
    holidays: config?.holidays ?? DEFAULT_RULES.holidays,
    makeupWorkdays: config?.makeupWorkdays ?? DEFAULT_RULES.makeupWorkdays,
    peakWindows: config?.peakWindows ?? DEFAULT_RULES.peakWindows,
    models: DEFAULT_RULES.models
  };
  const problems = validateRules(rules);
  if (problems.length > 0) throw new Error(`deepseek-peak-pricing: invalid rules
- ${problems.join("\n- ")}`);
  return rules;
}
function read(rules, now) {
  const { date } = beijingClock(now);
  const upcoming = nextSwitch(rules, now);
  return {
    now,
    period: periodAt(rules, now),
    kind: classifyDay(rules, date),
    makeupWorkday: isMakeupWorkday(rules, date),
    upcoming,
    remaining: upcoming === null ? 0 : Math.max(0, upcoming.at.getTime() - now.getTime())
  };
}
var RULE_TEXT = "\u5317\u4EAC\u65F6\u95F4\u5468\u4E00\u81F3\u5468\u4E94\uFF08\u4E0D\u542B\u4E2D\u56FD\u6CD5\u5B9A\u8282\u5047\u65E5\uFF0909:00-12:00\u300114:00-18:00 \u4E3A\u9AD8\u5CF0\u65F6\u6BB5\uFF1B\u5176\u4F59\u65F6\u6BB5\uFF0C\u5305\u62EC\u5468\u672B\u53CA\u4E2D\u56FD\u6CD5\u5B9A\u8282\u5047\u65E5\u5168\u5929\u5747\u4E3A\u7A7A\u95F2\u65F6\u6BB5\u3002\u8C03\u4F11\u4E0A\u73ED\u7684\u5468\u672B\u540C\u6837\u5168\u5929\u6309\u7A7A\u95F2\u65F6\u6BB5\u8BA1\u8D39\u3002";
function renderStatus(value) {
  const lines = [
    `DeepSeek API \u5F53\u524D\u4E3A${value.periodLabel}\uFF08\u5317\u4EAC\u65F6\u95F4 ${value.beijingTime}\uFF09\u3002`,
    value.period === "peak" ? "\u9AD8\u5CF0\u65F6\u6BB5\u4EF7\u683C\u4E3A\u8C37\u65F6\u7684 2 \u500D\u3002" : "\u7A7A\u95F2\u65F6\u6BB5\u4EF7\u683C\u4E3A\u9AD8\u5CF0\u7684 5 \u6298\u3002"
  ];
  if (value.makeupWorkday) {
    lines.push("\u4ECA\u5929\u662F\u8C03\u4F11\u4E0A\u73ED\u65E5\uFF0C\u4F46 DeepSeek \u5BF9\u8C03\u4F11\u4E0A\u73ED\u7684\u5468\u672B\u4ECD\u6309\u7A7A\u95F2\u65F6\u6BB5\u5168\u5929\u8BA1\u8D39\u3002");
  }
  if (value.nextPeriod !== "none") {
    lines.push(`\u8DDD\u4E0B\u4E00\u6B21\u5207\u6362\uFF08${value.nextReason}\uFF09\u8FD8\u6709 ${value.countdown}\uFF0C\u4E4B\u540E\u4E3A${value.nextPeriod === "peak" ? "\u9AD8\u5CF0\u65F6\u6BB5" : "\u7A7A\u95F2\u65F6\u6BB5"}\u3002`);
  }
  lines.push("");
  lines.push("\u5F53\u524D\u5355\u4EF7\uFF08\u5143 / \u767E\u4E07 tokens\uFF09\uFF1A");
  for (const price of value.prices) {
    lines.push(`- ${price.model}\uFF1A\u8F93\u5165(\u7F13\u5B58\u547D\u4E2D) ${price.cacheHit} \uFF5C \u8F93\u5165(\u7F13\u5B58\u672A\u547D\u4E2D) ${price.cacheMiss} \uFF5C \u8F93\u51FA ${price.output}`);
  }
  lines.push("");
  lines.push(`\u65F6\u6BB5\u89C4\u5219\uFF1A${value.rule}`);
  return lines.join("\n");
}
function apply(ctx, config) {
  const rules = resolveRules(config);
  ctx.tools.register(defineTool({
    name: "deepseek_pricing_status",
    description: "Report whether DeepSeek API requests right now bill at the peak (\u9AD8\u5CF0) or off-peak (\u7A7A\u95F2/\u8C37\u65F6) rate, how long until the rate changes, and the current CNY-per-million-token price of each model. Call it before reasoning about cost, batch size, or scheduling non-urgent work: off-peak is exactly half price. The answer is computed from the published rule (Beijing time, Mon-Fri 09:00-12:00 and 14:00-18:00 excluding China statutory holidays; weekends and holidays are off-peak all day, and \u8C03\u4F11\u4E0A\u73ED\u7684\u5468\u672B stay off-peak too) and needs no arguments.",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          period: { type: "string", required: true, enum: ["peak", "off-peak"] },
          beijingTime: { type: "string", required: true },
          periodLabel: { type: "string", required: true },
          dayKind: { type: "string", required: true, enum: ["holiday", "weekend", "workday"] },
          makeupWorkday: { type: "boolean", required: true },
          msUntilSwitch: { type: "integer", required: true },
          countdown: { type: "string", required: true },
          nextPeriod: { type: "string", required: true, enum: ["peak", "off-peak", "none"] },
          nextReason: { type: "string", required: true },
          prices: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                model: { type: "string", required: true },
                cacheHit: { type: "number", required: true },
                cacheMiss: { type: "number", required: true },
                output: { type: "number", required: true }
              }
            }
          },
          rule: { type: "string", required: true }
        }
      },
      // The reading is computed once, in execute; render only formats it.
      render: (_args, value) => [{ type: "text", text: renderStatus(value) }]
    },
    execute() {
      const reading = read(rules, /* @__PURE__ */ new Date());
      return Promise.resolve({
        period: reading.period,
        beijingTime: formatBeijingTime(reading.now),
        periodLabel: reading.period === "peak" ? "\u9AD8\u5CF0\u65F6\u6BB5" : "\u7A7A\u95F2\u65F6\u6BB5",
        dayKind: reading.kind,
        makeupWorkday: reading.makeupWorkday,
        msUntilSwitch: reading.remaining,
        countdown: formatCountdown(reading.remaining),
        nextPeriod: reading.upcoming === null ? "none" : reading.upcoming.period,
        nextReason: reading.upcoming === null ? "" : reading.upcoming.reason,
        prices: rules.models.map((model) => ({
          model: model.label,
          ...reading.period === "peak" ? model.peak : model.offPeak
        })),
        rule: RULE_TEXT
      });
    },
    presentCall: () => ({ card: "generic", title: "\u67E5\u8BE2 DeepSeek \u5CF0\u8C37\u8BA1\u8D39", kind: "other" })
  }));
}
export {
  Config,
  apply,
  inject,
  name
};
