/*
 * Multi-item editing operations on a diagram: move, remove, copy, paste.
 *
 * Every function is pure: it returns the new `parts`/`connections` arrays
 * (and the ids/indices of the affected items) without mutating its input.
 * The canvas applies a result with commands.setContent, which records the
 * whole before/after content, so undo and redo restore it exactly.
 *
 * Wire integrity rules:
 *   - moving parts never edits wires (routing is relative to the source pin,
 *     and the path to the target is re-derived);
 *   - removing a part removes every wire attached to it;
 *   - copying takes the selected parts plus every wire between two of them;
 *     wires to parts that are not copied are left out (a selected wire with
 *     only one copied end has nothing to attach to in the copy);
 *   - pasting gives every part a fresh id and rewrites wire endpoints.
 */
import { nextPartId, splitEndpoint } from "./diagram.js";

const clone = (value) => structuredClone(value);
const partOf = (endpoint) => splitEndpoint(endpoint)?.partId ?? null;

/** Moves the given parts by (dx, dy). */
export function moveParts(diagram, ids, dx, dy) {
  const moving = new Set(ids);
  return {
    parts: diagram.parts.map((part) => (moving.has(part.id) ? { ...clone(part), left: part.left + dx, top: part.top + dy } : clone(part))),
    connections: clone(diagram.connections),
  };
}

/** Removes parts (with their attached wires) and the given wires. */
export function removeItems(diagram, partIds, wireIndices) {
  const removedParts = new Set(partIds);
  const removedWires = new Set(wireIndices);
  return {
    parts: diagram.parts.filter((part) => !removedParts.has(part.id)).map(clone),
    connections: diagram.connections
      .filter((connection, index) => !removedWires.has(index)
        && !removedParts.has(partOf(connection[0])) && !removedParts.has(partOf(connection[1])))
      .map(clone),
  };
}

/** Clipboard content for the given parts (see the rules above). */
export function copyItems(diagram, partIds) {
  const ids = new Set(partIds);
  return {
    parts: diagram.parts.filter((part) => ids.has(part.id)).map(clone),
    connections: diagram.connections
      .filter(([from, to]) => ids.has(partOf(from)) && ids.has(partOf(to)))
      .map(clone),
  };
}

/**
 * Adds clipboard content with fresh ids, offset by (dx, dy).
 * `prefixOf(part)` gives the id prefix for a part ("led", "r", ...).
 * Returns { parts, connections, newIds, newWires }.
 */
export function pasteItems(diagram, clipboard, dx, dy, prefixOf) {
  const parts = diagram.parts.map(clone);
  const connections = diagram.connections.map(clone);
  const rename = new Map();
  const newIds = [];
  for (const part of clipboard.parts) {
    const id = nextPartId({ parts }, prefixOf(part));
    rename.set(part.id, id);
    newIds.push(id);
    parts.push({ ...clone(part), id, left: part.left + dx, top: part.top + dy });
  }
  const newWires = [];
  for (const [from, to, color, routing] of clipboard.connections) {
    const a = splitEndpoint(from);
    const b = splitEndpoint(to);
    if (!a || !b || !rename.has(a.partId) || !rename.has(b.partId)) {
      continue;
    }
    newWires.push(connections.length);
    connections.push([`${rename.get(a.partId)}:${a.pin}`, `${rename.get(b.partId)}:${b.pin}`, color, [...(routing ?? [])]]);
  }
  return { parts, connections, newIds, newWires };
}
