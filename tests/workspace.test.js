/*
 * Workspace model tests: geometry, diagram validation/serialization,
 * undo/redo, and the logic-level netlist. Pure modules, no browser.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GRID,
  autoRoute,
  bodyCrossings,
  clientToWorld,
  editableSegment,
  fitViewBox,
  partBounds,
  padCrossings,
  partToWorld,
  pinEscape,
  placeInView,
  placementKey,
  pointsToRouting,
  routeWire,
  routingFor,
  rotateQuarter,
  snap,
  wireOverlap,
  zoomViewBox,
} from "../apps/web/workspace/geometry.js";
import {
  History,
  commands,
  createDiagram,
  nextPartId,
  parseDiagram,
  serializeDiagram,
  validateDiagram,
} from "../apps/web/workspace/diagram.js";
import { evaluateCircuit } from "../apps/web/workspace/netlist.js";

/** Minimal catalog: a 4-pin "board" (GPIO PA1, PA2, 3V3, GND), LED, resistor, button. */
const testCatalog = {
  "tm4c123gxl-launchpad": {
    kind: "board",
    pins: [{ name: "P1" }, { name: "P2" }, { name: "3V3" }, { name: "GND" }, { name: "GND2" }],
    role: (pin) => ({ P1: { kind: "gpio", gpio: "PA1" }, P2: { kind: "gpio", gpio: "PA2" }, "3V3": { kind: "power" }, GND: { kind: "ground" }, GND2: { kind: "ground" } })[pin],
    links: () => [{ a: "GND", b: "GND2" }],
  },
  led: { kind: "led", pins: [{ name: "A" }, { name: "C" }] },
  resistor: { kind: "resistor", pins: [{ name: "1" }, { name: "2" }], links: () => [{ a: "1", b: "2", strength: "weak" }] },
  pushbutton: {
    kind: "pushbutton",
    pins: [{ name: "1" }, { name: "2" }],
    links: (part, inputs) => (inputs.pressed.has(part.id) ? [{ a: "1", b: "2" }] : []),
  },
};

function diagramWith(parts, connections) {
  const diagram = createDiagram({ author: "test" });
  diagram.parts.push(...parts.map((p) => ({ top: 0, left: 0, rotate: 0, attrs: {}, ...p })));
  diagram.connections.push(...connections);
  return diagram;
}

describe("geometry", () => {
  it("snaps to the 0.1-inch header pitch", () => {
    assert.equal(GRID, 9.6);
    assert.equal(snap(14.3), 9.6);
    assert.equal(snap(14.5), 19.2);
  });

  it("rotates exactly by quarter turns", () => {
    assert.deepEqual(rotateQuarter({ x: 10, y: 0 }, 90), { x: 0, y: 10 });
    assert.deepEqual(rotateQuarter({ x: 10, y: 0 }, 180), { x: -10, y: 0 });
    assert.deepEqual(rotateQuarter({ x: 10, y: 0 }, -90), { x: 0, y: -10 });
    assert.deepEqual(rotateQuarter({ x: 3, y: 4 }, 360), { x: 3, y: 4 });
  });

  it("maps part-local pins to world coordinates about the part center", () => {
    const size = { width: 20, height: 40 };
    const part = { left: 100, top: 50, rotate: 90 };
    // Local (0,0) is the top-left corner; rotated 90° about (10,20).
    assert.deepEqual(partToWorld({ x: 0, y: 0 }, part, size), { x: 130, y: 60 });
    assert.deepEqual(partBounds(part, size), { x: 90, y: 60, width: 40, height: 20 });
  });

  it("routes wires orthogonally and honours routing instructions", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 50, y: 30 };
    assert.deepEqual(routeWire(a, b), [a, { x: 50, y: 0 }, b]);
    // v10 leaves the source vertically; h-5 enters the target horizontally;
    // collinear points are merged.
    const routed = routeWire(a, b, ["v10", "*", "h-5"]);
    assert.deepEqual(routed, [a, { x: 0, y: 30 }, b]);
    // Up 10, right 40, then the remaining gap continues horizontally and drops to the target.
    const detour = routeWire(a, b, ["v-10", "h40", "*"]);
    assert.deepEqual(detour, [a, { x: 0, y: -10 }, { x: 50, y: -10 }, b]);
    for (let i = 1; i < routed.length; i++) {
      assert.ok(routed[i].x === routed[i - 1].x || routed[i].y === routed[i - 1].y, "segments are axis-aligned");
    }
  });

  it("makes every wire segment draggable without moving the pins", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 50, y: 30 };
    const lShape = routeWire(a, b); // [a, corner, b]: no inner segment
    // Dragging the segment that leaves the source vertically by -20 grows a jog at the source.
    const first = editableSegment(lShape, 0);
    assert.equal(first.segment, 1);
    assert.deepEqual(first.points[0], a, "source pin stays");
    const movedFirst = first.points.map((p, i) => (i === 1 || i === 2 ? { x: p.x, y: p.y - 20 } : p));
    const routingFirst = pointsToRouting(movedFirst);
    assert.deepEqual(routingFirst, ["v-20", "h50"]);
    assert.deepEqual(routeWire(a, b, routingFirst), [a, { x: 0, y: -20 }, { x: 50, y: -20 }, b]);

    // The segment that enters the target: the target keeps its position.
    const last = editableSegment(lShape, 1);
    assert.equal(last.points.length, 4);
    assert.deepEqual(last.points.at(-1), b, "target pin stays");
    const movedLast = last.points.map((p, i) => (i === last.segment || i === last.segment + 1 ? { x: p.x + 10, y: p.y } : p));
    const routed = routeWire(a, b, pointsToRouting(movedLast));
    assert.deepEqual(routed[0], a);
    assert.deepEqual(routed.at(-1), b);
    for (let i = 1; i < routed.length; i++) {
      assert.ok(routed[i].x === routed[i - 1].x || routed[i].y === routed[i - 1].y, "segments stay axis-aligned");
    }
    assert.ok(routed.some((p) => p.x === 60), "the dragged vertical segment moved to x = 60");

    // A straight wire becomes a detour; inner segments are unchanged.
    const straight = editableSegment([a, { x: 40, y: 0 }], 0);
    assert.deepEqual(straight, { points: [a, a, { x: 40, y: 0 }, { x: 40, y: 0 }], segment: 1 });
    const inner = [a, { x: 0, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 30 }];
    assert.deepEqual(editableSegment(inner, 1), { points: inner, segment: 1 });
    assert.equal(editableSegment(inner, 3), null);
    assert.equal(editableSegment(inner, -1), null);
  });

  it("routes a new wire clear of unrelated pads, keeping the default L when it is clean", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 48, y: 28.8 };
    const clean = autoRoute(a, b);
    assert.deepEqual(clean.routing, [], "nothing in the way: the default L, stored as older diagrams store it");
    assert.deepEqual(clean.points, routeWire(a, b));

    // A pad on the default L's horizontal run: the vertical-first L, stored as a zero-length step.
    const blocked = autoRoute(a, b, { pads: [{ x: 19.2, y: 0 }] });
    assert.deepEqual(blocked.routing, ["v0"]);
    assert.deepEqual(blocked.points, [a, { x: 0, y: 28.8 }, b]);
    assert.equal(blocked.crossings, 0);

    // Both Ls blocked: the shortest detour through a lane, clear of every pad.
    const pads = [{ x: 19.2, y: 0 }, { x: 0, y: 19.2 }];
    assert.equal(padCrossings(routeWire(a, b), pads), 1);
    const detour = autoRoute(a, b, { pads });
    assert.deepEqual(detour.routing, ["v9.6", "h0"]);
    assert.deepEqual(detour.points, [a, { x: 0, y: 9.6 }, { x: 48, y: 9.6 }, b]);
    assert.equal(detour.crossings, 0);
    assert.deepEqual(routeWire(a, b, detour.routing), detour.points, "the stored instructions draw exactly the chosen route");
  });

  it("encodes a route as instructions that redraw it exactly, ending exactly on the target", () => {
    assert.deepEqual(routingFor([{ x: 0, y: 0 }, { x: 5, y: 0 }]), []);
    assert.deepEqual(routingFor([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]), []);
    assert.deepEqual(routingFor([{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 5 }]), ["v0"]);
    assert.deepEqual(routingFor([{ x: 0, y: 0 }, { x: 9.6, y: 0 }, { x: 9.6, y: 20 }, { x: 30, y: 20 }]), ["h9.6", "v0"]);
    // Board pins are not exact multiples of 9.6 in floating point (J1.6 and an LED pin here).
    const from = { x: 9.599999999999994, y: 163.20000000000002 };
    const to = { x: 259.2, y: 153.6 };
    const intended = [from, { x: 0, y: from.y }, { x: 0, y: 105.6 }, { x: 259.2, y: 105.6 }, to];
    const routing = routingFor(intended);
    assert.deepEqual(routing, ["h-9.6", "v-57.6", "h0"]);
    const drawn = routeWire(from, to, routing);
    assert.equal(drawn.length, intended.length, "no extra jog from rounding");
    assert.deepEqual(drawn.at(-1), to);
    drawn.forEach((point, i) => {
      assert.ok(Math.abs(point.x - intended[i].x) < 1e-9 && Math.abs(point.y - intended[i].y) < 1e-9, `point ${i}`);
      assert.ok(i === 0 || point.x === drawn[i - 1].x || point.y === drawn[i - 1].y, `segment ${i} axis-aligned`);
    });
  });

  it("keeps new wires out of part bodies, but lets them reach pins on a part's edge", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 96, y: 48 };
    // A part sitting on the default L's horizontal run (a button whose cap the wire would cover).
    const button = { x: 38.4, y: -19.2, width: 38.4, height: 38.4 };
    assert.equal(bodyCrossings(routeWire(a, b), [button]), 1);
    const route = autoRoute(a, b, { bodies: [button] });
    assert.equal(route.bodies, 0);
    assert.deepEqual(route.routing, ["v0"], "the other L goes round it");
    // A pin on the part's own edge is reached from outside without counting as crossing the part.
    const edgePin = { x: 38.4, y: 0 };
    const toPin = autoRoute({ x: 0, y: 0 }, edgePin, { toEscape: { x: -1, y: 0 }, bodies: [button] });
    assert.equal(toPin.bodies, 0);
    assert.deepEqual(toPin.routing, []);
    // Running along an edge does not count either; going through the middle does.
    assert.equal(bodyCrossings([{ x: 0, y: -19.2 }, { x: 100, y: -19.2 }], [button]), 0);
    assert.equal(bodyCrossings([{ x: 57.6, y: -40 }, { x: 57.6, y: 40 }], [button]), 1);
    // Pads still come first: a body is crossed only when every pad-free route would cross one.
    const walled = autoRoute(a, b, { pads: [{ x: 0, y: 19.2 }], bodies: [button] });
    assert.equal(walled.crossings, 0);
  });

  it("keeps new wires off existing wires when a clean alternative exists", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 48, y: 28.8 };
    const wire = [{ x: -20, y: 0 }, { x: 80, y: 0 }]; // along the default L's first run
    assert.equal(wireOverlap(routeWire(a, b), [wire]), 48);
    const route = autoRoute(a, b, { wires: [wire] });
    assert.deepEqual(route.routing, ["v0"]);
    assert.equal(route.overlap, 0);
    // A wire one grid away is a separate wire, not an overlap.
    assert.equal(wireOverlap(routeWire(a, b), [[{ x: -20, y: 9.6 }, { x: 80, y: 9.6 }]]), 0);
  });

  it("returns the route crossing the fewest pads when none is clean, deterministically", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 96, y: 0 };
    const wall = Array.from({ length: 81 }, (_, i) => ({ x: 48, y: (i - 40) * GRID })); // farther than any lane
    const route = autoRoute(a, b, { pads: wall });
    assert.equal(route.crossings, 1);
    assert.deepEqual(route.routing, [], "the straight wire: nothing shorter crosses fewer pads");
    assert.deepEqual(autoRoute(a, b, { pads: wall }), route);
  });

  it("leaves pins along their escape direction, turned with the part", () => {
    const size = { width: 28.8, height: 57.6 };
    const bottom = { x: 9.6, y: 57.6 };
    assert.deepEqual(pinEscape(bottom, { rotate: 0 }, size), { x: 0, y: 1 });
    assert.deepEqual(pinEscape(bottom, { rotate: 90 }, size), { x: -1, y: 0 });
    assert.deepEqual(pinEscape({ x: 0, y: 9.6 }, { rotate: 0 }, size), { x: -1, y: 0 });
    assert.deepEqual(pinEscape({ x: 28.8, y: 9.6 }, {}, size), { x: 1, y: 0 });
    assert.deepEqual(pinEscape({ x: 9.6, y: 0 }, { rotate: 180 }, size), { x: 0, y: 1 });
    assert.equal(pinEscape({ x: 9.6, y: 9.6 }, { rotate: 0 }, size), null, "inside the outline");
    assert.deepEqual(pinEscape({ x: 9.6, y: 9.6, escape: { x: 1, y: 0 } }, { rotate: 270 }, size), { x: 0, y: -1 });
  });

  it("smart paste keeps the cascade position when visible, otherwise centers in the view", () => {
    const view = { x: 0, y: 0, width: 960, height: 480 };
    const bounds = { x: 96, y: 96, width: 96, height: 48 };
    const step = { dx: GRID * 3, dy: GRID * 3 };
    // Visible at the cascade offset: unchanged, the view is not involved.
    assert.deepEqual(placeInView(bounds, view, step), { ...step, relocated: false, crowded: false });

    // Cascade position off-screen: centered in the view, on the grid, same shape.
    const far = placeInView(bounds, view, { dx: 2000, dy: 2000 });
    assert.equal(far.relocated, true);
    const left = bounds.x + far.dx;
    const top = bounds.y + far.dy;
    assert.ok(Math.abs(left + bounds.width / 2 - 480) <= GRID / 2 + 1e-9, "horizontally centered");
    assert.ok(Math.abs(top + bounds.height / 2 - 240) <= GRID / 2 + 1e-9, "vertically centered");
    assert.ok(Math.abs(far.dx / GRID - Math.round(far.dx / GRID)) < 1e-9, "dx on the grid");
    assert.ok(Math.abs(far.dy / GRID - Math.round(far.dy / GRID)) < 1e-9, "dy on the grid");

    // A used center position steps diagonally instead of stacking exactly.
    const avoid = new Set([placementKey(bounds, far.dx, far.dy)]);
    const next = placeInView(bounds, view, { dx: 2000, dy: 2000 }, { avoid });
    assert.ok(Math.abs(next.dx - far.dx - GRID * 3) < 1e-9 && Math.abs(next.dy - far.dy - GRID * 3) < 1e-9, "one 0.3 in step");

    // Larger than the view: aligned to the top-left margin, still no zoom.
    const huge = { x: 0, y: 0, width: 2000, height: 1000 };
    const placed = placeInView(huge, view, { dx: 5000, dy: 5000 });
    assert.deepEqual({ left: placed.dx, top: placed.dy }, { left: snap(GRID * 2), top: snap(GRID * 2) });

    // Works for views at negative coordinates (after panning).
    const panned = { x: -1200, y: -800, width: 480, height: 320 };
    const inPanned = placeInView(bounds, panned, step);
    assert.ok(bounds.x + inPanned.dx >= panned.x && bounds.x + inPanned.dx + bounds.width <= panned.x + panned.width);
    assert.ok(bounds.y + inPanned.dy >= panned.y && bounds.y + inPanned.dy + bounds.height <= panned.y + panned.height);
  });

  it("collision-aware placement prefers free, visible canvas and degrades predictably", () => {
    const view = { x: 0, y: 0, width: 960, height: 576 };
    const group = { x: 96, y: 96, width: 57.6, height: 38.4 }; // e.g. an LED + resistor
    const cascade = { dx: GRID * 3, dy: GRID * 3 };
    const clearance = GRID;
    const moved = (b, place) => ({ x: b.x + place.dx, y: b.y + place.dy, width: b.width, height: b.height });
    const hits = (a, o) => Math.min(a.x + a.width, o.x + o.width + clearance) - Math.max(a.x, o.x - clearance) > 1e-6
      && Math.min(a.y + a.height, o.y + o.height + clearance) - Math.max(a.y, o.y - clearance) > 1e-6;
    const inside = (a) => a.x >= view.x + GRID * 2 - 1e-6 && a.y >= view.y + GRID * 2 - 1e-6
      && a.x + a.width <= view.x + view.width - GRID * 2 + 1e-6 && a.y + a.height <= view.y + view.height - GRID * 2 + 1e-6;
    const onGrid = (v) => Math.abs(v / GRID - Math.round(v / GRID)) < 1e-9;

    // The cascade may overlap its own family (the source and earlier copies), so it is kept.
    const source = { ...group, family: true };
    assert.deepEqual(placeInView(group, view, cascade, { obstacles: [source] }), { ...cascade, relocated: false, crowded: false });

    // A board in the middle of the view and a part blocking the cascade: the result avoids both.
    const board = { x: 384, y: 144, width: 192, height: 249.6 };
    const blocker = { x: 110, y: 110, width: 60, height: 60 };
    const obstacles = [board, blocker, source];
    const place = placeInView(group, view, cascade, { obstacles });
    assert.equal(place.relocated, true);
    assert.equal(place.crowded, false);
    const result = moved(group, place);
    assert.ok(inside(result), "visible");
    assert.ok(!hits(result, board) && !hits(result, blocker) && !hits(result, source), "on free canvas, with clearance");
    assert.ok(onGrid(place.dx) && onGrid(place.dy), "grid offset");
    assert.deepEqual(placeInView(group, view, cascade, { obstacles }), place, "deterministic");

    // Cut, then paste in place: kept even where it overlaps (it was there before).
    assert.deepEqual(placeInView(group, view, { dx: 0, dy: 0 }, { obstacles: [{ ...group }], inPlace: true }), { dx: 0, dy: 0, relocated: false, crowded: false });

    // Repeated placements do not stack: each result is added as an obstacle and to `avoid`.
    const avoid = new Set();
    const placed = [];
    for (let i = 0; i < 8; i++) {
      const next = placeInView(group, view, { dx: 5000, dy: 5000 }, { obstacles: [board, ...placed], avoid });
      avoid.add(placementKey(group, next.dx, next.dy));
      const box = moved(group, next);
      assert.ok(inside(box) && !hits(box, board), `placement ${i} visible and off the board`);
      assert.ok(placed.every((other) => !hits(box, other)), `placement ${i} does not overlap earlier ones`);
      placed.push(box);
    }

    // Crowded view (one obstacle covers everything): still visible, flagged, least overlap, deterministic.
    const wall = { x: -100, y: -100, width: 2000, height: 2000 };
    const crowded = placeInView(group, view, cascade, { obstacles: [wall] });
    assert.equal(crowded.crowded, true);
    assert.ok(inside(moved(group, crowded)));
    assert.deepEqual(placeInView(group, view, cascade, { obstacles: [wall] }), crowded);

    // Partly crowded: the spot with the least overlap wins over heavier overlap.
    const left = { x: 0, y: 0, width: 600, height: 576 };
    const partial = placeInView(group, view, cascade, { obstacles: [left] });
    const box = moved(group, partial);
    assert.ok(box.x >= left.x + left.width + clearance - 1e-6, "uses the free right-hand strip");

    // Items larger than the view: top-left margin, no zoom (unchanged from smart paste).
    const huge = { x: 0, y: 0, width: 2000, height: 1000 };
    const big = placeInView(huge, view, { dx: 5000, dy: 5000 }, { obstacles: [board] });
    assert.deepEqual({ dx: big.dx, dy: big.dy }, { dx: snap(GRID * 2), dy: snap(GRID * 2) });
    assert.equal(big.crowded, true);

    // Efficient: a large view with many obstacles completes quickly.
    const many = Array.from({ length: 60 }, (_, i) => ({ x: (i % 10) * 200, y: Math.floor(i / 10) * 200, width: 150, height: 150 }));
    const start = performance.now();
    placeInView(group, { x: 0, y: 0, width: 2000, height: 1200 }, cascade, { obstacles: many });
    assert.ok(performance.now() - start < 250, "placement search is fast");
  });

  it("add-part placement: the middle of the view when free, else the nearest free spot; repeats never stack", () => {
    const view = { x: 0, y: 0, width: 960, height: 576 };
    const led = { width: 28.8, height: 57.6 };
    // As canvas.addPart builds it: centered in the view, snapped to the grid, preferred offset (0, 0).
    const centered = { x: snap(480 - led.width / 2), y: snap(288 - led.height / 2), ...led };
    const moved = (place) => ({ x: centered.x + place.dx, y: centered.y + place.dy, ...led });
    const hits = (a, o) => Math.min(a.x + a.width, o.x + o.width + GRID) - Math.max(a.x, o.x - GRID) > 1e-6
      && Math.min(a.y + a.height, o.y + o.height + GRID) - Math.max(a.y, o.y - GRID) > 1e-6;
    const inside = (a) => a.x >= GRID * 2 - 1e-6 && a.y >= GRID * 2 - 1e-6
      && a.x + a.width <= view.width - GRID * 2 + 1e-6 && a.y + a.height <= view.height - GRID * 2 + 1e-6;
    const onGrid = (v) => Math.abs(v / GRID - Math.round(v / GRID)) < 1e-9;

    // Empty canvas: exactly the middle, as before.
    assert.deepEqual(placeInView(centered, view, { dx: 0, dy: 0 }, { obstacles: [] }), { dx: 0, dy: 0, relocated: false, crowded: false });

    // The LaunchPad fills the middle (as after Fit): parts go beside it, each one an obstacle for the next.
    const board = { x: 336, y: 48, width: 288, height: 480 };
    const obstacles = [board];
    for (let i = 0; i < 6; i++) {
      const place = placeInView(centered, view, { dx: 0, dy: 0 }, { obstacles });
      assert.deepEqual(placeInView(centered, view, { dx: 0, dy: 0 }, { obstacles }), place, "deterministic");
      const box = moved(place);
      assert.equal(place.crowded, false, `add ${i} found free space`);
      assert.ok(inside(box), `add ${i} visible`);
      assert.ok(obstacles.every((o) => !hits(box, o)), `add ${i} clear of the board and earlier parts`);
      assert.ok(onGrid(place.dx) && onGrid(place.dy), `add ${i} on the grid`);
      obstacles.push(box);
    }

    // Zoomed in on the board (it covers the whole view): visible, least overlap, flagged as crowded.
    const zoomed = { x: 400, y: 200, width: 160, height: 120 };
    const crowdedCenter = { x: snap(480 - led.width / 2), y: snap(260 - led.height / 2), ...led };
    const crowded = placeInView(crowdedCenter, zoomed, { dx: 0, dy: 0 }, { obstacles: [board] });
    assert.equal(crowded.crowded, true);
    const box = { x: crowdedCenter.x + crowded.dx, y: crowdedCenter.y + crowded.dy, ...led };
    assert.ok(box.x >= zoomed.x && box.y >= zoomed.y && box.x + box.width <= zoomed.x + zoomed.width && box.y + box.height <= zoomed.y + zoomed.height, "still in view");
  });

  it("zooms about an anchor and converts client coordinates", () => {
    const view = { x: 0, y: 0, width: 400, height: 200 };
    const zoomed = zoomViewBox(view, 2, { x: 100, y: 50 });
    assert.deepEqual(zoomed, { x: 50, y: 25, width: 200, height: 100 });
    const rect = { left: 10, top: 20, width: 800, height: 400 };
    assert.deepEqual(clientToWorld(view, rect, 10 + 400, 20 + 200), { x: 200, y: 100 });
    // preserveAspectRatio "meet": a 400x200 view in a 400x400 element is letterboxed 100 px top and bottom.
    const square = { left: 0, top: 0, width: 400, height: 400 };
    assert.deepEqual(clientToWorld(view, square, 0, 100), { x: 0, y: 0 });
    assert.deepEqual(clientToWorld(view, square, 400, 300), { x: 400, y: 200 });
    // Round trip: zooming keeps the anchor under the same client point.
    const anchorClient = { x: 10 + 600, y: 20 + 100 };
    const anchorWorld = clientToWorld(view, rect, anchorClient.x, anchorClient.y);
    const zoomedIn = zoomViewBox(view, 2.5, anchorWorld);
    const again = clientToWorld(zoomedIn, rect, anchorClient.x, anchorClient.y);
    assert.ok(Math.abs(again.x - anchorWorld.x) < 1e-9 && Math.abs(again.y - anchorWorld.y) < 1e-9);
    const fit = fitViewBox({ x: 0, y: 0, width: 100, height: 100 }, 2, 0);
    assert.deepEqual(fit, { x: -50, y: 0, width: 200, height: 100 });
  });
});

describe("diagram", () => {
  it("creates a valid default diagram containing the LaunchPad", () => {
    const diagram = createDiagram();
    assert.deepEqual(validateDiagram(diagram, testCatalog), []);
    assert.equal(diagram.parts[0].id, "board1");
  });

  it("rejects unknown parts, pins, self wires, and duplicates", () => {
    const diagram = diagramWith(
      [{ type: "led", id: "led1" }, { type: "mystery", id: "x1" }],
      [
        ["led1:A", "board1:P1", "green", []],
        ["board1:P1", "led1:A", "red", []],
        ["led1:Z", "board1:P1", "green", []],
        ["led1:A", "led1:A", "green", []],
        ["led1:C", "nope:1", "green", []],
        ["led1:C", "board1:GND", "green", ["q5"]],
      ],
    );
    const errors = validateDiagram(diagram, testCatalog).join("\n");
    assert.match(errors, /unknown part type "mystery"/);
    assert.match(errors, /duplicate wire/);
    assert.match(errors, /has no pin "Z"/);
    assert.match(errors, /cannot connect a pin to itself/);
    assert.match(errors, /unknown part "nope"/);
    assert.match(errors, /routing must be/);
  });

  it("round-trips through JSON without changing parts or connections", () => {
    const diagram = diagramWith(
      [{ type: "led", id: "led1", top: 96, left: 192.0001, rotate: 450, attrs: { color: "red" } }, { type: "resistor", id: "r1" }],
      [["led1:A", "r1:1", "orange", ["v9.6", "*", "h-19.2"]], ["r1:2", "board1:P1", "green", []]],
    );
    const text = serializeDiagram(diagram);
    const { diagram: loaded, errors } = parseDiagram(text, testCatalog);
    assert.deepEqual(errors, []);
    assert.equal(serializeDiagram(loaded), text, "serialization is stable");
    assert.deepEqual(loaded.parts.map((p) => p.id), ["board1", "led1", "r1"]);
    assert.equal(loaded.parts[1].rotate, 90, "rotation is normalized");
    assert.deepEqual(loaded.connections, [["led1:A", "r1:1", "orange", ["v9.6", "*", "h-19.2"]], ["r1:2", "board1:P1", "green", []]]);
  });

  it("reports invalid JSON", () => {
    const { diagram, errors } = parseDiagram("{nope", testCatalog);
    assert.equal(diagram, null);
    assert.match(errors[0], /Invalid JSON/);
  });

  it("undoes and redoes edits, restoring wires removed with a part", () => {
    const diagram = diagramWith([{ type: "led", id: "led1" }], [["led1:A", "board1:P1", "green", []]]);
    const before = serializeDiagram(diagram);
    const history = new History(diagram);
    history.execute(commands.movePart("led1", { left: 0, top: 0 }, { left: 48, top: 96 }));
    history.execute(commands.rotatePart("led1", 0, 90));
    history.execute(commands.removePart(history.diagram, "led1"));
    assert.equal(history.diagram.connections.length, 0);
    assert.equal(history.diagram.parts.length, 1);
    history.undo();
    assert.equal(history.diagram.connections.length, 1, "wire restored with the part");
    history.undo();
    history.undo();
    assert.equal(serializeDiagram(history.diagram), before);
    assert.equal(history.canUndo, false);
    history.redo();
    assert.equal(history.diagram.parts[1].left, 48);
    history.execute(commands.addPart({ type: "resistor", id: nextPartId(history.diagram, "r"), top: 0, left: 0, rotate: 0, attrs: {} }));
    assert.equal(history.canRedo, false, "a new edit clears the redo stack");
    assert.equal(nextPartId(history.diagram, "r"), "r2");
  });
});

describe("netlist", () => {
  const output = (level) => ({ level, drive: "output", state: level ? "high" : "low" });

  it("lights an LED through a resistor from a GPIO driven HIGH to GND", () => {
    const diagram = diagramWith(
      [{ type: "led", id: "led1" }, { type: "resistor", id: "r1" }],
      [["board1:P1", "r1:1", "green", []], ["r1:2", "led1:A", "green", []], ["led1:C", "board1:GND", "black", []]],
    );
    const on = evaluateCircuit(diagram, testCatalog, { PA1: output(1) });
    assert.deepEqual(on.leds.led1, { on: true, reason: "forward biased" });
    const off = evaluateCircuit(diagram, testCatalog, { PA1: output(0) });
    assert.equal(off.leds.led1.on, false);
    const floating = evaluateCircuit(diagram, testCatalog, { PA1: { level: null, drive: "none", state: "floating" } });
    assert.equal(floating.leds.led1.on, false);
  });

  it("warns about an LED without a series resistor", () => {
    const diagram = diagramWith([{ type: "led", id: "led1" }], [["board1:P1", "led1:A", "green", []], ["led1:C", "board1:GND2", "black", []]]);
    const result = evaluateCircuit(diagram, testCatalog, { PA1: output(1) });
    assert.equal(result.leds.led1.on, true);
    assert.match(result.leds.led1.warning, /series resistor/);
  });

  it("does not light a reversed LED", () => {
    const diagram = diagramWith([{ type: "led", id: "led1" }], [["board1:P1", "led1:C", "green", []], ["led1:A", "board1:GND", "black", []]]);
    assert.equal(evaluateCircuit(diagram, testCatalog, { PA1: output(1) }).leds.led1.on, false);
  });

  it("drives a board input LOW only while a button to GND is pressed", () => {
    const diagram = diagramWith([{ type: "pushbutton", id: "btn1" }], [["board1:P2", "btn1:1", "green", []], ["btn1:2", "board1:GND", "black", []]]);
    const released = evaluateCircuit(diagram, testCatalog, {}, { pressed: new Set() });
    assert.deepEqual(released.boardInputs.PA2, { level: null, strength: "none" });
    const pressed = evaluateCircuit(diagram, testCatalog, {}, { pressed: new Set(["btn1"]) });
    assert.deepEqual(pressed.boardInputs.PA2, { level: false, strength: "strong" });
  });

  it("treats a resistor to 3.3 V as a weak pull that a pressed button overrides", () => {
    const diagram = diagramWith(
      [{ type: "pushbutton", id: "btn1" }, { type: "resistor", id: "r1" }],
      [["board1:P2", "r1:1", "red", []], ["r1:2", "board1:3V3", "red", []], ["board1:P2", "btn1:1", "green", []], ["btn1:2", "board1:GND", "black", []]],
    );
    assert.deepEqual(evaluateCircuit(diagram, testCatalog, {}, { pressed: new Set() }).boardInputs.PA2, { level: true, strength: "weak" });
    assert.deepEqual(evaluateCircuit(diagram, testCatalog, {}, { pressed: new Set(["btn1"]) }).boardInputs.PA2, { level: false, strength: "strong" });
  });

  it("reports a short circuit when power and ground meet", () => {
    const diagram = diagramWith([{ type: "pushbutton", id: "btn1" }], [["board1:P2", "board1:3V3", "red", []], ["board1:P2", "btn1:1", "green", []], ["btn1:2", "board1:GND", "black", []]]);
    const result = evaluateCircuit(diagram, testCatalog, {}, { pressed: new Set(["btn1"]) });
    assert.match(result.errors.join(), /Short circuit/);
  });
});
