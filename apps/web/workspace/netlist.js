/*
 * Logic-level circuit evaluation for wired external parts (decision D-012:
 * logical electrical model, not SPICE).
 *
 * Nets are built from wires plus each part's internal connections:
 *   - strong links: wires, closed pushbuttons, board-internal shorts
 *     (all GND pins, R9/R10 between PD0-PB6 and PD1-PB7)
 *   - weak links:   resistors (pass a logic level, but lose to a strong one)
 *
 * Inputs to this module come from the simulator: the resolved state of each
 * TM4C123 pin as reported by the Renode GPIO model. Outputs are
 *   - which external LEDs are lit (and why / why not), and
 *   - which external levels must be driven onto board GPIO inputs.
 * The browser applies the latter through the orchestrator's input API, so
 * firmware sees them through the real GPIO model.
 *
 * Pure module — no DOM access.
 */
import { splitEndpoint } from "./diagram.js";

class UnionFind {
  #parent = new Map();

  find(node) {
    if (!this.#parent.has(node)) {
      this.#parent.set(node, node);
    }
    let root = node;
    while (this.#parent.get(root) !== root) {
      root = this.#parent.get(root);
    }
    let current = node;
    while (this.#parent.get(current) !== root) {
      const next = this.#parent.get(current);
      this.#parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.#parent.set(rootA, rootB);
    }
  }

  groups(nodes) {
    const groups = new Map();
    for (const node of nodes) {
      const root = this.find(node);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root).push(node);
    }
    return groups;
  }
}

const node = (partId, pin) => `${partId}:${pin}`;

/**
 * @param diagram   normalized diagram
 * @param catalog   part catalog: { [type]: { pins, links?(part, inputs), role?(pin) } }
 * @param inputs    { pressed: Set<partId> } — external pushbuttons currently held
 */
export function buildNets(diagram, catalog, inputs = { pressed: new Set() }) {
  const strong = new UnionFind();
  const weak = new UnionFind();
  const nodes = new Set();

  for (const part of diagram.parts) {
    const definition = catalog[part.type];
    for (const pin of definition.pins) {
      nodes.add(node(part.id, pin.name));
      strong.find(node(part.id, pin.name));
      weak.find(node(part.id, pin.name));
    }
    for (const link of definition.links?.(part, inputs) ?? []) {
      const a = node(part.id, link.a);
      const b = node(part.id, link.b);
      weak.union(a, b);
      if (link.strength !== "weak") {
        strong.union(a, b);
      }
    }
  }
  for (const [from, to] of diagram.connections) {
    if (splitEndpoint(from) && splitEndpoint(to)) {
      strong.union(from, to);
      weak.union(from, to);
    }
  }
  return { strong, weak, nodes: [...nodes] };
}

/**
 * Classifies what drives a set of nodes.
 * `pinStates` maps GPIO names ("PF1") to { level, drive } from board-state.
 */
function sources(members, diagram, catalog, pinStates, exclude = null) {
  const found = { high: [], low: [] };
  for (const member of members) {
    if (member === exclude) {
      continue;
    }
    const { partId, pin } = splitEndpoint(member);
    const part = diagram.parts.find((p) => p.id === partId);
    const definition = catalog[part.type];
    const role = definition.role?.(pin);
    if (!role) {
      continue;
    }
    if (role.kind === "power") {
      found.high.push(member);
    } else if (role.kind === "ground") {
      found.low.push(member);
    } else if (role.kind === "gpio") {
      const state = pinStates[role.gpio];
      if (state?.drive === "output" && state.level === 1) {
        found.high.push(member);
      } else if (state?.drive === "output" && state.level === 0) {
        found.low.push(member);
      }
    }
  }
  return found;
}

function netLevel(nets, member, diagram, catalog, pinStates, exclude) {
  const strongMembers = membersOf(nets.strong, nets.nodes, member);
  const strongSources = sources(strongMembers, diagram, catalog, pinStates, exclude);
  if (strongSources.high.length && strongSources.low.length) {
    return { level: null, strength: "strong", short: true, sources: strongSources };
  }
  if (strongSources.high.length || strongSources.low.length) {
    return { level: strongSources.high.length ? 1 : 0, strength: "strong", short: false, sources: strongSources };
  }
  const weakMembers = membersOf(nets.weak, nets.nodes, member);
  const weakSources = sources(weakMembers, diagram, catalog, pinStates, exclude);
  if (weakSources.high.length && weakSources.low.length) {
    return { level: null, strength: "weak", short: false, contention: true, sources: weakSources };
  }
  if (weakSources.high.length || weakSources.low.length) {
    return { level: weakSources.high.length ? 1 : 0, strength: "weak", short: false, sources: weakSources };
  }
  return { level: null, strength: "none", short: false, sources: weakSources };
}

function membersOf(unionFind, nodes, member) {
  const root = unionFind.find(member);
  return nodes.filter((n) => unionFind.find(n) === root);
}

/**
 * Evaluates the circuit for the current simulator pin states.
 *
 * @returns {{
 *   leds: Record<string, { on: boolean, reason: string, warning?: string }>,
 *   boardInputs: Record<string, { level: boolean|null, strength: string }>,
 *   errors: string[],
 * }}
 */
export function evaluateCircuit(diagram, catalog, pinStates, inputs = { pressed: new Set() }) {
  const nets = buildNets(diagram, catalog, inputs);
  const result = { leds: {}, boardInputs: {}, errors: [] };

  for (const part of diagram.parts) {
    if (catalog[part.type].kind !== "led") {
      continue;
    }
    const anode = netLevel(nets, node(part.id, "A"), diagram, catalog, pinStates);
    const cathode = netLevel(nets, node(part.id, "C"), diagram, catalog, pinStates);
    const on = anode.level === 1 && cathode.level === 0;
    let reason;
    if (on) {
      reason = "forward biased";
    } else if (anode.level === null && cathode.level === null) {
      reason = "not connected to a driven net";
    } else if (anode.level !== 1) {
      reason = anode.level === 0 ? "anode is LOW" : "anode is not driven HIGH";
    } else {
      reason = cathode.level === 1 ? "cathode is HIGH" : "cathode is not connected to LOW/GND";
    }
    const entry = { on, reason };
    if (on && anode.strength === "strong" && cathode.strength === "strong") {
      entry.warning = "No series resistor: a real LED would draw excessive current.";
    }
    result.leds[part.id] = entry;
  }

  // External drive onto each board GPIO pin (pushbuttons, pulls, direct ties).
  for (const part of diagram.parts) {
    const definition = catalog[part.type];
    if (definition.kind !== "board") {
      continue;
    }
    for (const pin of definition.pins) {
      const role = definition.role(pin.name);
      if (role?.kind !== "gpio") {
        continue;
      }
      const member = node(part.id, pin.name);
      // Only external connections count: ignore the pin's own output.
      const level = netLevel(nets, member, diagram, catalog, pinStates, member);
      if (level.short) {
        result.errors.push(`Short circuit on the net of ${pin.name} (${role.gpio}): HIGH and LOW are tied together.`);
      }
      const externallyDriven = level.level !== null && (level.sources.high.length + level.sources.low.length) > 0;
      const previous = result.boardInputs[role.gpio];
      // A GPIO may appear on several header pins (and R9/R10 shorts); keep the strongest.
      if (!previous || (externallyDriven && previous.level === null) || (level.strength === "strong" && previous.strength !== "strong")) {
        result.boardInputs[role.gpio] = externallyDriven
          ? { level: level.level === 1, strength: level.strength }
          : { level: null, strength: "none" };
      }
    }
  }
  return result;
}
