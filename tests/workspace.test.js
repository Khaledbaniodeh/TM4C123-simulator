/*
 * Workspace model tests: geometry, diagram validation/serialization,
 * undo/redo, and the logic-level netlist. Pure modules, no browser.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GRID,
  clientToWorld,
  fitViewBox,
  partBounds,
  partToWorld,
  routeWire,
  rotateQuarter,
  snap,
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
