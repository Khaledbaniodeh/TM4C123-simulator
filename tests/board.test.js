/*
 * EK-TM4C123GXL board definition tests: pin map integrity, anchor geometry,
 * board-internal connections, and pin metadata. The header-to-GPIO map is
 * additionally verified against TI's SPMU296 in the hardware-reference CI job.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOARD_INPUTS, BOARD_LEDS } from "../apps/web/board-state.js";
import { BOARD_PART, GEOMETRY } from "../apps/web/board/launchpad.js";
import { GRID } from "../apps/web/workspace/geometry.js";
import { CATALOG, LIBRARY } from "../apps/web/workspace/parts.js";
import { createDiagram, validateDiagram } from "../apps/web/workspace/diagram.js";
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

  it("is portrait with the USB edge at the top", () => {
    assert.ok(GEOMETRY.height > GEOMETRY.width);
    assert.ok(GEOMETRY.usbDebug.y < GEOMETRY.height / 4 && GEOMETRY.usbDevice.y < GEOMETRY.height / 4);
    assert.ok(GEOMETRY.sw1.y > GEOMETRY.height / 2 && GEOMETRY.sw2.y > GEOMETRY.height / 2);
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
    assert.ok(analog.lines.some((line) => /AIN0/.test(line) && /not modeled/.test(line)));
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

  it("offers only external parts in the library, each with an honest status", () => {
    assert.ok(!LIBRARY.includes(BOARD_PART.type));
    for (const type of LIBRARY) {
      assert.ok(["simulated", "editor"].includes(CATALOG[type].status), type);
      for (const pin of CATALOG[type].pins) {
        assert.ok(Math.abs(pin.x / GRID - Math.round(pin.x / GRID)) < 1e-9, `${type}:${pin.name} x on grid`);
        assert.ok(Math.abs(pin.y / GRID - Math.round(pin.y / GRID)) < 1e-9, `${type}:${pin.name} y on grid`);
      }
    }
    assert.equal(CATALOG.potentiometer.status, "editor");
    assert.equal(CATALOG.lcd1602.status, "editor");
    assert.equal(CATALOG["logic-analyzer"].status, "editor");
  });
});
