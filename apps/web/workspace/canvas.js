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
  clientToWorld,
  editableSegment,
  fitViewBox,
  normalizeRotation,
  panViewBox,
  partBounds,
  partToWorld,
  partTransform,
  pathData,
  pointsToRouting,
  routeWire,
  snap,
  unionBounds,
  zoomViewBox,
} from "./geometry.js";
import { WIRE_COLORS, commands, findPart, nextPartId, sameConnection, splitEndpoint } from "./diagram.js";

const SVG_NS = "http://www.w3.org/2000/svg";
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

export class Workspace extends EventTarget {
  #svg;
  #layers;
  #catalog;
  #history;
  #options;
  #viewBox = { x: -60, y: -60, width: 800, height: 600 };
  #selection = null; // { kind: "part", id } | { kind: "wire", index }
  #gesture = null;
  #wireDraft = null; // { from, fromPoint, pointer }
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
    svg.addEventListener("pointerleave", () => this.#hideTooltip());
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
      this.render();
      this.#emit("change", { label: `Redo ${command.label}` });
    }
  }

  select(selection) {
    this.#selection = selection;
    this.#renderSelection();
    this.#emit("select", { selection });
  }

  /** Adds a part from the library at the center of the view. */
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
    this.execute(commands.addPart(part));
    this.select({ kind: "part", id: part.id });
    return part;
  }

  rotateSelection() {
    const part = this.#selectedPart();
    if (part && this.#catalog[part.type].kind !== "board") {
      this.execute(commands.rotatePart(part.id, part.rotate, normalizeRotation(part.rotate + 90)));
    }
  }

  duplicateSelection() {
    const part = this.#selectedPart();
    if (!part || this.#catalog[part.type].kind === "board") {
      return;
    }
    const copy = {
      ...structuredClone(part),
      id: nextPartId(this.diagram, this.#catalog[part.type].idPrefix),
      left: part.left + GRID * 3,
      top: part.top + GRID * 3,
    };
    this.execute(commands.addPart(copy));
    this.select({ kind: "part", id: copy.id });
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
    if (selection?.kind === "part") {
      this.#svg.querySelector(`.part[data-part="${CSS.escape(selection.id)}"]`)?.classList.add("is-selected");
    } else if (selection?.kind === "component") {
      this.#svg.querySelector(`.part[data-part="${CSS.escape(selection.partId)}"] [data-component="${CSS.escape(selection.id)}"]`)?.classList.add("is-selected");
    } else if (selection?.kind === "wire") {
      this.#svg.querySelector(`.wire[data-wire="${selection.index}"]`)?.classList.add("is-selected");
    }
  }

  #renderDraft(pointerWorld, valid = null) {
    const overlay = this.#layers.overlay;
    overlay.replaceChildren();
    if (!this.#wireDraft) {
      return;
    }
    const points = routeWire(this.#wireDraft.fromPoint, pointerWorld);
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
      this.#onPinClick(`${pinNode.dataset.part}:${pinNode.dataset.pin}`, event);
      event.preventDefault();
      return;
    }
    if (this.#wireDraft) {
      // Clicking empty space while wiring cancels the draft.
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

    this.select(null);
    this.#gesture = { type: "pan", last: { x: event.clientX, y: event.clientY }, pointerId: event.pointerId };
    this.#svg.setPointerCapture(event.pointerId);
    this.#svg.classList.add("is-panning");
  }

  #onPointerMove(event) {
    const world = this.#world(event);
    const gesture = this.#gesture;

    if (!gesture) {
      if (this.#wireDraft) {
        const pinNode = event.target.closest?.(".pin-anchor");
        const target = pinNode ? `${pinNode.dataset.part}:${pinNode.dataset.pin}` : null;
        const valid = target ? this.#validateWire(this.#wireDraft.from, target) === null : null;
        const end = target ? this.pinPosition(target) : (this.#snapToGrid ? { x: snap(world.x), y: snap(world.y) } : world);
        this.#renderDraft(end, valid);
      }
      this.#updateTooltip(event);
      return;
    }

    if (gesture.type === "pan") {
      const rect = this.#svg.getBoundingClientRect();
      const scale = Math.min(rect.width / this.#viewBox.width, rect.height / this.#viewBox.height);
      this.#viewBox = panViewBox(this.#viewBox, (event.clientX - gesture.last.x) / scale, (event.clientY - gesture.last.y) / scale);
      gesture.last = { x: event.clientX, y: event.clientY };
      this.#applyViewBox();
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
      this.#wireDraft = { from: endpoint, fromPoint: this.pinPosition(endpoint) };
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
    const connection = [this.#wireDraft.from, endpoint, this.#defaultColor(this.#wireDraft.from, endpoint), []];
    this.#wireDraft = null;
    this.#layers.overlay.replaceChildren();
    this.execute(commands.addConnection(connection));
    this.select({ kind: "wire", index: this.diagram.connections.length - 1 });
    this.#emit("wire", { state: "created", connection });
  }

  #cancelDraft(message) {
    this.#wireDraft = null;
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
    const wires = this.diagram.connections.filter(([a, b]) => a === endpoint || b === endpoint).length;
    const rows = [
      `<strong>${escapeHtml(info.title)}</strong>`,
      ...info.lines.map((line) => `<span>${escapeHtml(line)}</span>`),
      `<span class="muted">${wires ? `${wires} wire${wires === 1 ? "" : "s"} connected` : "Not connected"}</span>`,
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
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
