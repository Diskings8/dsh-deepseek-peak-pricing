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
  MODELS: () => MODELS,
  PEAK_WINDOWS: () => PEAK_WINDOWS,
  PeakPricingPill: () => PeakPricingPill,
  apply: () => apply,
  classifyDay: () => classifyDay,
  formatBeijingClock: () => formatBeijingClock,
  formatCountdown: () => formatCountdown,
  inject: () => inject,
  nextSwitch: () => nextSwitch,
  periodAt: () => periodAt,
  read: () => read
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var COMPOSER_DOCK_SLOT = "conversation.composer.dock";
var MODELS = [
  { model: "deepseek-flash", peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 }, offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 } },
  { model: "deepseek-v4-pro", peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 }, offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 } }
];
var HOLIDAYS = [
  ["\u5143\u65E6", "2026-01-01", "2026-01-03"],
  ["\u6625\u8282", "2026-02-15", "2026-02-23"],
  ["\u6E05\u660E\u8282", "2026-04-04", "2026-04-06"],
  ["\u52B3\u52A8\u8282", "2026-05-01", "2026-05-05"],
  ["\u7AEF\u5348\u8282", "2026-06-19", "2026-06-21"],
  ["\u4E2D\u79CB\u8282", "2026-09-25", "2026-09-27"],
  ["\u56FD\u5E86\u8282", "2026-10-01", "2026-10-07"]
];
var MAKEUP_WORKDAYS = /* @__PURE__ */ new Set([
  "2026-01-04",
  "2026-02-14",
  "2026-02-28",
  "2026-05-09",
  "2026-09-20",
  "2026-10-10"
]);
var PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];
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
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds()
  };
}
function weekdayOf(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
function holidayOn(date) {
  return HOLIDAYS.find(([, start, end]) => date >= start && date <= end);
}
function classifyDay(date) {
  if (holidayOn(date) !== void 0) return "holiday";
  const weekday = weekdayOf(date);
  return weekday === 0 || weekday === 6 ? "weekend" : "workday";
}
function periodAt(instant) {
  const { date, minuteOfDay } = beijingClock(instant);
  if (classifyDay(date) !== "workday") return "off-peak";
  return PEAK_WINDOWS.some(([start, end]) => minuteOfDay >= start && minuteOfDay < end) ? "peak" : "off-peak";
}
function candidateBoundaries(from) {
  const { date } = beijingClock(from);
  const [year, month, day] = date.split("-").map(Number);
  const midnightUtc = Date.UTC(year, month - 1, day) - BEIJING_OFFSET_MS;
  const edges = /* @__PURE__ */ new Set();
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const dayStart = midnightUtc + offset * MS_PER_DAY;
    edges.add(dayStart);
    for (const [start, end] of PEAK_WINDOWS) {
      edges.add(dayStart + start * 6e4);
      edges.add(dayStart + end * 6e4);
    }
  }
  return [...edges].sort((left, right) => left - right).filter((time) => time >= from.getTime()).map((time) => new Date(time));
}
function describeSwitch(at, period) {
  const { date, minuteOfDay } = beijingClock(at);
  const kind = classifyDay(date);
  if (minuteOfDay === 0) {
    if (kind === "holiday") return `${holidayOn(date)?.[0] ?? "\u6CD5\u5B9A\u8282\u5047\u65E5"}\u5168\u5929\u8C37\u65F6`;
    if (kind === "weekend") return MAKEUP_WORKDAYS.has(date) ? "\u8C03\u4F11\u4E0A\u73ED\u65E5\u4ECD\u6309\u5468\u672B\u5168\u5929\u8C37\u65F6" : "\u5468\u672B\u5168\u5929\u8C37\u65F6";
    return "\u5DE5\u4F5C\u65E5\u5F00\u59CB";
  }
  if (period === "peak") return "\u9AD8\u5CF0\u65F6\u6BB5\u5F00\u59CB";
  return minuteOfDay === 12 * 60 ? "\u5348\u95F4\u8C37\u65F6\u5F00\u59CB" : "\u8C37\u65F6\u5F00\u59CB";
}
function nextSwitch(from) {
  let previous = periodAt(from);
  for (const candidate of candidateBoundaries(from)) {
    const period = periodAt(candidate);
    if (period !== previous) return { at: candidate, period, reason: describeSwitch(candidate, period) };
    previous = period;
  }
  return null;
}
function formatCountdown(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 1e3));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  const days = Math.floor(hours / 24);
  const clock = `${pad(hours % 24)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}\u5929${clock}` : hours > 0 ? clock : `${pad(minutes)}:${pad(seconds)}`;
}
function formatBeijingClock(instant) {
  const { date, minuteOfDay, second } = beijingClock(instant);
  return `${date.slice(5)} ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:${pad(second)}`;
}
var CSS = `
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
.dspp-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dspp-root[data-period="peak"] .dspp-dot { background: var(--dsw-alias-state-warn-primary); }
.dspp-root[data-period="off-peak"] .dspp-dot { background: var(--dsw-alias-state-success-primary); }
.dspp-root[data-period="peak"] .dspp-label { color: var(--dsw-alias-state-warn-primary); font-weight: 600; }
.dspp-count { color: var(--dsw-alias-label-secondary); }
.dspp-panel { position: absolute; left: 50%; transform: translateX(-50%);
  bottom: calc(100% + 10px); z-index: 40;
  width: max-content; max-width: min(340px, calc(100vw - 32px));
  padding: 12px 13px; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  font-size: 12px; line-height: 1.5; text-align: left;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22); }
.dspp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.dspp-head strong { font-size: 13px; }
.dspp-clock { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dspp-next { margin-bottom: 10px; color: var(--dsw-alias-label-secondary); }
.dspp-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
.dspp-table th, .dspp-table td { padding: 3px 6px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dspp-table th:first-child, .dspp-table td:first-child { text-align: left; font-variant-numeric: normal; }
.dspp-table thead th { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.dspp-table tbody tr + tr td { border-top: 1px solid var(--dsw-alias-border-l1); }
.dspp-table td.is-now { font-weight: 600; color: var(--dsw-alias-brand-primary); }
.dspp-note { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; }
.dspp-note b { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dspp-holidays { margin-top: 6px; }
`;
function read(now) {
  const period = periodAt(now);
  const { date } = beijingClock(now);
  const upcoming = nextSwitch(now);
  return {
    now,
    period,
    kind: classifyDay(date),
    makeupWorkday: MAKEUP_WORKDAYS.has(date),
    upcoming,
    remaining: upcoming === null ? 0 : Math.max(0, upcoming.at.getTime() - now.getTime()),
    rows: MODELS.map((card) => ({
      model: card.model,
      now: period === "peak" ? card.peak : card.offPeak,
      other: period === "peak" ? card.offPeak : card.peak
    }))
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
function PeakPricingPill() {
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
  const reading = (0, import_react.useMemo)(() => read(new Date(tick)), [tick]);
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dspp-root", "data-period": reading.period, children: [
    open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-panel", role: "dialog", "aria-label": "DeepSeek API \u5CF0\u8C37\u8BA1\u8D39", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: copy.label }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dspp-clock", children: [
          formatBeijingClock(reading.now),
          " \u5317\u4EAC"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dspp-next", children: reading.upcoming === null ? "\u672A\u6765 8 \u5929\u5185\u6CA1\u6709\u5207\u6362\u3002" : `\u8DDD${copy.next}\uFF08${reading.upcoming.reason}\uFF09\u8FD8\u6709 ${countdown}` }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "dspp-table", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u5143 / \u767E\u4E07 tokens" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u7F13\u5B58\u547D\u4E2D" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u7F13\u5B58\u672A\u547D\u4E2D" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "\u8F93\u51FA" })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: reading.rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.model }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "is-now", children: row.now.cacheHit }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "is-now", children: row.now.cacheMiss }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "is-now", children: row.now.output })
        ] }, row.model)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-note", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: dayCopy(reading) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: copy.hint }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dspp-holidays", children: [
          "\u9AD8\u5CF0\uFF1A\u5468\u4E00\u81F3\u5468\u4E94 09:00-12:00\u300114:00-18:00\uFF08\u5317\u4EAC\u65F6\u95F4\uFF0C\u4E0D\u542B\u4E2D\u56FD\u6CD5\u5B9A\u8282\u5047\u65E5\uFF09\uFF1B \u5176\u4F59\u65F6\u6BB5\u3001\u5468\u672B\u4E0E\u6CD5\u5B9A\u8282\u5047\u65E5\u5168\u5929\u5747\u4E3A\u8C37\u65F6\uFF0C",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "\u8C03\u4F11\u4E0A\u73ED\u7684\u5468\u672B\u4E5F\u6309\u8C37\u65F6" }),
          "\u3002 \u5DF2\u5185\u7F6E 2026 \u5E74\u8282\u5047\u65E5\u4E0E 6 \u4E2A\u8C03\u4F11\u4E0A\u73ED\u65E5\u3002"
        ] })
      ] })
    ] }),
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
}
return module.exports; } });
