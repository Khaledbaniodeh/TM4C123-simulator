/*
 * Board-state projection tests: the browser's LED/pin view is derived only
 * from simulator events.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOARD_INPUTS,
  applyEvent,
  createBoardState,
  describePin,
  formatVirtualTime,
  isLedOn,
} from "../apps/web/board-state.js";

const pinEvent = (sequence, pinId, level, drive = "output") => ({
  type: "digital-pin-changed",
  sequence,
  virtualTimeNs: String(sequence * 1000),
  pin: { partId: "board1", pinId },
  level,
  state: level === 1 ? "high" : level === 0 ? "low" : "floating",
  drive,
});

describe("board state", () => {
  it("starts with every LED off", () => {
    const state = createBoardState();
    assert.equal(isLedOn(state, "PF1"), false);
    assert.equal(describePin(state, "PF1").label, "unknown");
  });

  it("lights an LED only for a GPIO output driving HIGH", () => {
    const state = createBoardState();
    applyEvent(state, pinEvent(1, "PF1", 1));
    assert.equal(isLedOn(state, "PF1"), true);
    applyEvent(state, pinEvent(2, "PF1", 0));
    assert.equal(isLedOn(state, "PF1"), false);
    applyEvent(state, pinEvent(3, "PF1", 1, "pull-up"));
    assert.equal(isLedOn(state, "PF1"), false, "a weak pull-up does not light the LED");
  });

  it("ignores replayed or out-of-order events by sequence number", () => {
    const state = createBoardState();
    assert.equal(applyEvent(state, pinEvent(5, "PF1", 1)), true);
    assert.equal(applyEvent(state, pinEvent(4, "PF1", 0)), false);
    assert.equal(applyEvent(state, pinEvent(5, "PF1", 0)), false);
    assert.equal(isLedOn(state, "PF1"), true);
  });

  it("applies reset snapshots and clears faults", () => {
    const state = createBoardState();
    applyEvent(state, pinEvent(1, "PF1", 1));
    applyEvent(state, { type: "cpu-fault", exception: "HardFault" });
    assert.equal(state.fault.exception, "HardFault");
    applyEvent(state, {
      type: "port-snapshot",
      sequence: 2,
      virtualTimeNs: "2000",
      cause: "reset",
      pins: [{ pinId: "PF1", level: null, state: "floating", drive: "none" }],
    });
    assert.equal(isLedOn(state, "PF1"), false);
    assert.equal(state.fault, null);
    assert.deepEqual(describePin(state, "PF1"), { label: "FLOATING", detail: "not driven" });
  });

  it("maps the LaunchPad switches to their datasheet pins", () => {
    assert.deepEqual({ ...BOARD_INPUTS.SW1 }, { port: "F", pin: 4, pinId: "PF4" });
    assert.deepEqual({ ...BOARD_INPUTS.SW2 }, { port: "F", pin: 0, pinId: "PF0" });
  });

  it("formats virtual time", () => {
    assert.equal(formatVirtualTime("625"), "0.6 µs");
    assert.equal(formatVirtualTime("10001500"), "10.002 ms");
    assert.equal(formatVirtualTime("2500000000"), "2.500 s");
  });
});
