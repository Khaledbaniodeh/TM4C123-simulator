/*
 * HD44780-compatible character LCD controller (LCD1602 module).
 *
 * Original implementation of the controller behavior documented in the
 * Hitachi HD44780U data sheet (instruction set, DDRAM/CGRAM addressing,
 * 4/8-bit interface, execution times at fOSC = 270 kHz). Pure module, no DOM:
 * the browser and the Node tests use the same code.
 *
 * Input: one call to `latch()` per falling edge of E, with the levels of RS,
 * RW, and DB0-DB7 at that moment, and the virtual time. The simulator derives
 * those from real GPIO events produced by the firmware (see lcd.js).
 *
 * Modeled: power-on reset state, 8-bit and 4-bit transfers (nibble pairing),
 * every write instruction, DDRAM in 1- and 2-line mode with display shift,
 * CGRAM (8 custom 5x8 characters), cursor/blink flags, and execution-time
 * checks: an instruction that arrives while the previous one is still
 * executing is applied but reported as a timing warning (on hardware it may
 * be lost). Not modeled: reads (busy flag, RAM read — RW is tied to GND in
 * the supported wiring, decision D-024), the 5x10 font, contrast and
 * electrical timing below the instruction level (E pulse width, setup/hold).
 */

export const EXECUTION_NS = Object.freeze({
  clearOrHome: 1_520_000n, // 1.52 ms
  default: 37_000n,        // 37 us
});

/** Time after power-on before the controller accepts instructions (data sheet init flow, VCC = 5 V). */
export const POWER_ON_DELAY_NS = 15_000_000n;

const LINE_LENGTH_2 = 40;
const LINE_LENGTH_1 = 80;

function hex(value) {
  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

/**
 * Character for a DDRAM code in the A00 character ROM. Custom characters
 * (0x00-0x0F) return null; the renderer draws them from CGRAM.
 */
export function romCharacter(code) {
  if (code < 0x10) {
    return null;
  }
  if (code === 0x5c) {
    return "¥";
  }
  if (code === 0x7e) {
    return "→";
  }
  if (code === 0x7f) {
    return "←";
  }
  if (code >= 0x20 && code <= 0x7d) {
    return String.fromCharCode(code);
  }
  if (code >= 0xa1 && code <= 0xdf) {
    return String.fromCharCode(0xff61 + (code - 0xa1)); // JIS X 0201 half-width katakana
  }
  if (code >= 0xe0) {
    return "▯"; // A00 symbols and Greek letters: shown as a placeholder glyph
  }
  return " "; // 0x10-0x1F and 0x80-0xA0 are blank in the A00 ROM
}

export class Hd44780 {
  constructor({ powerOnNs = 0n } = {}) {
    this.powerOnNs = BigInt(powerOnNs);
    this.warnings = [];
    this.instructions = 0;
    this.#powerOnReset();
  }

  #powerOnReset() {
    this.eightBit = true;
    this.twoLines = false;
    this.font5x10 = false;
    this.displayOn = false;
    this.cursorOn = false;
    this.blinkOn = false;
    this.increment = true;
    this.shiftOnWrite = false;
    this.ddram = new Uint8Array(LINE_LENGTH_1).fill(0x20);
    this.cgram = new Uint8Array(64);
    this.address = 0;
    this.target = "ddram";
    this.shift = 0;
    this.pendingNibble = null;
    this.busyUntilNs = this.powerOnNs + POWER_ON_DELAY_NS;
    this.busyReason = "power-on initialization";
  }

  #warn(kind, detail, timeNs) {
    // Keep the list bounded; a broken driver can produce thousands.
    if (this.warnings.length < 50) {
      this.warnings.push({ kind, detail, virtualTimeNs: String(timeNs) });
    }
  }

  /**
   * One falling edge of E.
   * @param {{ rs: 0|1, rw: 0|1, data: number }} bus  data = DB7..DB0 as a byte
   * @param {bigint} timeNs virtual time of the edge
   */
  latch({ rs, rw, data }, timeNs) {
    const time = BigInt(timeNs);
    if (rw) {
      this.#warn("read-not-modeled", "E strobed with RW = 1 (read). Reads are not modeled; in the supported wiring RW is tied to GND.", time);
      return;
    }
    if (this.eightBit) {
      this.#execute(rs, data & 0xff, time);
      return;
    }
    const nibble = (data >> 4) & 0x0f;
    if (this.pendingNibble === null) {
      this.pendingNibble = { nibble, rs, timeNs: time };
      return;
    }
    const first = this.pendingNibble;
    this.pendingNibble = null;
    if (first.rs !== rs) {
      this.#warn("rs-changed", `RS changed between the two nibbles of one transfer (${first.rs} then ${rs}).`, time);
    }
    this.#execute(first.rs, (first.nibble << 4) | nibble, first.timeNs);
  }

  #execute(rs, byte, timeNs) {
    this.instructions++;
    if (timeNs < this.busyUntilNs) {
      const early = this.busyUntilNs - timeNs;
      const what = rs ? `data ${hex(byte)}` : `instruction ${hex(byte)}`;
      this.#warn("busy", `${what} sent ${formatNs(early)} before the controller finished ${this.busyReason}. On hardware it may be ignored.`, timeNs);
    }
    let duration = EXECUTION_NS.default;
    let reason;
    if (rs) {
      this.#writeData(byte);
      reason = `writing ${hex(byte)}`;
    } else {
      reason = `instruction ${hex(byte)}`;
      duration = this.#instruction(byte, timeNs);
    }
    this.busyUntilNs = timeNs + duration;
    this.busyReason = reason;
  }

  #instruction(byte, timeNs) {
    if (byte & 0x80) {
      this.target = "ddram";
      this.address = this.#normalizeDdram(byte & 0x7f, timeNs);
    } else if (byte & 0x40) {
      this.target = "cgram";
      this.address = byte & 0x3f;
    } else if (byte & 0x20) {
      this.eightBit = (byte & 0x10) !== 0;
      this.twoLines = (byte & 0x08) !== 0;
      this.font5x10 = (byte & 0x04) !== 0;
      if (this.font5x10 && !this.twoLines) {
        this.#warn("not-modeled", "5x10 dot font selected; characters are drawn with the 5x8 layout.", timeNs);
      }
      if (!this.eightBit) {
        this.pendingNibble = null;
      }
    } else if (byte & 0x10) {
      const displayShift = (byte & 0x08) !== 0;
      const right = (byte & 0x04) !== 0;
      if (displayShift) {
        const length = this.#lineLength();
        this.shift = (this.shift + (right ? -1 : 1) + length) % length;
      } else {
        this.address = this.#step(this.address, right);
      }
    } else if (byte & 0x08) {
      this.displayOn = (byte & 0x04) !== 0;
      this.cursorOn = (byte & 0x02) !== 0;
      this.blinkOn = (byte & 0x01) !== 0;
    } else if (byte & 0x04) {
      this.increment = (byte & 0x02) !== 0;
      this.shiftOnWrite = (byte & 0x01) !== 0;
    } else if (byte & 0x02) {
      this.target = "ddram";
      this.address = 0;
      this.shift = 0;
      return EXECUTION_NS.clearOrHome;
    } else if (byte & 0x01) {
      this.ddram.fill(0x20);
      this.target = "ddram";
      this.address = 0;
      this.shift = 0;
      this.increment = true;
      return EXECUTION_NS.clearOrHome;
    } else {
      this.#warn("invalid-instruction", "Instruction 0x00 has no effect.", timeNs);
    }
    return EXECUTION_NS.default;
  }

  #writeData(byte) {
    if (this.target === "cgram") {
      this.cgram[this.address] = byte & 0x1f;
      this.address = (this.address + (this.increment ? 1 : 63)) & 0x3f;
      return;
    }
    this.ddram[this.#ddramIndex(this.address)] = byte;
    this.address = this.#step(this.address, this.increment);
    if (this.shiftOnWrite) {
      const length = this.#lineLength();
      // I/D = 1 with S = 1 shifts the display to the left (text moves left).
      this.shift = (this.shift + (this.increment ? 1 : -1) + length) % length;
    }
  }

  #lineLength() {
    return this.twoLines ? LINE_LENGTH_2 : LINE_LENGTH_1;
  }

  #normalizeDdram(address, timeNs) {
    if (this.twoLines) {
      if ((address > 0x27 && address < 0x40) || address > 0x67) {
        this.#warn("invalid-address", `DDRAM address ${hex(address)} does not exist in 2-line mode.`, timeNs);
      }
      return address;
    }
    if (address > 0x4f) {
      this.#warn("invalid-address", `DDRAM address ${hex(address)} does not exist in 1-line mode.`, timeNs);
    }
    return address;
  }

  #ddramIndex(address) {
    if (this.twoLines) {
      const line = address >= 0x40 ? 1 : 0;
      return line * LINE_LENGTH_2 + ((address & 0x3f) % LINE_LENGTH_2);
    }
    return address % LINE_LENGTH_1;
  }

  /** Address counter step with the data sheet's line wrap-around. */
  #step(address, forward) {
    if (this.target === "cgram") {
      return (address + (forward ? 1 : 63)) & 0x3f;
    }
    if (this.twoLines) {
      if (forward) {
        return address === 0x27 ? 0x40 : address >= 0x67 ? 0x00 : address + 1;
      }
      return address === 0x00 ? 0x67 : address === 0x40 ? 0x27 : address - 1;
    }
    if (forward) {
      return address >= 0x4f ? 0x00 : address + 1;
    }
    return address === 0x00 ? 0x4f : address - 1;
  }

  /** Visible 16x2 contents, cursor, and modes. */
  snapshot() {
    const rows = [];
    const cells = [];
    for (let row = 0; row < 2; row++) {
      const codes = [];
      for (let col = 0; col < 16; col++) {
        let code = 0x20;
        if (this.twoLines) {
          code = this.ddram[row * LINE_LENGTH_2 + ((this.shift + col) % LINE_LENGTH_2)];
        } else if (row === 0) {
          code = this.ddram[(this.shift + col) % LINE_LENGTH_1];
        }
        codes.push(this.displayOn && (this.twoLines || row === 0) ? code : 0x20);
      }
      cells.push(codes.map((code) => ({ code, char: romCharacter(code), custom: code < 0x10 ? code & 0x07 : null })));
      rows.push(codes.map((code) => romCharacter(code) ?? "□").join(""));
    }
    return {
      rows,
      cells,
      displayOn: this.displayOn,
      cursor: this.#cursorPosition(),
      mode: { bits: this.eightBit ? 8 : 4, lines: this.twoLines ? 2 : 1, font: this.font5x10 ? "5x10" : "5x8" },
      cgram: Array.from({ length: 8 }, (_, index) => Array.from(this.cgram.slice(index * 8, index * 8 + 8))),
      instructions: this.instructions,
      warnings: [...this.warnings],
    };
  }

  #cursorPosition() {
    if (!this.displayOn || this.target !== "ddram" || (!this.cursorOn && !this.blinkOn)) {
      return null;
    }
    const index = this.#ddramIndex(this.address);
    const length = this.#lineLength();
    const row = this.twoLines ? Math.floor(index / LINE_LENGTH_2) : 0;
    const column = ((index % length) - this.shift + length) % length;
    if (column >= 16) {
      return null;
    }
    return { row, column, underline: this.cursorOn, blink: this.blinkOn };
  }
}

function formatNs(ns) {
  if (ns >= 1_000_000n) {
    return `${(Number(ns) / 1e6).toFixed(2)} ms`;
  }
  return `${(Number(ns) / 1e3).toFixed(1)} µs`;
}
