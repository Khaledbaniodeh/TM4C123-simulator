/*
 * LCD1602 (HD44780) tests.
 *
 *   - controller: instruction set, addressing, CGRAM, timing checks
 *   - binding: which GPIOs reach the LCD through the wired diagram (D-024)
 *   - execution: real Experiment 8 firmware on Renode; every character on the
 *     display is reconstructed from the GPIO model's pin events
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { EXECUTION_NS, Hd44780, POWER_ON_DELAY_NS, romCharacter } from "../apps/web/workspace/hd44780.js";
import { LcdSimulation, bindLcd } from "../apps/web/workspace/lcd.js";
import { parseDiagram } from "../apps/web/workspace/diagram.js";
import { CATALOG } from "../apps/web/workspace/parts.js";
import { repoRoot } from "../scripts/lib/tools.mjs";
import { MS, exampleSource, withFirmware } from "./helpers.js";

const US = 1_000n;

/** Drives a controller over a 4-bit bus like firmware would: two strobes per byte. */
class Bus {
  constructor(lcd, startNs = POWER_ON_DELAY_NS + MS) {
    this.lcd = lcd;
    this.t = startNs;
  }

  nibble(rs, nibble, gapNs = 100n * US) {
    this.lcd.latch({ rs, rw: 0, data: (nibble & 0xf) << 4 }, this.t);
    this.t += gapNs;
  }

  byte(rs, value, gapNs = 100n * US) {
    this.nibble(rs, value >> 4, 1n * US);
    this.nibble(rs, value, gapNs);
  }

  command(value) {
    this.byte(0, value, value <= 0x03 ? 2n * MS : 100n * US);
  }

  text(string) {
    for (const ch of string) {
      this.byte(1, ch.charCodeAt(0));
    }
  }

  init4() {
    for (const nibble of [0x3, 0x3, 0x3, 0x2]) {
      this.nibble(0, nibble, 5n * MS);
    }
    for (const command of [0x28, 0x08, 0x01, 0x06, 0x0c]) {
      this.command(command);
    }
  }
}

async function exampleDiagram(id) {
  const text = await readFile(path.join(repoRoot, "examples", id, "diagram.json"), "utf8");
  const { diagram, errors } = parseDiagram(text, CATALOG);
  assert.deepEqual(errors, []);
  return diagram;
}

describe("HD44780 controller", () => {
  it("starts in the power-on reset state: 8-bit, 1 line, display off, blank", () => {
    const snapshot = new Hd44780().snapshot();
    assert.deepEqual(snapshot.mode, { bits: 8, lines: 1, font: "5x8" });
    assert.equal(snapshot.displayOn, false);
    assert.deepEqual(snapshot.rows, [" ".repeat(16), " ".repeat(16)]);
    assert.equal(snapshot.cursor, null);
  });

  it("initializes 4-bit mode by instruction and writes both lines", () => {
    const lcd = new Hd44780();
    const bus = new Bus(lcd);
    bus.init4();
    bus.command(0x80);
    bus.text("Hello");
    bus.command(0xc0 + 3);
    bus.text("world");
    const snapshot = lcd.snapshot();
    assert.deepEqual(snapshot.mode, { bits: 4, lines: 2, font: "5x8" });
    assert.equal(snapshot.displayOn, true);
    assert.deepEqual(snapshot.rows, ["Hello           ", "   world        "]);
    assert.deepEqual(snapshot.warnings, []);
  });

  it("wraps the address counter from the end of line 1 (0x27) to line 2 (0x40)", () => {
    const lcd = new Hd44780();
    const bus = new Bus(lcd);
    bus.init4();
    bus.command(0x80 + 0x27);
    bus.text("AB");
    // 'A' at 0x27 is off screen (column 39); 'B' lands at 0x40 = line 2, column 0.
    assert.equal(lcd.snapshot().rows[1][0], "B");
  });

  it("shifts the display and moves the cursor", () => {
    const lcd = new Hd44780();
    const bus = new Bus(lcd);
    bus.init4();
    bus.command(0x0e); // display on, underline cursor
    bus.text("ABC");
    assert.deepEqual(lcd.snapshot().cursor, { row: 0, column: 3, underline: true, blink: false });
    bus.command(0x18); // shift display left
    assert.equal(lcd.snapshot().rows[0].slice(0, 2), "BC");
    bus.command(0x1c); // shift display right
    assert.equal(lcd.snapshot().rows[0].slice(0, 3), "ABC");
    bus.command(0x10); // cursor left
    assert.equal(lcd.snapshot().cursor.column, 2);
  });

  it("supports decrement entry mode and shift-on-write", () => {
    const lcd = new Hd44780();
    const bus = new Bus(lcd);
    bus.init4();
    bus.command(0x04); // decrement, no shift
    bus.command(0x80 + 4);
    bus.text("abc");
    assert.equal(lcd.snapshot().rows[0].slice(0, 5), "  cba");
    bus.command(0x01);
    bus.command(0x07); // increment + shift display on write
    bus.command(0x80 + 15);
    bus.text("xy");
    // Each write shifts the window left by one: 'x' and 'y' stay at the right edge.
    assert.equal(lcd.snapshot().rows[0].slice(13), "xy ");
  });

  it("stores custom characters in CGRAM and displays them from DDRAM codes 0-7", () => {
    const lcd = new Hd44780();
    const bus = new Bus(lcd);
    bus.init4();
    const glyph = [0x00, 0x0a, 0x1f, 0x1f, 0x1f, 0x0e, 0x04, 0x00];
    bus.command(0x40 + 8); // character 1
    for (const row of glyph) {
      bus.byte(1, row | 0xe0); // only the low 5 bits are stored
    }
    bus.command(0x80);
    bus.byte(1, 0x01);
    bus.byte(1, 0x09); // 0x08-0x0F mirror 0x00-0x07
    const snapshot = lcd.snapshot();
    assert.deepEqual(snapshot.cgram[1], glyph);
    assert.equal(snapshot.cells[0][0].custom, 1);
    assert.equal(snapshot.cells[0][1].custom, 1);
    assert.equal(snapshot.rows[0][0], "□");
  });

  it("clear and return home reset the address and the shift", () => {
    const lcd = new Hd44780();
    const bus = new Bus(lcd);
    bus.init4();
    bus.text("abcdef");
    bus.command(0x18);
    bus.command(0x02);
    bus.text("Z");
    assert.equal(lcd.snapshot().rows[0].slice(0, 2), "Zb");
    bus.command(0x01);
    assert.equal(lcd.snapshot().rows[0], " ".repeat(16));
  });

  it("reports an instruction sent while the previous one is still executing", () => {
    const lcd = new Hd44780();
    const bus = new Bus(lcd);
    bus.init4();
    bus.byte(0, 0x01, 200n * US); // clear needs 1.52 ms
    bus.text("x");
    const busy = lcd.snapshot().warnings.filter((w) => w.kind === "busy");
    assert.equal(busy.length, 1);
    assert.match(busy[0].detail, /1\.\d\d ms|\d+\.\d µs/);
    assert.equal(EXECUTION_NS.clearOrHome, 1_520_000n);
  });

  it("reports writes during the power-on delay", () => {
    const lcd = new Hd44780();
    const bus = new Bus(lcd, 1n * MS);
    bus.nibble(0, 0x3);
    assert.equal(lcd.snapshot().warnings[0].kind, "busy");
  });

  it("does not model reads: an RW = 1 strobe is reported", () => {
    const lcd = new Hd44780();
    lcd.latch({ rs: 0, rw: 1, data: 0 }, POWER_ON_DELAY_NS + MS);
    assert.equal(lcd.snapshot().warnings[0].kind, "read-not-modeled");
  });

  it("maps the A00 character ROM", () => {
    assert.equal(romCharacter(0x41), "A");
    assert.equal(romCharacter(0x5c), "¥");
    assert.equal(romCharacter(0x7e), "→");
    assert.equal(romCharacter(0xb1), "ｱ");
    assert.equal(romCharacter(0x03), null);
    assert.equal(romCharacter(0x90), " ");
  });
});

describe("LCD binding", () => {
  it("binds the Experiment 8 wiring as a powered 4-bit interface with RW tied to GND (D-024)", async () => {
    const binding = bindLcd(await exampleDiagram("lcd1602-hello"), CATALOG, "lcd1");
    assert.deepEqual(binding.errors, []);
    assert.equal(binding.powered, true);
    assert.equal(binding.backlight, true);
    assert.equal(binding.interface, "4-bit");
    assert.deepEqual(binding.signals.RS.gpios, ["PB0"]);
    assert.deepEqual(binding.signals.E.gpios, ["PB2"]);
    assert.deepEqual(binding.signals.RW.gpios, ["PB1"]);
    assert.equal(binding.signals.RW.low, true);
    assert.deepEqual(binding.signals.D4.gpios, ["PB4"]);
    // R9/R10 short PB6-PD0 and PB7-PD1 on the LaunchPad.
    assert.deepEqual([...binding.signals.D6.gpios].sort(), ["PB6", "PD0"]);
    assert.deepEqual([...binding.signals.D7.gpios].sort(), ["PB7", "PD1"]);
    assert.ok(binding.notes.some((note) => /D-024/.test(note)));
  });

  it("reports an unpowered or incompletely wired LCD", async () => {
    const diagram = await exampleDiagram("lcd1602-hello");
    const unpowered = { ...diagram, connections: diagram.connections.filter((c) => !c.includes("lcd1:VDD")) };
    assert.equal(bindLcd(unpowered, CATALOG, "lcd1").powered, false);
    const noEnable = { ...diagram, connections: diagram.connections.filter((c) => !c.includes("lcd1:E")) };
    const binding = bindLcd(noEnable, CATALOG, "lcd1");
    assert.equal(binding.interface, "incomplete");
    assert.ok(binding.errors.some((error) => /RS, E, and D4-D7/.test(error)));
  });
});

/** Runs firmware with the LCD wired as in the example diagram, mirroring the workspace's GND tie on RW. */
async function runLcdFirmware(source, steps) {
  const diagram = await exampleDiagram("lcd1602-hello");
  return withFirmware(source, async (session) => {
    await session.setExternalInput("B", 1, false); // RW net is tied to GND (D-024)
    const lcd = new LcdSimulation(bindLcd(diagram, CATALOG, "lcd1"));
    let fed = 0;
    const feed = () => {
      for (; fed < session.events.length; fed++) {
        lcd.handleEvent(session.events[fed]);
      }
    };
    return steps({ session, lcd, feed });
  });
}

describe("execution: Experiment 8 LCD1602", { timeout: 600_000 }, () => {
  it("L: firmware writes the greeting, a CGRAM heart, and a counter through Port B", async () => {
    await runLcdFirmware(await exampleSource("lcd1602-hello"), async ({ session, lcd, feed }) => {
      await session.runFor(700n * MS);
      feed();
      const first = lcd.snapshot();
      assert.deepEqual(first.warnings, [], JSON.stringify(first.warnings));
      assert.equal(first.undefinedStrobes, 0);
      assert.deepEqual(first.mode, { bits: 4, lines: 2, font: "5x8" });
      assert.equal(first.rows[0], "Hello, TM4C123! ");
      assert.match(first.rows[1], /^LCD1602 □ n=\d {3}$/);
      assert.equal(first.cells[1][8].custom, 0);
      assert.deepEqual(first.cgram[0], [0x00, 0x0a, 0x1f, 0x1f, 0x1f, 0x0e, 0x04, 0x00]);
      assert.equal(first.cursor, null, "display on, cursor off");

      // RW (PB1) is driven LOW by firmware and tied to GND: no conflict.
      assert.equal(await session.pinState("B", 1), "low");
      assert.equal(session.events.filter((e) => /unsupported|bus-fault|cpu-fault/.test(e.type)).length, 0);

      const before = Number(first.rows[1][12]);
      await session.runFor(400n * MS);
      feed();
      const after = Number(lcd.snapshot().rows[1][12]);
      assert.equal(after, (before + 2) % 10, "the counter advances every 200 ms");
    });
  });

  it("pin changes of one register write arrive as one group (update / updateSize)", async () => {
    await runLcdFirmware(await exampleSource("lcd1602-hello"), async ({ session }) => {
      await session.runFor(100n * MS);
      const portB = session.events.filter((e) => e.type === "digital-pin-changed" && e.pin.pinId.startsWith("PB"));
      const groups = new Map();
      for (const event of portB) {
        const group = groups.get(event.update) ?? [];
        group.push(event);
        groups.set(event.update, group);
      }
      assert.ok(groups.size > 30);
      for (const group of groups.values()) {
        assert.equal(group.length, group[0].updateSize);
        assert.deepEqual(group.map((e) => e.updateIndex), group.map((_, i) => i));
        assert.ok(group.every((e) => e.virtualTimeNs === group[0].virtualTimeNs));
      }
      // The init writes DIR/DEN for 7 pins at once; a data nibble changes several data lines together.
      assert.ok([...groups.values()].some((group) => group.length >= 2));
    });
  });

  it("too short a delay after clear is reported as a timing warning", async () => {
    const source = (await exampleSource("lcd1602-hello")).replace("delay_us(command <= 0x03u ? 2000u : 50u);", "delay_us(50u);");
    await runLcdFirmware(source, async ({ session, lcd, feed }) => {
      await session.runFor(200n * MS);
      feed();
      const busy = lcd.snapshot().warnings.filter((w) => w.kind === "busy");
      assert.ok(busy.length >= 1, "expected a busy warning");
      assert.match(busy[0].detail, /instruction 0x01/);
    });
  });

  it("D-024: driving RW (PB1) HIGH against the GND tie is a pin conflict", async () => {
    // Every transfer drives RW HIGH (a "read" wiring mistake) while the circuit ties RW to GND.
    const source = (await exampleSource("lcd1602-hello")).replace("& LCD_DATA) | rs;", "& LCD_DATA) | rs | LCD_RW;");
    assert.match(source, /\| rs \| LCD_RW;/);
    await runLcdFirmware(source, async ({ session, lcd, feed }) => {
      await session.runFor(300n * MS);
      feed();
      assert.equal(await session.pinState("B", 1), "conflict");
      assert.ok(session.events.some((e) => e.type === "digital-pin-changed" && e.pin.pinId === "PB1" && e.drive === "conflict"));
      assert.ok(lcd.snapshot().undefinedStrobes > 0, "strobes with a contended RW line are counted");
    });
  });
});
