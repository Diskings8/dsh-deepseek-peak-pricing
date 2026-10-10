// src/shared/pricing.ts → lib/shared/pricing.js

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
function beijingDate(instant) {
  return beijingClock(instant).date;
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
  const { hours, minutes, seconds } = breakdown(milliseconds);
  const days = Math.floor(hours / 24);
  const clock = `${pad(hours % 24)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}\u5929${clock}` : hours > 0 ? clock : `${pad(minutes)}:${pad(seconds)}`;
}
function formatSpan(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 6e4));
  const days = Math.floor(total / 1440);
  const hours = Math.floor(total % 1440 / 60);
  const minutes = total % 60;
  const parts = [];
  if (days > 0) parts.push(`${days} \u5929`);
  if (hours > 0) parts.push(`${hours} \u5C0F\u65F6`);
  if (minutes > 0) parts.push(`${minutes} \u5206\u949F`);
  return parts.length === 0 ? "\u4E0D\u5230 1 \u5206\u949F" : parts.join(" ");
}
function formatBeijingTime(instant) {
  const { date, minuteOfDay, second } = beijingClock(instant);
  return `${date} ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:${pad(second)}`;
}
function formatBeijingClock(instant) {
  return formatBeijingTime(instant).slice(5);
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
export {
  DEFAULT_NOTIFY_ON_SWITCH,
  DEFAULT_PEAK_WINDOWS,
  DEFAULT_REMIND_BEFORE_PEAK_MINUTES,
  DEFAULT_RULES,
  HOLIDAYS_2026,
  MAKEUP_WORKDAYS_2026,
  MODELS,
  beijingDate,
  breakdown,
  classifyDay,
  dayLoad,
  estimateCost,
  formatBeijingClock,
  formatBeijingTime,
  formatCountdown,
  formatSpan,
  holidayOn,
  isMakeupWorkday,
  live,
  nextSwitch,
  parseBeijingMoment,
  periodAt,
  ratesFor,
  read,
  resolveRules,
  schedule,
  validateRules
};
