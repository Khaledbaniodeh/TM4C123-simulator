/*
 * EK-TM4C123GXL board definition tests: pin map integrity, anchor geometry,
 * board-internal connections, and pin metadata. The header-to-GPIO map is
 * additionally verified against TI's SPMU296 in the hardware-reference CI job.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOARD_INPUTS, BOARD_LEDS } from "../apps/web/board-state.js";
import { BOARD_PART, GEOMETRY } from "../apps/web/board/launchpad.js";
import { readFile } from "node:fs/promises";
import { GRID, autoRoute, padCrossings, partToWorld, pinEscape, routeWire } from "../apps/web/workspace/geometry.js";
import { CATALOG, LIBRARY } from "../apps/web/workspace/parts.js";
import { createDiagram, parseDiagram, validateDiagram } from "../apps/web/workspace/diagram.js";
import { evaluateCircuit } from "../apps/web/workspace/netlist.js";

const { pinMap } = BOARD_PART;

describe("EK-TM4C123GXL pin map", () => {
  it("has four 10-pin BoosterPack headers", () => {
    assert.deepEqual(Object.keys(pinMap.headers).sort(), ["J1", "J2", "J3", "J4"]);
    for (const [header, pins] of Object.entries(pinMap.headers)) {
      assert.deepEqual(pins.map((p) => p.pin), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], header);
    }
    assert.equal(BOARD_PART.pins.length, 40);
  });

  it("lists each GPIO at most once and uses valid TM4C123 port/pin names", () => {
    const gpios = BOARD_PART.pins.filter((p) => p.gpio).map((p) => p.gpio);
    assert.equal(new Set(gpios).size, gpios.length, "duplicate GPIO on headers");
    assert.ok(gpios.every((g) => /^P[A-F][0-7]$/.test(g)));
    assert.equal(gpios.length, 35, "35 GPIOs + 3.3V, 5V, 2x GND, RESET");
  });

  it("keeps on-board roles consistent with the simulator's LED/switch mapping", () => {
    assert.equal(pinMap.onboard.redLed, BOARD_LEDS.red);
    assert.equal(pinMap.onboard.blueLed, BOARD_LEDS.blue);
    assert.equal(pinMap.onboard.greenLed, BOARD_LEDS.green);
    assert.equal(pinMap.onboard.sw1, BOARD_INPUTS.SW1.pinId);
    assert.equal(pinMap.onboard.sw2, BOARD_INPUTS.SW2.pinId);
  });

  it("describes R9/R10 as symmetric shorts", () => {
    const byGpio = Object.fromEntries(BOARD_PART.pins.filter((p) => p.gpio).map((p) => [p.gpio, p]));
    for (const [a, b] of [["PD0", "PB6"], ["PD1", "PB7"]]) {
      assert.equal(byGpio[a].shorted, b);
      assert.equal(byGpio[b].shorted, a);
      assert.equal(byGpio[a].via, byGpio[b].via);
    }
  });
});

describe("board geometry", () => {
  it("places header pins on a 0.1-inch pitch inside the board outline", () => {
    for (const header of ["J1", "J2", "J3", "J4"]) {
      const pins = BOARD_PART.pins.filter((p) => p.header === header).sort((a, b) => a.number - b.number);
      for (let i = 1; i < pins.length; i++) {
        assert.ok(Math.abs(pins[i].y - pins[i - 1].y - GRID) < 1e-9, `${header} pitch`);
        assert.equal(pins[i].x, pins[0].x, `${header} column`);
      }
      for (const pin of pins) {
        assert.ok(pin.x > 0 && pin.x < BOARD_PART.size.width && pin.y > 0 && pin.y < BOARD_PART.size.height, `${pin.name} inside board`);
      }
    }
  });

  it("puts J1/J3 on the left half and J4/J2 on the right half, outer headers outermost", () => {
    const x = (header) => GEOMETRY.headers[header].x;
    assert.ok(x("J1") < x("J3") && x("J3") < GEOMETRY.width / 2);
    assert.ok(x("J2") > x("J4") && x("J4") > GEOMETRY.width / 2);
  });

  it("matches TI's CAD data: 2.0 x 2.6 in outline and header columns on 0.1 in", () => {
    assert.ok(Math.abs(GEOMETRY.width - 50.8) < 1e-9 && Math.abs(GEOMETRY.height - 66.04) < 1e-9);
    // J1/J3 at 100/200 mil, J4/J2 at 1800/1900 mil; pin 1 at 1400 mil (CAD y up) = 30.48 mm from the top.
    const expected = { J1: 2.54, J3: 5.08, J4: 45.72, J2: 48.26 };
    for (const [header, x] of Object.entries(expected)) {
      assert.ok(Math.abs(GEOMETRY.headers[header].x - x) < 1e-9, `${header} x`);
      assert.ok(Math.abs(GEOMETRY.headers[header].y - 30.48) < 1e-9, `${header} pin 1 y`);
    }
  });

  it("is portrait with DEBUG USB on the top edge, DEVICE USB on the left edge, and switches at the bottom", () => {
    assert.ok(GEOMETRY.height > GEOMETRY.width);
    assert.ok(GEOMETRY.usbDebug.y < 3, "DEBUG micro-B on the top edge");
    assert.ok(GEOMETRY.usbDevice.x < 3, "DEVICE micro-AB on the left edge");
    assert.ok(GEOMETRY.sw1.y > GEOMETRY.height * 0.85 && GEOMETRY.sw2.y > GEOMETRY.height * 0.85);
    assert.ok(GEOMETRY.sw1.x < GEOMETRY.width / 2 && GEOMETRY.sw2.x > GEOMETRY.width / 2);
  });

  it("places the RESET switch from its SPMR240 part line (1770, 1880 mil)", () => {
    assert.ok(Math.abs(GEOMETRY.reset.x - 1770 * 0.0254) < 1e-9);
    assert.ok(Math.abs(GEOMETRY.reset.y - (2600 - 1880) * 0.0254) < 1e-9);
    assert.equal(BOARD_PART.components.RESET.status, "simulated");
  });

  it("puts every header pin anchor on the 0.1-inch workspace grid", () => {
    for (const pin of BOARD_PART.pins) {
      assert.ok(Math.abs(pin.x / GRID - Math.round(pin.x / GRID)) < 1e-6, `${pin.name} x`);
      assert.ok(Math.abs(pin.y / GRID - Math.round(pin.y / GRID)) < 1e-6, `${pin.name} y`);
    }
  });

  it("routes new wires from a header pin away from its neighbouring column and clear of every other pad", () => {
    const away = { J1: { x: -1, y: 0 }, J3: { x: 1, y: 0 }, J4: { x: -1, y: 0 }, J2: { x: 1, y: 0 } };
    for (const pin of BOARD_PART.pins) {
      assert.deepEqual(pinEscape(pin, { rotate: 0 }, BOARD_PART.size), away[pin.header], pin.name);
    }
    const pin = (name) => BOARD_PART.pins.find((p) => p.name === name);
    const others = (...names) => BOARD_PART.pins.filter((p) => !names.includes(p.name));
    // From the inner column J3 to a point level with it beyond J1: the default L runs over J1.5.
    const from = pin("J3.5");
    const to = { x: -96, y: from.y };
    assert.equal(padCrossings(routeWire(from, to), others("J3.5")), 1);
    const route = autoRoute(from, to, { fromEscape: pinEscape(from, {}, BOARD_PART.size), pads: others("J3.5") });
    assert.equal(route.crossings, 0);
    assert.ok(route.points[1].x > from.x && route.points[1].y === from.y, "leaves J3 towards the board, away from J1");
    // Between pins of the two left columns (J1.10 to J3.1): no pad of either column on the way.
    const across = autoRoute(pin("J1.10"), pin("J3.1"), { fromEscape: away.J1, toEscape: away.J3, pads: others("J1.10", "J3.1") });
    assert.equal(across.crossings, 0);
    assert.deepEqual(routeWire(pin("J1.10"), pin("J3.1"), across.routing), across.points);
  });

  it("ships example circuits whose wires cross no unrelated pin pad", async () => {
    for (const id of ["lcd1602-hello", "external-led-button", "adc-potentiometer"]) {
      const { diagram, errors } = parseDiagram(await readFile(new URL(`../examples/${id}/diagram.json`, import.meta.url), "utf8"), CATALOG);
      assert.deepEqual(errors, [], id);
      const pads = diagram.parts.flatMap((part) => CATALOG[part.type].pins.map((p) => ({ id: `${part.id}:${p.name}`, ...partToWorld(p, part, CATALOG[part.type].size) })));
      const at = (endpoint) => pads.find((p) => p.id === endpoint);
      for (const [from, to, , routing] of diagram.connections) {
        const points = routeWire(at(from), at(to), routing);
        assert.equal(padCrossings(points, pads.filter((p) => p.id !== from && p.id !== to)), 0, `${id} ${from}→${to}`);
      }
    }
  });
});

describe("board part behavior", () => {
  it("reports pin roles and tooltips from the pin map", () => {
    assert.deepEqual(BOARD_PART.role("J1.2"), { kind: "gpio", gpio: "PB5" });
    assert.deepEqual(BOARD_PART.role("J2.1"), { kind: "ground" });
    assert.equal(BOARD_PART.role("J1.1").kind, "power");
    const info = BOARD_PART.pinInfo("J3.10");
    assert.match(info.title, /J3 pin 10 · PF1/);
    assert.ok(info.lines.some((line) => /On-board red LED/.test(line)));
    const analog = BOARD_PART.pinInfo("J3.9");
    assert.ok(analog.lines.some((line) => /AIN0/.test(line) && /sampled by ADC0\/ADC1/.test(line)));
  });

  it("joins all GND pins and the R9/R10 shorts electrically", () => {
    const diagram = createDiagram();
    diagram.parts.push({ type: "pushbutton", id: "btn1", top: 0, left: 0, rotate: 0, attrs: {} });
    // Button from PB6 (J2.7) to GND on J3.2; PD0 is tied to PB6 through R9.
    diagram.connections.push(["board1:J2.7", "btn1:1", "green", []], ["btn1:2", "board1:J3.2", "black", []]);
    assert.deepEqual(validateDiagram(diagram, CATALOG), []);
    const result = evaluateCircuit(diagram, CATALOG, {}, { pressed: new Set(["btn1"]) });
    assert.deepEqual(result.boardInputs.PB6, { level: false, strength: "strong" });
    assert.deepEqual(result.boardInputs.PD0, { level: false, strength: "strong" }, "R9 carries the level to PD0");
  });

  it("lights a real-catalog LED through a resistor from a board GPIO (example F wiring)", () => {
    const diagram = createDiagram();
    diagram.parts.push(
      { type: "led", id: "led1", top: 0, left: 0, rotate: 0, attrs: { color: "red" } },
      { type: "resistor", id: "r1", top: 0, left: 0, rotate: 0, attrs: { value: "220" } },
    );
    diagram.connections.push(["board1:J1.10", "r1:2", "green", []], ["r1:1", "led1:A", "green", []], ["led1:C", "board1:J3.2", "black", []]);
    const high = { PA7: { level: 1, drive: "output", state: "high" } };
    const low = { PA7: { level: 0, drive: "output", state: "low" } };
    assert.deepEqual(evaluateCircuit(diagram, CATALOG, high).leds.led1, { on: true, reason: "forward biased" });
    assert.equal(evaluateCircuit(diagram, CATALOG, low).leds.led1.on, false);
    assert.equal(evaluateCircuit(diagram, CATALOG, {}).leds.led1.on, false, "no simulation state: LED off");
  });

  it("offers only external parts in the library, each with an honest status", () => {
    assert.ok(!LIBRARY.includes(BOARD_PART.type));
    for (const type of LIBRARY) {
      assert.ok(["simulated", "editor"].includes(CATALOG[type].status), type);
      for (const pin of CATALOG[type].pins) {
        assert.ok(Math.abs(pin.x / GRID - Math.round(pin.x / GRID)) < 1e-9, `${type}:${pin.name} x on grid`);
        assert.ok(Math.abs(pin.y / GRID - Math.round(pin.y / GRID)) < 1e-9, `${type}:${pin.name} y on grid`);
      }
    }
    assert.equal(CATALOG.potentiometer.status, "simulated"); // ideal divider feeding the ADC model
    assert.equal(CATALOG.lcd1602.status, "simulated"); // HD44780 model fed by GPIO events
    assert.equal(CATALOG["logic-analyzer"].status, "editor");
  });
});
