/*
 * LaunchPad board state derived from simulator events.
 *
 * Pure functions shared by the browser and the Node test suite. The board
 * view is a projection of `port-snapshot` and `digital-pin-changed` events
 * emitted by the Renode GPIO model — nothing here decides electrical state
 * on its own.
 */

/** On-board switches: pressing shorts the pin to ground (active-low). */
export const BOARD_INPUTS = Object.freeze({
  SW1: Object.freeze({ port: "F", pin: 4, pinId: "PF4" }),
  SW2: Object.freeze({ port: "F", pin: 0, pinId: "PF0" }),
});

/** On-board RGB LED channels (driven through transistors; HIGH = on). */
export const BOARD_LEDS = Object.freeze({
  red: "PF1",
  blue: "PF2",
  green: "PF3",
});

export const WATCHED_PINS = Object.freeze(["PF0", "PF1", "PF2", "PF3", "PF4"]);

export function createBoardState() {
  return {
    pins: {},
    lastSequence: 0,
    virtualTimeNs: "0",
    fault: null,
  };
}

function setPin(state, pinId, { level, state: pinState, drive }) {
  state.pins[pinId] = { level, state: pinState, drive };
}

/**
 * Applies one simulator event. Returns true if the board view changed.
 * Events are idempotent by sequence number, so replays are harmless.
 */
export function applyEvent(state, event) {
  if (typeof event?.sequence === "number") {
    if (event.sequence <= state.lastSequence) {
      return false;
    }
    state.lastSequence = event.sequence;
  }
  if (event.virtualTimeNs !== undefined) {
    state.virtualTimeNs = event.virtualTimeNs;
  }

  switch (event.type) {
  case "port-snapshot":
    for (const pin of event.pins ?? []) {
      setPin(state, pin.pinId, pin);
    }
    if (event.cause === "reset" || event.cause === "power-on") {
      state.fault = null;
    }
    return true;
  case "digital-pin-changed":
    setPin(state, event.pin.pinId, event);
    return true;
  case "cpu-fault":
    state.fault = event;
    return true;
  default:
    return false;
  }
}

/** An LED is lit only when its pin is actively driven HIGH by a GPIO output. */
export function isLedOn(state, pinId) {
  const pin = state.pins[pinId];
  return pin?.level === 1 && pin.drive === "output";
}

export function describePin(state, pinId) {
  const pin = state.pins[pinId];
  if (!pin) {
    return { label: "unknown", detail: "no data yet" };
  }
  const label = pin.state === "high" ? "HIGH" : pin.state === "low" ? "LOW" : pin.state === "conflict" ? "CONFLICT" : "FLOATING";
  const detail = {
    output: "GPIO output",
    "pull-up": "internal pull-up",
    "pull-down": "internal pull-down",
    external: "external (switch)",
    conflict: "output vs external",
    none: "not driven",
  }[pin.drive] ?? pin.drive;
  return { label, detail };
}

/** Formats virtual nanoseconds as a human-readable time. */
export function formatVirtualTime(ns) {
  const value = BigInt(ns ?? 0);
  if (value < 1_000_000n) {
    return `${(Number(value) / 1_000).toFixed(1)} µs`;
  }
  if (value < 1_000_000_000n) {
    return `${(Number(value) / 1_000_000).toFixed(3)} ms`;
  }
  return `${(Number(value) / 1_000_000_000).toFixed(3)} s`;
}
