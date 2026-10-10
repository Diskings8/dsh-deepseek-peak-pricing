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
var BEIJING_OFFSET_MS = 8 * 60 * 60 * 1e3;
var MS_PER_DAY = 24 * 60 * 60 * 1e3;
var SEARCH_DAYS = 8;
function beijingClock(instant) {
  const shifted = new Date(instant.getTime() + BEIJING_OFFSET_MS);
  const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  return { date, minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}
function pad(value) {
  return value < 10 ? `0${value}` : String(value);
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
    if (period !== previous) {
      return { at: candidate, period, reason: describeSwitch(rules, candidate, period) };
    }
    previous = period;
  }
  return null;
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
function formatBeijingTime(instant) {
  const { date, minuteOfDay } = beijingClock(instant);
  const shifted = new Date(instant.getTime() + BEIJING_OFFSET_MS);
  return `${date} ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:${pad(shifted.getUTCSeconds())}`;
}
function ratesFor(rules, model, period) {
  const entry = rules.models.find((item) => item.model === model || item.label === model);
  if (entry === void 0) return null;
  return { model: entry.model, label: entry.label, ...period === "peak" ? entry.peak : entry.offPeak };
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
export {
  DEFAULT_PEAK_WINDOWS,
  DEFAULT_RULES,
  HOLIDAYS_2026,
  MAKEUP_WORKDAYS_2026,
  MODELS,
  breakdown,
  classifyDay,
  formatBeijingTime,
  formatCountdown,
  isMakeupWorkday,
  nextSwitch,
  periodAt,
  ratesFor,
  validateRules
};
