/*
 * TM4C123 Simulator — browser workspace.
 *
 * The browser edits source, calls the local orchestrator to compile and run
 * it, and renders the event stream coming back from Renode. It never
 * decides LED, pin, or timing state itself: the board view is a projection
 * of simulator events (see board-state.js).
 */
import {
  BOARD_LEDS,
  WATCHED_PINS,
  applyEvent,
  createBoardState,
  describePin,
  formatVirtualTime,
  isLedOn,
} from "./board-state.js";

const CAPABILITIES = [
  { name: "ARM GCC build → Cortex-M4 ELF", status: "verified" },
  { name: "Cortex-M4 execution (Renode)", status: "verified" },
  { name: "SYSCTL GPIO clock gating", status: "verified" },
  { name: "GPIO A–F: DIR / DEN / masked DATA", status: "verified" },
  { name: "Pull-up / pull-down, open drain", status: "verified" },
  { name: "PF0 GPIOLOCK / GPIOCR commit", status: "verified" },
  { name: "GPIO edge interrupts → NVIC → ISR", status: "verified" },
  { name: "Bus fault: unclocked / reserved access", status: "verified" },
  { name: "RGB LED (PF1–PF3), SW1/SW2", status: "verified" },
  { name: "SysTick (Renode NVIC)", status: "unverified" },
  { name: "PLL / RCC clock configuration", status: "missing" },
  { name: "GPTM timers (TIMER0A–2A)", status: "missing" },
  { name: "ADC0 SS3 / potentiometer", status: "missing" },
  { name: "UART0 / serial terminal", status: "missing" },
  { name: "LCD1602 (HD44780)", status: "missing" },
  { name: "Alternate pin functions, AHB GPIO", status: "missing" },
];

const STATUS_LABELS = {
  verified: "Implemented & tested",
  unverified: "Engine-provided, not yet verified",
  missing: "Not modeled — accesses are reported",
};

const PIN_ROLES = { PF0: "SW2", PF1: "Red LED", PF2: "Blue LED", PF3: "Green LED", PF4: "SW1" };

const $ = (selector) => document.querySelector(selector);

const elements = {
  exampleSelect: $("#exampleSelect"),
  exampleSummary: $("#exampleSummary"),
  compileButton: $("#compileButton"),
  runButton: $("#runButton"),
  pauseButton: $("#pauseButton"),
  resetButton: $("#resetButton"),
  stopButton: $("#stopButton"),
  editor: $("#codeEditor"),
  lineNumbers: $("#lineNumbers"),
  cursorPosition: $("#cursorPosition"),
  editorStatus: $("#editorStatus"),
  simulationStatus: $("#simulationStatus"),
  stateIndicator: $("#stateIndicator"),
  virtualTime: $("#virtualTime"),
  footerStatus: $("#footerStatus"),
  toolchainInfo: $("#toolchainInfo"),
  leds: { red: $("#redLed"), blue: $("#blueLed"), green: $("#greenLed") },
  switches: [$("#sw1Button"), $("#sw2Button")],
  faultBadge: $("#faultBadge"),
  pinTable: $("#pinTable"),
  elfInfo: $("#elfInfo"),
  capabilityList: $("#capabilityList"),
  zoomInButton: $("#zoomInButton"),
  zoomOutButton: $("#zoomOutButton"),
  fitButton: $("#fitButton"),
  zoomValue: $("#zoomValue"),
  launchpadBoard: $("#launchpadBoard"),
  consoleTabs: document.querySelectorAll(".console-tab"),
  consoleOutput: $("#consoleOutput"),
  problemsOutput: $("#problemsOutput"),
  eventsOutput: $("#eventsOutput"),
  problemCount: $("#problemCount"),
  eventCount: $("#eventCount"),
  clearConsoleButton: $("#clearConsoleButton"),
};

/**
 * UI state. `session.state` mirrors the orchestrator's authoritative state:
 * none | starting | paused | running | stopped | error.
 */
const state = {
  examples: [],
  build: null,          // { id, source, elf } of the last successful build
  busy: null,           // "compiling" | "starting" | null
  session: { id: null, state: "none", stream: null },
  board: createBoardState(),
  realTimeFactor: null,
  eventCount: 0,
  zoom: 100,
};

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

function timestamp(virtualTimeNs) {
  return virtualTimeNs === undefined ? "" : formatVirtualTime(virtualTimeNs);
}

function log(message, level = "info", virtualTimeNs) {
  const line = document.createElement("div");
  line.className = "console-line";
  const time = document.createElement("span");
  time.className = "console-time";
  time.textContent = timestamp(virtualTimeNs);
  time.title = virtualTimeNs === undefined ? "" : "virtual time";
  const badge = document.createElement("span");
  badge.className = `console-level ${level}`;
  badge.textContent = level.toUpperCase();
  const text = document.createElement("span");
  text.textContent = message;
  line.append(time, badge, text);
  elements.consoleOutput.append(line);
  while (elements.consoleOutput.childElementCount > 1_000) {
    elements.consoleOutput.firstElementChild.remove();
  }
  elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;
}

function recordEvent(message) {
  state.eventCount += 1;
  elements.eventCount.textContent = String(state.eventCount);
  const line = document.createElement("div");
  line.className = "event-line";
  line.textContent = JSON.stringify(message);
  elements.eventsOutput.append(line);
  while (elements.eventsOutput.childElementCount > 2_000) {
    elements.eventsOutput.firstElementChild.remove();
  }
}

function showProblems(diagnostics, errorText) {
  elements.problemsOutput.replaceChildren();
  const problems = diagnostics.filter((d) => d.severity !== "note");
  elements.problemCount.textContent = String(problems.length + (errorText && !problems.length ? 1 : 0));
  for (const diagnostic of problems) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `problem-row ${diagnostic.severity}`;
    row.textContent = `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}  ${diagnostic.severity}: ${diagnostic.message}`;
    row.addEventListener("click", () => goToLine(diagnostic.line, diagnostic.column));
    elements.problemsOutput.append(row);
  }
  if (errorText && !problems.length) {
    const row = document.createElement("div");
    row.className = "problem-row error";
    row.textContent = errorText;
    elements.problemsOutput.append(row);
  }
}

function selectConsoleTab(name) {
  elements.consoleTabs.forEach((tab) => {
    const active = tab.dataset.console === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  elements.consoleOutput.hidden = name !== "console";
  elements.problemsOutput.hidden = name !== "problems";
  elements.eventsOutput.hidden = name !== "events";
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function updateLineNumbers() {
  const count = elements.editor.value.split("\n").length;
  elements.lineNumbers.textContent = Array.from({ length: count }, (_, i) => i + 1).join("\n");
}

function updateCursorPosition() {
  const before = elements.editor.value.slice(0, elements.editor.selectionStart).split("\n");
  elements.cursorPosition.textContent = `Ln ${before.length}, Col ${before.at(-1).length + 1}`;
}

function goToLine(line, column = 1) {
  const lines = elements.editor.value.split("\n");
  const offset = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0) + column - 1;
  elements.editor.focus();
  elements.editor.setSelectionRange(offset, offset);
  const lineHeight = parseFloat(getComputedStyle(elements.editor).lineHeight) || 20;
  elements.editor.scrollTop = Math.max(0, (line - 5) * lineHeight);
  updateCursorPosition();
}

function buildIsCurrent() {
  return state.build !== null && state.build.source === elements.editor.value;
}

function updateEditorStatus() {
  if (state.busy === "compiling") {
    elements.editorStatus.textContent = "Compiling…";
  } else if (buildIsCurrent()) {
    elements.editorStatus.textContent = "Built";
  } else if (state.build) {
    elements.editorStatus.textContent = "Changed since build";
  } else {
    elements.editorStatus.textContent = "Not built";
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const SESSION_LABELS = {
  none: "No firmware running",
  starting: "Starting Renode…",
  paused: "Halted",
  running: "Running",
  stopped: "Stopped",
  error: "Error",
};

function render() {
  const sessionState = state.session.state;
  const busy = state.busy !== null;
  const live = sessionState === "running" || sessionState === "paused";

  elements.compileButton.disabled = busy;
  elements.runButton.disabled = busy || sessionState === "running" || sessionState === "starting";
  elements.runButton.textContent = sessionState === "paused" ? "▶ Resume" : "▶ Run";
  elements.pauseButton.disabled = sessionState !== "running";
  elements.resetButton.disabled = !live;
  elements.stopButton.disabled = !(live || sessionState === "starting");
  elements.exampleSelect.disabled = busy;
  for (const button of elements.switches) {
    button.disabled = !live;
  }

  const label = state.busy === "compiling" ? "Compiling…" : SESSION_LABELS[sessionState];
  elements.simulationStatus.textContent = label;
  elements.footerStatus.textContent = label;
  elements.stateIndicator.className = `state-indicator ${
    sessionState === "running" ? "running" : state.busy || sessionState === "starting" ? "compiling" : sessionState === "error" ? "error" : "stopped"
  }`;

  renderBoard();
  updateEditorStatus();
}

function renderBoard() {
  const live = state.session.state !== "none" && state.session.state !== "stopped";
  for (const [color, pinId] of Object.entries(BOARD_LEDS)) {
    const on = live && isLedOn(state.board, pinId);
    elements.leds[color].classList.toggle("active", on);
    elements.leds[color].setAttribute("aria-label", `${color[0].toUpperCase()}${color.slice(1)} LED (${pinId}): ${on ? "on" : "off"}`);
  }

  elements.virtualTime.textContent = live || state.session.state === "stopped"
    ? formatVirtualTime(state.board.virtualTimeNs) +
      (state.realTimeFactor ? ` (${state.realTimeFactor.toFixed(2)}× real time)` : "")
    : "—";

  const rows = WATCHED_PINS.map((pinId) => {
    const { label, detail } = live ? describePin(state.board, pinId) : { label: "—", detail: "" };
    const row = document.createElement("tr");
    row.dataset.pin = pinId;
    row.className = `pin-${label.toLowerCase()}`;
    for (const text of [pinId, PIN_ROLES[pinId], label, detail]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    return row;
  });
  elements.pinTable.replaceChildren(...rows);

  const fault = live ? state.board.fault : null;
  elements.faultBadge.hidden = !fault;
  if (fault) {
    elements.faultBadge.textContent = `${fault.exception}${fault.bfar ? ` · BFAR ${fault.bfar}` : ""}`;
  }
}

function renderElfInfo(elf) {
  const hex = (value) => `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
  const entries = [
    ["Format", `${elf.class} ${elf.machine}`],
    ["Entry", `${hex(elf.entry)} (Reset_Handler, Thumb)`],
    ["Initial SP", elf.symbols._estack !== null ? hex(elf.symbols._estack) : "—"],
    ...elf.sections.map((s) => [s.name, `${hex(s.address)} · ${s.size} B`]),
    ["File size", `${elf.bytes} B`],
  ];
  elements.elfInfo.replaceChildren(
    ...entries.flatMap(([term, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      return [dt, dd];
    }),
  );
}

function renderCapabilities() {
  elements.capabilityList.replaceChildren(
    ...CAPABILITIES.map(({ name, status }) => {
      const item = document.createElement("li");
      item.className = `capability ${status}`;
      item.title = STATUS_LABELS[status];
      const dot = document.createElement("span");
      dot.className = "capability-dot";
      dot.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.textContent = name;
      const tag = document.createElement("small");
      tag.textContent = status === "verified" ? "tested" : status === "unverified" ? "unverified" : "not modeled";
      item.append(dot, text, tag);
      return item;
    }),
  );
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.body === undefined ? "GET" : "POST",
    headers: options.body === undefined ? {} : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }
  return body;
}

async function compile() {
  const source = elements.editor.value;
  state.busy = "compiling";
  render();
  log("Compiling main.c with arm-none-eabi-gcc…", "info");
  try {
    const result = await api("/api/build", { body: { source } });
    showProblems(result.diagnostics ?? [], result.ok ? null : result.error);
    if (!result.ok) {
      state.build = null;
      log(`Build failed: ${result.error}`, "error");
      for (const line of (result.log ?? "").split(/\r?\n/).filter(Boolean).slice(0, 20)) {
        log(line, "error");
      }
      selectConsoleTab("problems");
      return false;
    }
    state.build = { id: result.buildId, source, elf: result.elf };
    renderElfInfo(result.elf);
    const warnings = (result.diagnostics ?? []).filter((d) => d.severity === "warning").length;
    log(
      `Build succeeded in ${result.durationMs} ms: ${result.elf.bytes}-byte ELF, entry 0x${result.elf.entry.toString(16)}` +
        (warnings ? `, ${warnings} warning(s)` : ""),
      warnings ? "warning" : "success",
    );
    return true;
  } catch (error) {
    log(`Build request failed: ${error.message}`, "error");
    return false;
  } finally {
    state.busy = null;
    render();
  }
}

function closeStream() {
  state.session.stream?.close();
  state.session.stream = null;
}

async function startSession() {
  closeStream();
  state.board = createBoardState();
  state.busy = "starting";
  state.session = { id: null, state: "starting", stream: null };
  render();
  log("Starting Renode and loading the ELF…", "info");
  try {
    const { sessionId } = await api("/api/sessions", { body: { buildId: state.build.id, autoRun: true } });
    state.session.id = sessionId;
    const stream = new EventSource(`/api/sessions/${sessionId}/events`);
    state.session.stream = stream;
    stream.onmessage = (message) => handleMessage(sessionId, JSON.parse(message.data));
    stream.onerror = () => {
      if (state.session.id === sessionId && !["stopped", "error"].includes(state.session.state)) {
        state.session.state = "error";
        log("Lost the event stream from the simulator.", "error");
        closeStream();
        render();
      }
    };
  } catch (error) {
    state.session.state = "error";
    log(`Could not start the simulation: ${error.message}`, "error");
  } finally {
    state.busy = null;
    render();
  }
}

async function run() {
  if (state.session.state === "paused" && buildIsCurrent()) {
    await control("run");
    return;
  }
  if (!buildIsCurrent()) {
    if (!(await compile())) {
      return;
    }
  }
  await startSession();
}

async function control(action) {
  if (!state.session.id) {
    return;
  }
  try {
    await api(`/api/sessions/${state.session.id}/control`, { body: { action } });
  } catch (error) {
    log(`${action} failed: ${error.message}`, "error");
  }
}

async function stop() {
  await control("stop");
  closeStream();
  state.session.state = "stopped";
  render();
}

async function sendInput(name, pressed) {
  if (!state.session.id) {
    return;
  }
  try {
    await api(`/api/sessions/${state.session.id}/input`, { body: { input: name, pressed } });
  } catch (error) {
    log(`Input ${name} failed: ${error.message}`, "error");
  }
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------

function describeEvent(event) {
  switch (event.type) {
  case "clock-gate-changed":
    return [`SYSCTL: ${event.peripheral} clock ${event.enabled ? "enabled" : "disabled"}`, "info"];
  case "digital-pin-changed": {
    if (!WATCHED_PINS.includes(event.pin.pinId)) {
      return null;
    }
    const { label, detail } = describePin({ pins: { x: event } }, "x");
    return [`${event.pin.pinId} → ${label} (${detail})`, event.level === 1 ? "success" : "info"];
  }
  case "bus-fault":
    return [`Bus fault: ${event.access} of ${event.address} — ${event.reason}`, "error"];
  case "cpu-fault":
    return [`CPU entered ${event.exception} (PC ${event.pc}, CFSR ${event.cfsr}, HFSR ${event.hfsr}${event.bfar ? `, BFAR ${event.bfar}` : ""})`, "error"];
  case "unsupported-register-access":
    return [`Unsupported ${event.peripheral} register ${event.access} at ${event.address}: ${event.reason}`, "warning"];
  case "unimplemented-peripheral-access":
    return [`${event.reason} (${event.access} at ${event.address})`, "warning"];
  case "unsupported-feature":
    return [`${event.peripheral}: ${event.detail}`, "warning"];
  case "commit-protected-write-ignored":
    return [`${event.peripheral} ${event.register}: bits ${event.bits} not committed — ${event.reason}`, "warning"];
  case "locked-register-write-ignored":
    return [`${event.peripheral} ${event.register} write ignored: GPIOLOCK is locked`, "warning"];
  case "floating-input-read":
    return [`${event.peripheral}: read of floating input bits ${event.bits} (${event.reason})`, "warning"];
  case "interrupt-line-changed":
    return [`${event.peripheral} interrupt ${event.asserted ? "asserted" : "cleared"}${event.asserted ? ` (MIS ${event.mis})` : ""}`, "info"];
  default:
    return null;
  }
}

function handleMessage(sessionId, message) {
  if (state.session.id !== sessionId) {
    return;
  }
  recordEvent(message);

  switch (message.type) {
  case "session-status": {
    const previous = state.session.state;
    state.session.state = message.state;
    if (message.virtualTimeNs !== undefined && BigInt(message.virtualTimeNs) > BigInt(state.board.virtualTimeNs)) {
      state.board.virtualTimeNs = message.virtualTimeNs;
    }
    state.realTimeFactor = message.state === "running" ? message.realTimeFactor ?? state.realTimeFactor : null;
    if (message.message) {
      log(message.message, message.state === "error" ? "error" : "info", message.virtualTimeNs);
    } else if (previous !== message.state && message.state === "running") {
      log("CPU running.", "success", message.virtualTimeNs);
    } else if (previous !== message.state && message.state === "paused") {
      log("CPU halted.", "info", message.virtualTimeNs);
    }
    if (message.state === "stopped" || message.state === "error") {
      closeStream();
    }
    break;
  }
  case "simulator-event": {
    const event = message.event;
    applyEvent(state.board, event);
    const described = describeEvent(event);
    if (described) {
      log(described[0], described[1], event.virtualTimeNs);
    }
    break;
  }
  case "mcu-reset":
    log("MCU reset: peripherals at reset values, CPU restarts from the vector table.", "info", message.virtualTimeNs);
    break;
  case "board-input":
    log(`${message.input} ${message.pressed ? "pressed" : "released"}`, "info", message.virtualTimeNs);
    break;
  case "session-limit":
    log(`Session limit reached (${message.kind}).`, "error");
    break;
  default:
    break;
  }
  render();
}

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

function loadExample(id) {
  const example = state.examples.find((e) => e.id === id);
  if (!example) {
    return;
  }
  elements.editor.value = example.source;
  elements.exampleSummary.textContent = `${example.summary} Expected: ${example.expected}.`;
  updateLineNumbers();
  updateCursorPosition();
  showProblems([], null);
  render();
}

async function initialize() {
  renderCapabilities();
  render();
  try {
    const health = await api("/api/health");
    const { toolchain } = health;
    elements.toolchainInfo.textContent = toolchain.gcc
      ? ` Toolchain: ${toolchain.gcc.replace(/^arm-none-eabi-gcc(\.exe)? /, "GCC ")}; Renode ${toolchain.renodePinned}.`
      : " Toolchain missing — run `npm run setup:tools`.";
    const { examples } = await api("/api/examples");
    state.examples = examples;
    elements.exampleSelect.replaceChildren(
      ...examples.map((example) => {
        const option = document.createElement("option");
        option.value = example.id;
        option.textContent = example.title;
        return option;
      }),
    );
    loadExample(examples[0]?.id);
    log("Workspace ready. Choose an example, then Run (compiles automatically).", "success");
  } catch (error) {
    log(`Cannot reach the local orchestrator: ${error.message}. Start it with \`npm start\`.`, "error");
    elements.compileButton.disabled = true;
    elements.runButton.disabled = true;
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function updateZoom(value) {
  state.zoom = Math.max(60, Math.min(140, value));
  elements.zoomValue.textContent = `${state.zoom}%`;
  elements.launchpadBoard.style.setProperty("--board-scale", String(state.zoom / 100));
}

elements.exampleSelect.addEventListener("change", () => loadExample(elements.exampleSelect.value));
elements.editor.addEventListener("input", () => {
  updateLineNumbers();
  updateCursorPosition();
  updateEditorStatus();
});
elements.editor.addEventListener("click", updateCursorPosition);
elements.editor.addEventListener("keyup", updateCursorPosition);
elements.editor.addEventListener("scroll", () => {
  elements.lineNumbers.scrollTop = elements.editor.scrollTop;
});
elements.editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    elements.editor.setRangeText("    ", elements.editor.selectionStart, elements.editor.selectionEnd, "end");
    elements.editor.dispatchEvent(new Event("input"));
  }
});

elements.compileButton.addEventListener("click", compile);
elements.runButton.addEventListener("click", run);
elements.pauseButton.addEventListener("click", () => control("pause"));
elements.resetButton.addEventListener("click", () => control("reset"));
elements.stopButton.addEventListener("click", stop);

for (const button of elements.switches) {
  const input = button.dataset.input;
  let pressed = false;
  const press = (event) => {
    event.preventDefault();
    if (button.disabled || pressed) {
      return;
    }
    pressed = true;
    button.classList.add("pressed");
    button.setAttribute("aria-pressed", "true");
    try {
      button.setPointerCapture?.(event.pointerId);
    } catch {
      // Keyboard and synthetic events have no capturable pointer.
    }
    sendInput(input, true);
  };
  const release = () => {
    if (!pressed) {
      return;
    }
    pressed = false;
    button.classList.remove("pressed");
    button.setAttribute("aria-pressed", "false");
    sendInput(input, false);
  };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
  button.addEventListener("keydown", (event) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      press(event);
    }
  });
  button.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") {
      release();
    }
  });
  button.addEventListener("blur", release);
}

elements.consoleTabs.forEach((tab) => tab.addEventListener("click", () => selectConsoleTab(tab.dataset.console)));
elements.clearConsoleButton.addEventListener("click", () => {
  elements.consoleOutput.replaceChildren();
  elements.eventsOutput.replaceChildren();
  state.eventCount = 0;
  elements.eventCount.textContent = "0";
});
elements.zoomInButton.addEventListener("click", () => updateZoom(state.zoom + 10));
elements.zoomOutButton.addEventListener("click", () => updateZoom(state.zoom - 10));
elements.fitButton.addEventListener("click", () => updateZoom(100));
window.addEventListener("beforeunload", closeStream);

updateLineNumbers();
initialize();
