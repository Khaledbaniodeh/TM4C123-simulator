/*
 * Circuit diagram model, serialized in a Wokwi-inspired `diagram.json`
 * format (docs.wokwi.com/diagram-format):
 *
 *   { version: 1, author, editor, parts: [{ type, id, top, left, rotate, attrs }],
 *     connections: [[ "partId:pin", "partId:pin", color, routing[] ]] }
 *
 * Part types are this project's own (see parts.js); full Wokwi compatibility
 * is NOT claimed. All edits go through commands so they can be undone.
 *
 * Pure module — no DOM access.
 */
import { normalizeRotation, round } from "./geometry.js";

export const DIAGRAM_VERSION = 1;
export const EDITOR_NAME = "tm4c123-simulator";
export const WIRE_COLORS = Object.freeze(["green", "blue", "red", "black", "orange", "yellow", "purple", "gray", "white"]);

export function createDiagram({ author = "" } = {}) {
  return {
    version: DIAGRAM_VERSION,
    author,
    editor: EDITOR_NAME,
    parts: [{ type: "tm4c123gxl-launchpad", id: "board1", top: 0, left: 0, rotate: 0, attrs: {} }],
    connections: [],
  };
}

export function splitEndpoint(endpoint) {
  const text = String(endpoint);
  const index = text.indexOf(":");
  return index > 0 ? { partId: text.slice(0, index), pin: text.slice(index + 1) } : null;
}

export function sameConnection(a, b) {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

/**
 * Validates a diagram against a part catalog ({ [type]: { pins: [{ name }] } }).
 * Returns a list of human-readable errors (empty when valid).
 */
export function validateDiagram(diagram, catalog) {
  const errors = [];
  if (!diagram || typeof diagram !== "object") {
    return ["Diagram must be a JSON object."];
  }
  if (diagram.version !== DIAGRAM_VERSION) {
    errors.push(`Unsupported diagram version ${JSON.stringify(diagram.version)} (expected ${DIAGRAM_VERSION}).`);
  }
  if (!Array.isArray(diagram.parts)) {
    errors.push("`parts` must be an array.");
    return errors;
  }
  if (!Array.isArray(diagram.connections)) {
    errors.push("`connections` must be an array.");
    return errors;
  }

  const parts = new Map();
  for (const [index, part] of diagram.parts.entries()) {
    const where = `parts[${index}]`;
    if (!part || typeof part.id !== "string" || !/^[A-Za-z][\w-]{0,40}$/.test(part.id)) {
      errors.push(`${where}: invalid id ${JSON.stringify(part?.id)}.`);
      continue;
    }
    if (parts.has(part.id)) {
      errors.push(`${where}: duplicate id "${part.id}".`);
      continue;
    }
    if (!catalog[part.type]) {
      errors.push(`${where} (${part.id}): unknown part type "${part.type}".`);
      continue;
    }
    for (const key of ["top", "left"]) {
      if (part[key] !== undefined && !Number.isFinite(part[key])) {
        errors.push(`${where} (${part.id}): ${key} must be a number.`);
      }
    }
    if (part.rotate !== undefined && (!Number.isFinite(part.rotate) || part.rotate % 90 !== 0)) {
      errors.push(`${where} (${part.id}): rotate must be a multiple of 90.`);
    }
    if (part.attrs !== undefined && (typeof part.attrs !== "object" || Array.isArray(part.attrs))) {
      errors.push(`${where} (${part.id}): attrs must be an object.`);
    }
    parts.set(part.id, part);
  }

  const seen = [];
  for (const [index, connection] of diagram.connections.entries()) {
    const where = `connections[${index}]`;
    if (!Array.isArray(connection) || connection.length < 2 || connection.length > 4) {
      errors.push(`${where}: expected [from, to, color, routing].`);
      continue;
    }
    const [from, to, color = "", routing = []] = connection;
    for (const endpoint of [from, to]) {
      const parsed = splitEndpoint(endpoint);
      if (!parsed) {
        errors.push(`${where}: endpoint ${JSON.stringify(endpoint)} must look like "partId:pin".`);
        continue;
      }
      const part = parts.get(parsed.partId);
      if (!part) {
        errors.push(`${where}: unknown part "${parsed.partId}".`);
      } else if (!catalog[part.type].pins.some((pin) => pin.name === parsed.pin)) {
        errors.push(`${where}: part "${parsed.partId}" has no pin "${parsed.pin}".`);
      }
    }
    if (from === to) {
      errors.push(`${where}: a wire cannot connect a pin to itself.`);
    }
    if (typeof color !== "string") {
      errors.push(`${where}: color must be a string.`);
    }
    if (!Array.isArray(routing) || routing.some((step) => step !== "*" && !/^[vh]-?\d+(\.\d+)?$/.test(String(step)))) {
      errors.push(`${where}: routing must be an array of "v<n>", "h<n>", or "*".`);
    }
    if (seen.some((other) => sameConnection(other, connection))) {
      errors.push(`${where}: duplicate wire between ${from} and ${to}.`);
    }
    seen.push(connection);
  }
  return errors;
}

/** Parses diagram text. Returns { diagram, errors }. */
export function parseDiagram(text, catalog) {
  let diagram;
  try {
    diagram = JSON.parse(text);
  } catch (error) {
    return { diagram: null, errors: [`Invalid JSON: ${error.message}`] };
  }
  const errors = validateDiagram(diagram, catalog);
  return { diagram: errors.length ? null : normalizeDiagram(diagram), errors };
}

/** Canonical form: fills defaults, rounds coordinates, keeps part and wire order. */
export function normalizeDiagram(diagram) {
  return {
    version: DIAGRAM_VERSION,
    author: String(diagram.author ?? ""),
    editor: EDITOR_NAME,
    parts: diagram.parts.map((part) => ({
      type: part.type,
      id: part.id,
      top: round(part.top ?? 0),
      left: round(part.left ?? 0),
      rotate: normalizeRotation(part.rotate ?? 0),
      attrs: { ...(part.attrs ?? {}) },
    })),
    connections: diagram.connections.map(([from, to, color = "", routing = []]) => [from, to, color, [...routing]]),
  };
}

export function serializeDiagram(diagram) {
  return `${JSON.stringify(normalizeDiagram(diagram), null, 2)}\n`;
}

export function findPart(diagram, id) {
  return diagram.parts.find((part) => part.id === id) ?? null;
}

/** Next free id with the given prefix: led1, led2, ... */
export function nextPartId(diagram, prefix) {
  const used = new Set(diagram.parts.map((part) => part.id));
  for (let n = 1; ; n++) {
    if (!used.has(`${prefix}${n}`)) {
      return `${prefix}${n}`;
    }
  }
}

export function connectionsOf(diagram, partId) {
  return diagram.connections.filter(([from, to]) => splitEndpoint(from)?.partId === partId || splitEndpoint(to)?.partId === partId);
}

// ---------------------------------------------------------------------------
// Commands and history (undo/redo)
// ---------------------------------------------------------------------------

/** Each command mutates the diagram in `apply` and restores it exactly in `revert`. */
export const commands = {
  addPart(part) {
    return {
      label: `Add ${part.id}`,
      apply: (d) => { d.parts.push(structuredClone(part)); },
      revert: (d) => { d.parts = d.parts.filter((p) => p.id !== part.id); },
    };
  },

  removePart(diagram, id) {
    const index = diagram.parts.findIndex((p) => p.id === id);
    const part = structuredClone(diagram.parts[index]);
    const wires = diagram.connections
      .map((connection, position) => ({ connection: structuredClone(connection), position }))
      .filter(({ connection }) => [connection[0], connection[1]].some((e) => splitEndpoint(e)?.partId === id));
    return {
      label: `Delete ${id}`,
      apply: (d) => {
        d.parts = d.parts.filter((p) => p.id !== id);
        d.connections = d.connections.filter(([from, to]) => splitEndpoint(from)?.partId !== id && splitEndpoint(to)?.partId !== id);
      },
      revert: (d) => {
        d.parts.splice(index, 0, structuredClone(part));
        for (const { connection, position } of wires) {
          d.connections.splice(position, 0, structuredClone(connection));
        }
      },
    };
  },

  movePart(id, from, to) {
    return {
      label: `Move ${id}`,
      apply: (d) => Object.assign(findPart(d, id), { left: to.left, top: to.top }),
      revert: (d) => Object.assign(findPart(d, id), { left: from.left, top: from.top }),
    };
  },

  rotatePart(id, from, to) {
    return {
      label: `Rotate ${id}`,
      apply: (d) => { findPart(d, id).rotate = normalizeRotation(to); },
      revert: (d) => { findPart(d, id).rotate = normalizeRotation(from); },
    };
  },

  setAttr(id, key, from, to) {
    return {
      label: `Set ${id}.${key}`,
      apply: (d) => { findPart(d, id).attrs[key] = to; },
      revert: (d) => {
        if (from === undefined) {
          delete findPart(d, id).attrs[key];
        } else {
          findPart(d, id).attrs[key] = from;
        }
      },
    };
  },

  addConnection(connection) {
    return {
      label: `Wire ${connection[0]} → ${connection[1]}`,
      apply: (d) => { d.connections.push(structuredClone(connection)); },
      revert: (d) => {
        const index = d.connections.findIndex((c) => sameConnection(c, connection));
        if (index >= 0) {
          d.connections.splice(index, 1);
        }
      },
    };
  },

  removeConnection(diagram, index) {
    const connection = structuredClone(diagram.connections[index]);
    return {
      label: `Delete wire ${connection[0]} → ${connection[1]}`,
      apply: (d) => { d.connections.splice(index, 1); },
      revert: (d) => { d.connections.splice(index, 0, structuredClone(connection)); },
    };
  },

  updateConnection(diagram, index, changes) {
    const before = structuredClone(diagram.connections[index]);
    const after = structuredClone(before);
    if (changes.color !== undefined) {
      after[2] = changes.color;
    }
    if (changes.routing !== undefined) {
      after[3] = [...changes.routing];
    }
    return {
      label: `Edit wire ${before[0]} → ${before[1]}`,
      apply: (d) => { d.connections[index] = structuredClone(after); },
      revert: (d) => { d.connections[index] = structuredClone(before); },
    };
  },

  /** Several commands applied and reverted as one undo step. */
  batch(label, list) {
    return {
      label,
      apply: (d) => list.forEach((c) => c.apply(d)),
      revert: (d) => [...list].reverse().forEach((c) => c.revert(d)),
    };
  },
};

export class History {
  #done = [];
  #undone = [];
  #limit;

  constructor(diagram, { limit = 200 } = {}) {
    this.diagram = diagram;
    this.#limit = limit;
  }

  execute(command) {
    command.apply(this.diagram);
    this.#done.push(command);
    if (this.#done.length > this.#limit) {
      this.#done.shift();
    }
    this.#undone = [];
    return command;
  }

  undo() {
    const command = this.#done.pop();
    if (!command) {
      return null;
    }
    command.revert(this.diagram);
    this.#undone.push(command);
    return command;
  }

  redo() {
    const command = this.#undone.pop();
    if (!command) {
      return null;
    }
    command.apply(this.diagram);
    this.#done.push(command);
    return command;
  }

  get canUndo() {
    return this.#done.length > 0;
  }

  get canRedo() {
    return this.#undone.length > 0;
  }

  /** Replaces the diagram (e.g. after loading a file) and clears history. */
  reset(diagram) {
    this.diagram = diagram;
    this.#done = [];
    this.#undone = [];
  }
}
