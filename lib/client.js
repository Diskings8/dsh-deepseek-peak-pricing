window.__ModuleLoader__.load({ id: "dsh-deepseek-peak-pricing", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
// src/client/index.tsx → lib/client.js
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  CONFIG_CSS: () => CONFIG_CSS,
  DEFAULT_RULES: () => DEFAULT_RULES,
  INITIAL_NOTICE_STATE: () => INITIAL_NOTICE_STATE,
  NOTICE_CSS: () => NOTICE_CSS,
  NOTICE_TTL_MS: () => NOTICE_TTL_MS,
  NoticeCard: () => NoticeCard,
  PILL_CSS: () => PILL_CSS,
  PeakPricingPanel: () => PeakPricingPanel,
  PeakPricingPill: () => PeakPricingPill,
  PricingConfigPage: () => PricingConfigPage,
  ROW_CONFIG_KEY: () => ROW_CONFIG_KEY,
  SETTINGS_NAMESPACE: () => SETTINGS_NAMESPACE,
  SwitchNotice: () => SwitchNotice,
  advanceNotice: () => advanceNotice,
  apply: () => apply,
  applyClientSettings: () => applyClientSettings,
  classifyDay: () => classifyDay2,
  createStore: () => createStore,
  draftFromValue: () => draftFromValue,
  draftToOps: () => draftToOps,
  formatBeijingClock: () => formatBeijingClock,
  formatCountdown: () => formatCountdown,
  formatSpan: () => formatSpan,
  inject: () => inject,
  liveSettings: () => liveSettings,
  nextSwitch: () => nextSwitch2,
  periodAt: () => periodAt2,
  read: () => read2,
  schedule: () => schedule2,
  validateDraft: () => validateDraft,
  watchSettings: () => watchSettings
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");

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
  return rules.peakWindows.some((window2) => minuteOfDay >= window2.startMinute && minuteOfDay < window2.endMinute) ? "peak" : "off-peak";
}
function candidateBoundaries(rules, from) {
  const { date } = beijingClock(from);
  const midnightUtc = beijingInstant(date).getTime();
  const edges = /* @__PURE__ */ new Set();
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const dayStart = midnightUtc + offset * MS_PER_DAY;
    edges.add(dayStart);
    for (const window2 of rules.peakWindows) {
      edges.add(dayStart + window2.startMinute * MS_PER_MINUTE);
      edges.add(dayStart + window2.endMinute * MS_PER_MINUTE);
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
  const sorted = windows.map((window2) => [Math.max(0, window2.startMinute), Math.min(1440, window2.endMinute)]).filter(([start, end]) => start < end).sort((left, right) => left[0] - right[0]);
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
function formatBeijingClock(instant) {
  return formatBeijingTime(instant).slice(5);
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
  for (const window2 of rules.peakWindows) {
    if (!Number.isFinite(window2.startMinute) || !Number.isFinite(window2.endMinute) || window2.startMinute < 0 || window2.endMinute > 1440 || window2.startMinute >= window2.endMinute) {
      problems.push(`peakWindow ${window2.startMinute}-${window2.endMinute} is not a valid half-open minute range`);
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

// src/client/index.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var COMPOSER_DOCK_SLOT = "conversation.composer.dock";
var SHELL_OVERLAY_SLOT = "shell.overlay";
var SETTINGS_NAMESPACE = "deepseek-peak-pricing";
var TIMELINE_LENGTH = 4;
function createStore(initial) {
  let current = initial;
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (value) => {
      if (value === current) return;
      current = value;
      for (const listener of [...listeners]) listener();
    }
  };
}
var BUILT_IN_SETTINGS = {
  rules: DEFAULT_RULES,
  notifyOnSwitch: DEFAULT_NOTIFY_ON_SWITCH,
  remindBeforePeakMinutes: DEFAULT_REMIND_BEFORE_PEAK_MINUTES,
  problems: [],
  source: "built-in"
};
var liveSettings = createStore(BUILT_IN_SETTINGS);
function applyClientSettings(value) {
  if (value === null || typeof value !== "object") return BUILT_IN_SETTINGS;
  const source = value;
  const { rules, problems } = resolveRules(source);
  return {
    rules,
    notifyOnSwitch: typeof source.notifyOnSwitch === "boolean" ? source.notifyOnSwitch : DEFAULT_NOTIFY_ON_SWITCH,
    remindBeforePeakMinutes: typeof source.remindBeforePeakMinutes === "number" && Number.isFinite(source.remindBeforePeakMinutes) && source.remindBeforePeakMinutes >= 0 ? Math.floor(source.remindBeforePeakMinutes) : DEFAULT_REMIND_BEFORE_PEAK_MINUTES,
    problems,
    source: "host"
  };
}
function watchSettings(form) {
  const sync = () => {
    const snapshot = form.getSnapshot();
    liveSettings.set(snapshot?.value === void 0 ? BUILT_IN_SETTINGS : applyClientSettings(snapshot.value));
  };
  sync();
  return form.subscribe(sync);
}
function periodAt2(instant, rules = liveSettings.getSnapshot().rules) {
  return periodAt(rules, instant);
}
function classifyDay2(date, rules = liveSettings.getSnapshot().rules) {
  return classifyDay(rules, date);
}
function nextSwitch2(from, rules = liveSettings.getSnapshot().rules) {
  return nextSwitch(rules, from);
}
function schedule2(from, count, rules = liveSettings.getSnapshot().rules) {
  return schedule(rules, from, count);
}
function read2(now, rules = liveSettings.getSnapshot().rules) {
  const core = read(rules, now);
  return {
    ...core,
    rows: rules.models.map((card) => ({
      model: card.model,
      now: core.period === "peak" ? card.peak : card.offPeak,
      other: core.period === "peak" ? card.offPeak : card.peak,
      period: core.period
    })),
    timeline: schedule(rules, now, TIMELINE_LENGTH + 1).slice(1)
  };
}
var PERIOD_COPY = {
  peak: {
    label: "\u9AD8\u5CF0\u65F6\u6BB5",
    hint: "\u9AD8\u5CF0\u4EF7\u4E3A\u8C37\u65F6\u7684 2 \u500D\uFF0C\u975E\u7D27\u6025\u7684\u6279\u91CF\u8BF7\u6C42\u53EF\u4EE5\u7B49\u5230\u8C37\u65F6\u3002",
    next: "\u8F6C\u5165\u8C37\u65F6"
  },
  "off-peak": {
    label: "\u7A7A\u95F2\u65F6\u6BB5",
    hint: "\u8C37\u65F6\u4E3A\u9AD8\u5CF0\u4EF7\u7684 5 \u6298\uFF0C\u9002\u5408\u8DD1\u6279\u91CF\u4E0E\u957F\u4EFB\u52A1\u3002",
    next: "\u8F6C\u5165\u9AD8\u5CF0"
  }
};
var KIND_COPY = {
  holiday: "\u6CD5\u5B9A\u8282\u5047\u65E5 \xB7 \u5168\u5929\u8C37\u65F6",
  weekend: "\u5468\u672B \xB7 \u5168\u5929\u8C37\u65F6",
  workday: "\u5DE5\u4F5C\u65E5 \xB7 \u4EC5 09:00-12:00\u300114:00-18:00 \u4E3A\u9AD8\u5CF0"
};
function dayCopy(reading) {
  if (!reading.makeupWorkday) return KIND_COPY[reading.kind];
  return `${KIND_COPY[reading.kind]}\uFF08\u4ECA\u5929\u8C03\u4F11\u4E0A\u73ED\uFF0C\u4F46 API \u4ECD\u6309\u5468\u672B\u8BA1\u8D39\uFF09`;
}
function hours(minutes) {
  if (minutes % 60 === 0) return String(minutes / 60);
  return (minutes / 60).toFixed(1);
}
function shortClock(instant) {
  return formatBeijingClock(instant).slice(0, 11);
}
var INITIAL_NOTICE_STATE = { lastPeriod: null, remindedFor: null, active: null };
var NOTICE_TTL_MS = 12e3;
function advanceNotice(rules, state, now, options) {
  const at = now.getTime();
  const stillVisible = state.active !== null && at - state.active.at <= NOTICE_TTL_MS ? state.active : null;
  const period = periodAt(rules, now);
  if (state.lastPeriod === null) return { lastPeriod: period, remindedFor: state.remindedFor, active: stillVisible };
  if (period !== state.lastPeriod) {
    const notice = period === "off-peak" ? {
      id: `switch:${at}`,
      kind: "switch",
      period,
      at,
      title: "\u5DF2\u8FDB\u5165\u8C37\u65F6\uFF08\u9AD8\u5CF0\u4EF7\u7684 5 \u6298\uFF09",
      body: "\u9002\u5408\u8DD1\u6279\u91CF\u4E0E\u957F\u4EFB\u52A1\uFF1B\u5355\u4EF7\u5DF2\u5728\u4E0B\u65B9\u7684\u4EF7\u76EE\u8868\u91CC\u5207\u6362\u3002"
    } : {
      id: `switch:${at}`,
      kind: "switch",
      period,
      at,
      title: "\u5DF2\u8FDB\u5165\u9AD8\u5CF0\u65F6\u6BB5\uFF08\u4EF7\u683C\u4E3A\u8C37\u65F6 2 \u500D\uFF09",
      body: "\u975E\u7D27\u6025\u7684\u6279\u91CF\u8BF7\u6C42\u53EF\u4EE5\u7B49\u5230\u4E0B\u4E00\u6B21\u8C37\u65F6\u3002"
    };
    return { lastPeriod: period, remindedFor: state.remindedFor, active: options.notifyOnSwitch ? notice : stillVisible };
  }
  const lead = options.remindBeforePeakMinutes * 6e4;
  const upcoming = nextSwitch(rules, now);
  const due = upcoming !== null && upcoming.period === "peak" ? upcoming.at.getTime() - at : Number.POSITIVE_INFINITY;
  if (lead > 0 && due >= 0 && due <= lead && state.remindedFor !== upcoming?.at.getTime()) {
    const minutes = Math.max(1, Math.ceil(due / 6e4));
    return {
      lastPeriod: period,
      remindedFor: upcoming === null ? state.remindedFor : upcoming.at.getTime(),
      active: {
        id: `before-peak:${upcoming?.at.getTime() ?? at}`,
        kind: "before-peak",
        period: "peak",
        at,
        title: `${minutes} \u5206\u949F\u540E\u8FDB\u5165\u9AD8\u5CF0`,
        body: "\u9AD8\u5CF0\u4EF7\u4E3A\u8C37\u65F6\u7684 2 \u500D\uFF0C\u957F\u4EFB\u52A1\u8981\u4E48\u73B0\u5728\u8D77\uFF0C\u8981\u4E48\u7B49\u8C37\u65F6\u3002"
      }
    };
  }
  return { lastPeriod: period, remindedFor: state.remindedFor, active: stillVisible };
}
var PILL_CSS = `
.dspp-root { position: relative; display: inline-flex; min-width: 0;
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px)); }
.dspp-pill { display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box;
  max-width: 100%; padding: 1px 8px; border: none; border-radius: 999px;
  corner-shape: round; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-variant-numeric: tabular-nums; line-height: inherit; white-space: nowrap;
  cursor: pointer; }
.dspp-pill:hover, .dspp-pill[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  color: var(--dsw-alias-label-primary); }
.dspp-pill:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
/* The lamp: amber while peak bills, green while off-peak does. The fill follows
   the theme token and falls back to that token's literal value, so the light
   still reads as \u9EC4/\u7EFF if a theme ever drops the alias. The halo is the same
   hue at low opacity, which is what makes it look lit rather than printed. */
.dspp-dot, .dspp-lamp { border-radius: 50%; flex: none; }
.dspp-dot { width: 8px; height: 8px; }
.dspp-lamp { width: 9px; height: 9px; display: inline-block; margin-right: 6px; vertical-align: middle; }
.dspp-root[data-period="peak"] .dspp-dot,
.dspp-panel[data-period="peak"] .dspp-lamp,
.dspp-notice[data-period="peak"] .dspp-lamp {
  background: var(--dsw-alias-state-warn-primary, #f59e0b); box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.22); }
.dspp-root[data-period="off-peak"] .dspp-dot,
.dspp-panel[data-period="off-peak"] .dspp-lamp,
.dspp-notice[data-period="off-peak"] .dspp-lamp {
  background: var(--dsw-alias-state-success-primary, #22c55e); box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.22); }
/* Only the peak label is coloured on the resting pill: the amber is the anomaly
   worth pulling the eye, while the green lamp carries the off-peak reading
   without making the third dock reading louder than its two siblings. */
.dspp-root[data-period="peak"] .dspp-label { color: var(--dsw-alias-state-warn-primary, #f59e0b); font-weight: 600; }
.dspp-count { color: var(--dsw-alias-label-secondary); }
.dspp-panel { position: absolute; left: 50%; transform: translateX(-50%);
  bottom: calc(100% + 10px); z-index: 40;
  width: max-content; max-width: min(380px, calc(100vw - 32px));
  padding: 12px 13px; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 1.5; text-align: left;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22); }
.dspp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.dspp-head strong { font-size: 13px; }
.dspp-clock { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dspp-next { color: var(--dsw-alias-label-secondary); }
.dspp-load { margin-bottom: 10px; color: var(--dsw-alias-label-secondary); }
.dspp-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
.dspp-table th, .dspp-table td { padding: 3px 6px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dspp-table th:first-child, .dspp-table td:first-child { text-align: left; font-variant-numeric: normal; }
.dspp-table thead th { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.dspp-table td.dspp-model { vertical-align: top; padding-top: 4px; }
.dspp-table td.dspp-tag { text-align: left; color: var(--dsw-alias-label-secondary); }
.dspp-table tr + tr td { border-top: 1px solid var(--dsw-alias-border-l1); }
.dspp-table tr.dspp-group td { border-top: 1px solid var(--dsw-alias-border-l1); }
.dspp-table tr.is-current td { color: var(--dsw-alias-brand-primary); font-weight: 600; }
.dspp-section { margin-bottom: 4px; color: var(--dsw-alias-label-secondary); }
.dspp-timeline { margin-bottom: 10px; }
.dspp-timeline-row { display: flex; gap: 8px; justify-content: space-between; }
.dspp-timeline-row span:first-child { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.dspp-timeline-row span:last-child { color: var(--dsw-alias-label-secondary); }
.dspp-note { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; }
.dspp-note b { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dspp-warn { margin-top: 6px; color: var(--dsw-alias-state-warn-primary); }
`;
var NOTICE_CSS = `
.dspp-notice { position: fixed; right: 16px; bottom: 16px; z-index: 60;
  display: flex; align-items: flex-start; gap: 10px;
  max-width: min(320px, calc(100vw - 32px)); padding: 10px 12px; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 1.5; text-align: left;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22); }
.dspp-notice[data-period="peak"] { border-color: var(--dsw-alias-state-warn-primary); }
.dspp-notice strong { display: block; margin-bottom: 2px; font-size: 13px; }
.dspp-notice[data-kind="switch"][data-period="off-peak"] strong { color: var(--dsw-alias-state-success-primary); }
.dspp-notice[data-kind="switch"][data-period="peak"] strong { color: var(--dsw-alias-state-warn-primary); }
.dspp-notice-text > div { color: var(--dsw-alias-label-secondary); }
.dspp-notice-close { flex: none; border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 16px; line-height: 1; padding: 0 2px; }
.dspp-notice-close:hover { color: var(--dsw-alias-label-primary); }
`;
var CONFIG_CSS = `
.dspp-cfg { display: flex; flex-direction: column; gap: 12px; max-width: 640px;
  color: var(--dsw-alias-label-primary); font-size: 13px; text-align: left; }
.dspp-cfg fieldset { margin: 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; }
.dspp-cfg legend { padding: 0 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dspp-cfg-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.dspp-cfg-row:last-child { margin-bottom: 0; }
.dspp-cfg input[type="date"], .dspp-cfg input[type="time"], .dspp-cfg input[type="text"], .dspp-cfg input[type="number"] {
  padding: 4px 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
  background: transparent; color: inherit; font: inherit; }
.dspp-cfg input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dspp-cfg button { padding: 4px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
  background: transparent; color: inherit; font: inherit; cursor: pointer; }
.dspp-cfg button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)); }
.dspp-cfg button:disabled { opacity: 0.5; cursor: not-allowed; }
.dspp-cfg-note { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dspp-cfg-problem { margin: 0; color: var(--dsw-alias-state-warn-primary); font-size: 12px; }
.dspp-cfg-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dspp-cfg-status { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dspp-cfg-grow { flex: 1 1 auto; min-width: 96px; }
.dspp-cfg-check { gap: 6px; }
`;
var CSS = `${PILL_CSS}
${NOTICE_CSS}
${CONFIG_CSS}`;
function PeakPricingPanel({ reading, settings }) {
  const copy = PERIOD_COPY[reading.period];
  const countdown = reading.upcoming === null ? null : formatCountdown(reading.remaining);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-panel", role: "dialog", "aria-label": "DeepSeek API \u5CF0\u8C37\u8BA1\u8D39", "data-period": reading.period, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dspp-lamp", "aria-hidden": true }),
        copy.label
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dspp-clock", children: [
        formatBeijingClock(reading.now),
        " \u5317\u4EAC"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dspp-next", children: reading.upcoming === null ? "\u672A\u6765 8 \u5929\u5185\u6CA1\u6709\u5207\u6362\u3002" : `\u8DDD${copy.next}\uFF08${reading.upcoming.reason}\uFF09\u8FD8\u6709 ${countdown}` }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-load", children: [
      "\u4ECA\u5929\uFF1A\u9AD8\u5CF0 ",
      hours(reading.load.peakMinutes),
      " \u5C0F\u65F6 \xB7 \u8C37\u65F6 ",
      hours(reading.load.offPeakMinutes),
      " \u5C0F\u65F6"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "dspp-table", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u5143 / \u767E\u4E07 tokens" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u65F6\u6BB5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u7F13\u5B58\u547D\u4E2D" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u7F13\u5B58\u672A\u547D\u4E2D" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u8F93\u51FA" })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: reading.rows.map((row) => {
        const columns = [
          { label: "\u8C37\u65F6", active: row.period === "off-peak", rates: row.period === "off-peak" ? row.now : row.other },
          { label: "\u9AD8\u5CF0", active: row.period === "peak", rates: row.period === "peak" ? row.now : row.other }
        ];
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Fragment, { children: columns.map((column, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "tr",
          {
            className: [index === 0 ? "dspp-group" : "", column.active ? "is-current" : ""].join(" ").trim() || void 0,
            children: [
              index === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "dspp-model", rowSpan: 2, children: row.model }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "dspp-tag", children: column.active ? `${column.label} \u2605` : column.label }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: column.rates.cacheHit }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: column.rates.cacheMiss }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: column.rates.output })
            ]
          },
          column.label
        )) }, row.model);
      }) })
    ] }),
    reading.timeline.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-timeline", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dspp-section", children: "\u63A5\u4E0B\u6765" }),
      reading.timeline.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-timeline-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: shortClock(entry.at) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: entry.reason }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatSpan(entry.milliseconds) })
      ] }, entry.at.getTime()))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-note", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: dayCopy(reading) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: copy.hint }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        "\u9AD8\u5CF0\uFF1A\u5468\u4E00\u81F3\u5468\u4E94 09:00-12:00\u300114:00-18:00\uFF08\u5317\u4EAC\u65F6\u95F4\uFF0C\u4E0D\u542B\u4E2D\u56FD\u6CD5\u5B9A\u8282\u5047\u65E5\uFF09\uFF1B \u5176\u4F59\u65F6\u6BB5\u3001\u5468\u672B\u4E0E\u6CD5\u5B9A\u8282\u5047\u65E5\u5168\u5929\u5747\u4E3A\u8C37\u65F6\uFF0C",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u8C03\u4F11\u4E0A\u73ED\u7684\u5468\u672B\u4E5F\u6309\u8C37\u65F6" }),
        "\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: settings.source === "host" ? "\u65E5\u5386\u4E0E\u65F6\u6BB5\u6765\u81EA Host \u7684\u63D2\u4EF6\u914D\u7F6E\uFF08\u5728\u300C\u63D2\u4EF6\u300D\u9875\u91CC\u6539\uFF0C\u6216\u6539 profile \u7684 cordis.patch.yml\uFF09\u3002" : "\u65E5\u5386\u6765\u81EA\u5185\u7F6E\u7684 2026 \u5E74\u8282\u5047\u65E5\uFF08Host \u7684\u63D2\u4EF6\u914D\u7F6E\u672A\u9001\u8FBE\uFF09\u3002" }),
      settings.problems.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-warn", children: [
        "\u914D\u7F6E\u6709\u95EE\u9898\uFF0C\u5DF2\u56DE\u9000\u5230\u5185\u7F6E\u65E5\u5386\uFF1A",
        settings.problems[0]
      ] })
    ] })
  ] });
}
function PeakPricingPill() {
  const settings = (0, import_react.useSyncExternalStore)(liveSettings.subscribe, liveSettings.getSnapshot, liveSettings.getSnapshot);
  const [tick, setTick] = (0, import_react.useState)(() => Date.now());
  const [open, setOpen] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    const timer = window.setInterval(() => {
      setTick(Date.now());
    }, 1e3);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const reading = (0, import_react.useMemo)(() => read2(new Date(tick), settings.rules), [tick, settings.rules]);
  const copy = PERIOD_COPY[reading.period];
  const countdown = reading.upcoming === null ? null : formatCountdown(reading.remaining);
  const toggle = (0, import_react.useCallback)(() => {
    setOpen((value) => !value);
  }, []);
  const onKeyDown = (0, import_react.useCallback)((event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }, []);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dspp-root", "data-period": reading.period, "data-source": settings.source, children: [
    open && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeakPricingPanel, { reading, settings }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: "dspp-pill",
        "aria-expanded": open,
        "aria-haspopup": "dialog",
        "aria-label": `DeepSeek API \u5F53\u524D${copy.label}${countdown === null ? "" : `\uFF0C\u8DDD\u5207\u6362 ${countdown}`}`,
        onClick: toggle,
        onKeyDown,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dspp-dot", "aria-hidden": true }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dspp-label", children: copy.label }),
          countdown !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dspp-count", children: countdown })
        ]
      }
    )
  ] });
}
function NoticeCard({ notice, onDismiss }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-notice", role: "status", "data-kind": notice.kind, "data-period": notice.period, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-notice-text", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dspp-lamp", "aria-hidden": true }),
        notice.title
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: notice.body })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dspp-notice-close", "aria-label": "\u5173\u95ED\u63D0\u9192", onClick: onDismiss, children: "\xD7" })
  ] });
}
function SwitchNotice() {
  const settings = (0, import_react.useSyncExternalStore)(liveSettings.subscribe, liveSettings.getSnapshot, liveSettings.getSnapshot);
  const [state, setState] = (0, import_react.useState)(INITIAL_NOTICE_STATE);
  (0, import_react.useEffect)(() => {
    const tick = () => {
      setState((current) => advanceNotice(
        settings.rules,
        current,
        /* @__PURE__ */ new Date(),
        { notifyOnSwitch: settings.notifyOnSwitch, remindBeforePeakMinutes: settings.remindBeforePeakMinutes }
      ));
    };
    tick();
    const timer = window.setInterval(tick, 1e3);
    return () => {
      window.clearInterval(timer);
    };
  }, [settings]);
  const notice = state.active;
  if (notice === null) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NoticeCard, { notice, onDismiss: () => {
    setState((current) => ({ ...current, active: null }));
  } });
}
var ROW_CONFIG_SLOT = "plugins.row.config";
var PACKAGE_NAME = "dsh-deepseek-peak-pricing";
var ROW_CONFIG_KEY = `${PACKAGE_NAME}#${SETTINGS_NAMESPACE}`;
function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}
function minutesToTime(minutes) {
  const clamped = Math.max(0, Math.min(1439, Math.trunc(minutes)));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}
function timeToMinutes(text) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text.trim());
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}
function holidayList(value) {
  if (!Array.isArray(value)) return void 0;
  const ranges = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const range = entry;
    if (typeof range.start !== "string" || typeof range.end !== "string") continue;
    ranges.push({ start: range.start, end: range.end, name: typeof range.name === "string" ? range.name : "" });
  }
  return ranges;
}
function windowList(value) {
  if (!Array.isArray(value)) return void 0;
  const windows = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const window2 = entry;
    if (typeof window2.startMinute !== "number" || typeof window2.endMinute !== "number") continue;
    windows.push({ startMinute: window2.startMinute, endMinute: window2.endMinute });
  }
  return windows;
}
function dateList(value) {
  if (!Array.isArray(value)) return void 0;
  return value.filter((entry) => typeof entry === "string");
}
function draftFromValue(value) {
  const source = value !== null && typeof value === "object" ? value : {};
  const reminder = source.remindBeforePeakMinutes;
  return {
    holidays: holidayList(source.holidays) ?? HOLIDAYS_2026.map((range) => ({ ...range })),
    makeupWorkdays: dateList(source.makeupWorkdays) ?? [...MAKEUP_WORKDAYS_2026],
    peakWindows: windowList(source.peakWindows) ?? DEFAULT_PEAK_WINDOWS.map((window2) => ({ ...window2 })),
    notifyOnSwitch: typeof source.notifyOnSwitch === "boolean" ? source.notifyOnSwitch : DEFAULT_NOTIFY_ON_SWITCH,
    remindBeforePeakMinutes: typeof reminder === "number" && Number.isFinite(reminder) && reminder >= 0 ? Math.floor(reminder) : DEFAULT_REMIND_BEFORE_PEAK_MINUTES
  };
}
function draftToOps(draft) {
  return [
    { op: "set", path: ["holidays"], value: draft.holidays.map((range) => ({ ...range })) },
    { op: "set", path: ["makeupWorkdays"], value: [...draft.makeupWorkdays] },
    { op: "set", path: ["peakWindows"], value: draft.peakWindows.map((window2) => ({ ...window2 })) },
    { op: "set", path: ["notifyOnSwitch"], value: draft.notifyOnSwitch },
    { op: "set", path: ["remindBeforePeakMinutes"], value: draft.remindBeforePeakMinutes }
  ];
}
function validateDraft(draft) {
  const problems = [...resolveRules(draft).problems];
  if (!Number.isInteger(draft.remindBeforePeakMinutes) || draft.remindBeforePeakMinutes < 0 || draft.remindBeforePeakMinutes > 1440) {
    problems.push("remindBeforePeakMinutes \u5FC5\u987B\u662F 0-1440 \u7684\u6574\u6570");
  }
  return problems;
}
function PricingConfigPage(props) {
  if ((props.view ?? "page") === "summary") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dspp-cfg-note", children: "\u5CF0\u8C37\u65E5\u5386\u3001\u9AD8\u5CF0\u65F6\u6BB5\u4E0E\u5207\u6362\u63D0\u9192\uFF0C\u90FD\u5728\u8FD9\u91CC\u6539\u3002" });
  }
  const form = props.form;
  if (form === void 0 || typeof form.mutate !== "function") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dspp-cfg-note", children: "\u914D\u7F6E\u754C\u9762\u6682\u4E0D\u53EF\u7528\uFF1AHost \u6CA1\u6709\u63D0\u4F9B\u8FD9\u4E2A\u63D2\u4EF6\u7684\u914D\u7F6E\u6295\u5F71\u3002" });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PricingConfigEditor, { form });
}
function PricingConfigEditor({ form }) {
  const state = form.state ?? form.getSnapshot?.() ?? {};
  const [draft, setDraft] = (0, import_react.useState)(() => draftFromValue(state.value));
  const [status, setStatus] = (0, import_react.useState)("idle");
  const seen = (0, import_react.useRef)(state.value);
  (0, import_react.useEffect)(() => {
    if (seen.current === state.value) return;
    seen.current = state.value;
    setDraft(draftFromValue(state.value));
    setStatus("idle");
  }, [state.value]);
  const problems = validateDraft(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFromValue(state.value));
  const writable = state.writable !== false && state.status !== "unavailable";
  const patch = (change) => {
    setDraft((current) => ({ ...current, ...change }));
    setStatus("idle");
  };
  const patchHoliday = (index, change) => {
    patch({ holidays: draft.holidays.map((range, at) => at === index ? { ...range, ...change } : range) });
  };
  const patchWindow = (index, change) => {
    patch({ peakWindows: draft.peakWindows.map((window2, at) => at === index ? { ...window2, ...change } : window2) });
  };
  const save = () => {
    setStatus("saving");
    form.mutate(draftToOps(draft), state.revision).then(
      (ok) => {
        setStatus(ok ? "saved" : "failed");
      },
      () => {
        setStatus("failed");
      }
    );
  };
  const statusText = status === "saving" ? "\u6B63\u5728\u5199\u5165 Host\u2026" : status === "saved" ? "\u5DF2\u4FDD\u5B58\uFF1A\u5DE5\u5177\u3001/pricing \u4E0E\u72B6\u6001\u6761\u5DF2\u6362\u7528\u8FD9\u4EFD\u65E5\u5386\u3002" : status === "failed" ? "\u4FDD\u5B58\u5931\u8D25\uFF1A\u914D\u7F6E\u53EF\u80FD\u5DF2\u88AB\u522B\u5904\u6539\u52A8\uFF0C\u8BF7\u91CD\u65B0\u8F7D\u5165\u540E\u518D\u8BD5\u3002" : !writable ? "\u5F53\u524D profile \u4E0D\u5141\u8BB8\u8868\u5355\u5199\u5165\uFF0C\u8BF7\u76F4\u63A5\u7F16\u8F91 cordis.patch.yml\u3002" : dirty ? "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u3002" : "\u4E0E Host \u5F53\u524D\u914D\u7F6E\u4E00\u81F4\u3002";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-cfg", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dspp-cfg-note", children: "\u8FD9\u91CC\u6539\u7684\u662F Host \u90A3\u4E00\u4EFD\u914D\u7F6E\uFF08\u5199\u8FDB profile \u7684 cordis.patch.yml\uFF09\u3002\u4FDD\u5B58\u540E\u5DE5\u5177\u3001`/pricing` \u4E0E\u72B6\u6001\u6761\u4E00\u8D77\u6362\u65E5\u5386\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: "\u9AD8\u5CF0\u65F6\u6BB5\uFF08\u5317\u4EAC\u65F6\u95F4\uFF0C\u5DE6\u95ED\u53F3\u5F00\uFF09" }),
      draft.peakWindows.map((window2, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-cfg-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "time",
            value: minutesToTime(window2.startMinute),
            "aria-label": `\u7B2C ${index + 1} \u4E2A\u9AD8\u5CF0\u65F6\u6BB5\u7684\u5F00\u59CB\u65F6\u95F4`,
            onChange: (event) => {
              const minutes = timeToMinutes(event.target.value);
              if (minutes !== null) patchWindow(index, { startMinute: minutes });
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u2013" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "time",
            value: minutesToTime(window2.endMinute),
            "aria-label": `\u7B2C ${index + 1} \u4E2A\u9AD8\u5CF0\u65F6\u6BB5\u7684\u7ED3\u675F\u65F6\u95F4`,
            onChange: (event) => {
              const minutes = timeToMinutes(event.target.value);
              if (minutes !== null) patchWindow(index, { endMinute: minutes });
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dspp-cfg-status", children: window2.endMinute > window2.startMinute ? `\u6301\u7EED ${formatSpan((window2.endMinute - window2.startMinute) * 6e4)}` : "\u533A\u95F4\u65E0\u6548" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            disabled: draft.peakWindows.length <= 1,
            onClick: () => {
              patch({ peakWindows: draft.peakWindows.filter((_, at) => at !== index) });
            },
            children: "\u5220\u9664"
          }
        )
      ] }, `window-${index}`)),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          onClick: () => {
            patch({ peakWindows: [...draft.peakWindows, { startMinute: 9 * 60, endMinute: 12 * 60 }] });
          },
          children: "\u6DFB\u52A0\u65F6\u6BB5"
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: "\u6CD5\u5B9A\u8282\u5047\u65E5\uFF08\u542B\u9996\u5C3E\uFF0C\u5168\u5929\u8C37\u65F6\uFF09" }),
      draft.holidays.map((range, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-cfg-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "text",
            className: "dspp-cfg-grow",
            placeholder: "\u540D\u79F0",
            value: range.name,
            "aria-label": `\u7B2C ${index + 1} \u4E2A\u8282\u5047\u65E5\u7684\u540D\u79F0`,
            onChange: (event) => {
              patchHoliday(index, { name: event.target.value });
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "date",
            value: range.start,
            "aria-label": `\u7B2C ${index + 1} \u4E2A\u8282\u5047\u65E5\u7684\u5F00\u59CB\u65E5\u671F`,
            onChange: (event) => {
              patchHoliday(index, { start: event.target.value });
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u2013" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "date",
            value: range.end,
            "aria-label": `\u7B2C ${index + 1} \u4E2A\u8282\u5047\u65E5\u7684\u7ED3\u675F\u65E5\u671F`,
            onChange: (event) => {
              patchHoliday(index, { end: event.target.value });
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            onClick: () => {
              patch({ holidays: draft.holidays.filter((_, at) => at !== index) });
            },
            children: "\u5220\u9664"
          }
        )
      ] }, `holiday-${index}`)),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          onClick: () => {
            patch({ holidays: [...draft.holidays, { start: "", end: "", name: "" }] });
          },
          children: "\u6DFB\u52A0\u8282\u5047\u65E5"
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: "\u8C03\u4F11\u4E0A\u73ED\u65E5\uFF08\u4EC5\u7528\u4E8E\u8BF4\u660E\uFF1A\u8C03\u4F11\u7684\u5468\u672B\u4ECD\u5168\u5929\u8C37\u65F6\uFF09" }),
      draft.makeupWorkdays.map((date, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-cfg-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "date",
            value: date,
            "aria-label": `\u7B2C ${index + 1} \u4E2A\u8C03\u4F11\u4E0A\u73ED\u65E5`,
            onChange: (event) => {
              patch({ makeupWorkdays: draft.makeupWorkdays.map((at, position) => position === index ? event.target.value : at) });
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            onClick: () => {
              patch({ makeupWorkdays: draft.makeupWorkdays.filter((_, at) => at !== index) });
            },
            children: "\u5220\u9664"
          }
        )
      ] }, `makeup-${index}`)),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => {
        patch({ makeupWorkdays: [...draft.makeupWorkdays, ""] });
      }, children: "\u6DFB\u52A0\u8C03\u4F11\u65E5" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: "\u63D0\u9192\uFF08\u4EC5\u72B6\u6001\u6761\u7684\u6D4F\u89C8\u5668\u534A\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dspp-cfg-row dspp-cfg-check", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: draft.notifyOnSwitch,
            onChange: (event) => {
              patch({ notifyOnSwitch: event.target.checked });
            }
          }
        ),
        "\u65F6\u6BB5\u5207\u6362\u65F6\u5F39\u4E00\u6761\u63D0\u9192"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dspp-cfg-row dspp-cfg-check", children: [
        "\u8FDB\u5165\u9AD8\u5CF0\u524D",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "number",
            min: 0,
            max: 120,
            value: draft.remindBeforePeakMinutes,
            "aria-label": "\u8FDB\u5165\u9AD8\u5CF0\u524D\u591A\u5C11\u5206\u949F\u9884\u544A",
            onChange: (event) => {
              patch({ remindBeforePeakMinutes: Number(event.target.value) });
            }
          }
        ),
        "\u5206\u949F\u9884\u544A\u4E00\u6B21\uFF080 = \u4E0D\u9884\u544A\uFF09"
      ] })
    ] }),
    problems.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dspp-cfg-problem", children: [
      "\u8FD8\u4E0D\u80FD\u4FDD\u5B58\uFF1A",
      problems.join("\uFF1B")
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-cfg-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          disabled: !writable || !dirty || problems.length > 0 || status === "saving",
          onClick: save,
          children: status === "saving" ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: !dirty, onClick: () => {
        setDraft(draftFromValue(state.value));
        setStatus("idle");
      }, children: "\u653E\u5F03\u4FEE\u6539" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dspp-cfg-status", children: statusText })
    ] })
  ] });
}
var inject = ["slots"];
function apply(ctx) {
  const slots = ctx.slots;
  const installStyle = () => {
    const target = globalThis.document;
    if (target === void 0) return () => {
    };
    const tag = target.createElement("style");
    tag.dataset.plugin = "dsh-deepseek-peak-pricing";
    tag.textContent = CSS;
    target.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  };
  if (typeof ctx.effect === "function") ctx.effect(installStyle, "deepseek-peak-pricing: stylesheet");
  else installStyle();
  slots.inject(COMPOSER_DOCK_SLOT, () => slots.register({
    name: COMPOSER_DOCK_SLOT,
    id: "deepseek-peak-pricing",
    // After ui-chat's stats entry (order 0), so the strip reads
    // speed · cache hit · period · countdown.
    order: 10
  }, PeakPricingPill));
  slots.inject(SHELL_OVERLAY_SLOT, () => slots.register({
    name: SHELL_OVERLAY_SLOT,
    id: "deepseek-peak-pricing-notice",
    order: 10
  }, SwitchNotice));
  slots.inject(ROW_CONFIG_SLOT, () => slots.register({
    name: ROW_CONFIG_SLOT,
    key: ROW_CONFIG_KEY
  }, PricingConfigPage));
  if (typeof ctx.inject === "function") {
    ctx.inject(["configForms"], (scope) => {
      watchSettings(scope.configForms.get(SETTINGS_NAMESPACE));
    });
  }
}
return module.exports; } });
