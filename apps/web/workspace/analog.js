/*
 * Analog evaluation for wired potentiometers (decision D-033).
 *
 * A potentiometer is an ideal voltage divider: its wiper (SIG) sits at
 * V(GND end) + (V(VCC end) - V(GND end)) * position. End voltages come from
 * the board supply pins wired to them (3.3V, 5V, GND). The wiper voltage is
 * applied to every ADC-capable board GPIO (AIN0-AIN11) directly wired to it;
 * the ADC model in Renode then converts it when the firmware samples.
 *
 * Not modeled: loading by the ADC input, resistance values, and voltages on
 * nets driven by GPIO outputs (logic levels are not analog sources here).
 * Pure module — no DOM access.
 */
import { ANALOG_INPUTS } from "../board-state.js";
import { splitEndpoint } from "./diagram.js";
import { buildNets } from "./netlist.js";

export const SUPPLY_VOLTS = Object.freeze({ "3.3V": 3.3, "5V": 5.0 });
export const ADC_FULL_SCALE_VOLTS = 3.3;

/** Clamps a potentiometer position attribute to 0-100 (%). */
export function potPosition(part) {
  const value = Number(part.attrs?.position ?? 50);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 50;
}

function netInfo(nets, diagram, catalog, member) {
  const root = nets.strong.find(member);
  const info = { volts: [], gpios: [], pots: [] };
  for (const other of nets.nodes) {
    if (other === member || nets.strong.find(other) !== root) {
      continue;
    }
    const { partId, pin } = splitEndpoint(other);
    const part = diagram.parts.find((p) => p.id === partId);
    const definition = catalog[part.type];
    const role = definition.role?.(pin);
    if (role?.kind === "power" && SUPPLY_VOLTS[role.net] !== undefined) {
      info.volts.push(SUPPLY_VOLTS[role.net]);
    } else if (role?.kind === "ground") {
      info.volts.push(0);
    } else if (role?.kind === "gpio") {
      info.gpios.push(role.gpio);
    } else if (definition.kind === "potentiometer" && pin === "SIG") {
      info.pots.push(partId);
    }
  }
  return info;
}

function endVoltage(info) {
  const distinct = [...new Set(info.volts)];
  if (distinct.length === 1) {
    return { volts: distinct[0] };
  }
  if (distinct.length > 1) {
    return { volts: null, error: "tied to two different supplies (short circuit)" };
  }
  return { volts: null };
}

/**
 * @returns {{
 *   pots: Record<string, { volts: number|null, position: number, reason: string, pins: string[] }>,
 *   inputs: Record<string, number>,   // AIN-capable GPIO -> volts
 *   errors: string[], notes: string[],
 * }}
 */
export function evaluateAnalog(diagram, catalog) {
  const nets = buildNets(diagram, catalog);
  const result = { pots: {}, inputs: {}, errors: [], notes: [] };
  const sources = new Map(); // gpio -> pot ids

  for (const part of diagram.parts) {
    if (catalog[part.type]?.kind !== "potentiometer") {
      continue;
    }
    const position = potPosition(part);
    const high = endVoltage(netInfo(nets, diagram, catalog, `${part.id}:VCC`));
    const low = endVoltage(netInfo(nets, diagram, catalog, `${part.id}:GND`));
    const wiper = netInfo(nets, diagram, catalog, `${part.id}:SIG`);
    for (const [end, info] of [["VCC", high], ["GND", low]]) {
      if (info.error) {
        result.errors.push(`${part.id} ${end} is ${info.error}.`);
      }
    }
    let volts = null;
    let reason;
    if (high.volts === null || low.volts === null) {
      reason = "connect VCC and GND to board supply pins (3.3V or 5V, and GND)";
    } else {
      volts = Math.round((low.volts + (high.volts - low.volts) * position / 100) * 1000) / 1000;
      reason = `${volts.toFixed(3)} V at ${position}%`;
      if (volts > ADC_FULL_SCALE_VOLTS) {
        result.notes.push(`${part.id} wiper is at ${volts.toFixed(2)} V, above the 3.3 V ADC range; on hardware this can damage the MCU.`);
      }
    }
    const pins = wiper.gpios.filter((gpio) => ANALOG_INPUTS[gpio] !== undefined);
    for (const gpio of wiper.gpios.filter((g) => ANALOG_INPUTS[g] === undefined)) {
      result.notes.push(`${part.id} wiper is wired to ${gpio}, which has no ADC input (AIN pins: PE0-PE5, PD0-PD3, PB4-PB5).`);
    }
    if (wiper.volts.length) {
      result.errors.push(`${part.id} wiper is wired directly to a supply or GND.`);
    }
    if (wiper.pots.length) {
      result.errors.push(`${part.id} wiper is wired to another potentiometer's wiper.`);
    }
    for (const gpio of pins) {
      sources.set(gpio, [...(sources.get(gpio) ?? []), part.id]);
      if (volts !== null) {
        result.inputs[gpio] = volts;
      }
    }
    result.pots[part.id] = { volts, position, reason, pins };
  }
  for (const [gpio, pots] of sources) {
    if (pots.length > 1) {
      result.errors.push(`${gpio} is driven by several potentiometers (${pots.join(", ")}).`);
      delete result.inputs[gpio];
    }
  }
  return result;
}
