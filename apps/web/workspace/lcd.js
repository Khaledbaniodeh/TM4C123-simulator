/*
 * Connects an LCD1602 part in the circuit workspace to the simulated MCU.
 *
 * `bindLcd()` resolves, from the wired diagram, which board GPIOs and fixed
 * levels (5V/3.3V, GND) reach each LCD pin through direct connections.
 * `LcdSimulation` then consumes the GPIO model's `digital-pin-changed`
 * events in order, applies the pin changes of one register write together
 * (`update`/`updateSize`), and strobes the HD44780 controller on every
 * falling edge of E. Everything shown on the LCD therefore comes from GPIO
 * activity of the running firmware.
 *
 * Signals must be wired directly (wires, board-internal shorts such as
 * R9/R10); a resistor in a signal line is not a supported LCD connection.
 * Pure module — no DOM access.
 */
import { splitEndpoint } from "./diagram.js";
import { buildNets } from "./netlist.js";
import { Hd44780 } from "./hd44780.js";

export const LCD_SIGNALS = Object.freeze(["RS", "RW", "E", "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"]);

/**
 * @returns {{
 *   partId: string,
 *   signals: Record<string, { gpios: string[], high: boolean, low: boolean }>,
 *   powered: boolean, backlight: boolean, contrastConnected: boolean,
 *   interface: "4-bit"|"8-bit"|"incomplete", errors: string[], notes: string[],
 * }}
 */
export function bindLcd(diagram, catalog, partId) {
  const nets = buildNets(diagram, catalog);
  const describe = (pin) => {
    const root = nets.strong.find(`${partId}:${pin}`);
    const result = { gpios: [], high: false, low: false, connected: false };
    for (const member of nets.nodes) {
      if (member === `${partId}:${pin}` || nets.strong.find(member) !== root) {
        continue;
      }
      result.connected = true;
      const { partId: otherId, pin: otherPin } = splitEndpoint(member);
      const part = diagram.parts.find((p) => p.id === otherId);
      const role = catalog[part.type].role?.(otherPin);
      if (role?.kind === "gpio" && !result.gpios.includes(role.gpio)) {
        result.gpios.push(role.gpio);
      } else if (role?.kind === "power") {
        result.high = true;
      } else if (role?.kind === "ground") {
        result.low = true;
      }
    }
    return result;
  };

  const errors = [];
  const notes = [];
  const signals = {};
  for (const name of LCD_SIGNALS) {
    signals[name] = describe(name);
    if (signals[name].high && signals[name].low) {
      errors.push(`LCD ${name} is tied to both a supply and GND.`);
    }
  }
  const vdd = describe("VDD");
  const vss = describe("VSS");
  const powered = vdd.high && !vdd.low && vss.low && !vss.high;
  if (!powered) {
    errors.push("LCD is not powered: connect VDD to 5V (or 3.3V) and VSS to GND.");
  }
  const a = describe("A");
  const k = describe("K");
  const backlight = a.high && k.low;
  const contrastConnected = describe("V0").connected;
  if (!contrastConnected) {
    notes.push("V0 (contrast) is unconnected; on hardware the text may be invisible. The simulator shows it anyway.");
  }

  const driven = (name) => signals[name].gpios.length > 0 || signals[name].high || signals[name].low;
  const dataHigh = ["D4", "D5", "D6", "D7"].every((name) => signals[name].gpios.length > 0);
  const dataLow = ["D0", "D1", "D2", "D3"].every((name) => signals[name].gpios.length > 0);
  let iface = "incomplete";
  if (dataHigh && signals.RS.gpios.length && signals.E.gpios.length && driven("RW")) {
    iface = dataLow ? "8-bit" : "4-bit";
  } else if (powered) {
    errors.push("LCD needs RS, E, and D4-D7 wired to GPIOs, and RW wired to GND or a GPIO.");
  }
  if (signals.RW.gpios.length && signals.RW.low) {
    notes.push(`RW is tied to GND and also wired to ${signals.RW.gpios.join("/")} (D-024): driving it HIGH is a short.`);
  }
  return { partId, signals, powered, backlight, contrastConnected, interface: iface, errors, notes };
}

/** Resolves one LCD input from the current GPIO states. */
function signalLevel(signal, pinStates) {
  let high = signal.high;
  let low = signal.low;
  for (const gpio of signal.gpios) {
    const state = pinStates.get(gpio);
    if (state?.level === 1 && (state.drive === "output" || state.drive === "conflict")) {
      high = true;
    } else if (state?.level === 0 && (state.drive === "output" || state.drive === "conflict")) {
      low = true;
    } else if (state?.drive === "conflict") {
      high = true;
      low = true;
    }
  }
  if (high && low) {
    return null; // contention: undefined level
  }
  return high ? 1 : low ? 0 : null;
}

export class LcdSimulation {
  /**
   * @param binding  result of bindLcd()
   * @param options  { powerOnNs } virtual time at which the LCD powered up
   */
  constructor(binding, { powerOnNs = 0n } = {}) {
    this.binding = binding;
    this.controller = new Hd44780({ powerOnNs });
    this.pinStates = new Map();
    this.pending = null;
    this.e = null;
    this.edges = 0;
    this.undefinedStrobes = 0;
  }

  /** Feeds one simulator event; only digital-pin-changed events matter. */
  handleEvent(event) {
    if (event.type === "port-snapshot") {
      this.#flush();
      for (const pin of event.pins ?? []) {
        this.pinStates.set(pin.pinId, { level: pin.level, drive: pin.drive });
      }
      this.#evaluate(BigInt(event.virtualTimeNs ?? 0));
      return;
    }
    if (event.type !== "digital-pin-changed") {
      return;
    }
    const key = event.update === undefined ? null : `${event.pin.pinId.slice(0, 2)}:${event.update}`;
    if (this.pending && this.pending.key !== key) {
      this.#flush();
    }
    if (!this.pending) {
      this.pending = { key, events: [] };
    }
    this.pending.events.push(event);
    if (key === null || this.pending.events.length >= (event.updateSize ?? 1)) {
      this.#flush();
    }
  }

  #flush() {
    if (!this.pending) {
      return;
    }
    const { events } = this.pending;
    this.pending = null;
    for (const event of events) {
      this.pinStates.set(event.pin.pinId, { level: event.level, drive: event.drive });
    }
    this.#evaluate(BigInt(events.at(-1).virtualTimeNs));
  }

  #evaluate(timeNs) {
    if (!this.binding.powered || this.binding.interface === "incomplete") {
      return;
    }
    const level = (name) => signalLevel(this.binding.signals[name], this.pinStates);
    const e = level("E");
    if (this.e === 1 && e === 0) {
      this.edges++;
      let data = 0;
      let undefinedLines = false;
      const lines = this.binding.interface === "8-bit" ? ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"] : ["D4", "D5", "D6", "D7"];
      for (const name of lines) {
        const value = level(name);
        if (value === null) {
          undefinedLines = true;
        }
        if (value === 1) {
          data |= 1 << Number(name.slice(1));
        }
      }
      const rs = level("RS");
      const rw = level("RW");
      if (undefinedLines || rs === null || rw === null) {
        this.undefinedStrobes++;
      }
      this.controller.latch({ rs: rs === 1 ? 1 : 0, rw: rw === 1 ? 1 : 0, data }, timeNs);
    }
    this.e = e;
  }

  /** Current display. A register write whose pin events are still arriving is not applied yet. */
  snapshot() {
    const snapshot = this.controller.snapshot();
    return {
      ...snapshot,
      powered: this.binding.powered,
      backlight: this.binding.backlight,
      interface: this.binding.interface,
      errors: this.binding.errors,
      notes: this.binding.notes,
      edges: this.edges,
      undefinedStrobes: this.undefinedStrobes,
    };
  }
}
