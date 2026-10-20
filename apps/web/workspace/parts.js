/*
 * Part catalog for the circuit workspace.
 *
 * Every part declares:
 *   size      local drawing size (world units; 9.6 = 0.1 in)
 *   pins      [{ name, x, y, label? }] in local coordinates, on the 0.1" grid
 *   status    "simulated"  — behavior derived from real simulator events
 *             "editor"     — can be placed and wired; no electrical behavior yet
 *   kind      used by the netlist (led, resistor, pushbutton, board, ...)
 *   render()  returns SVG markup for the part body (original artwork)
 *
 * Electrical behavior lives in netlist.js; rendering here is pure strings so
 * the catalog can be imported (and validated) in Node.
 */
import { BOARD_PART } from "../board/launchpad.js";

const G = 9.6; // 0.1 inch

export const LED_COLORS = Object.freeze({
  red: { body: "#e53935", glow: "#ff5252" },
  green: { body: "#43a047", glow: "#69f0ae" },
  blue: { body: "#1e88e5", glow: "#82b1ff" },
  yellow: { body: "#fdd835", glow: "#ffff8d" },
  white: { body: "#eceff1", glow: "#ffffff" },
  orange: { body: "#fb8c00", glow: "#ffd180" },
});

export const RESISTOR_VALUES = Object.freeze(["220", "330", "470", "1k", "4.7k", "10k"]);

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const led = {
  title: "LED (5 mm)",
  kind: "led",
  status: "simulated",
  idPrefix: "led",
  description: "Lights when its anode net is driven HIGH and its cathode net is LOW (logic-level model).",
  size: { width: 3 * G, height: 6 * G },
  defaultAttrs: { color: "red" },
  pins: [
    { name: "A", x: 1 * G, y: 6 * G, label: "Anode (+)" },
    { name: "C", x: 2 * G, y: 6 * G, label: "Cathode (−)" },
  ],
  render(part, state = {}) {
    const color = LED_COLORS[part.attrs?.color] ?? LED_COLORS.red;
    const lit = state.on === true;
    return `
      <g class="part-led${lit ? " lit" : ""}">
        <line x1="${G}" y1="${3.4 * G}" x2="${G}" y2="${6 * G}" class="lead" />
        <polyline points="${2 * G},${3.4 * G} ${2 * G},${4.4 * G} ${2 * G},${6 * G}" class="lead" />
        ${lit ? `<circle cx="${1.5 * G}" cy="${1.6 * G}" r="${2.4 * G}" fill="${color.glow}" class="led-glow" />` : ""}
        <path d="M${0.25 * G} ${3.3 * G} V${1.5 * G} A${1.25 * G} ${1.25 * G} 0 0 1 ${2.75 * G} ${1.5 * G} V${3.3 * G} Z"
              fill="${lit ? color.glow : color.body}" fill-opacity="${lit ? 0.95 : 0.78}" stroke="rgba(0,0,0,0.35)" stroke-width="0.6" />
        <rect x="${0.05 * G}" y="${3.15 * G}" width="${2.9 * G}" height="${0.35 * G}" rx="1" fill="${color.body}" opacity="0.9" />
        <path d="M${0.8 * G} ${1.0 * G} q ${0.3 * G} ${-0.5 * G} ${0.9 * G} ${-0.55 * G}" stroke="#fff" stroke-opacity="0.55" stroke-width="1.2" fill="none" />
      </g>`;
  },
};

const resistor = {
  title: "Resistor",
  kind: "resistor",
  status: "simulated",
  idPrefix: "r",
  description: "Passes a logic level as a weak connection (a pull resistor loses to a direct connection).",
  size: { width: 6 * G, height: 2 * G },
  defaultAttrs: { value: "220" },
  pins: [
    { name: "1", x: 0, y: G },
    { name: "2", x: 6 * G, y: G },
  ],
  links: () => [{ a: "1", b: "2", strength: "weak" }],
  render(part) {
    const value = escapeXml(part.attrs?.value ?? "220");
    return `
      <g class="part-resistor">
        <line x1="0" y1="${G}" x2="${6 * G}" y2="${G}" class="lead" />
        <rect x="${1.4 * G}" y="${0.55 * G}" width="${3.2 * G}" height="${0.9 * G}" rx="${0.45 * G}" fill="#d7c39b" stroke="#a48b5c" stroke-width="0.6" />
        <rect x="${1.9 * G}" y="${0.55 * G}" width="${0.22 * G}" height="${0.9 * G}" fill="#8d4f1f" />
        <rect x="${2.5 * G}" y="${0.55 * G}" width="${0.22 * G}" height="${0.9 * G}" fill="#c62828" />
        <rect x="${3.1 * G}" y="${0.55 * G}" width="${0.22 * G}" height="${0.9 * G}" fill="#5d4037" />
        <rect x="${3.9 * G}" y="${0.55 * G}" width="${0.22 * G}" height="${0.9 * G}" fill="#c9a227" />
        <text x="${3 * G}" y="${1.95 * G}" class="part-value">${value} Ω</text>
      </g>`;
  },
};

const pushbutton = {
  title: "Pushbutton",
  kind: "pushbutton",
  status: "simulated",
  idPrefix: "btn",
  description: "Connects its two pins while held. Wired between a GPIO and GND it drives the input LOW through the GPIO model.",
  size: { width: 4 * G, height: 4 * G },
  defaultAttrs: { color: "gray" },
  pins: [
    { name: "1", x: 0, y: 3 * G },
    { name: "2", x: 4 * G, y: 3 * G },
  ],
  // Closed (a strong connection) only while held.
  links: (part, inputs) => (inputs?.pressed?.has(part.id) ? [{ a: "1", b: "2" }] : []),
  interactive: true,
  render(part, state = {}) {
    const pressed = state.pressed === true;
    return `
      <g class="part-pushbutton${pressed ? " pressed" : ""}">
        <line x1="0" y1="${3 * G}" x2="${0.5 * G}" y2="${3 * G}" class="lead" />
        <line x1="${3.5 * G}" y1="${3 * G}" x2="${4 * G}" y2="${3 * G}" class="lead" />
        <rect x="${0.4 * G}" y="${0.4 * G}" width="${3.2 * G}" height="${3.2 * G}" rx="2" fill="#2b2f36" stroke="#14171c" stroke-width="0.8" />
        <circle cx="${0.75 * G}" cy="${0.75 * G}" r="1.4" fill="#5b6270" /><circle cx="${3.25 * G}" cy="${0.75 * G}" r="1.4" fill="#5b6270" />
        <circle cx="${0.75 * G}" cy="${3.25 * G}" r="1.4" fill="#5b6270" /><circle cx="${3.25 * G}" cy="${3.25 * G}" r="1.4" fill="#5b6270" />
        <circle cx="${2 * G}" cy="${2 * G}" r="${1.05 * G}" class="button-cap" />
      </g>`;
  },
};

const potentiometer = {
  title: "Potentiometer",
  kind: "potentiometer",
  status: "editor",
  idPrefix: "pot",
  description: "Placeable and wireable. ADC is not modeled yet, so its voltage does not reach firmware.",
  size: { width: 6 * G, height: 5 * G },
  defaultAttrs: { value: "10k" },
  pins: [
    { name: "GND", x: 1 * G, y: 5 * G },
    { name: "SIG", x: 3 * G, y: 5 * G },
    { name: "VCC", x: 5 * G, y: 5 * G },
  ],
  render() {
    return `
      <g class="part-pot">
        <rect x="${0.2 * G}" y="${0.2 * G}" width="${5.6 * G}" height="${4 * G}" rx="3" fill="#1f5fa8" stroke="#123a66" stroke-width="0.8" />
        <circle cx="${3 * G}" cy="${2.2 * G}" r="${1.6 * G}" fill="#e0e3e8" stroke="#9aa1ab" stroke-width="0.8" />
        <rect x="${2.85 * G}" y="${0.75 * G}" width="${0.3 * G}" height="${1.4 * G}" rx="1" fill="#4a5160" />
        <line x1="${1 * G}" y1="${4.2 * G}" x2="${1 * G}" y2="${5 * G}" class="lead" />
        <line x1="${3 * G}" y1="${4.2 * G}" x2="${3 * G}" y2="${5 * G}" class="lead" />
        <line x1="${5 * G}" y1="${4.2 * G}" x2="${5 * G}" y2="${5 * G}" class="lead" />
      </g>`;
  },
};

const LCD_PINS = ["VSS", "VDD", "V0", "RS", "RW", "E", "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "A", "K"];

const LCD_PIN_LABELS = {
  VSS: "VSS (GND)", VDD: "VDD (+5 V)", V0: "V0 (contrast)", RS: "RS (register select)", RW: "RW (read/write)",
  E: "E (enable)", A: "A (backlight +)", K: "K (backlight −)",
};

function lcdCell(cell, x, y, cgram, lit) {
  const width = 1.35 * G;
  const height = 2.2 * G;
  if (cell.custom !== null) {
    // Custom character: draw the firmware's CGRAM bitmap as 5x8 dots.
    const dots = [];
    const pitchX = width / 5;
    const pitchY = height / 8;
    cgram[cell.custom].forEach((row, r) => {
      for (let c = 0; c < 5; c++) {
        if (row & (1 << (4 - c))) {
          dots.push(`<rect x="${(x + c * pitchX + 0.2).toFixed(2)}" y="${(y + r * pitchY + 0.2).toFixed(2)}" width="${(pitchX - 0.4).toFixed(2)}" height="${(pitchY - 0.4).toFixed(2)}" class="lcd-dot" />`);
        }
      }
    });
    return dots.join("");
  }
  if (!cell.char || cell.char === " ") {
    return "";
  }
  return `<text x="${(x + width / 2).toFixed(2)}" y="${(y + height * 0.78).toFixed(2)}" class="lcd-char${lit ? " lit" : ""}">${escapeXml(cell.char)}</text>`;
}

const lcd1602 = {
  title: "LCD1602 (HD44780)",
  kind: "lcd1602",
  status: "simulated",
  idPrefix: "lcd",
  description: "HD44780 controller driven by the firmware's GPIO writes (4- or 8-bit). Wire VDD/VSS, RS, E, D4–D7, and RW to GND (D-024).",
  size: { width: 34 * G, height: 14 * G },
  defaultAttrs: {},
  pins: LCD_PINS.map((name, index) => ({ name, x: (2 + index) * G, y: 0, label: LCD_PIN_LABELS[name] ?? name })),
  render(part, state = {}) {
    const lcd = state.lcd ?? null;
    const labels = LCD_PINS.map((name, index) =>
      `<text x="${(2 + index) * G}" y="${1.45 * G}" class="pin-silk">${name}</text>`).join("");
    const cells = [];
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 16; col++) {
        const x = (4.2 + col * 1.6) * G;
        const y = (5.2 + row * 2.6) * G;
        cells.push(`<rect x="${x}" y="${y}" width="${1.35 * G}" height="${2.2 * G}" rx="0.6" class="lcd-cell" />`);
        if (lcd?.powered) {
          cells.push(lcdCell(lcd.cells[row][col], x, y, lcd.cgram, lcd.backlight));
          const cursor = lcd.cursor;
          if (cursor && cursor.row === row && cursor.column === col) {
            if (cursor.blink) {
              cells.push(`<rect x="${x}" y="${y}" width="${1.35 * G}" height="${2.2 * G}" class="lcd-blink" />`);
            }
            if (cursor.underline) {
              cells.push(`<rect x="${x}" y="${y + 2.0 * G}" width="${1.35 * G}" height="${0.2 * G}" class="lcd-underline" />`);
            }
          }
        }
      }
    }
    const screenClass = !lcd ? "" : !lcd.powered ? " off" : lcd.backlight ? " backlit" : "";
    const label = lcd?.powered ? `LCD: "${lcd.rows[0].trimEnd()}" / "${lcd.rows[1].trimEnd()}"` : "LCD: no simulated content";
    return `
      <g class="part-lcd" role="img" aria-label="${escapeXml(label)}"
         data-row0="${escapeXml(lcd?.powered ? lcd.rows[0] : "")}" data-row1="${escapeXml(lcd?.powered ? lcd.rows[1] : "")}">
        <rect x="0" y="0" width="${34 * G}" height="${14 * G}" rx="4" fill="#1d6b3a" stroke="#0f3f22" stroke-width="1" />
        ${labels}
        <rect x="${2.6 * G}" y="${3.4 * G}" width="${28.8 * G}" height="${9.2 * G}" rx="3" fill="#20262c" />
        <rect x="${3.4 * G}" y="${4.4 * G}" width="${27.2 * G}" height="${7.2 * G}" rx="2" class="lcd-screen${screenClass}" />
        ${cells.join("")}
      </g>`;
  },
};

const logicAnalyzer = {
  title: "Logic analyzer (8 ch)",
  kind: "logic-analyzer",
  status: "editor",
  idPrefix: "la",
  description: "Placeable and wireable. Waveform capture is planned; channels do not record yet.",
  size: { width: 12 * G, height: 10 * G },
  defaultAttrs: {},
  pins: [...Array.from({ length: 8 }, (_, i) => ({ name: `D${i}`, x: 0, y: (1 + i) * G })), { name: "GND", x: 0, y: 9 * G }],
  render() {
    const labels = [...Array.from({ length: 8 }, (_, i) => `D${i}`), "GND"]
      .map((name, i) => `<text x="${1.1 * G}" y="${(1 + i) * G + 3}" class="pin-silk left">${name}</text>`).join("");
    return `
      <g class="part-logic">
        <rect x="${0.4 * G}" y="0" width="${11.6 * G}" height="${10 * G}" rx="4" fill="#2c3440" stroke="#151a21" stroke-width="1" />
        ${labels}
        <text x="${7.6 * G}" y="${5.3 * G}" class="part-title">LOGIC</text>
      </g>`;
  },
};

export const CATALOG = Object.freeze({
  [BOARD_PART.type]: BOARD_PART,
  led,
  resistor,
  pushbutton,
  potentiometer,
  lcd1602,
  "logic-analyzer": logicAnalyzer,
});

/** Parts offered in the library panel, in display order. */
export const LIBRARY = Object.freeze(["led", "resistor", "pushbutton", "potentiometer", "lcd1602", "logic-analyzer"]);

export function pinOf(type, name) {
  return CATALOG[type]?.pins.find((pin) => pin.name === name) ?? null;
}
