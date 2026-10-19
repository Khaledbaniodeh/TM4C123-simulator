/*
 * EK-TM4C123GXL LaunchPad part: original SVG artwork, pin anchors, and pin
 * metadata for the circuit workspace.
 *
 * Placement data comes from TI's Rev A design package (SPMR240, a PADS 9.3
 * design), extracted on the CI runner by tools/hwref/inspect_pads.py:
 *   - board outline: PADS *LINES* BOARD and the BoardOutline Gerber agree,
 *     2000 x 2600 mil
 *   - part placements: PADS *PART* section (BASIC units / 38100 = mil)
 *   - header pins: NC drill tool T2 (0.035 in), 40 hits on a 100 mil grid
 * CAD values are kept verbatim below in mil with the y axis pointing up
 * (as TI publishes them) and converted to SVG millimetres (y down) by cad().
 * The artwork itself is an original drawing; no TI files are redistributed.
 *
 * Header signal assignments come from ek-tm4c123gxl.pins.json, verified
 * against SPMU296 by tools/hwref/check_pinmap.py.
 *
 * Electrical state is never decided here: `update()` paints LEDs and
 * switches from the simulator-derived state passed in by the app.
 */
import pinMap from "./ek-tm4c123gxl.pins.json" with { type: "json" };
import { mm } from "../workspace/geometry.js";

export const BOARD_TYPE = "tm4c123gxl-launchpad";

const MIL = 0.0254;
const BOARD_MIL = { width: 2000, height: 2600 };

/** CAD (mil, y up) -> board millimetres (origin top-left, y down). */
function cad(xMil, yMil) {
  return { x: xMil * MIL, y: (BOARD_MIL.height - yMil) * MIL };
}

/** Part placements from SPMR240 (refdes: [x mil, y mil, rotation deg (CAD, CCW)]). */
export const CAD_PLACEMENT = Object.freeze({
  J1: [100, 1400, 0], J3: [200, 1400, 0], J4: [1800, 1400, 0], J2: [1900, 1400, 0],
  U1: [1000, 1000, 135], // TM4C123GH6PM target (LQFP-64)
  U2: [1200, 2230, 0], // TM4C123G in-circuit debug interface (ICDI)
  SW1: [400, 200, 0], SW2: [1600, 200, 0], // SW-EVQQ2 user switches
  RESET: [1770, 1880, 0], // SW-EVQQ2 reset switch (refdes "RESET")
  SW3: [200, 2400, 90], // DPDT power select
  J11: [616, 2540, 270], // USB micro-B (DEBUG)
  J9: [60, 1800, 0], // USB micro-AB (DEVICE)
  D1: [1904, 1616, 270], // RGB LED (0404)
  D4: [772, 2200, 270], // power LED (0805)
  Q1: [1695.8, 1551.3, 0], Q2: [1695.4, 1696.8, 0], Q3: [1696, 1624, 0], // LED drivers
  Y1: [726.3, 1480.9, 0], Y2: [650.1, 1340.4, 0], Y5: [1711.1, 2223.4, 270], // crystals
  U4: [548, 2060, 0], U8: [576, 2208, 90], D2: [708, 2024, 180],
  R9: [813.7, 633.3, 0], R10: [942, 632.6, 0],
});

/** Passives with known placement (refdes: [x, y, rot, package]). Partial list. */
const CAD_PASSIVES = [
  ["R24", 372.9, 2526.3, 270, "0402"], ["R19", 843.6, 2169.7, 270, "0402"], ["C34", 819, 2041.8, 0, "0402"],
  ["R21", 1952, 2328, 270, "0402"], ["R22", 1952, 2432, 90, "0402"], ["R30", 654, 1812, 180, "0603"],
  ["R14", 236, 2020, 0, "0603"], ["R1", 1552, 1150, 0, "0603"], ["R2", 1508, 1572, 0, "0603"],
  ["R11", 1552, 1450, 180, "0603"], ["R12", 1552, 1350, 180, "0603"], ["R13", 691.3, 277.1, 180, "0603"],
  ["R16", 396, 2368, 270, "0603"], ["R17", 528, 1920, 90, "0402"], ["R4", 1783.4, 1696.8, 0, "0402"],
  ["R5", 1784, 1624, 0, "0402"], ["C12", 700.5, 752.8, 180, "0402"], ["C1", 853.8, 2340, 270, "0402"],
  ["C2", 1244, 1908, 270, "0402"], ["C8", 1132, 644, 0, "0402"], ["R26", 649.3, 1242.5, 0, "0603"],
  ["R20", 1536.8, 2242.2, 180, "0603"], ["C14", 431.4, 2189.3, 270, "0402"], ["R25", 260, 1580, 0, "0603"],
  ["R29", 260, 1516, 180, "0603"], ["C18", 708, 2244, 90, "0402"], ["R27", 708, 2164, 270, "0402"],
  ["C3", 1260.5, 1182.6, 0, "0402"], ["C4", 701.4, 839.8, 180, "0402"], ["C5", 1132, 692, 0, "0402"],
  ["C6", 1307.4, 825.5, 90, "0402"], ["C7", 663.9, 1185.8, 180, "0402"], ["C10", 701, 796.5, 180, "0402"],
  ["C11", 1260, 1230, 0, "0402"], ["R31", 1095.2, 1403.7, 270, "0402"], ["C28", 809.4, 1518.7, 270, "0402"],
  ["C29", 809.4, 1447.1, 270, "0402"], ["C31", 551.8, 1250.6, 180, "0402"], ["C32", 747.1, 1250.9, 0, "0402"],
  ["R28", 809, 1368.3, 270, "0402"], ["C13", 809, 1289.4, 270, "0402"], ["C15", 904, 2340, 270, "0402"],
];

/** Plated single-pin holes (NC drill tool T3, 0.039 in), inch, y up, board-relative. */
const CAD_TEST_HOLES = [
  [0.1, 0.1], [0.1, 0.2], [0.1, 0.3], [0.4, 1.7], [0.4, 1.8], [0.2, 2.1], [0.1, 2.1], [0.3, 2.1],
  [0.9, 2.5], [0.6, 1.9], [0.7, 1.9], [1.0, 1.8], [0.9, 1.8], [1.0, 1.4], [1.2, 1.3], [1.1, 1.8],
  [1.2, 1.8], [1.5, 1.8], [1.4, 1.8], [1.3, 1.8], [1.5, 1.9], [1.8, 0.4], [1.9, 0.3], [1.9, 0.2], [1.9, 0.1],
];

/**
 * Three 0.039 in holes (NC drill tool T4) centred on J5 at (1872, 2360) mil:
 * the Tag-Connect TC2050 debug footprint on the bottom side.
 */
const CAD_J5_HOLES = [[1.832, 2.21], [1.912, 2.21], [1.872, 2.51]];

/**
 * RESET switch: SPMR240 *PART* line "RESET SW-EVQQ2 1770 1880 mil" (the
 * refdes has no digits, which the first extraction pass skipped), matching
 * the "Reset Switch" callout in SPMU296's board figure and section 2.2.4.
 */
export const RESET_SOURCE = "SPMR240 part RESET (SW-EVQQ2) at 1770, 1880 mil; SPMU296 §2.2.4";

const at = (refdes) => cad(CAD_PLACEMENT[refdes][0], CAD_PLACEMENT[refdes][1]);
const inch = ([x, y]) => cad(x * 1000, y * 1000);

/** Header pitch: 0.1 inch. */
const PITCH = 2.54;

/** Layout in board millimetres (origin top-left, y down), derived from CAD_PLACEMENT. */
export const GEOMETRY = Object.freeze({
  width: BOARD_MIL.width * MIL,
  height: BOARD_MIL.height * MIL,
  cornerRadius: 1.0,
  // Pin 1 of each header; pins run downward on a 0.1 in pitch.
  headers: { J1: at("J1"), J3: at("J3"), J4: at("J4"), J2: at("J2") },
  mcu: { ...at("U1"), size: 10, rotation: -CAD_PLACEMENT.U1[2] },
  icdi: { ...at("U2"), size: 10 },
  usbDebug: at("J11"),
  usbDevice: at("J9"),
  powerSwitch: at("SW3"),
  tagConnect: cad(1872, 2360),
  reset: at("RESET"),
  sw1: at("SW1"),
  sw2: at("SW2"),
  rgbLed: at("D1"),
  powerLed: at("D4"),
});

export const GEOMETRY_SOURCE = "TI SPMR240 Rev A design package (PADS 9.3), extracted in CI";

const SIZE = { width: mm(GEOMETRY.width), height: mm(GEOMETRY.height) };

function headerPinPosition(header, pin) {
  const origin = GEOMETRY.headers[header];
  return { x: mm(origin.x), y: mm(origin.y + (pin - 1) * PITCH) };
}

const PIN_INDEX = new Map();
const PINS = [];
for (const [header, entries] of Object.entries(pinMap.headers)) {
  for (const entry of entries) {
    const name = `${header}.${entry.pin}`;
    const position = headerPinPosition(header, entry.pin);
    const pin = { name, x: position.x, y: position.y, header, number: entry.pin, ...entry };
    PINS.push(pin);
    PIN_INDEX.set(name, pin);
  }
}

const ONBOARD_ROLE = Object.fromEntries(Object.entries(pinMap.onboard).map(([role, gpio]) => [gpio, role]));
const ROLE_LABEL = { redLed: "On-board red LED", blueLed: "On-board blue LED", greenLed: "On-board green LED", sw1: "On-board SW1 (active low)", sw2: "On-board SW2 (active low, NMI-locked pin)" };

function role(pinName) {
  const pin = PIN_INDEX.get(pinName);
  if (!pin) {
    return null;
  }
  if (pin.gpio) {
    return { kind: "gpio", gpio: pin.gpio };
  }
  if (pin.kind === "power") {
    return { kind: "power", net: pin.signal };
  }
  if (pin.kind === "ground") {
    return { kind: "ground" };
  }
  return { kind: pin.kind ?? "other" };
}

const ANALOG = /^AIN\d+$/;

function pinInfo(pinName) {
  const pin = PIN_INDEX.get(pinName);
  if (!pin) {
    return null;
  }
  const info = { ...role(pinName), title: `${pin.header} pin ${pin.number}`, lines: [] };
  if (pin.gpio) {
    info.title += ` · ${pin.gpio}`;
    info.lines.push(`GPIO port ${pin.gpio[1]}, bit ${pin.gpio[2]} — digital I/O (modeled)`);
    const analog = pin.alt.filter((fn) => ANALOG.test(fn));
    if (analog.length) {
      info.lines.push(`Analog input: ${analog.join(", ")} (ADC not modeled yet)`);
    }
    const alternates = pin.alt.filter((fn) => !ANALOG.test(fn));
    if (alternates.length) {
      info.lines.push(`Alternate functions: ${alternates.join(", ")} (not modeled)`);
    }
    if (ONBOARD_ROLE[pin.gpio]) {
      info.lines.push(ROLE_LABEL[ONBOARD_ROLE[pin.gpio]]);
    }
    if (pin.shorted) {
      info.lines.push(`Tied to ${pin.shorted} through ${pin.via} (0 Ω, fitted by default)`);
    }
  } else {
    info.title += ` · ${pin.signal}`;
    info.lines.push(pin.kind === "ground" ? "Ground" : pin.kind === "power" ? `${pin.signal} supply` : "Target reset (not modeled as a wire input)");
  }
  return info;
}

/** Board-internal connections: all GND pins, and the R9/R10 0-ohm shorts. */
function links() {
  const result = [];
  const grounds = PINS.filter((p) => p.kind === "ground").map((p) => p.name);
  for (let i = 1; i < grounds.length; i++) {
    result.push({ a: grounds[0], b: grounds[i] });
  }
  const byGpio = new Map(PINS.filter((p) => p.gpio).map((p) => [p.gpio, p.name]));
  for (const pin of PINS) {
    if (pin.shorted && pin.gpio < pin.shorted) {
      result.push({ a: pin.name, b: byGpio.get(pin.shorted) });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Artwork (original drawing; placement from TI CAD data)
// ---------------------------------------------------------------------------

const S = (value) => mm(value).toFixed(2);

function headerArt(header) {
  const origin = GEOMETRY.headers[header];
  const x = mm(origin.x);
  const y = mm(origin.y);
  const half = mm(PITCH / 2);
  const right = origin.x > GEOMETRY.width / 2;
  const outer = header === "J1" || header === "J2";
  const pins = pinMap.headers[header].map((entry) => {
    const py = mm(origin.y + (entry.pin - 1) * PITCH);
    const label = entry.gpio ?? entry.signal;
    // Labels sit toward the board centre; outer-header (J1/J2) labels are
    // drawn by outerLabels() one column further in.
    const labelX = right ? x - mm(1.6) : x + mm(1.6);
    return `
      <rect x="${(x - mm(0.95)).toFixed(2)}" y="${(py - mm(0.95)).toFixed(2)}" width="${S(1.9)}" height="${S(1.9)}" rx="1" class="lp-pad" />
      <circle cx="${x.toFixed(2)}" cy="${py.toFixed(2)}" r="${S(0.45)}" class="lp-pin" />
      ${outer ? "" : `<text x="${labelX.toFixed(2)}" y="${(py + mm(0.45)).toFixed(2)}" class="lp-silk lp-pinlabel ${right ? "end" : "start"}">${label}</text>`}`;
  }).join("");
  return `
    <g class="lp-header" data-header="${header}">
      <rect x="${(x - half).toFixed(2)}" y="${(y - half).toFixed(2)}" width="${(half * 2).toFixed(2)}" height="${mm(PITCH * 10).toFixed(2)}" rx="1.5" class="lp-header-body" />
      ${pins}
      <text x="${x.toFixed(2)}" y="${(y - mm(1.9)).toFixed(2)}" class="lp-silk lp-header-name">${header}</text>
    </g>`;
}

/** Outer-header labels (J1/J2) next to the inner header's labels, e.g. "PB5 · PD0". */
function outerLabels() {
  const rows = [];
  for (const [outer, inner] of [["J1", "J3"], ["J2", "J4"]]) {
    const right = outer === "J2";
    const origin = GEOMETRY.headers[inner];
    for (let pin = 1; pin <= 10; pin++) {
      const entry = pinMap.headers[outer][pin - 1];
      const py = mm(origin.y + (pin - 1) * PITCH);
      const x = right ? mm(origin.x) - mm(6.6) : mm(origin.x) + mm(6.6);
      rows.push(`<text x="${x.toFixed(2)}" y="${(py + mm(0.45)).toFixed(2)}" class="lp-silk lp-pinlabel dim ${right ? "end" : "start"}">${entry.gpio ?? entry.signal}</text>`);
    }
  }
  return rows.join("");
}

function qfp(cx, cy, size, rotation, label, sublabel) {
  const body = mm(size);
  const leadLength = mm(1.0);
  const leads = [];
  const count = 16;
  const span = body * 0.8;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < count; i++) {
      const offset = -span / 2 + (span * (i + 0.5)) / count;
      const half = body / 2;
      const [x, y, w, h] = [
        [offset - 0.55, -half - leadLength, 1.1, leadLength],
        [half, offset - 0.55, leadLength, 1.1],
        [offset - 0.55, half, 1.1, leadLength],
        [-half - leadLength, offset - 0.55, leadLength, 1.1],
      ][side];
      leads.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" class="lp-lead" />`);
    }
  }
  return `
    <g transform="translate(${mm(cx).toFixed(2)} ${mm(cy).toFixed(2)}) rotate(${rotation})">
      ${leads.join("")}
      <rect x="${(-body / 2).toFixed(2)}" y="${(-body / 2).toFixed(2)}" width="${body.toFixed(2)}" height="${body.toFixed(2)}" rx="1.2" class="lp-chip" />
      <circle cx="${(-body / 2 + 4.5).toFixed(2)}" cy="${(-body / 2 + 4.5).toFixed(2)}" r="1.5" class="lp-chip-dot" />
      <g transform="rotate(${-rotation})">
        <text y="-1" class="lp-chip-text">${label}</text>
        <text y="6.5" class="lp-chip-subtext">${sublabel}</text>
      </g>
    </g>`;
}

function smdPart(position, rotation, length, width, cls) {
  const vertical = rotation % 180 !== 0;
  const w = vertical ? width : length;
  const h = vertical ? length : width;
  return `<rect x="${S(position.x - w / 2)}" y="${S(position.y - h / 2)}" width="${S(w)}" height="${S(h)}" class="${cls}" />`;
}

const PASSIVE_SIZE = { "0402": [1.0, 0.5], "0603": [1.6, 0.8] };

function passivesArt() {
  return CAD_PASSIVES.map(([refdes, x, y, rotation, size]) => {
    const [length, width] = PASSIVE_SIZE[size];
    const cls = refdes.startsWith("C") ? "lp-cap" : "lp-res";
    return smdPart(cad(x, y), rotation, length, width, cls);
  }).join("");
}

function usbTop(position, label) {
  return `
    <g class="lp-usb">
      <rect x="${S(position.x - 4)}" y="${S(-1.0)}" width="${S(8)}" height="${S(5.2)}" rx="1.3" class="lp-usb-shell" />
      <rect x="${S(position.x - 2.9)}" y="${S(-0.6)}" width="${S(5.8)}" height="${S(1.5)}" rx="0.6" class="lp-usb-mouth" />
      <text x="${S(position.x)}" y="${S(6.6)}" class="lp-silk small">${label}</text>
    </g>`;
}

function usbLeft(position, label) {
  return `
    <g class="lp-usb">
      <rect x="${S(-1.0)}" y="${S(position.y - 4)}" width="${S(5.2)}" height="${S(8)}" rx="1.3" class="lp-usb-shell" />
      <rect x="${S(-0.6)}" y="${S(position.y - 2.9)}" width="${S(1.5)}" height="${S(5.8)}" rx="0.6" class="lp-usb-mouth" />
      <text x="${S(5.6)}" y="${S(position.y + 0.8)}" class="lp-silk small start">${label}</text>
    </g>`;
}

function crystal(refdes) {
  const position = at(refdes);
  const vertical = CAD_PLACEMENT[refdes][2] % 180 !== 0;
  const w = vertical ? 3.2 : 5.0;
  const h = vertical ? 5.0 : 3.2;
  return `<rect x="${S(position.x - w / 2)}" y="${S(position.y - h / 2)}" width="${S(w)}" height="${S(h)}" rx="0.6" class="lp-crystal" />`;
}

function tactileSwitch(id, input, position, label, size = 6) {
  const { x, y } = position;
  return `
    <g id="${id}" class="lp-switch" data-input="${input}" role="button" tabindex="0" aria-pressed="false"
       aria-label="${label} — hold to press while the simulation runs">
      <rect x="${S(x - size / 2)}" y="${S(y - size / 2)}" width="${S(size)}" height="${S(size)}" rx="1.6" class="lp-switch-body" />
      <circle cx="${S(x - size * 0.36)}" cy="${S(y - size * 0.36)}" r="${S(0.35)}" class="lp-switch-corner" />
      <circle cx="${S(x + size * 0.36)}" cy="${S(y - size * 0.36)}" r="${S(0.35)}" class="lp-switch-corner" />
      <circle cx="${S(x - size * 0.36)}" cy="${S(y + size * 0.36)}" r="${S(0.35)}" class="lp-switch-corner" />
      <circle cx="${S(x + size * 0.36)}" cy="${S(y + size * 0.36)}" r="${S(0.35)}" class="lp-switch-corner" />
      <circle cx="${S(x)}" cy="${S(y)}" r="${S(size * 0.3)}" class="lp-switch-cap" />
      <text x="${S(x)}" y="${S(y + size / 2 + 2.0)}" class="lp-silk">${label}</text>
    </g>`;
}

// ---------------------------------------------------------------------------
// Selectable board components
// ---------------------------------------------------------------------------

/**
 * Technical information for each selectable board component.
 * status: "simulated" (behavior from the simulator), "visual" (drawn only),
 * or "provisional" (simulated, but its position is not yet confirmed).
 */
const headerInfo = (header) => ({
  title: `${header} · BoosterPack header (10 pins)`,
  status: "simulated",
  lines: [
    "Every pin is a wire anchor; GPIO pins connect to the Renode GPIO model",
    `Position: TI SPMR240 (${CAD_PLACEMENT[header][0]} mil column); pinout: SPMU296 ${{ J1: "Table 2-3", J2: "Table 2-4", J3: "Table 2-5", J4: "Table 2-6" }[header]}`,
  ],
});

export const COMPONENTS = Object.freeze({
  U1: { title: "U1 · TM4C123GH6PM target MCU", status: "simulated", lines: ["Cortex-M4F executed by Renode 1.17.0 at 16 MIPS (≈ 16 MHz PIOSC)", "Modeled: SYSCTL GPIO clock gating, GPIO A–F, GPIO interrupts → NVIC, bus faults", "Other peripherals report accesses instead of simulating them"] },
  U2: { title: "U2 · In-Circuit Debug Interface (ICDI)", status: "visual", lines: ["On the real board, a second TM4C123G runs TI's debug firmware", "Not simulated: firmware is loaded into the target directly"] },
  J11: { title: "J11 · DEBUG USB (micro-B)", status: "visual", lines: ["Connects the ICDI to a PC on the real board", "Not simulated"] },
  J9: { title: "J9 · DEVICE USB (micro-AB)", status: "visual", lines: ["Target MCU USB 2.0 device/OTG port", "USB is not modeled"] },
  SW3: { title: "SW3 · Power select (DEBUG / DEVICE)", status: "visual", lines: ["Selects which USB connector powers the real board", "The simulated board is always powered"] },
  D1: { title: "D1 · RGB LED", status: "simulated", lines: ["Red = PF1, Blue = PF2, Green = PF3, driven through Q1–Q3", "Lit only while its pin is a GPIO output driven HIGH (Renode events)"] },
  D4: { title: "D4 · Power LED", status: "visual", lines: ["Shown lit while a simulation session is live"] },
  SW1: { title: "SW1 · User switch", status: "simulated", lines: ["PF4, active low; firmware must enable the internal pull-up", "Hold to press while the simulation runs"] },
  SW2: { title: "SW2 · User switch", status: "simulated", lines: ["PF0, active low; PF0 is commit-protected (GPIOLOCK/GPIOCR)", "Hold to press while the simulation runs"] },
  J5: { title: "J5 · Tag-Connect TC2050 debug footprint (bottom side)", status: "visual", lines: ["Three alignment holes from the NC drill file (tool T4)", "Not simulated"] },
  RESET: { title: "RESET · Reset switch", status: "simulated", lines: ["Releasing it resets the simulated MCU (Renode machine Reset); holding the MCU in reset is not modeled", `Position: ${RESET_SOURCE}`] },
  Y1: { title: "Y1 · Crystal (target MCU)", status: "visual", lines: ["Clock tree not modeled; the simulator assumes the 16 MHz PIOSC reset clock"] },
  Y2: { title: "Y2 · Crystal (target MCU)", status: "visual", lines: ["Clock tree and hibernation module not modeled"] },
  Y5: { title: "Y5 · Crystal (ICDI)", status: "visual", lines: ["Part of the debug interface; not simulated"] },
  R9: { title: "R9 · 0 Ω link PD0 ↔ PB6", status: "simulated", lines: ["Fitted by default for MSP430 BoosterPack compatibility (SPMU296)", "Modeled as a direct connection in the circuit netlist"] },
  R10: { title: "R10 · 0 Ω link PD1 ↔ PB7", status: "simulated", lines: ["Fitted by default for MSP430 BoosterPack compatibility (SPMU296)", "Modeled as a direct connection in the circuit netlist"] },
  J1: headerInfo("J1"), J2: headerInfo("J2"), J3: headerInfo("J3"), J4: headerInfo("J4"),
});

/** Wraps artwork in a selectable component group with a generous hit area (mm). */
function component(id, bounds, inner) {
  const minimum = 3.0; // keep small parts easy to hit
  const w = Math.max(bounds.w, minimum);
  const h = Math.max(bounds.h, minimum);
  const x = bounds.x + bounds.w / 2 - w / 2;
  const y = bounds.y + bounds.h / 2 - h / 2;
  return `
    <g class="lp-component" data-component="${id}" data-status="${COMPONENTS[id].status}">
      <rect x="${S(x)}" y="${S(y)}" width="${S(w)}" height="${S(h)}" rx="${S(0.6)}" class="lp-hit" />
      ${inner}
    </g>`;
}

const around = (p, w, h) => ({ x: p.x - w / 2, y: p.y - h / 2, w, h });

function render() {
  const g = GEOMETRY;
  const holes = CAD_TEST_HOLES.map(inch).map((p) => `<circle cx="${S(p.x)}" cy="${S(p.y)}" r="${S(0.75)}" class="lp-hole" /><circle cx="${S(p.x)}" cy="${S(p.y)}" r="${S(0.45)}" class="lp-drill" />`).join("");
  const tagConnectHoles = CAD_J5_HOLES.map(inch).map((p) => `<circle cx="${S(p.x)}" cy="${S(p.y)}" r="${S(0.5)}" class="lp-drill" />`).join("");
  const r9 = at("R9");
  const r10 = at("R10");
  return `
    <g class="launchpad">
      <rect x="0" y="0" width="${S(g.width)}" height="${S(g.height)}" rx="${S(g.cornerRadius)}" class="lp-pcb" />
      <rect x="${S(0.6)}" y="${S(0.6)}" width="${S(g.width - 1.2)}" height="${S(g.height - 1.2)}" rx="${S(g.cornerRadius)}" class="lp-pcb-edge" />
      <g class="lp-traces">
        <path d="M ${S(g.mcu.x)} ${S(g.mcu.y - 8)} V ${S(g.icdi.y + 8)}" />
        <path d="M ${S(g.mcu.x - 8)} ${S(g.mcu.y)} H ${S(g.headers.J3.x + 6)}" />
        <path d="M ${S(g.mcu.x + 8)} ${S(g.mcu.y)} H ${S(g.headers.J4.x - 6)}" />
        <path d="M ${S(g.mcu.x + 6)} ${S(g.mcu.y - 6)} L ${S(g.rgbLed.x - 6)} ${S(g.rgbLed.y)} H ${S(g.rgbLed.x - 1)}" />
        <path d="M ${S(g.mcu.x - 5)} ${S(g.mcu.y + 6)} V ${S(g.sw1.y - 4)} H ${S(g.sw1.x + 3)}" />
        <path d="M ${S(g.mcu.x + 5)} ${S(g.mcu.y + 6)} V ${S(g.sw2.y - 4)} H ${S(g.sw2.x - 3)}" />
      </g>
      ${holes}
      ${component("J5", around(g.tagConnect, 4.4, 9.0), `${tagConnectHoles}<text x="${S(g.tagConnect.x)}" y="${S(g.tagConnect.y + 0.7)}" class="lp-silk small">J5</text>`)}
      <rect x="${S(1.2)}" y="${S(16.6)}" width="${S(39.0)}" height="${S(0.25)}" class="lp-divider" />
      <text x="${S(21)}" y="${S(18.4)}" class="lp-silk small">ICDI ABOVE · TARGET MCU BELOW</text>
      ${component("J11", { x: g.usbDebug.x - 4, y: -1, w: 8, h: 5.2 }, usbTop(g.usbDebug, "DEBUG"))}
      ${component("J9", { x: -1, y: g.usbDevice.y - 4, w: 5.2, h: 8 }, usbLeft(g.usbDevice, "DEVICE"))}
      ${component("SW3", around(g.powerSwitch, 3.6, 7.6), `
        ${smdPart(g.powerSwitch, CAD_PLACEMENT.SW3[2], 7.0, 3.0, "lp-switch-body")}
        <rect x="${S(g.powerSwitch.x - 0.9)}" y="${S(g.powerSwitch.y - 2.6)}" width="${S(1.8)}" height="${S(2.0)}" rx="0.3" class="lp-slider" />`)}
      <text x="${S(g.powerSwitch.x + 2.4)}" y="${S(g.powerSwitch.y - 1.6)}" class="lp-silk small start">DEBUG</text>
      <text x="${S(g.powerSwitch.x + 2.4)}" y="${S(g.powerSwitch.y + 2.6)}" class="lp-silk small start">DEVICE</text>
      <text x="${S(g.powerSwitch.x)}" y="${S(g.powerSwitch.y + 5.6)}" class="lp-silk small">PWR SELECT</text>
      ${component("U2", around(g.icdi, 12, 12), qfp(g.icdi.x, g.icdi.y, g.icdi.size, 0, "TM4C123G", "ICDI"))}
      ${component("U1", around(g.mcu, 14, 14), qfp(g.mcu.x, g.mcu.y, g.mcu.size, g.mcu.rotation, "TM4C123G", "H6PM"))}
      ${["Y1", "Y2", "Y5"].map((y) => component(y, around(at(y), 5.2, 5.2), crystal(y))).join("")}
      ${passivesArt()}
      ${smdPart(at("U4"), 0, 2.9, 1.6, "lp-ic-small")}
      ${smdPart(at("U8"), 90, 3.0, 3.0, "lp-ic-small")}
      ${smdPart(at("D2"), 180, 2.9, 1.3, "lp-ic-small")}
      ${["Q1", "Q2", "Q3"].map((q) => smdPart(at(q), 0, 1.2, 0.8, "lp-ic-small")).join("")}
      ${component("R9", around(r9, 2.4, 1.6), smdPart(r9, 0, 1.6, 0.8, "lp-res lp-zero"))}
      ${component("R10", around(r10, 2.4, 1.6), smdPart(r10, 0, 1.6, 0.8, "lp-res lp-zero"))}
      <text x="${S(r9.x)}" y="${S(r9.y + 2.2)}" class="lp-silk small">R9</text>
      <text x="${S(r10.x)}" y="${S(r10.y + 2.2)}" class="lp-silk small">R10</text>
      ${["J1", "J3", "J4", "J2"].map((h) => component(h, { x: g.headers[h].x - 1.27, y: g.headers[h].y - 1.27, w: 2.54, h: 25.4 }, headerArt(h))).join("")}
      ${outerLabels()}
      ${component("D4", around(g.powerLed, 2.4, 2.4), `<g class="lp-power-led">${smdPart(g.powerLed, 270, 2.0, 1.25, "lp-led-off")}</g>`)}
      <text x="${S(g.powerLed.x + 2.4)}" y="${S(g.powerLed.y + 0.8)}" class="lp-silk small start">PWR</text>
      ${component("D1", around(g.rgbLed, 4, 4), `
        <g class="lp-rgb">
          <circle cx="${S(g.rgbLed.x)}" cy="${S(g.rgbLed.y)}" r="${S(4.5)}" class="lp-rgb-glow" />
          <rect x="${S(g.rgbLed.x - 1.0)}" y="${S(g.rgbLed.y - 1.0)}" width="${S(2.0)}" height="${S(2.0)}" rx="0.3" class="lp-rgb-body" />
          <circle id="redLed" cx="${S(g.rgbLed.x - 0.5)}" cy="${S(g.rgbLed.y + 0.35)}" r="${S(0.33)}" class="lp-rgb-die red" />
          <circle id="greenLed" cx="${S(g.rgbLed.x)}" cy="${S(g.rgbLed.y - 0.45)}" r="${S(0.33)}" class="lp-rgb-die green" />
          <circle id="blueLed" cx="${S(g.rgbLed.x + 0.5)}" cy="${S(g.rgbLed.y + 0.35)}" r="${S(0.33)}" class="lp-rgb-die blue" />
        </g>`)}
      <text x="${S(g.rgbLed.x - 1.8)}" y="${S(g.rgbLed.y + 0.8)}" class="lp-silk small end">RGB</text>
      ${component("RESET", around(g.reset, 7.4, 7.4), tactileSwitch("resetButton_board", "RESET", g.reset, "RESET"))}
      ${component("SW1", around(g.sw1, 7.4, 7.4), tactileSwitch("sw1Button", "SW1", g.sw1, "SW1"))}
      ${component("SW2", around(g.sw2, 7.4, 7.4), tactileSwitch("sw2Button", "SW2", g.sw2, "SW2"))}
      <text x="${S(g.width / 2)}" y="${S(g.height - 6.4)}" class="lp-silk lp-title">TM4C123G LaunchPad</text>
      <text x="${S(g.width / 2)}" y="${S(g.height - 3.4)}" class="lp-silk small">EK-TM4C123GXL · simulated board view</text>
    </g>`;
}

/** Paints simulator-derived state onto an already rendered board. */
function update(body, part, state = {}) {
  const pins = state.pins ?? {};
  const lit = (gpio) => state.live === true && pins[gpio]?.level === 1 && pins[gpio]?.drive === "output";
  const leds = { redLed: lit(pinMap.onboard.redLed), greenLed: lit(pinMap.onboard.greenLed), blueLed: lit(pinMap.onboard.blueLed) };
  for (const [id, on] of Object.entries(leds)) {
    body.querySelector(`#${id}`)?.classList.toggle("active", on);
  }
  body.querySelector(".lp-rgb-glow")?.setAttribute("style",
    `opacity:${Object.values(leds).some(Boolean) ? 1 : 0};fill:rgb(${leds.redLed ? 255 : 0},${leds.greenLed ? 255 : 0},${leds.blueLed ? 255 : 0})`);
  body.querySelector(".lp-power-led .lp-led-off")?.classList.toggle("active", state.live === true);
  for (const node of body.querySelectorAll("[data-input]")) {
    const pressed = state.pressed?.has(node.dataset.input) === true;
    node.classList.toggle("pressed", pressed);
    node.setAttribute("aria-pressed", String(pressed));
    node.setAttribute("aria-disabled", String(state.live !== true));
  }
}

export const BOARD_PART = Object.freeze({
  type: BOARD_TYPE,
  title: "EK-TM4C123GXL LaunchPad",
  kind: "board",
  status: "simulated",
  idPrefix: "board",
  description: "TM4C123GH6PM executed by Renode. On-board LEDs and switches, and every header GPIO, are connected to the real GPIO model.",
  size: SIZE,
  defaultAttrs: {},
  pins: PINS,
  role,
  pinInfo,
  links,
  render,
  update,
  components: COMPONENTS,
  geometry: GEOMETRY,
  geometrySource: GEOMETRY_SOURCE,
  resetSource: RESET_SOURCE,
  pinMap,
});
