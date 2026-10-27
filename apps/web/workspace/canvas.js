/*
 * Interactive circuit workspace (DOM/SVG).
 *
 * Rendering and interaction only: the diagram model (diagram.js), geometry
 * (geometry.js), and electrical evaluation (netlist.js) are separate pure
 * modules. Simulator-derived state reaches the view through `getPartState`
 * and `getPinInfo` callbacks — the canvas never invents hardware state.
 */
import {
  GRID,
  autoRoute,
  clientToWorld,
  editableSegment,
  fitViewBox,
  normalizeRotation,
  panViewBox,
  areaBounds,
  partBounds,
  partToWorld,
  partTransform,
  pathData,
  pinApproach,
  pinEscape,
  placeInView,
  placementKey,
  pointsToRouting,
  routeWire,
  snap,
  unionBounds,
  zoomViewBox,
} from "./geometry.js";
import { WIRE_COLORS, commands, findPart, nextPartId, sameConnection, splitEndpoint } from "./diagram.js";
import { copyItems, moveParts, pasteItems, removeItems } from "./editing.js";
import { isItemSelected, sanitizeSelection, selectedParts, selectedWires, selectionOf, toggleItem } from "./selection.js";

const SVG_NS = "http://www.w3.org/2000/svg";
/**
 * Screen movement that turns a press into a drag: on a pin, a release on
 * another pin connects; on empty canvas while wiring, the drag pans instead
 * of cancelling the wire.
 */
const WIRE_DRAG_PX = 4;
const WIRE_HEX = {
  green: "#2e9d4e", blue: "#2f6fd6", red: "#d93a3a", black: "#2a2a2a", orange: "#ea8a1d",
  yellow: "#e2c21f", purple: "#8a4fc9", gray: "#8a929c", white: "#e9edf1",
};

function element(name, attributes = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  parent?.append(node);
  return node;
}

/** "2 parts and 1 wire" style label for history entries. */
function describeCount(parts, wires) {
  const list = [];
  if (parts) {
    list.push(`${parts} part${parts === 1 ? "" : "s"}`);
  }
  if (wires) {
    list.push(`${wires} wire${wires === 1 ? "" : "s"}`);
  }
  return list.join(" and ") || "nothing";
}

export class Workspace extends EventTarget {
  #svg;
  #layers;
  #catalog;
  #history;
  #options;
  #viewBox = { x: -60, y: -60, width: 800, height: 600 };
  #selection = null; // see selection.js (single part/wire/component, or a group)
  #clipboard = null; // { parts, connections } from copyItems()
  #lastPaste = null; // { dx, dy } offset of the last paste of this clipboard
  #pasteInPlace = false; // the first paste after a cut goes back to the cut position
  #placedPositions = new Set(); // placementKey()s used by pastes and duplicates (no exact stacking)
  #pastedIds = new Set(); // ids created by pastes of this clipboard (the cascade may overlap them)
  #gesture = null;
  #wireDraft = null; // { from }: the pin the wire in progress starts at
  #pointer = null; // { clientX, clientY } of the pointer over the canvas, to keep hover feedback current
  #routeObstacles = null; // { pads, bodies, wires } that automatic routes keep clear of; rebuilt after the wires change
  #lastRoute = null; // { key, obstacles, route }: the preview route, reused while the wire end stays put
  #tooltip;
  #showGrid = true;
  #snapToGrid = true;
  #pressedParts = new Set();
  #initialFitDone = false;

  /**
   * @param svg        root <svg> element
   * @param tooltip    HTML element used for pin tooltips
   * @param options    { catalog, history, getPartState(part), getPinInfo(part, pin),
   *                     isInteractive(part) -> bool, onPress(part, pressed, target) }
   */
  constructor(svg, tooltip, options) {
    super();
    this.#svg = svg;
    this.#tooltip = tooltip;
    this.#catalog = options.catalog;
    this.#history = options.history;
    this.#options = options;
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("tabindex", "0");

    const defs = element("defs", {}, svg);
    const pattern = element("pattern", { id: "grid-minor", width: GRID, height: GRID, patternUnits: "userSpaceOnUse" }, defs);
    element("circle", { cx: 0, cy: 0, r: 0.7, class: "grid-dot" }, pattern);
    const major = element("pattern", { id: "grid-major", width: GRID * 10, height: GRID * 10, patternUnits: "userSpaceOnUse" }, defs);
    element("rect", { width: GRID * 10, height: GRID * 10, fill: "url(#grid-minor)" }, major);
    element("path", { d: `M ${GRID * 10} 0 L 0 0 0 ${GRID * 10}`, class: "grid-line", fill: "none" }, major);

    this.#layers = {
      grid: element("rect", { class: "grid", x: -1e5, y: -1e5, width: 2e5, height: 2e5, fill: "url(#grid-major)" }, svg),
      parts: element("g", { class: "layer-parts" }, svg),
      wires: element("g", { class: "layer-wires" }, svg),
      // Pin anchors sit above wires so a connected pin stays hoverable and wireable.
      anchors: element("g", { class: "layer-anchors" }, svg),
      overlay: element("g", { class: "layer-overlay" }, svg),
    };

    svg.addEventListener("pointerdown", (event) => this.#onPointerDown(event));
    svg.addEventListener("pointermove", (event) => this.#onPointerMove(event));
    svg.addEventListener("pointerup", (event) => this.#onPointerUp(event));
    svg.addEventListener("pointercancel", (event) => this.#onPointerUp(event));
    svg.addEventListener("wheel", (event) => this.#onWheel(event), { passive: false });
    svg.addEventListener("keydown", (event) => this.#onKeyDown(event));
    svg.addEventListener("pointerleave", () => {
      this.#pointer = null;
      this.#hideTooltip();
    });
    // Fit once the canvas has a real size (it may be 0×0 while the layout
    // settles); afterwards keep the user's view and only re-apply it.
    new ResizeObserver(() => {
      const rect = svg.getBoundingClientRect();
      if (!this.#initialFitDone && rect.width > 0 && rect.height > 0) {
        this.#initialFitDone = true;
        this.fit();
      } else {
        this.#applyViewBox();
      }
    }).observe(svg);

    this.render();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  get diagram() {
    return this.#history.diagram;
  }

  get selection() {
    return this.#selection;
  }

  get viewBox() {
    return { ...this.#viewBox };
  }

  set showGrid(value) {
    this.#showGrid = Boolean(value);
    this.#layers.grid.style.display = this.#showGrid ? "" : "none";
    this.#emit("view");
  }

  get showGrid() {
    return this.#showGrid;
  }

  set snapToGrid(value) {
    this.#snapToGrid = Boolean(value);
    this.#emit("view");
  }

  get snapToGrid() {
    return this.#snapToGrid;
  }

  /** Executes an editing command through the undo history and re-renders. */
  execute(command) {
    this.#history.execute(command);
    this.#selection = sanitizeSelection(this.#selection, this.diagram);
    this.render();
    this.#emit("change", { label: command.label });
  }

  undo() {
    const command = this.#history.undo();
    if (command) {
      this.#selection = null;
      this.render();
      this.#emit("change", { label: `Undo ${command.label}` });
    }
  }

  redo() {
    const command = this.#history.redo();
    if (command) {
      this.#selection = sanitizeSelection(this.#selection, this.diagram);
      this.render();
      this.#emit("change", { label: `Redo ${command.label}` });
    }
  }

  select(selection) {
    this.#selection = sanitizeSelection(selection, this.diagram);
    this.#renderSelection();
    this.#emit("select", { selection });
  }

  /**
   * Adds a part from the library: in the middle of the view when that is
   * free, otherwise on the nearest free visible canvas (the same
   * collision-aware placement as paste and duplicate; the view never moves).
   */
  addPart(type) {
    const definition = this.#catalog[type];
    const center = { x: this.#viewBox.x + this.#viewBox.width / 2, y: this.#viewBox.y + this.#viewBox.height / 2 };
    const part = {
      type,
      id: nextPartId(this.diagram, definition.idPrefix),
      left: snap(center.x - definition.size.width / 2),
      top: snap(center.y - definition.size.height / 2),
      rotate: 0,
      attrs: structuredClone(definition.defaultAttrs ?? {}),
    };
    const place = placeInView(this.#boundsOf([part]), this.#viewBox, { dx: 0, dy: 0 }, { obstacles: this.#obstacles(new Set()) });
    part.left += place.dx;
    part.top += place.dy;
    this.execute(commands.addPart(part));
    this.select({ kind: "part", id: part.id });
    this.#reportPlacement("add", place, 1, 0);
    return part;
  }

  rotateSelection() {
    const part = this.#selectedPart();
    if (part && this.#catalog[part.type].kind !== "board") {
      this.execute(commands.rotatePart(part.id, part.rotate, normalizeRotation(part.rotate + 90)));
    }
  }

  duplicateSelection() {
    if (this.#selection?.kind === "group") {
      const ids = this.#editableParts();
      if (ids.length) {
        const content = copyItems(this.diagram, ids);
        const bounds = this.#boundsOf(content.parts);
        const place = placeInView(bounds, this.#viewBox, { dx: GRID * 3, dy: GRID * 3 }, {
          avoid: this.#placedPositions,
          obstacles: this.#obstacles(new Set(ids)),
        });
        this.#placedPositions.add(placementKey(bounds, place.dx, place.dy));
        this.#pasteContent(content, `Duplicate ${ids.length} parts`, place);
      }
      return;
    }
    const part = this.#selectedPart();
    if (!part || this.#catalog[part.type].kind === "board") {
      return;
    }
    const bounds = this.#boundsOf([part]);
    const place = placeInView(bounds, this.#viewBox, { dx: GRID * 3, dy: GRID * 3 }, {
      avoid: this.#placedPositions,
      obstacles: this.#obstacles(new Set([part.id])),
    });
    this.#placedPositions.add(placementKey(bounds, place.dx, place.dy));
    const copy = {
      ...structuredClone(part),
      id: nextPartId(this.diagram, this.#catalog[part.type].idPrefix),
      left: part.left + place.dx,
      top: part.top + place.dy,
    };
    this.execute(commands.addPart(copy));
    this.select({ kind: "part", id: copy.id });
    this.#reportPlacement("duplicate", place, 1, 0);
  }

  deleteSelection() {
    const selection = this.#selection;
    if (selection?.kind === "part") {
      const part = findPart(this.diagram, selection.id);
      if (part && this.#catalog[part.type].kind !== "board") {
        this.execute(commands.removePart(this.diagram, part.id));
        this.select(null);
      }
    } else if (selection?.kind === "wire" && this.diagram.connections[selection.index]) {
      this.execute(commands.removeConnection(this.diagram, selection.index));
      this.select(null);
    } else if (selection?.kind === "group") {
      const parts = selectedParts(selection);
      const wires = selectedWires(selection);
      const after = removeItems(this.diagram, parts, wires);
      this.execute(commands.setContent(`Delete ${describeCount(parts.length, wires.length)}`, this.diagram, after));
      this.select(null);
    }
  }

  /** Selects every part except the board, and every wire. */
  selectAll() {
    const parts = this.diagram.parts.filter((part) => !this.#isBoard(part.id)).map((part) => part.id);
    this.select(selectionOf(parts, this.diagram.connections.map((_, index) => index)));
  }

  /**
   * Copies the selected parts (not the board) and the wires between them.
   * Returns false when there is nothing to copy.
   */
  copySelection() {
    const ids = this.#editableParts();
    if (!ids.length) {
      return false;
    }
    this.#clipboard = copyItems(this.diagram, ids);
    this.#lastPaste = null;
    this.#pasteInPlace = false;
    this.#placedPositions.clear();
    this.#pastedIds.clear();
    this.#emit("clipboard", { action: "copy", parts: this.#clipboard.parts.length, wires: this.#clipboard.connections.length });
    return true;
  }

  cutSelection() {
    const ids = this.#editableParts();
    if (!this.copySelection()) {
      return;
    }
    this.#pasteInPlace = true; // the first paste after a cut lands where the parts were
    this.execute(commands.setContent(`Cut ${describeCount(ids.length, 0)}`, this.diagram, removeItems(this.diagram, ids, [])));
    this.select(null);
    this.#emit("clipboard", { action: "cut", parts: this.#clipboard.parts.length, wires: this.#clipboard.connections.length });
  }

  /**
   * Pastes the clipboard with fresh ids. Successive pastes cascade by 0.3 in;
   * when that position is not fully visible, the items are placed in the
   * middle of the current view instead (smart paste). The view itself never
   * pans or zooms, and the pasted items stay selected.
   */
  paste() {
    if (!this.#clipboard?.parts.length) {
      return;
    }
    const bounds = this.#boundsOf(this.#clipboard.parts);
    const step = GRID * 3;
    const preferred = this.#pasteInPlace
      ? { dx: 0, dy: 0 }
      : this.#lastPaste
        ? { dx: this.#lastPaste.dx + step, dy: this.#lastPaste.dy + step }
        : { dx: step, dy: step };
    const inPlace = this.#pasteInPlace;
    this.#pasteInPlace = false;
    // The cascade may overlap the copied parts and earlier pastes of this clipboard, nothing else.
    const family = new Set([...this.#clipboard.parts.map((part) => part.id), ...this.#pastedIds]);
    const place = placeInView(bounds, this.#viewBox, preferred, {
      avoid: this.#placedPositions,
      obstacles: this.#obstacles(family),
      inPlace,
    });
    this.#lastPaste = { dx: place.dx, dy: place.dy };
    this.#placedPositions.add(placementKey(bounds, place.dx, place.dy));
    const newIds = this.#pasteContent(this.#clipboard, `Paste ${describeCount(this.#clipboard.parts.length, 0)}`, place);
    for (const id of newIds) {
      this.#pastedIds.add(id);
    }
  }

  /** Moves the selected part(s) by (dx, dy) world units as one undo step. */
  nudgeSelection(dx, dy) {
    const selection = this.#selection;
    if (selection?.kind === "part") {
      const part = findPart(this.diagram, selection.id);
      if (part) {
        this.execute(commands.movePart(part.id, { left: part.left, top: part.top }, { left: part.left + dx, top: part.top + dy }));
      }
    } else if (selection?.kind === "group") {
      const ids = selectedParts(selection);
      if (ids.length) {
        this.execute(commands.setContent(`Move ${describeCount(ids.length, 0)}`, this.diagram, moveParts(this.diagram, ids, dx, dy)));
      }
    }
  }

  setWireColor(color) {
    const selection = this.#selection;
    if (selection?.kind === "wire" && WIRE_COLORS.includes(color)) {
      this.execute(commands.updateConnection(this.diagram, selection.index, { color }));
    }
  }

  /** World coordinates of a part pin ("partId:pin"), or null. */
  pinPosition(endpoint) {
    const parsed = splitEndpoint(endpoint);
    const part = parsed && findPart(this.diagram, parsed.partId);
    const definition = part && this.#catalog[part.type];
    const pin = definition?.pins.find((p) => p.name === parsed.pin);
    return pin ? partToWorld(pin, part, definition.size) : null;
  }

  fit() {
    const bounds = unionBounds(this.diagram.parts.map((part) => partBounds(part, this.#catalog[part.type].size)));
    const rect = this.#svg.getBoundingClientRect();
    const aspect = rect.width && rect.height ? rect.width / rect.height : 4 / 3;
    this.#viewBox = fitViewBox(bounds, aspect, GRID * 2.5);
    this.#applyViewBox();
  }

  resetView() {
    this.fit();
  }

  zoom(factor) {
    const anchor = { x: this.#viewBox.x + this.#viewBox.width / 2, y: this.#viewBox.y + this.#viewBox.height / 2 };
    this.#viewBox = zoomViewBox(this.#viewBox, factor, anchor);
    this.#applyViewBox();
  }

  /** Zoom level relative to 1 world unit = 1 CSS pixel. */
  get zoomLevel() {
    const rect = this.#svg.getBoundingClientRect();
    return rect.width ? Math.min(rect.width / this.#viewBox.width, rect.height / this.#viewBox.height) : 1;
  }

  /** Re-renders parts and wires from the diagram. */
  render() {
    this.#renderParts();
    this.#renderWires();
    this.#renderSelection();
    this.#refreshPointer();
  }

  /**
   * Applies new simulator state to part bodies. Parts with an `update`
   * hook are patched in place (keeps hover, focus, and pointer capture);
   * others re-render their body markup.
   */
  refreshStates() {
    for (const group of this.#layers.parts.querySelectorAll(":scope > .part")) {
      const part = findPart(this.diagram, group.dataset.part);
      if (!part) {
        continue;
      }
      const definition = this.#catalog[part.type];
      const state = this.#options.getPartState?.(part) ?? {};
      const body = group.querySelector(":scope > .part-body");
      if (definition.update) {
        definition.update(body, part, state);
      } else {
        body.innerHTML = definition.render(part, state);
      }
    }
    this.#refreshPointer();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  #applyViewBox() {
    const { x, y, width, height } = this.#viewBox;
    this.#svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
    this.#svg.style.setProperty("--zoom", String(this.zoomLevel));
    this.#updateHitTargets();
    this.#emit("view");
    this.#refreshPointer();
  }

  #renderParts() {
    const layer = this.#layers.parts;
    layer.replaceChildren();
    this.#layers.anchors.replaceChildren();
    for (const part of this.diagram.parts) {
      const definition = this.#catalog[part.type];
      const state = this.#options.getPartState?.(part) ?? {};
      const group = element("g", {
        class: `part part-${definition.kind}`,
        transform: partTransform(part, definition.size),
        "data-part": part.id,
        "data-type": part.type,
        role: "group",
        "aria-label": `${definition.title} ${part.id}`,
      }, layer);
      element("rect", { class: "part-hitbox", x: 0, y: 0, width: definition.size.width, height: definition.size.height }, group);
      const body = element("g", { class: "part-body" }, group);
      body.innerHTML = definition.render(part, state);
      definition.update?.(body, part, state);
      const anchors = element("g", {
        class: "part-anchors",
        transform: partTransform(part, definition.size),
        "data-part": part.id,
      }, this.#layers.anchors);
      for (const pin of definition.pins) {
        element("circle", {
          class: "pin-anchor",
          cx: pin.x,
          cy: pin.y,
          r: this.#anchorRadius(),
          "data-part": part.id,
          "data-pin": pin.name,
        }, anchors);
      }
    }
  }

  /**
   * Pin hit radius in world units: about 7 CSS px on screen, but never
   * below the drawn pad nor large enough to overlap the 0.1 in neighbour.
   */
  #anchorRadius() {
    return Math.min(GRID * 0.48, Math.max(GRID * 0.32, 7 / (this.zoomLevel || 1)));
  }

  #updateHitTargets() {
    const radius = this.#anchorRadius();
    for (const anchor of this.#layers.anchors.querySelectorAll(".pin-anchor")) {
      anchor.setAttribute("r", radius);
    }
  }

  #wirePoints(connection) {
    const from = this.pinPosition(connection[0]);
    const to = this.pinPosition(connection[1]);
    return from && to ? routeWire(from, to, connection[3] ?? []) : null;
  }

  #renderWires() {
    this.#routeObstacles = null;
    const layer = this.#layers.wires;
    layer.replaceChildren();
    this.diagram.connections.forEach((connection, index) => {
      const points = this.#wirePoints(connection);
      if (!points) {
        return;
      }
      const d = pathData(points);
      const group = element("g", { class: "wire", "data-wire": index, "data-from": connection[0], "data-to": connection[1] }, layer);
      element("path", { class: "wire-hit", d }, group);
      element("path", { class: "wire-casing", d }, group);
      element("path", { class: "wire-core", d, stroke: WIRE_HEX[connection[2]] ?? WIRE_HEX.green }, group);
      for (const point of [points[0], points.at(-1)]) {
        element("circle", { class: "wire-end", cx: point.x, cy: point.y, r: GRID * 0.22, fill: WIRE_HEX[connection[2]] ?? WIRE_HEX.green }, group);
      }
    });
  }

  #renderSelection() {
    for (const node of this.#svg.querySelectorAll(".is-selected")) {
      node.classList.remove("is-selected");
    }
    const selection = this.#selection;
    if (selection?.kind === "component") {
      this.#svg.querySelector(`.part[data-part="${CSS.escape(selection.partId)}"] [data-component="${CSS.escape(selection.id)}"]`)?.classList.add("is-selected");
      return;
    }
    for (const id of selectedParts(selection)) {
      this.#svg.querySelector(`.part[data-part="${CSS.escape(id)}"]`)?.classList.add("is-selected");
    }
    for (const index of selectedWires(selection)) {
      this.#svg.querySelector(`.wire[data-wire="${index}"]`)?.classList.add("is-selected");
    }
  }

  #renderDraft(pointerWorld, valid = null, target = null) {
    const overlay = this.#layers.overlay;
    overlay.replaceChildren();
    this.#showWiring(Boolean(this.#wireDraft));
    if (!this.#wireDraft) {
      return;
    }
    const { points } = this.#routeNewWire(this.#wireDraft.from, target, pointerWorld);
    element("path", {
      class: `wire-draft${valid === false ? " invalid" : ""}`,
      d: pathData(points),
    }, overlay);
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  #world(event) {
    return clientToWorld(this.#viewBox, this.#svg.getBoundingClientRect(), event.clientX, event.clientY);
  }

  #isBoard(id) {
    const part = findPart(this.diagram, id);
    return Boolean(part) && this.#catalog[part.type].kind === "board";
  }

  /** Selected part ids that can be copied, moved as a group, or deleted (not the board). */
  #editableParts() {
    return selectedParts(this.#selection).filter((id) => !this.#isBoard(id));
  }

  #pasteContent(clipboard, label, place) {
    const result = pasteItems(this.diagram, clipboard, place.dx, place.dy, (part) => this.#catalog[part.type].idPrefix);
    this.execute(commands.setContent(label, this.diagram, result));
    this.select(selectionOf(result.newIds, result.newWires));
    this.#reportPlacement(label.startsWith("Duplicate") ? "duplicate" : "paste", place, result.newIds.length, result.newWires.length);
    return result.newIds;
  }

  /**
   * Occupied canvas regions for placement: every existing part (the board
   * included). Parts in `family` (the source of a paste/duplicate and its
   * earlier copies) may be overlapped by the familiar cascade.
   */
  #obstacles(family) {
    return this.diagram.parts.map((part) => ({
      ...partBounds(part, this.#catalog[part.type].size),
      family: family.has(part.id),
    }));
  }

  /** World bounding box of parts (at their stored positions). */
  #boundsOf(parts) {
    return unionBounds(parts.map((part) => partBounds(part, this.#catalog[part.type].size)));
  }

  /** Tells the app when placement moved items off their preferred spot (cascade, or the view's middle for add). */
  #reportPlacement(action, place, parts, wires) {
    if (place.relocated) {
      this.#emit("clipboard", { action, parts, wires, relocated: true, crowded: place.crowded });
    }
  }

  #moveGroupLive(ids, origins, dx, dy) {
    for (const id of ids) {
      const part = findPart(this.diagram, id);
      const origin = origins.get(id);
      part.left = origin.left + dx;
      part.top = origin.top + dy;
      const transform = partTransform(part, this.#catalog[part.type].size);
      for (const node of this.#svg.querySelectorAll(`[data-part="${CSS.escape(id)}"]:is(.part, .part-anchors)`)) {
        node.setAttribute("transform", transform);
      }
    }
    this.#renderWires();
    this.#renderSelection();
  }

  #renderBox(start, end) {
    const overlay = this.#layers.overlay;
    overlay.replaceChildren();
    element("rect", {
      class: "selection-box",
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }, overlay);
  }

  /** Parts (not the board) overlapping a world rectangle, and the wires between them. */
  #itemsInBox(start, end) {
    const box = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), x2: Math.max(start.x, end.x), y2: Math.max(start.y, end.y) };
    const parts = this.diagram.parts.filter((part) => {
      if (this.#isBoard(part.id)) {
        return false;
      }
      const b = partBounds(part, this.#catalog[part.type].size);
      return b.x < box.x2 && b.x + b.width > box.x && b.y < box.y2 && b.y + b.height > box.y;
    }).map((part) => part.id);
    const inside = new Set(parts);
    const wires = [];
    this.diagram.connections.forEach(([from, to], index) => {
      if (inside.has(splitEndpoint(from)?.partId) && inside.has(splitEndpoint(to)?.partId)) {
        wires.push(index);
      }
    });
    return { parts, wires };
  }

  #selectedPart() {
    return this.#selection?.kind === "part" ? findPart(this.diagram, this.#selection.id) : null;
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #onPointerDown(event) {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    this.#svg.focus({ preventScroll: true });
    const target = event.target;
    const world = this.#world(event);

    // Middle button or space-less empty-canvas drag pans.
    const pinNode = target.closest?.(".pin-anchor");
    const interactiveNode = target.closest?.("[data-input]");
    const partNode = target.closest?.(".part");
    const wireNode = target.closest?.(".wire");

    if (event.button === 0 && pinNode) {
      const starting = !this.#wireDraft;
      this.#onPinClick(`${pinNode.dataset.part}:${pinNode.dataset.pin}`, event);
      if (starting && this.#wireDraft) {
        this.#armWirePress(event);
      }
      event.preventDefault();
      return;
    }
    if (this.#wireDraft) {
      // While wiring, a drag on empty canvas (or with the middle button anywhere) pans and keeps
      // the wire; a click there without moving still cancels it. Presses on parts and wires cancel.
      const empty = !partNode && !wireNode && !event.shiftKey && !event.ctrlKey && !event.metaKey;
      if (event.button === 1 || (event.button === 0 && empty)) {
        this.#gesture = {
          type: "pan",
          last: { x: event.clientX, y: event.clientY },
          pointerId: event.pointerId,
          wiring: { client: { x: event.clientX, y: event.clientY }, moved: false },
        };
        this.#svg.setPointerCapture(event.pointerId);
        this.#svg.classList.add("is-panning");
        event.preventDefault();
        return;
      }
      this.#cancelDraft("Wire cancelled.");
      return;
    }

    if (event.button === 0 && partNode) {
      const part = findPart(this.diagram, partNode.dataset.part);
      // During simulation, interactive parts (pushbuttons, board switches) are pressed, not dragged.
      if (part && this.#options.isInteractive?.(part, interactiveNode)) {
        const targetName = interactiveNode?.dataset.input ?? null;
        this.#gesture = { type: "press", part, target: targetName, pointerId: event.pointerId };
        this.#svg.setPointerCapture(event.pointerId);
        this.#setPressed(part, targetName, true);
        event.preventDefault();
        return;
      }
      // Shift/Ctrl/Cmd+click adds or removes the part from the selection.
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        this.select(toggleItem(this.#selection, { part: part.id }, (id) => this.#isBoard(id)));
        event.preventDefault();
        return;
      }
      // Dragging any member of a group moves the whole group.
      if (this.#selection?.kind === "group" && isItemSelected(this.#selection, { part: part.id })) {
        const ids = selectedParts(this.#selection);
        this.#gesture = {
          type: "drag-group",
          ids,
          origins: new Map(ids.map((id) => {
            const member = findPart(this.diagram, id);
            return [id, { left: member.left, top: member.top }];
          })),
          start: world,
          delta: { x: 0, y: 0 },
          clicked: part.id,
          pointerId: event.pointerId,
        };
        this.#svg.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      this.select({ kind: "part", id: part.id });
      this.#gesture = {
        type: "drag-part",
        part,
        start: world,
        origin: { left: part.left, top: part.top },
        moved: false,
        // A click (no drag) on a board component selects that component.
        component: target.closest?.("[data-component]")?.dataset.component ?? null,
        pointerId: event.pointerId,
      };
      this.#svg.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (event.button === 0 && wireNode) {
      const index = Number(wireNode.dataset.wire);
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        this.select(toggleItem(this.#selection, { wire: index }, (id) => this.#isBoard(id)));
        event.preventDefault();
        return;
      }
      this.select({ kind: "wire", index });
      const points = this.#wirePoints(this.diagram.connections[index]);
      // Any segment can be dragged perpendicular to reroute the wire; a
      // segment at a pin grows a short jog there, so the pins stay attached.
      const editable = editableSegment(points, this.#segmentAt(points, world));
      if (editable) {
        this.#gesture = { type: "drag-segment", index, points: editable.points, segment: editable.segment, start: world, moved: false, pointerId: event.pointerId };
        this.#svg.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      return;
    }

    // Shift+drag on empty canvas draws a selection box (added to the selection).
    if (event.button === 0 && event.shiftKey) {
      this.#gesture = { type: "box", start: world, end: world, pointerId: event.pointerId };
      this.#svg.setPointerCapture(event.pointerId);
      this.#renderBox(world, world);
      event.preventDefault();
      return;
    }

    this.select(null);
    this.#gesture = { type: "pan", last: { x: event.clientX, y: event.clientY }, pointerId: event.pointerId };
    this.#svg.setPointerCapture(event.pointerId);
    this.#svg.classList.add("is-panning");
  }

  #onPointerMove(event) {
    this.#pointer = { clientX: event.clientX, clientY: event.clientY };
    const world = this.#world(event);
    const gesture = this.#gesture;

    if (gesture?.type === "wire-press" && event.pointerId === gesture.pointerId && !gesture.dragged
      && Math.hypot(event.clientX - gesture.client.x, event.clientY - gesture.client.y) > WIRE_DRAG_PX) {
      gesture.dragged = true;
      this.#emit("wire", { state: "dragging", from: gesture.from });
    }
    if (!gesture || gesture.type === "wire-press") {
      this.#updateDraft(event, world);
      this.#updateTooltip(event);
      return;
    }

    if (gesture.type === "pan") {
      if (gesture.wiring && event.pointerId !== gesture.pointerId) {
        return;
      }
      const rect = this.#svg.getBoundingClientRect();
      const scale = Math.min(rect.width / this.#viewBox.width, rect.height / this.#viewBox.height);
      this.#viewBox = panViewBox(this.#viewBox, (event.clientX - gesture.last.x) / scale, (event.clientY - gesture.last.y) / scale);
      gesture.last = { x: event.clientX, y: event.clientY };
      this.#applyViewBox();
      if (gesture.wiring) {
        const { client } = gesture.wiring;
        gesture.wiring.moved ||= Math.hypot(event.clientX - client.x, event.clientY - client.y) > WIRE_DRAG_PX;
        this.#updateDraft(event); // the wire end stays under the pointer while the view moves
      }
    } else if (gesture.type === "drag-part") {
      let left = gesture.origin.left + world.x - gesture.start.x;
      let top = gesture.origin.top + world.y - gesture.start.y;
      if (this.#snapToGrid) {
        left = snap(left);
        top = snap(top);
      }
      if (left !== gesture.part.left || top !== gesture.part.top) {
        gesture.part.left = left;
        gesture.part.top = top;
        gesture.moved = true;
        const transform = partTransform(gesture.part, this.#catalog[gesture.part.type].size);
        for (const node of this.#svg.querySelectorAll(`[data-part="${CSS.escape(gesture.part.id)}"]:is(.part, .part-anchors)`)) {
          node.setAttribute("transform", transform);
        }
        this.#renderWires();
        this.#renderSelection();
      }
    } else if (gesture.type === "drag-group") {
      let dx = world.x - gesture.start.x;
      let dy = world.y - gesture.start.y;
      if (this.#snapToGrid) {
        dx = snap(dx);
        dy = snap(dy);
      }
      if (dx !== gesture.delta.x || dy !== gesture.delta.y) {
        gesture.delta = { x: dx, y: dy };
        this.#moveGroupLive(gesture.ids, gesture.origins, dx, dy);
      }
    } else if (gesture.type === "box") {
      gesture.end = world;
      this.#renderBox(gesture.start, world);
    } else if (gesture.type === "drag-segment") {
      const a = gesture.points[gesture.segment];
      const b = gesture.points[gesture.segment + 1];
      const vertical = a.x === b.x;
      const delta = vertical ? world.x - gesture.start.x : world.y - gesture.start.y;
      const offset = this.#snapToGrid ? snap(delta) : delta;
      const points = gesture.points.map((p, i) =>
        i === gesture.segment || i === gesture.segment + 1
          ? (vertical ? { x: p.x + offset, y: p.y } : { x: p.x, y: p.y + offset })
          : p);
      gesture.preview = points;
      gesture.moved = offset !== 0;
      const group = this.#svg.querySelector(`.wire[data-wire="${gesture.index}"]`);
      for (const path of group?.querySelectorAll("path") ?? []) {
        path.setAttribute("d", pathData(points));
      }
    }
  }

  #onPointerUp(event) {
    const gesture = this.#gesture;
    if (gesture?.type === "wire-press") {
      if (event.pointerId === gesture.pointerId) {
        this.#gesture = null;
        this.#finishWirePress(gesture, event);
      }
      return;
    }
    if (gesture?.wiring && event.pointerId !== gesture.pointerId) {
      return; // another pointer: the pan while wiring continues
    }
    if (gesture?.wiring && event.type === "pointerup" && !gesture.wiring.moved) {
      this.#cancelDraft("Wire cancelled."); // a click on empty canvas, as before
    }
    this.#gesture = null;
    this.#svg.classList.remove("is-panning");
    if (!gesture) {
      return;
    }
    if (this.#svg.hasPointerCapture?.(event.pointerId)) {
      this.#svg.releasePointerCapture(event.pointerId);
    }
    if (gesture.type === "press") {
      this.#setPressed(gesture.part, gesture.target, false);
    } else if (gesture.type === "drag-part" && gesture.moved) {
      const to = { left: gesture.part.left, top: gesture.part.top };
      Object.assign(gesture.part, gesture.origin); // the command applies the move
      this.execute(commands.movePart(gesture.part.id, gesture.origin, to));
    } else if (gesture.type === "drag-part" && gesture.component) {
      this.select({ kind: "component", partId: gesture.part.id, id: gesture.component });
    } else if (gesture.type === "drag-group") {
      const { x: dx, y: dy } = gesture.delta;
      // Restore the live preview; the command applies the move (one undo step).
      this.#moveGroupLive(gesture.ids, gesture.origins, 0, 0);
      if (dx !== 0 || dy !== 0) {
        this.execute(commands.setContent(`Move ${describeCount(gesture.ids.length, 0)}`, this.diagram, moveParts(this.diagram, gesture.ids, dx, dy)));
      } else {
        // A click without dragging selects just that part.
        this.select({ kind: "part", id: gesture.clicked });
      }
    } else if (gesture.type === "box") {
      this.#layers.overlay.replaceChildren();
      const found = this.#itemsInBox(gesture.start, gesture.end);
      const current = this.#selection?.kind === "group" || this.#selection?.kind === "part" || this.#selection?.kind === "wire"
        ? { parts: selectedParts(this.#selection).filter((id) => !this.#isBoard(id)), wires: selectedWires(this.#selection) }
        : { parts: [], wires: [] };
      this.select(selectionOf([...current.parts, ...found.parts], [...current.wires, ...found.wires]));
    } else if (gesture.type === "drag-segment" && gesture.moved && gesture.preview) {
      this.execute(commands.updateConnection(this.diagram, gesture.index, { routing: pointsToRouting(gesture.preview) }));
    }
  }

  #setPressed(part, target, pressed) {
    const key = target ? `${part.id}:${target}` : part.id;
    if (pressed) {
      this.#pressedParts.add(key);
    } else {
      this.#pressedParts.delete(key);
    }
    this.#options.onPress?.(part, pressed, target);
  }

  #onWheel(event) {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015));
    this.#viewBox = zoomViewBox(this.#viewBox, factor, this.#world(event));
    this.#applyViewBox();
  }

  #onKeyDown(event) {
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (ctrl && key === "z" && !event.shiftKey) {
      this.undo();
    } else if (ctrl && (key === "y" || (key === "z" && event.shiftKey))) {
      this.redo();
    } else if (ctrl && key === "d") {
      this.duplicateSelection();
    } else if (ctrl && key === "a") {
      this.selectAll();
    } else if (ctrl && key === "c") {
      this.copySelection();
    } else if (ctrl && key === "x") {
      this.cutSelection();
    } else if (ctrl && key === "v") {
      this.paste();
    } else if (!ctrl && key.startsWith("arrow")) {
      // 0.1 in per press (the header pitch), 1 in with Shift.
      const step = event.shiftKey ? GRID * 10 : GRID;
      const delta = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[key];
      if (!delta) {
        return;
      }
      this.nudgeSelection(...delta);
    } else if (!ctrl && key === "r") {
      this.rotateSelection();
    } else if (key === "delete" || key === "backspace") {
      this.deleteSelection();
    } else if (key === "escape") {
      if (this.#wireDraft) {
        this.#cancelDraft("Wire cancelled.");
      } else {
        this.select(null);
      }
    } else if (key === "+" || key === "=") {
      this.zoom(1.25);
    } else if (key === "-") {
      this.zoom(0.8);
    } else if (key === "0" || key === "f") {
      this.fit();
    } else if (key === "g") {
      this.showGrid = !this.showGrid;
    } else {
      return;
    }
    event.preventDefault();
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  #onPinClick(endpoint, event) {
    if (!this.#wireDraft) {
      this.#wireDraft = { from: endpoint };
      this.#renderDraft(this.#world(event));
      this.#emit("wire", { state: "started", from: endpoint });
      return;
    }
    const error = this.#validateWire(this.#wireDraft.from, endpoint);
    if (error) {
      this.#emit("wire", { state: "invalid", from: this.#wireDraft.from, to: endpoint, error });
      this.#flashInvalid(endpoint);
      return;
    }
    const { routing } = this.#routeNewWire(this.#wireDraft.from, endpoint); // the route the preview showed
    const connection = [this.#wireDraft.from, endpoint, this.#defaultColor(this.#wireDraft.from, endpoint), routing];
    this.#wireDraft = null;
    this.#showWiring(false);
    this.#layers.overlay.replaceChildren();
    this.execute(commands.addConnection(connection));
    this.select({ kind: "wire", index: this.diagram.connections.length - 1 });
    this.#emit("wire", { state: "created", connection });
  }

  /**
   * Drag-to-connect: the press that started a wire is followed until its
   * pointer is released. No pointer capture, so hover feedback keeps working;
   * a release outside the canvas just ends the gesture (window listener).
   */
  #armWirePress(event) {
    const gesture = { type: "wire-press", pointerId: event.pointerId, from: this.#wireDraft.from, client: { x: event.clientX, y: event.clientY }, dragged: false };
    this.#gesture = gesture;
    const end = (up) => {
      if (up.pointerId !== gesture.pointerId) {
        return;
      }
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (this.#gesture === gesture) {
        this.#gesture = null; // released outside the canvas, or cancelled: never connects
        this.#emitWaiting(gesture);
      }
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  #finishWirePress(gesture, event) {
    if (event.type !== "pointerup" || !gesture.dragged || this.#wireDraft?.from !== gesture.from) {
      return; // a click, a cancelled pointer, or the wire already ended: the draft (if any) continues as after a click
    }
    const pinNode = this.#pinUnder(event);
    const target = pinNode ? `${pinNode.dataset.part}:${pinNode.dataset.pin}` : null;
    if (target && target !== gesture.from) {
      this.#onPinClick(target, event); // same validation, feedback, creation, and undo step as clicking the pin
    } else {
      this.#emitWaiting(gesture);
    }
  }

  /** A drag that started a wire ended without connecting it: the wire now waits for a click on its target. */
  #emitWaiting(gesture) {
    if (gesture.dragged && this.#wireDraft?.from === gesture.from) {
      this.#emit("wire", { state: "waiting", from: gesture.from });
    }
  }

  /**
   * Moves the end of the wire in progress to the pin or (snapped) point under the pointer.
   * `world` is the pointer in world units when the caller already has it for the current view.
   */
  #updateDraft(event, world = null) {
    if (!this.#wireDraft) {
      return;
    }
    world ??= this.#world(event);
    const pinNode = this.#pinUnder(event);
    const target = pinNode ? `${pinNode.dataset.part}:${pinNode.dataset.pin}` : null;
    const valid = target ? this.#validateWire(this.#wireDraft.from, target) === null : null;
    const end = target ? this.pinPosition(target) : (this.#snapToGrid ? { x: snap(world.x), y: snap(world.y) } : world);
    this.#renderDraft(end, valid, target);
  }

  /** Direction a wire leaves or enters the pin `endpoint` ("part:pin"), or null. */
  #pinEscape(endpoint) {
    const parsed = splitEndpoint(endpoint);
    const part = parsed && findPart(this.diagram, parsed.partId);
    const definition = part && this.#catalog[part.type];
    const pin = definition?.pins.find((p) => p.name === parsed.pin);
    return pin ? pinEscape(pin, part, definition.size) : null;
  }

  /**
   * The automatic route of a new wire from pin `from` to pin `to`, or to the
   * free point `end` while it is drawn (smart routing, geometry.js autoRoute):
   * clear of unrelated pin pads and existing wires where possible. The
   * preview and the created wire both come from here, so they are the same.
   */
  #routeNewWire(from, to, end = this.pinPosition(to)) {
    this.#routeObstacles ??= {
      pads: this.diagram.parts.flatMap((part) => {
        const definition = this.#catalog[part.type];
        return definition.pins.map((pin) => {
          const at = partToWorld(pin, part, definition.size);
          return { id: `${part.id}:${pin.name}`, ...at, approach: pinApproach(at, pinEscape(pin, part, definition.size)) };
        });
      }),
      // A part keeps wires off its whole body; the board, whose headers sit inside it, only off its switches.
      bodies: this.diagram.parts.flatMap((part) => {
        const definition = this.#catalog[part.type];
        return definition.kind === "board"
          ? (definition.keepOut ?? []).map((area) => areaBounds(area, part, definition.size))
          : [partBounds(part, definition.size)];
      }),
      wires: this.diagram.connections.map((connection) => this.#wirePoints(connection)).filter(Boolean),
    };
    const key = `${from} ${to} ${end.x} ${end.y}`;
    if (this.#lastRoute?.key !== key || this.#lastRoute.obstacles !== this.#routeObstacles) {
      const others = this.#routeObstacles.pads.filter((pad) => pad.id !== from && pad.id !== to);
      const route = autoRoute(this.pinPosition(from), end, {
        fromEscape: this.#pinEscape(from),
        toEscape: to ? this.#pinEscape(to) : null,
        pads: others,
        bodies: this.#routeObstacles.bodies,
        wires: this.#routeObstacles.wires,
        approaches: others.map((pad) => pad.approach).filter(Boolean),
      });
      this.#lastRoute = { key, obstacles: this.#routeObstacles, route };
    }
    return this.#lastRoute.route;
  }

  /** The pin under the pointer, by position (touch and pen pointers stay targeted at the pin they pressed). */
  #pinUnder(event) {
    const node = document.elementFromPoint?.(event.clientX, event.clientY) ?? event.target;
    return node?.closest?.(".pin-anchor") ?? null;
  }

  /** While a wire is drawn, every pin shows as a target and the starting pin is marked. */
  #showWiring(on) {
    this.#svg.classList.toggle("is-wiring", on);
    for (const node of this.#svg.querySelectorAll(".pin-anchor.is-source")) {
      node.classList.remove("is-source");
    }
    const from = on ? splitEndpoint(this.#wireDraft.from) : null;
    if (from) {
      this.#svg.querySelector(`.pin-anchor[data-part="${CSS.escape(from.partId)}"][data-pin="${CSS.escape(from.pin)}"]`)?.classList.add("is-source");
    }
  }

  #cancelDraft(message) {
    this.#wireDraft = null;
    this.#showWiring(false);
    this.#layers.overlay.replaceChildren();
    this.#emit("wire", { state: "cancelled", message });
  }

  /** Returns null when the wire is acceptable, otherwise a reason. */
  #validateWire(from, to) {
    if (from === to) {
      return "A wire cannot start and end on the same pin.";
    }
    if (this.diagram.connections.some((c) => sameConnection(c, [from, to]))) {
      return "These pins are already connected.";
    }
    const a = splitEndpoint(from);
    const b = splitEndpoint(to);
    const roleA = this.#options.getPinInfo?.(findPart(this.diagram, a.partId), a.pin);
    const roleB = this.#options.getPinInfo?.(findPart(this.diagram, b.partId), b.pin);
    const kinds = new Set([roleA?.kind, roleB?.kind]);
    if (kinds.has("power") && kinds.has("ground")) {
      return "Connecting a supply pin directly to GND would short the supply.";
    }
    return null;
  }

  #defaultColor(from, to) {
    const roles = [from, to].map((e) => {
      const p = splitEndpoint(e);
      return this.#options.getPinInfo?.(findPart(this.diagram, p.partId), p.pin)?.kind;
    });
    if (roles.includes("ground")) {
      return "black";
    }
    if (roles.includes("power")) {
      return "red";
    }
    return "green";
  }

  #flashInvalid(endpoint) {
    const parsed = splitEndpoint(endpoint);
    const node = this.#svg.querySelector(`.pin-anchor[data-part="${CSS.escape(parsed.partId)}"][data-pin="${CSS.escape(parsed.pin)}"]`);
    node?.classList.add("invalid");
    setTimeout(() => node?.classList.remove("invalid"), 700);
  }

  #segmentAt(points, world) {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const distance = a.x === b.x
        ? Math.abs(world.x - a.x) + Math.max(0, Math.min(a.y, b.y) - world.y, world.y - Math.max(a.y, b.y))
        : Math.abs(world.y - a.y) + Math.max(0, Math.min(a.x, b.x) - world.x, world.x - Math.max(a.x, b.x));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Tooltips
  // ---------------------------------------------------------------------------

  #updateTooltip(event) {
    const pinNode = event.target.closest?.(".pin-anchor");
    if (!pinNode) {
      this.#hideTooltip();
      return;
    }
    const part = findPart(this.diagram, pinNode.dataset.part);
    const info = this.#options.getPinInfo?.(part, pinNode.dataset.pin);
    if (!info) {
      this.#hideTooltip();
      return;
    }
    const endpoint = `${part.id}:${pinNode.dataset.pin}`;
    const rows = [
      `<strong>${escapeHtml(info.title)}</strong>`,
      ...info.lines.map((line) => `<span>${escapeHtml(line)}</span>`),
      `<span class="muted">${escapeHtml(this.#describeWires(endpoint))}</span>`,
    ];
    this.#tooltip.innerHTML = rows.join("");
    this.#tooltip.hidden = false;
    this.#tooltip.dataset.pin = endpoint;
    // Keep the tooltip inside the canvas: flip left/up near the right/bottom edges.
    const host = this.#tooltip.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0, width: Infinity, height: Infinity };
    const { offsetWidth: width, offsetHeight: height } = this.#tooltip;
    let left = event.clientX - host.left + 14;
    let top = event.clientY - host.top + 14;
    if (left + width > host.width - 4) {
      left = Math.max(4, event.clientX - host.left - width - 14);
    }
    if (top + height > host.height - 4) {
      top = Math.max(4, event.clientY - host.top - height - 14);
    }
    this.#tooltip.style.left = `${left}px`;
    this.#tooltip.style.top = `${top}px`;
  }

  #hideTooltip() {
    this.#tooltip.hidden = true;
    delete this.#tooltip.dataset.pin;
  }

  /** "Not connected", "Wired to led1:A", or "Wired to led1:A, r1:2 (2 wires)": the pin's wires as drawn now. */
  #describeWires(endpoint) {
    const others = this.diagram.connections.filter(([a, b]) => a === endpoint || b === endpoint).map(([a, b]) => (a === endpoint ? b : a));
    if (!others.length) {
      return "Not connected";
    }
    const listed = others.length > 4 ? [...others.slice(0, 3), "…"] : others;
    return `Wired to ${listed.join(", ")}${others.length > 1 ? ` (${others.length} wires)` : ""}`;
  }

  /**
   * Re-applies hover feedback at the last pointer position, for changes under
   * a pointer that did not move: a wire made, deleted, undone, or redone; a
   * zoom, Fit, or resize; new simulator state. The pin tooltip shows the
   * current wires and state, and a wire in progress ends under the pointer.
   */
  #refreshPointer() {
    if (!this.#pointer) {
      return;
    }
    const { clientX, clientY } = this.#pointer;
    const target = document.elementFromPoint?.(clientX, clientY);
    if (!target || !this.#svg.contains(target)) {
      this.#hideTooltip();
      return;
    }
    const event = { clientX, clientY, target };
    this.#updateDraft(event);
    if (!this.#gesture || this.#gesture.type === "wire-press") {
      this.#updateTooltip(event);
    }
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
