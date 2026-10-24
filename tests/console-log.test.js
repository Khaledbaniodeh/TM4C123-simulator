/*
 * Console log model: repeats, bounded memory that keeps errors, filters that
 * never hide errors, and the compact view's folding of GPIO pin changes.
 * Pure module, no browser.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConsoleLog, DEFAULT_FILTER, consoleRows } from "../apps/web/console-log.js";

const filter = (changes) => ({ ...DEFAULT_FILTER, levels: new Set(DEFAULT_FILTER.levels), ...changes });
const pin = (log, name, state, time) => log.add({ level: "info", category: "gpio", key: name, message: `${name} → ${state} (GPIO output)`, time });

describe("console log", () => {
  it("counts a message that repeats itself instead of adding it again", () => {
    const log = new ConsoleLog();
    log.add({ level: "info", category: "input", message: "SW1 pressed", time: 1 });
    log.add({ level: "info", category: "input", message: "SW1 pressed", time: 2 });
    log.add({ level: "info", category: "input", message: "SW1 released", time: 3 });
    log.add({ level: "info", category: "input", message: "SW1 pressed", time: 4 });
    assert.deepEqual(log.entries.map((e) => [e.message, e.count, e.time]), [["SW1 pressed", 2, 2], ["SW1 released", 1, 3], ["SW1 pressed", 1, 4]]);
  });

  it("keeps memory bounded, dropping old messages before any error", () => {
    const log = new ConsoleLog({ capacity: 10 });
    log.add({ level: "error", category: "build", message: "Build failed" });
    for (let i = 0; i < 50; i++) {
      pin(log, "PF1", i % 2 ? "HIGH" : "LOW", i);
    }
    assert.equal(log.entries.length, 10);
    assert.equal(log.entries[0].message, "Build failed", "the old error is still there");
    assert.equal(log.dropped, 41);
    // New errors push out the remaining pin changes first; an error goes only when nothing else is left.
    for (let i = 0; i < 10; i++) {
      log.add({ level: "error", category: "run", message: `fault ${i}` });
    }
    assert.equal(log.entries.length, 10);
    assert.ok(log.entries.every((e) => e.level === "error"));
    assert.deepEqual([log.entries[0].message, log.entries.at(-1).message], ["fault 0", "fault 9"]);
    assert.equal(log.errorCount, 10);
    assert.equal(log.dropped, 51);
    log.clear();
    assert.deepEqual([log.entries.length, log.dropped, log.errorCount], [0, 0, 0]);
  });

  it("never hides an error, whatever the level, source, or text filter", () => {
    const log = new ConsoleLog();
    log.add({ level: "error", category: "build", message: "Build failed: Compilation failed." });
    log.add({ level: "warning", category: "peripheral", message: "UART0 not modeled" });
    log.add({ level: "info", category: "run", message: "CPU running." });
    const shown = (f) => consoleRows(log.entries, filter(f)).rows.map((r) => r.message);
    assert.deepEqual(shown({}), ["Build failed: Compilation failed.", "UART0 not modeled", "CPU running."]);
    assert.deepEqual(shown({ levels: new Set() }), ["Build failed: Compilation failed."]);
    assert.deepEqual(shown({ category: "run" }), ["Build failed: Compilation failed.", "CPU running."]);
    assert.deepEqual(shown({ text: "uart" }), ["Build failed: Compilation failed.", "UART0 not modeled"]);
    assert.equal(consoleRows(log.entries, filter({ levels: new Set() })).hidden, 2);
  });

  it("folds consecutive GPIO changes in the compact view, and shows each in the detailed view", () => {
    const log = new ConsoleLog();
    log.add({ level: "info", category: "run", message: "CPU running." });
    for (const [name, state] of [["PB0", "HIGH"], ["PB1", "LOW"], ["PB0", "LOW"], ["PB2", "HIGH"]]) {
      pin(log, name, state);
    }
    log.add({ level: "warning", category: "peripheral", message: "read of floating input" });
    pin(log, "PF1", "HIGH");
    const compact = consoleRows(log.entries, filter({ view: "compact" })).rows;
    assert.deepEqual(compact.map((r) => [r.message, r.count, r.grouped]), [
      ["CPU running.", 1, false],
      ["GPIO: 4 pin changes (PB0, PB1, PB2); latest PB2 → HIGH (GPIO output)", 4, true],
      ["read of floating input", 1, false],
      ["PF1 → HIGH (GPIO output)", 1, false],
    ]);
    assert.equal(consoleRows(log.entries, filter({ view: "detailed" })).rows.length, 7);
    // A row keeps its key while it grows, so the page can update it in place.
    pin(log, "PF1", "LOW");
    const grown = consoleRows(log.entries, filter({ view: "compact" })).rows;
    assert.equal(grown.at(-1).key, compact.at(-1).key);
    assert.equal(grown.at(-1).count, 2);
  });

  it("shows the newest rows when there are more than the limit", () => {
    const log = new ConsoleLog();
    for (let i = 0; i < 30; i++) {
      log.add({ level: "info", category: "system", message: `message ${i}` });
    }
    const { rows, truncated } = consoleRows(log.entries, filter({}), 10);
    assert.equal(truncated, 20);
    assert.deepEqual([rows[0].message, rows.at(-1).message], ["message 20", "message 29"]);
  });

  it("matches the text filter in a message's details too", () => {
    const log = new ConsoleLog();
    log.add({ level: "warning", category: "build", message: "Build finished with warnings", details: ["main.c:5:9: warning: unused variable 'x'"] });
    assert.equal(consoleRows(log.entries, filter({ text: "unused" })).rows.length, 1);
    assert.equal(consoleRows(log.entries, filter({ text: "nothing" })).rows.length, 0);
  });
});
