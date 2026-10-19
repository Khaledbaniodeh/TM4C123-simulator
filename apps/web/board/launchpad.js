/*
 * EK-TM4C123GXL LaunchPad part: original SVG artwork, pin anchors, and pin
 * metadata for the circuit workspace.
 *
 * Geometry (millimetres, origin at the board's top-left corner, USB edge at
 * the top) comes from TI's Rev A design files (SPMR240), extracted in CI by
 * tools/hwref/extract_brd.py — see GEOMETRY_SOURCE below. Header signal
 * assignments come from ek-tm4c123gxl.pins.json (verified against SPMU296
 * by tools/hwref/check_pinmap.py).
 *
 * Electrical state is never decided here: `update()` paints LEDs and
 * switches from the simulator-derived state passed in by the app.
 */
import pinMap from "./ek-tm4c123gxl.pins.json" with { type: "json" };
import { mm } from "../workspace/geometry.js";

export const BOARD_TYPE = "tm4c123gxl-launchpad";

/** Header pitch: 0.1 inch. */
const PITCH = 2.54;

/**
 * Physical layout in mm. PLACEHOLDER values until replaced with the
 * numbers extracted from SPMR240 (see GEOMETRY_SOURCE).
 */
export const GEOMETRY = Object.freeze({
  width: 50.8,
  height: 66.04,
  cornerRadius: 1.5,
  // Pin 1 of each header (pins run downward, 0.1" pitch).
  headers: {
    J1: { x: 6.35, y: 19.05 },
    J3: { x: 8.89, y: 19.05 },
    J4: { x: 41.91, y: 19.05 },
    J2: { x: 44.45, y: 19.05 },
  },
  mcu: { x: 25.4, y: 34.9, size: 10, rotation: 45 },
  icdi: { x: 25.4, y: 11.5, size: 7 },
  usbDebug: { x: 34.0, y: 0 },
  usbDevice: { x: 12.0, y: 0 },
  powerSwitch: { x: 6.0, y: 3.2 },
  reset: { x: 45.5, y: 4.5 },
  sw1: { x: 6.2, y: 60.5 },
  sw2: { x: 44.6, y: 60.5 },
  rgbLed: { x: 37.5, y: 52.5 },
  powerLed: { x: 41.5, y: 9.5 },
  holes: [],
});

export const GEOMETRY_SOURCE = "placeholder — pending SPMR240 extraction";

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
// Artwork (original drawing; proportions from TI design data)
// ---------------------------------------------------------------------------

const S = (value) => mm(value).toFixed(2);

function headerArt(header) {
  const origin = GEOMETRY.headers[header];
  const x = mm(origin.x);
  const y = mm(origin.y);
  const length = mm(PITCH * 10);
  const half = mm(PITCH / 2);
  const right = origin.x > GEOMETRY.width / 2;
  const pins = pinMap.headers[header].map((entry) => {
    const py = mm(origin.y + (entry.pin - 1) * PITCH);
    const label = entry.gpio ?? entry.signal;
    const labelX = right ? x - mm(1.9) : x + mm(1.9);
    return `
      <rect x="${(x - mm(0.95)).toFixed(2)}" y="${(py - mm(0.95)).toFixed(2)}" width="${S(1.9)}" height="${S(1.9)}" rx="1" class="lp-pad" />
      <rect x="${(x - mm(0.32)).toFixed(2)}" y="${(py - mm(0.32)).toFixed(2)}" width="${S(0.64)}" height="${S(0.64)}" class="lp-pin" />
      <text x="${labelX.toFixed(2)}" y="${(py + mm(0.45)).toFixed(2)}" class="lp-silk lp-pinlabel ${right ? "end" : "start"}">${label}</text>`;
  }).join("");
  const numberX = x;
  return `
    <g class="lp-header" data-header="${header}">
      <rect x="${(x - half).toFixed(2)}" y="${(y - half).toFixed(2)}" width="${(half * 2).toFixed(2)}" height="${length.toFixed(2)}" rx="1.5" class="lp-header-body" />
      ${pins}
      <text x="${numberX.toFixed(2)}" y="${(y - mm(2.2)).toFixed(2)}" class="lp-silk lp-header-name">${header}</text>
    </g>`;
}

function qfp(cx, cy, size, rotation, label, sublabel) {
  const body = mm(size);
  const leadLength = mm(1.0);
  const leads = [];
  const count = 16;
  const span = body * 0.82;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < count; i++) {
      const offset = -span / 2 + (span * (i + 0.5)) / count;
      const half = body / 2;
      const [x, y, w, h] = [
        [offset - 0.6, -half - leadLength, 1.2, leadLength],
        [half, offset - 0.6, leadLength, 1.2],
        [offset - 0.6, half, 1.2, leadLength],
        [-half - leadLength, offset - 0.6, leadLength, 1.2],
      ][side];
      leads.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" class="lp-lead" />`);
    }
  }
  return `
    <g transform="translate(${mm(cx).toFixed(2)} ${mm(cy).toFixed(2)}) rotate(${rotation})">
      ${leads.join("")}
      <rect x="${(-body / 2).toFixed(2)}" y="${(-body / 2).toFixed(2)}" width="${body.toFixed(2)}" height="${body.toFixed(2)}" rx="1.2" class="lp-chip" />
      <circle cx="${(-body / 2 + 4).toFixed(2)}" cy="${(-body / 2 + 4).toFixed(2)}" r="1.4" class="lp-chip-dot" />
      <g transform="rotate(${-rotation})">
        <text y="-1" class="lp-chip-text">${label}</text>
        <text y="6" class="lp-chip-subtext">${sublabel}</text>
      </g>
    </g>`;
}

function usbArt(x, label) {
  return `
    <g class="lp-usb">
      <rect x="${S(x - 4)}" y="${S(-1.2)}" width="${S(8)}" height="${S(5.6)}" rx="1.5" class="lp-usb-shell" />
      <rect x="${S(x - 2.9)}" y="${S(-0.6)}" width="${S(5.8)}" height="${S(1.6)}" rx="0.6" class="lp-usb-mouth" />
      <text x="${S(x)}" y="${S(7.2)}" class="lp-silk">${label}</text>
    </g>`;
}

function tactileSwitch(id, input, position, label, size = 6) {
  const { x, y } = position;
  return `
    <g id="${id}" class="lp-switch" data-input="${input}" role="button" tabindex="0" aria-pressed="false"
       aria-label="${label} — hold to press while the simulation runs">
      <rect x="${S(x - size / 2)}" y="${S(y - size / 2)}" width="${S(size)}" height="${S(size)}" rx="2" class="lp-switch-body" />
      <circle cx="${S(x)}" cy="${S(y)}" r="${S(size * 0.29)}" class="lp-switch-cap" />
      <text x="${S(x)}" y="${S(y + size / 2 + 2.3)}" class="lp-silk">${label}</text>
    </g>`;
}

function render() {
  const g = GEOMETRY;
  const smd = [];
  // Decorative passives near the MCUs (positions are illustrative, not placement data).
  const passives = [[18, 26], [20, 26], [31, 26], [33, 26], [18, 44], [20, 44], [31, 44], [33, 44], [16.5, 33], [16.5, 36], [34.5, 33], [34.5, 36], [20, 7.5], [30.5, 7.5], [20, 15.5], [30.5, 15.5]];
  for (const [x, y] of passives) {
    smd.push(`<rect x="${S(x - 0.8)}" y="${S(y - 0.4)}" width="${S(1.6)}" height="${S(0.8)}" class="lp-passive" />`);
  }
  return `
    <g class="launchpad">
      <rect x="0" y="0" width="${S(g.width)}" height="${S(g.height)}" rx="${S(g.cornerRadius)}" class="lp-pcb" />
      <rect x="${S(0.8)}" y="${S(0.8)}" width="${S(g.width - 1.6)}" height="${S(g.height - 1.6)}" rx="${S(g.cornerRadius)}" class="lp-pcb-edge" />
      <g class="lp-traces">
        <path d="M ${S(g.mcu.x)} ${S(g.mcu.y - 9)} V ${S(g.icdi.y + 6)}" />
        <path d="M ${S(g.mcu.x - 9)} ${S(g.mcu.y)} H ${S(g.headers.J3.x + 2)}" />
        <path d="M ${S(g.mcu.x + 9)} ${S(g.mcu.y)} H ${S(g.headers.J4.x - 2)}" />
        <path d="M ${S(g.mcu.x)} ${S(g.mcu.y + 9)} V ${S(g.rgbLed.y - 4)} H ${S(g.rgbLed.x)}" />
      </g>
      ${g.holes.map((h) => `<circle cx="${S(h.x)}" cy="${S(h.y)}" r="${S(h.r ?? 1.6)}" class="lp-hole" />`).join("")}
      ${usbArt(g.usbDevice.x, "DEVICE")}
      ${usbArt(g.usbDebug.x, "DEBUG")}
      <g class="lp-power-switch">
        <rect x="${S(g.powerSwitch.x - 3)}" y="${S(g.powerSwitch.y - 1.3)}" width="${S(6)}" height="${S(2.6)}" rx="0.6" class="lp-switch-body" />
        <rect x="${S(g.powerSwitch.x - 2.6)}" y="${S(g.powerSwitch.y - 0.8)}" width="${S(2.2)}" height="${S(1.6)}" rx="0.4" class="lp-slider" />
        <text x="${S(g.powerSwitch.x)}" y="${S(g.powerSwitch.y + 3.6)}" class="lp-silk small">PWR SELECT</text>
      </g>
      ${qfp(g.icdi.x, g.icdi.y, g.icdi.size, 0, "ICDI", "debug")}
      ${qfp(g.mcu.x, g.mcu.y, g.mcu.size, g.mcu.rotation, "TM4C123", "GH6PM")}
      ${smd.join("")}
      ${["J1", "J3", "J4", "J2"].map(headerArt).join("")}
      <g class="lp-power-led">
        <rect x="${S(g.powerLed.x - 0.8)}" y="${S(g.powerLed.y - 0.5)}" width="${S(1.6)}" height="${S(1)}" class="lp-led-off" id="powerLed" />
        <text x="${S(g.powerLed.x)}" y="${S(g.powerLed.y + 2.6)}" class="lp-silk small">PWR</text>
      </g>
      <g class="lp-rgb">
        <rect x="${S(g.rgbLed.x - 2.6)}" y="${S(g.rgbLed.y - 2.6)}" width="${S(5.2)}" height="${S(5.2)}" rx="0.8" class="lp-rgb-body" />
        <circle id="redLed" cx="${S(g.rgbLed.x - 1.3)}" cy="${S(g.rgbLed.y)}" r="${S(0.75)}" class="lp-rgb-die red" />
        <circle id="greenLed" cx="${S(g.rgbLed.x)}" cy="${S(g.rgbLed.y - 1.1)}" r="${S(0.75)}" class="lp-rgb-die green" />
        <circle id="blueLed" cx="${S(g.rgbLed.x + 1.3)}" cy="${S(g.rgbLed.y)}" r="${S(0.75)}" class="lp-rgb-die blue" />
        <circle cx="${S(g.rgbLed.x)}" cy="${S(g.rgbLed.y)}" r="${S(4.2)}" class="lp-rgb-glow" />
        <text x="${S(g.rgbLed.x)}" y="${S(g.rgbLed.y + 4.7)}" class="lp-silk small">RGB LED</text>
      </g>
      ${tactileSwitch("resetButton_board", "RESET", g.reset, "RESET", 4.4)}
      ${tactileSwitch("sw1Button", "SW1", g.sw1, "SW1")}
      ${tactileSwitch("sw2Button", "SW2", g.sw2, "SW2")}
      <text x="${S(g.width / 2)}" y="${S(g.height - 6.8)}" class="lp-silk lp-title">TM4C123G LaunchPad</text>
      <text x="${S(g.width / 2)}" y="${S(g.height - 3.6)}" class="lp-silk small">EK-TM4C123GXL · simulated board view</text>
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
  body.querySelector("#powerLed")?.classList.toggle("active", state.live === true);
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
  geometry: GEOMETRY,
  geometrySource: GEOMETRY_SOURCE,
  pinMap,
});
