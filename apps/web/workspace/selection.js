/*
 * Selection model for the circuit workspace.
 *
 * A selection is one of:
 *   null
 *   { kind: "part", id }                       one part (the board included)
 *   { kind: "wire", index }                    one connection
 *   { kind: "component", partId, id }          a board component (info only)
 *   { kind: "group", parts: [id], wires: [i] } two or more parts/wires
 *
 * Groups never contain the board (it cannot be deleted, duplicated, or
 * moved together with parts) and are normalized: a group of exactly one
 * item becomes the single kind, so code that handles single selections keeps
 * working unchanged. Pure module — no DOM access.
 */

/** Builds the normalized selection for the given part ids and wire indices. */
export function selectionOf(parts = [], wires = []) {
  const uniqueParts = [...new Set(parts)];
  const uniqueWires = [...new Set(wires)].sort((a, b) => a - b);
  if (uniqueParts.length + uniqueWires.length === 0) {
    return null;
  }
  if (uniqueParts.length === 1 && uniqueWires.length === 0) {
    return { kind: "part", id: uniqueParts[0] };
  }
  if (uniqueParts.length === 0 && uniqueWires.length === 1) {
    return { kind: "wire", index: uniqueWires[0] };
  }
  return { kind: "group", parts: uniqueParts, wires: uniqueWires };
}

/** Part ids in a selection (single part or group). */
export function selectedParts(selection) {
  if (selection?.kind === "part") {
    return [selection.id];
  }
  return selection?.kind === "group" ? [...selection.parts] : [];
}

/** Wire indices in a selection (single wire or group). */
export function selectedWires(selection) {
  if (selection?.kind === "wire") {
    return [selection.index];
  }
  return selection?.kind === "group" ? [...selection.wires] : [];
}

/**
 * Adds or removes one item (Shift/Ctrl+click). `isBoard(id)` excludes the
 * board from groups: toggling the board, or toggling anything while the
 * board is selected, starts over with just the clicked item.
 */
export function toggleItem(selection, item, isBoard) {
  let parts = selectedParts(selection);
  let wires = selectedWires(selection);
  if (parts.some(isBoard) || (item.part !== undefined && isBoard(item.part))) {
    return item.part !== undefined ? selectionOf([item.part]) : selectionOf([], [item.wire]);
  }
  if (item.part !== undefined) {
    parts = parts.includes(item.part) ? parts.filter((id) => id !== item.part) : [...parts, item.part];
  } else {
    wires = wires.includes(item.wire) ? wires.filter((i) => i !== item.wire) : [...wires, item.wire];
  }
  return selectionOf(parts, wires);
}

/** Drops items that no longer exist in the diagram (after undo/redo or edits). */
export function sanitizeSelection(selection, diagram) {
  if (!selection) {
    return null;
  }
  if (selection.kind === "component") {
    // Board components may be selected without a part id (there is one board).
    return selection.partId === undefined || diagram.parts.some((p) => p.id === selection.partId) ? selection : null;
  }
  const ids = new Set(diagram.parts.map((p) => p.id));
  const parts = selectedParts(selection).filter((id) => ids.has(id));
  const wires = selectedWires(selection).filter((i) => i >= 0 && i < diagram.connections.length);
  return selectionOf(parts, wires);
}

export function isItemSelected(selection, item) {
  if (item.part !== undefined) {
    return selectedParts(selection).includes(item.part);
  }
  return selectedWires(selection).includes(item.wire);
}
