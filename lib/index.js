// src/host/index.ts → lib/index.js

// src/host/index.ts
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/shared/pricing.ts
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
var DEFAULT_RULES = {
  holidays: HOLIDAYS_2026,
  makeupWorkdays: MAKEUP_WORKDAYS_2026,
  peakWindows: DEFAULT_PEAK_WINDOWS,
  models: MODELS
};
var DEFAULT_NOTIFY_ON_SWITCH = true;
var DEFAULT_REMIND_BEFORE_PEAK_MINUTES = 5;
var VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");
function live(value) {
  if (value === null || typeof value !== "object") return value;
  if (VOLATILE_WRITE in value) return value.get();
  return value;
}
function resolveRules(overrides) {
  const rules = {
    holidays: live(overrides?.holidays) ?? DEFAULT_RULES.holidays,
    makeupWorkdays: live(overrides?.makeupWorkdays) ?? DEFAULT_RULES.makeupWorkdays,
    peakWindows: live(overrides?.peakWindows) ?? DEFAULT_RULES.peakWindows,
    models: MODELS
  };
  const problems = validateRules(rules);
  return { rules: problems.length === 0 ? rules : DEFAULT_RULES, problems };
}
var BEIJING_OFFSET_MS = 8 * 60 * 60 * 1e3;
var MS_PER_DAY = 24 * 60 * 60 * 1e3;
var MS_PER_MINUTE = 6e4;
var SEARCH_DAYS = 8;
function pad(value) {
  return value < 10 ? `0${value}` : String(value);
}
function beijingClock(instant) {
  const shifted = new Date(instant.getTime() + BEIJING_OFFSET_MS);
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay()
  };
}
function beijingInstant(date, minuteOfDay = 0, second = 0) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, minuteOfDay, second) - BEIJING_OFFSET_MS);
}
function weekdayOf(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
function isCalendarDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
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
  const midnightUtc = beijingInstant(date).getTime();
  const edges = /* @__PURE__ */ new Set();
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const dayStart = midnightUtc + offset * MS_PER_DAY;
    edges.add(dayStart);
    for (const window of rules.peakWindows) {
      edges.add(dayStart + window.startMinute * MS_PER_MINUTE);
      edges.add(dayStart + window.endMinute * MS_PER_MINUTE);
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
    if (period !== previous) {
      return { at: candidate, period, reason: describeSwitch(rules, candidate, period) };
    }
    previous = period;
  }
  return null;
}
function schedule(rules, from, count) {
  const entries = [];
  let cursor = from;
  let period = periodAt(rules, from);
  let reason = "\u73B0\u5728";
  while (entries.length < Math.max(0, count)) {
    const next = nextSwitch(rules, cursor);
    const until = next === null ? null : next.at;
    entries.push({
      at: cursor,
      period,
      reason,
      until,
      milliseconds: until === null ? 0 : Math.max(0, until.getTime() - cursor.getTime())
    });
    if (next === null) break;
    cursor = next.at;
    period = next.period;
    reason = next.reason;
  }
  return entries;
}
function mergedWindows(windows) {
  const sorted = windows.map((window) => [Math.max(0, window.startMinute), Math.min(1440, window.endMinute)]).filter(([start, end]) => start < end).sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last !== void 0 && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
function dayLoad(rules, date) {
  if (classifyDay(rules, date) !== "workday") return { peakMinutes: 0, offPeakMinutes: 1440 };
  const peakMinutes = mergedWindows(rules.peakWindows).reduce((total, [start, end]) => total + (end - start), 0);
  return { peakMinutes, offPeakMinutes: 1440 - peakMinutes };
}
function read(rules, now) {
  const { date } = beijingClock(now);
  const upcoming = nextSwitch(rules, now);
  return {
    now,
    date,
    period: periodAt(rules, now),
    kind: classifyDay(rules, date),
    holiday: holidayOn(rules, date)?.name ?? null,
    makeupWorkday: isMakeupWorkday(rules, date),
    upcoming,
    remaining: upcoming === null ? 0 : Math.max(0, upcoming.at.getTime() - now.getTime()),
    load: dayLoad(rules, date)
  };
}
function ratesFor(rules, model, period) {
  const entry = rules.models.find((item) => item.model === model || item.label === model);
  if (entry === void 0) return null;
  return { model: entry.model, label: entry.label, ...period === "peak" ? entry.peak : entry.offPeak };
}
function tokenCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
function estimateCost(rules, model, usage, period) {
  const rates = ratesFor(rules, model, period);
  if (rates === null) return null;
  const tokens = {
    cacheHit: tokenCount(usage.cacheHit),
    cacheMiss: tokenCount(usage.cacheMiss),
    output: tokenCount(usage.output)
  };
  const cost = (tokens.cacheHit * rates.cacheHit + tokens.cacheMiss * rates.cacheMiss + tokens.output * rates.output) / 1e6;
  return {
    model: rates.model,
    label: rates.label,
    period,
    tokens,
    rates: { cacheHit: rates.cacheHit, cacheMiss: rates.cacheMiss, output: rates.output },
    cost: Math.round(cost * 1e6) / 1e6
  };
}
function breakdown(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 1e3));
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor(total % 3600 / 60),
    seconds: total % 60
  };
}
function formatCountdown(milliseconds) {
  const { hours: hours2, minutes, seconds } = breakdown(milliseconds);
  const days = Math.floor(hours2 / 24);
  const clock = `${pad(hours2 % 24)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}\u5929${clock}` : hours2 > 0 ? clock : `${pad(minutes)}:${pad(seconds)}`;
}
function formatSpan(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 6e4));
  const days = Math.floor(total / 1440);
  const hours2 = Math.floor(total % 1440 / 60);
  const minutes = total % 60;
  const parts = [];
  if (days > 0) parts.push(`${days} \u5929`);
  if (hours2 > 0) parts.push(`${hours2} \u5C0F\u65F6`);
  if (minutes > 0) parts.push(`${minutes} \u5206\u949F`);
  return parts.length === 0 ? "\u4E0D\u5230 1 \u5206\u949F" : parts.join(" ");
}
function formatBeijingTime(instant) {
  const { date, minuteOfDay, second } = beijingClock(instant);
  return `${date} ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:${pad(second)}`;
}
function parseBeijingMoment(text, now) {
  const input = text.trim();
  if (input === "") return null;
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(input);
  if (time !== null) {
    const hour = Number(time[1]);
    const minute = Number(time[2]);
    const second = Number(time[3] ?? 0);
    if (hour > 23 || minute > 59 || second > 59) return null;
    return beijingInstant(beijingClock(now).date, hour * 60 + minute, second);
  }
  const calendar = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(input);
  if (calendar !== null) {
    const [, date, hourText, minuteText, secondText] = calendar;
    if (!isCalendarDate(date)) return null;
    const hour = hourText === void 0 ? 0 : Number(hourText);
    const minute = minuteText === void 0 ? 0 : Number(minuteText);
    const second = secondText === void 0 ? 0 : Number(secondText);
    if (hour > 23 || minute > 59 || second > 59) return null;
    return beijingInstant(date, hour * 60 + minute, second);
  }
  const absolute = new Date(input);
  return Number.isNaN(absolute.getTime()) ? null : absolute;
}
function validateRules(rules) {
  const problems = [];
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (rules.holidays.length === 0) problems.push("holidays must not be empty (pass at least the current year)");
  if (rules.peakWindows.length === 0) problems.push("peakWindows must not be empty");
  for (const range of rules.holidays) {
    if (!iso.test(range.start) || !iso.test(range.end) || !isCalendarDate(range.start) || !isCalendarDate(range.end)) {
      problems.push(`holiday ${range.name}: start/end must be a real YYYY-MM-DD date`);
    } else if (range.start > range.end) {
      problems.push(`holiday ${range.name}: start ${range.start} is after end ${range.end}`);
    }
  }
  for (const date of rules.makeupWorkdays) {
    if (!isCalendarDate(date)) problems.push(`makeupWorkday ${date} must be a real YYYY-MM-DD date`);
  }
  for (const window of rules.peakWindows) {
    if (!Number.isFinite(window.startMinute) || !Number.isFinite(window.endMinute) || window.startMinute < 0 || window.endMinute > 1440 || window.startMinute >= window.endMinute) {
      problems.push(`peakWindow ${window.startMinute}-${window.endMinute} is not a valid half-open minute range`);
    }
  }
  if (rules.models.length === 0) problems.push("models must not be empty");
  for (const model of rules.models) {
    for (const period of ["peak", "offPeak"]) {
      const rates = model[period];
      for (const [field, value] of Object.entries(rates)) {
        if (!Number.isFinite(value) || value < 0) problems.push(`${model.model}.${period}.${field} must be a non-negative number`);
      }
    }
  }
  return problems;
}

// src/host/index.ts
var name = "deepseek-peak-pricing";
var inject = ["tools"];
var Config = z.object({
  holidays: z.array(z.object({
    start: z.string().required(),
    end: z.string().required(),
    name: z.string().required()
  })).default([...HOLIDAYS_2026]).volatile().description("\u6CD5\u5B9A\u8282\u5047\u65E5\u533A\u95F4\uFF08\u542B\u9996\u5C3E\uFF0C\u5317\u4EAC\u65E5\u671F YYYY-MM-DD\uFF09\uFF1B\u7F16\u8F91\u540E\u540C\u65F6\u4F5C\u7528\u4E8E\u5DE5\u5177\u4E0E\u72B6\u6001\u6761"),
  makeupWorkdays: z.array(z.string()).default([...MAKEUP_WORKDAYS_2026]).volatile().description("\u8C03\u4F11\u4E0A\u73ED\u65E5 YYYY-MM-DD\uFF08\u4EC5\u7528\u4E8E\u8BF4\u660E\uFF0C\u4E0D\u5F71\u54CD\u8BA1\u4EF7\uFF1A\u8C03\u4F11\u7684\u5468\u672B\u4ECD\u5168\u5929\u8C37\u65F6\uFF09"),
  peakWindows: z.array(z.object({
    startMinute: z.number().required(),
    endMinute: z.number().required()
  })).default([...DEFAULT_PEAK_WINDOWS]).volatile().description("\u9AD8\u5CF0\u65F6\u6BB5\uFF08\u5317\u4EAC\u65F6\u95F4\u7684\u5F53\u65E5\u5206\u949F\u6570\uFF0C\u5DE6\u95ED\u53F3\u5F00\uFF09\uFF1B\u9ED8\u8BA4 09:00-12:00 / 14:00-18:00"),
  notifyOnSwitch: z.boolean().default(DEFAULT_NOTIFY_ON_SWITCH).volatile().description("\u65F6\u6BB5\u5207\u6362\u65F6\u5728\u9875\u9762\u53F3\u4E0B\u89D2\u5F39\u4E00\u6761\u81EA\u52A8\u6D88\u5931\u7684\u63D0\u9192"),
  remindBeforePeakMinutes: z.natural().default(DEFAULT_REMIND_BEFORE_PEAK_MINUTES).volatile().description("\u8FDB\u5165\u9AD8\u5CF0\u524D\u591A\u5C11\u5206\u949F\u63D0\u9192\u4E00\u6B21\uFF1B0 \u8868\u793A\u53EA\u63D0\u9192\u5207\u6362\u672C\u8EAB")
});
var RULE_TEXT = "\u5317\u4EAC\u65F6\u95F4\u5468\u4E00\u81F3\u5468\u4E94\uFF08\u4E0D\u542B\u4E2D\u56FD\u6CD5\u5B9A\u8282\u5047\u65E5\uFF0909:00-12:00\u300114:00-18:00 \u4E3A\u9AD8\u5CF0\u65F6\u6BB5\uFF1B\u5176\u4F59\u65F6\u6BB5\uFF0C\u5305\u62EC\u5468\u672B\u53CA\u4E2D\u56FD\u6CD5\u5B9A\u8282\u5047\u65E5\u5168\u5929\u5747\u4E3A\u7A7A\u95F2\u65F6\u6BB5\u3002\u8C03\u4F11\u4E0A\u73ED\u7684\u5468\u672B\u540C\u6837\u5168\u5929\u6309\u7A7A\u95F2\u65F6\u6BB5\u8BA1\u8D39\u3002\u7A7A\u95F2\u65F6\u6BB5\u4EF7\u683C\u4E3A\u9AD8\u5CF0\u65F6\u6BB5\u4EF7\u683C\u7684\u4E00\u534A\uFF085 \u6298\uFF09\u3002";
function periodLabel(period) {
  return period === "peak" ? "\u9AD8\u5CF0\u65F6\u6BB5" : "\u7A7A\u95F2\u65F6\u6BB5";
}
function renderStatus(value) {
  const lines = [
    `DeepSeek API \u5728 ${value.beijingTime}\uFF08\u5317\u4EAC\u65F6\u95F4\uFF09\u4E3A${value.periodLabel}\u3002`,
    value.period === "peak" ? "\u9AD8\u5CF0\u65F6\u6BB5\u4EF7\u683C\u4E3A\u8C37\u65F6\u7684 2 \u500D\u3002" : "\u7A7A\u95F2\u65F6\u6BB5\u4EF7\u683C\u4E3A\u9AD8\u5CF0\u7684 5 \u6298\u3002"
  ];
  if (value.holiday !== void 0) lines.push(`\u5F53\u5929\u662F\u6CD5\u5B9A\u8282\u5047\u65E5\u300C${value.holiday}\u300D\uFF0C\u5168\u5929\u6309\u7A7A\u95F2\u65F6\u6BB5\u8BA1\u8D39\u3002`);
  if (value.makeupWorkday) {
    lines.push("\u5F53\u5929\u662F\u8C03\u4F11\u4E0A\u73ED\u65E5\uFF0C\u4F46 DeepSeek \u5BF9\u8C03\u4F11\u4E0A\u73ED\u7684\u5468\u672B\u4ECD\u6309\u7A7A\u95F2\u65F6\u6BB5\u5168\u5929\u8BA1\u8D39\u3002");
  }
  lines.push(`\u5F53\u5929\u5171 ${hours(value.dayLoad.peakMinutes)} \u5C0F\u65F6\u9AD8\u5CF0\u3001${hours(value.dayLoad.offPeakMinutes)} \u5C0F\u65F6\u8C37\u65F6\u3002`);
  if (value.nextPeriod !== "none") {
    lines.push(`\u8DDD\u4E0B\u4E00\u6B21\u5207\u6362\uFF08${value.nextReason}\uFF09\u8FD8\u6709 ${value.countdown}\uFF0C\u4E4B\u540E\u4E3A${periodLabel(value.nextPeriod)}\u3002`);
  } else {
    lines.push("\u672A\u6765 8 \u5929\u5185\u6CA1\u6709\u5207\u6362\u3002");
  }
  lines.push("");
  lines.push("\u65F6\u6BB5\u8868\uFF08\u5317\u4EAC\u65F6\u95F4\uFF09\uFF1A");
  for (const item of value.switches) {
    lines.push(`- ${item.beijingTime} \u8D77 ${item.periodLabel}\uFF08${item.reason}\uFF0C\u6301\u7EED ${item.span}\uFF09`);
  }
  lines.push("");
  lines.push("\u5F53\u524D\u5355\u4EF7\uFF08\u5143 / \u767E\u4E07 tokens\uFF09\uFF1A");
  for (const price of value.prices) {
    lines.push(`- ${price.model}\uFF1A\u8F93\u5165(\u7F13\u5B58\u547D\u4E2D) ${price.cacheHit} \uFF5C \u8F93\u5165(\u7F13\u5B58\u672A\u547D\u4E2D) ${price.cacheMiss} \uFF5C \u8F93\u51FA ${price.output}`);
  }
  if (value.estimate !== void 0) {
    lines.push("");
    lines.push(
      `\u6210\u672C\u4F30\u7B97\uFF08${value.estimate.model}\uFF09\uFF1A\u5F53\u524D${value.estimate.periodLabel} \xA5${value.estimate.cost}\uFF1B\u82E5\u6362\u5230${value.estimate.otherPeriodLabel}\u5219 \xA5${value.estimate.otherCost}\u3002`
    );
  }
  lines.push("");
  lines.push(`\u65F6\u6BB5\u89C4\u5219\uFF1A${value.rule}`);
  return lines.join("\n");
}
function hours(minutes) {
  if (minutes % 60 === 0) return String(minutes / 60);
  return (minutes / 60).toFixed(1);
}
var DEFAULT_SWITCH_COUNT = 3;
var MAX_SWITCH_COUNT = 8;
function answer(overrides, args, now) {
  const { rules, problems } = resolveRules(overrides);
  if (problems.length > 0) return { error: `deepseek-peak-pricing: invalid rules
- ${problems.join("\n- ")}` };
  if (args.model === void 0 !== (args.tokens === void 0)) {
    return { error: "\u6210\u672C\u4F30\u7B97\u9700\u8981\u540C\u65F6\u63D0\u4F9B `model` \u4E0E `tokens`\uFF08\u53EF\u542B cacheHit / cacheMiss / output\uFF09\u3002" };
  }
  const requested = args.at === void 0 || args.at.trim() === "" ? now : parseBeijingMoment(args.at, now);
  if (requested === null) {
    return {
      error: `\u65E0\u6CD5\u89E3\u6790\u65F6\u95F4\u300C${args.at}\u300D\u3002\u53EF\u7528\u683C\u5F0F\uFF1AYYYY-MM-DD\u3001YYYY-MM-DD HH:MM\u3001HH:MM\uFF08\u4ECA\u5929\uFF09\u3001\u6216\u5E26\u65F6\u533A\u7684 ISO 8601\u3002`
    };
  }
  const reading = read(rules, requested);
  const count = Math.max(1, Math.min(MAX_SWITCH_COUNT, Math.trunc(args.switches ?? DEFAULT_SWITCH_COUNT)));
  const stretches = schedule(rules, requested, count);
  const value = {
    period: reading.period,
    beijingTime: formatBeijingTime(reading.now),
    periodLabel: periodLabel(reading.period),
    dayKind: reading.kind,
    makeupWorkday: reading.makeupWorkday,
    msUntilSwitch: reading.remaining,
    countdown: formatCountdown(reading.remaining),
    nextPeriod: reading.upcoming === null ? "none" : reading.upcoming.period,
    nextReason: reading.upcoming === null ? "" : reading.upcoming.reason,
    dayLoad: reading.load,
    switches: stretches.map((entry) => ({
      beijingTime: formatBeijingTime(entry.at),
      period: entry.period,
      periodLabel: periodLabel(entry.period),
      reason: entry.reason,
      span: entry.until === null ? "8 \u5929\u4EE5\u4E0A" : formatSpan(entry.milliseconds),
      until: entry.until === null ? null : formatBeijingTime(entry.until)
    })),
    prices: rules.models.map((model) => ({
      model: model.label,
      ...reading.period === "peak" ? model.peak : model.offPeak
    })),
    rule: RULE_TEXT
  };
  if (reading.holiday !== null) value.holiday = reading.holiday;
  if (args.model !== void 0 && args.tokens !== void 0) {
    const here = estimateCost(rules, args.model, args.tokens, reading.period);
    const there = estimateCost(rules, args.model, args.tokens, reading.period === "peak" ? "off-peak" : "peak");
    if (here === null || there === null) {
      return { error: `\u672A\u77E5\u6A21\u578B\u300C${args.model}\u300D\u3002\u5185\u7F6E\u4EF7\u76EE\u8868\uFF1A${rules.models.map((model) => model.label).join("\u3001")}\u3002` };
    }
    value.estimate = {
      model: here.label,
      period: here.period,
      periodLabel: periodLabel(here.period),
      cost: here.cost,
      otherCost: there.cost,
      otherPeriodLabel: periodLabel(there.period)
    };
  }
  return value;
}
function apply(ctx, config) {
  const initial = resolveRules(config);
  if (initial.problems.length > 0) {
    throw new Error(`deepseek-peak-pricing: invalid rules
- ${initial.problems.join("\n- ")}`);
  }
  const overrides = config;
  ctx.tools.register(defineTool({
    name: "deepseek_pricing_status",
    description: 'Report whether DeepSeek API requests bill at the peak (\u9AD8\u5CF0) or off-peak (\u7A7A\u95F2/\u8C37\u65F6) rate, when the rate changes next, how each day divides between the two prices, the upcoming peak/off-peak timeline, and the current CNY-per-million-token price of each model. Optionally inspect a future or past instant ("2026-10-12 10:00"), or price a token mix to compare running now against waiting for the cheap window. Call it before reasoning about cost, batch size, or scheduling non-urgent work: off-peak is exactly half price. The answer is computed from the published rule (Beijing time, Mon-Fri 09:00-12:00 and 14:00-18:00 excluding China statutory holidays; weekends and holidays are off-peak all day, and \u8C03\u4F11\u4E0A\u73ED\u7684\u5468\u672B stay off-peak too).',
    parameters: {
      at: {
        type: "string",
        description: 'Instant to inspect, in Beijing terms: "2026-10-12", "2026-10-12 10:00", "10:00" (today), or an ISO 8601 string with an offset. Omit for now.'
      },
      switches: {
        type: "integer",
        description: `How many upcoming stretches to list, including the current one (1-${MAX_SWITCH_COUNT}, default ${DEFAULT_SWITCH_COUNT}).`
      },
      model: {
        type: "string",
        description: 'Model to price the supplied token counts with, e.g. "deepseek-flash". Required together with `tokens`.'
      },
      tokens: {
        type: "object",
        additionalProperties: false,
        description: "Token counts to price at the reported period, with the same mix priced at the other period for comparison.",
        properties: {
          cacheHit: { type: "number", description: "Input tokens served from the context cache." },
          cacheMiss: { type: "number", description: "Input tokens that missed the context cache." },
          output: { type: "number", description: "Generated output tokens." }
        }
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          period: { type: "string", required: true, enum: ["peak", "off-peak"] },
          beijingTime: { type: "string", required: true },
          periodLabel: { type: "string", required: true },
          dayKind: { type: "string", required: true, enum: ["holiday", "weekend", "workday"] },
          holiday: { type: "string" },
          makeupWorkday: { type: "boolean", required: true },
          msUntilSwitch: { type: "integer", required: true },
          countdown: { type: "string", required: true },
          nextPeriod: { type: "string", required: true, enum: ["peak", "off-peak", "none"] },
          nextReason: { type: "string", required: true },
          dayLoad: {
            type: "object",
            required: true,
            additionalProperties: false,
            properties: {
              peakMinutes: { type: "integer", required: true },
              offPeakMinutes: { type: "integer", required: true }
            }
          },
          switches: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                beijingTime: { type: "string", required: true },
                period: { type: "string", required: true, enum: ["peak", "off-peak"] },
                periodLabel: { type: "string", required: true },
                reason: { type: "string", required: true },
                span: { type: "string", required: true },
                until: { required: true, oneOf: [{ type: "string" }, { type: "null" }] }
              }
            }
          },
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
          estimate: {
            type: "object",
            additionalProperties: false,
            properties: {
              model: { type: "string", required: true },
              period: { type: "string", required: true, enum: ["peak", "off-peak"] },
              periodLabel: { type: "string", required: true },
              cost: { type: "number", required: true },
              otherCost: { type: "number", required: true },
              otherPeriodLabel: { type: "string", required: true }
            }
          },
          rule: { type: "string", required: true }
        }
      },
      // The reading is computed once, in execute; render only formats it.
      render: (_args, value) => [{ type: "text", text: renderStatus(value) }]
    },
    execute(args) {
      const result = answer(overrides, args, /* @__PURE__ */ new Date());
      if ("error" in result) throw new Error(result.error);
      return Promise.resolve(result);
    },
    presentCall: () => ({ card: "generic", title: "\u67E5\u8BE2 DeepSeek \u5CF0\u8C37\u8BA1\u8D39", kind: "other" })
  }));
  ctx.inject(["commands"], (scope) => {
    const commands = scope.commands;
    commands.register({
      name: "pricing",
      description: "\u67E5\u770B DeepSeek API \u5F53\u524D\u5CF0/\u8C37\u8BA1\u4EF7\u3001\u4E0B\u4E00\u6B21\u5207\u6362\u4E0E\u5355\u4EF7\u8868",
      input: { hint: "[\u5317\u4EAC\u65F6\u95F4\uFF0C\u53EF\u7559\u7A7A\uFF0C\u5982 2026-10-12 10:00]" },
      handler: (invocation) => {
        const result = answer(overrides, { at: invocation.rawInput, switches: DEFAULT_SWITCH_COUNT }, /* @__PURE__ */ new Date());
        return "error" in result ? { kind: "error", text: result.error } : { kind: "success", text: renderStatus(result) };
      }
    });
  });
}
export {
  Config,
  apply,
  inject,
  name
};
