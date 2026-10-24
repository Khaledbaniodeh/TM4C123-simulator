/*
 * Console messages: a bounded log with severity, source category, repeat
 * counts, and the rows a view shows for a filter. Pure (no DOM), so it is
 * unit-tested in Node; app.js renders the rows.
 *
 * Rules:
 *   - Errors are always shown: no level, source, or text filter hides one,
 *     and when the log is full it drops the oldest message that is not an
 *     error (an error only when nothing else is left).
 *   - An identical message right after itself is counted (×N), not repeated.
 *   - The compact view folds consecutive GPIO pin changes into one row; the
 *     detailed view shows every change.
 */

export const LEVELS = Object.freeze(["error", "warning", "success", "info"]);

/** Message sources, in the order the source menu lists them. */
export const CATEGORIES = Object.freeze({
  build: "Build",
  run: "Simulation",
  gpio: "GPIO pins",
  peripheral: "Peripherals",
  input: "Inputs",
  workspace: "Workspace",
  system: "System",
});

export const DEFAULT_FILTER = Object.freeze({ levels: new Set(["warning", "success", "info"]), category: "all", text: "", view: "compact" });

export class ConsoleLog {
  #entries = [];
  #nextId = 1;
  #dropped = 0;
  #capacity;

  /** Keeps at most `capacity` messages. */
  constructor({ capacity = 5000 } = {}) {
    this.#capacity = capacity;
  }

  get entries() {
    return this.#entries;
  }

  /** Messages no longer kept (the oldest ones beyond capacity). */
  get dropped() {
    return this.#dropped;
  }

  get errorCount() {
    return this.#entries.reduce((sum, entry) => sum + (entry.level === "error" ? entry.count : 0), 0);
  }

  /**
   * Adds a message: { level, category, message, time (virtual ns, optional),
   * key (what it is about, e.g. a pin), details (extra lines, e.g. compiler
   * output) }. Returns the entry, which is the previous one with its count
   * raised when the message repeats it.
   */
  add({ level = "info", category = "system", message, time, key = null, details = null }) {
    const last = this.#entries.at(-1);
    if (last && !details && !last.details && last.level === level && last.category === category && last.message === message) {
      last.count += 1;
      last.time = time ?? last.time;
      return last;
    }
    const entry = { id: this.#nextId++, level, category, message: String(message), time, key, details, count: 1 };
    this.#entries.push(entry);
    this.#trim();
    return entry;
  }

  clear() {
    this.#entries = [];
    this.#dropped = 0;
  }

  #trim() {
    while (this.#entries.length > this.#capacity) {
      const index = this.#entries.findIndex((entry) => entry.level !== "error");
      const [removed] = this.#entries.splice(Math.max(0, index), 1);
      this.#dropped += removed.count;
    }
  }
}

function matches(entry, text) {
  if (!text) {
    return true;
  }
  const needle = text.toLowerCase();
  return entry.message.toLowerCase().includes(needle) || (entry.details ?? []).some((line) => line.toLowerCase().includes(needle));
}

/** "PB0–PB3, PF1" style list of the pins in a run of GPIO changes (at most `max`, then "…"). */
function pinList(entries, max = 6) {
  const pins = [...new Set(entries.map((entry) => entry.key).filter(Boolean))];
  return pins.length > max ? `${pins.slice(0, max).join(", ")}, …` : pins.join(", ");
}

/**
 * The rows a view shows: { rows, hidden, truncated }. A row is
 * { key, level, category, message, time, count, grouped, details, entries }:
 * `key` stays the same while the row grows, `count` is the repeats of one
 * message or, for a `grouped` row, the GPIO changes folded into it. `hidden` counts messages the filter
 * hides (never errors); `truncated` the rows beyond `limit` left out at the
 * top (the newest rows are kept).
 */
export function consoleRows(entries, filter = DEFAULT_FILTER, limit = 500) {
  const rows = [];
  let hidden = 0;
  for (const entry of entries) {
    const shown = entry.level === "error"
      || (filter.levels.has(entry.level) && (filter.category === "all" || entry.category === filter.category) && matches(entry, filter.text));
    if (!shown) {
      hidden += entry.count;
      continue;
    }
    const last = rows.at(-1);
    if (filter.view === "compact" && entry.category === "gpio" && entry.level !== "error" && last?.category === "gpio" && last.level !== "error") {
      last.entries.push(entry);
      last.grouped = true;
      last.count += entry.count;
      last.time = entry.time ?? last.time;
      last.message = `GPIO: ${last.count} pin changes (${pinList(last.entries)}); latest ${entry.message}`;
      continue;
    }
    rows.push({ key: `r${entry.id}`, level: entry.level, category: entry.category, message: entry.message, time: entry.time, count: entry.count, grouped: false, details: entry.details, entries: [entry] });
  }
  const truncated = Math.max(0, rows.length - limit);
  return { rows: truncated ? rows.slice(truncated) : rows, hidden, truncated };
}
