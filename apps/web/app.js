/*
 * TM4C123 Simulator — browser application controller.
 *
 * Responsibilities (each in its own module):
 *   - simulation session: compile/run/reset via the local orchestrator,
 *     event stream from Renode                               (this file)
 *   - board/pin projection of simulator events               (board-state.js)
 *   - circuit editing, undo/redo, diagram.json               (workspace/*.js)
 *   - logic-level evaluation of wired external parts          (workspace/netlist.js)
 *
 * The browser never decides hardware state: LEDs, pin values, and timing
 * come from Renode events. External parts only translate wiring into pin
 * drives that are applied through the real GPIO model.
 */
import { applyEvent, createBoardState, describePin, formatVirtualTime } from "./board-state.js";
import { BOARD_PART } from "./board/launchpad.js";
import { CATALOG, LIBRARY } from "./workspace/parts.js";
import { Workspace } from "./workspace/canvas.js";
import { History, WIRE_COLORS, commands, createDiagram, findPart, parseDiagram, serializeDiagram, splitEndpoint } from "./workspace/diagram.js";
import { evaluateCircuit } from "./workspace/netlist.js";

const CAPABILITIES = [
  { name: "ARM GCC build → Cortex-M4 ELF", status: "verified" },
  { name: "Cortex-M4 execution (Renode)", status: "verified" },
  { name: "SYSCTL GPIO / timer clock gating", status: "verified" },
  { name: "GPIO A–F: DIR / DEN / masked DATA", status: "verified" },
  { name: "Pull-up / pull-down, open drain", status: "verified" },
  { name: "PF0 GPIOLOCK / GPIOCR commit", status: "verified" },
  { name: "GPIO edge interrupts → NVIC → ISR", status: "verified" },
  { name: "Bus fault: unclocked / reserved access", status: "verified" },
  { name: "On-board RGB LED, SW1/SW2", status: "verified" },
  { name: "Wired external LED / resistor / pushbutton (logic level)", status: "verified" },
  { name: "PLL / RCC / RCC2 system clock (16–80 MHz)", status: "verified" },
  { name: "SysTick interrupt at the core clock", status: "verified" },
  { name: "GPTM 16/32-bit periodic timers + IRQs", status: "verified" },
  { name: "CMSIS-style TM4C123.h + SystemInit (50 MHz)", status: "verified" },
  { name: "SysTick COUNTFLAG polling", status: "unverified" },
  { name: "ADC0 SS3 / potentiometer", status: "missing" },
  { name: "UART0 / serial terminal", status: "missing" },
  { name: "LCD1602 (HD44780)", status: "missing" },
  { name: "Logic analyzer capture", status: "missing" },
];

const STATUS_LABELS = {
  verified: "Implemented & tested",
  unverified: "Engine-provided, not yet verified",
  missing: "Not modeled — accesses are reported",
};

const DRAFT_KEY = "tm4c123-simulator:diagram-draft";

/** GPIOs whose live state is shown when a board component is selected. */
const COMPONENT_PINS = {
  D1: ["PF1", "PF2", "PF3"],
  SW1: ["PF4"],
  SW2: ["PF0"],
  R9: ["PD0", "PB6"],
  R10: ["PD1", "PB7"],
};

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
  canvas: $("#circuitCanvas"),
  tooltip: $("#pinTooltip"),
  faultBadge: $("#faultBadge"),
  pinTable: $("#pinTable"),
  elfInfo: $("#elfInfo"),
  capabilityList: $("#capabilityList"),
  selectionPanel: $("#selectionPanel"),
  zoomInButton: $("#zoomInButton"),
  zoomOutButton: $("#zoomOutButton"),
  fitButton: $("#fitButton"),
  zoomValue: $("#zoomValue"),
  gridToggle: $("#gridToggle"),
  snapToggle: $("#snapToggle"),
  undoButton: $("#undoButton"),
  redoButton: $("#redoButton"),
  rotateButton: $("#rotateButton"),
  duplicateButton: $("#duplicateButton"),
  deleteButton: $("#deleteButton"),
  addPartButton: $("#addPartButton"),
  partLibrary: $("#partLibrary"),
  saveDiagramButton: $("#saveDiagramButton"),
  loadDiagramInput: $("#loadDiagramInput"),
  workspaceMessage: $("#workspaceMessage"),
  consoleTabs: document.querySelectorAll(".console-tab"),
  consoleOutput: $("#consoleOutput"),
  problemsOutput: $("#problemsOutput"),
  eventsOutput: $("#eventsOutput"),
  problemCount: $("#problemCount"),
  eventCount: $("#eventCount"),
  clearConsoleButton: $("#clearConsoleButton"),
};

/** UI state. `session.state` mirrors the orchestrator: none | starting | paused | running | stopped | error. */
const state = {
  examples: [],
  build: null,
  busy: null,
  session: { id: null, state: "none", stream: null },
  board: createBoardState(),
  realTimeFactor: null,
  eventCount: 0,
  /** External pushbuttons and on-board switches currently held. */
  pressed: new Set(),
  /** Last evaluation of the wired circuit. */
  circuit: { leds: {}, boardInputs: {}, errors: [] },
  /** External drives currently applied to the simulator, by GPIO name. */
  appliedDrives: new Map(),
};

const history = new History(loadDraft() ?? createDiagram({ author: "" }));

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

function log(message, level = "info", virtualTimeNs) {
  const line = document.createElement("div");
  line.className = "console-line";
  const time = document.createElement("span");
  time.className = "console-time";
  time.textContent = virtualTimeNs === undefined ? "" : formatVirtualTime(virtualTimeNs);
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

function workspaceMessage(text, level = "info") {
  elements.workspaceMessage.textContent = text;
  elements.workspaceMessage.dataset.level = level;
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
// Workspace integration
// ---------------------------------------------------------------------------

function simulationLive() {
  return state.session.state === "running" || state.session.state === "paused";
}

/** Pin states keyed by GPIO name, only while a simulation is live. */
function livePinStates() {
  return simulationLive() ? state.board.pins : {};
}

const workspace = new Workspace(elements.canvas, elements.tooltip, {
  catalog: CATALOG,
  history,
  getPartState(part) {
    const definition = CATALOG[part.type];
    if (definition.kind === "board") {
      return {
        live: simulationLive(),
        pins: livePinStates(),
        pressed: state.pressed,
        fault: simulationLive() ? state.board.fault : null,
      };
    }
    if (definition.kind === "led") {
      return { on: simulationLive() && state.circuit.leds[part.id]?.on === true };
    }
    if (definition.kind === "pushbutton") {
      return { pressed: state.pressed.has(part.id) };
    }
    return {};
  },
  getPinInfo(part, pinName) {
    if (!part) {
      return null;
    }
    const definition = CATALOG[part.type];
    if (definition.kind === "board") {
      const info = BOARD_PART.pinInfo(pinName);
      if (info.gpio) {
        const live = simulationLive() ? describePin(state.board, info.gpio) : null;
        info.lines.push(live ? `Simulation: ${live.label} (${live.detail})` : "Simulation: not running");
      }
      return info;
    }
    const pin = definition.pins.find((p) => p.name === pinName);
    const lines = [definition.status === "simulated" ? "Logic-level model" : "Editor only — no electrical model yet"];
    if (definition.kind === "led" && simulationLive()) {
      const led = state.circuit.leds[part.id];
      lines.push(led ? `LED ${led.on ? "ON" : "off"}: ${led.reason}` : "LED off");
    }
    return { kind: "part", title: `${part.id} · ${pin?.label ?? pinName}`, lines };
  },
  isInteractive(part, node) {
    if (!simulationLive()) {
      return false;
    }
    const kind = CATALOG[part.type].kind;
    return kind === "pushbutton" || (kind === "board" && Boolean(node?.dataset.input));
  },
  onPress(part, pressed, target) {
    const kind = CATALOG[part.type].kind;
    const key = kind === "board" ? target : part.id;
    if (pressed) {
      state.pressed.add(key);
    } else {
      state.pressed.delete(key);
    }
    if (kind === "board" && target === "RESET") {
      // Releasing the board's RESET switch resets the MCU.
      if (!pressed) {
        control("reset");
      }
    } else if (kind === "board") {
      sendInput(target, pressed);
    } else {
      log(`${part.id} ${pressed ? "pressed" : "released"}`, "info", state.board.virtualTimeNs);
      reevaluateCircuit();
    }
    workspace.refreshStates();
  },
});

workspace.addEventListener("change", (event) => {
  saveDraft();
  reevaluateCircuit();
  renderToolbar();
  renderPinTable();
  workspaceMessage(event.detail.label);
});
workspace.addEventListener("select", () => {
  renderToolbar();
  renderSelectionPanel();
});
workspace.addEventListener("view", () => {
  elements.zoomValue.textContent = `${Math.round(workspace.zoomLevel * 100)}%`;
  elements.gridToggle.setAttribute("aria-pressed", String(workspace.showGrid));
  elements.snapToggle.setAttribute("aria-pressed", String(workspace.snapToGrid));
});
workspace.addEventListener("wire", (event) => {
  const { detail } = event;
  if (detail.state === "started") {
    workspaceMessage(`Wiring from ${detail.from} — click a target pin (Esc cancels).`);
  } else if (detail.state === "invalid") {
    workspaceMessage(detail.error, "error");
  } else if (detail.state === "created") {
    workspaceMessage(`Connected ${detail.connection[0]} → ${detail.connection[1]}.`);
  } else if (detail.state === "cancelled") {
    workspaceMessage(detail.message);
  }
});

/**
 * Re-evaluates the wired circuit with the latest simulator pin states and
 * pushes any changed external drives to the GPIO model.
 */
function reevaluateCircuit() {
  state.circuit = evaluateCircuit(history.diagram, CATALOG, livePinStates(), { pressed: state.pressed });
  if (state.circuit.errors.length) {
    workspaceMessage(state.circuit.errors[0], "error");
  }
  syncExternalDrives();
}

function syncExternalDrives() {
  if (!simulationLive() || !state.session.id) {
    return;
  }
  const wanted = new Map();
  for (const [gpio, input] of Object.entries(state.circuit.boardInputs)) {
    if (input.level !== null) {
      wanted.set(gpio, input.level ? "high" : "low");
    }
  }
  for (const [gpio, level] of wanted) {
    if (state.appliedDrives.get(gpio) !== level) {
      state.appliedDrives.set(gpio, level);
      drivePin(gpio, level);
    }
  }
  for (const gpio of [...state.appliedDrives.keys()]) {
    if (!wanted.has(gpio)) {
      state.appliedDrives.delete(gpio);
      drivePin(gpio, "release");
    }
  }
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, serializeDiagram(history.diagram));
  } catch {
    // Storage may be unavailable (private mode); the diagram stays in memory.
  }
}

function loadDraft() {
  try {
    const text = localStorage.getItem(DRAFT_KEY);
    if (!text) {
      return null;
    }
    const { diagram } = parseDiagram(text, CATALOG);
    return diagram;
  } catch {
    return null;
  }
}

function loadDiagramText(text, origin) {
  const { diagram, errors } = parseDiagram(text, CATALOG);
  if (!diagram) {
    workspaceMessage(`Could not load ${origin}: ${errors[0]}`, "error");
    log(`Diagram ${origin} rejected: ${errors.join(" ")}`, "error");
    return false;
  }
  history.reset(diagram);
  workspace.select(null);
  workspace.render();
  workspace.fit();
  saveDraft();
  reevaluateCircuit();
  renderToolbar();
  renderPinTable();
  workspaceMessage(`Loaded ${origin}.`);
  return true;
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
  const live = simulationLive();

  elements.compileButton.disabled = busy;
  elements.runButton.disabled = busy || sessionState === "running" || sessionState === "starting";
  elements.runButton.textContent = sessionState === "paused" ? "▶ Resume" : "▶ Run";
  elements.pauseButton.disabled = sessionState !== "running";
  elements.resetButton.disabled = !live;
  elements.stopButton.disabled = !(live || sessionState === "starting");
  elements.exampleSelect.disabled = busy;
  elements.canvas.classList.toggle("is-live", live);

  const label = state.busy === "compiling" ? "Compiling…" : SESSION_LABELS[sessionState];
  elements.simulationStatus.textContent = label;
  elements.footerStatus.textContent = label;
  elements.stateIndicator.className = `state-indicator ${
    sessionState === "running" ? "running" : state.busy || sessionState === "starting" ? "compiling" : sessionState === "error" ? "error" : "stopped"
  }`;

  elements.virtualTime.textContent = live || sessionState === "stopped"
    ? formatVirtualTime(state.board.virtualTimeNs) + (state.realTimeFactor ? ` (${state.realTimeFactor.toFixed(2)}× real time)` : "")
    : "—";

  const fault = live ? state.board.fault : null;
  elements.faultBadge.hidden = !fault;
  if (fault) {
    elements.faultBadge.textContent = `${fault.exception}${fault.bfar ? ` · BFAR ${fault.bfar}` : ""}`;
  }

  workspace.refreshStates();
  renderPinTable();
  updateEditorStatus();
}

function renderToolbar() {
  const selection = workspace.selection;
  const part = selection?.kind === "part" ? findPart(history.diagram, selection.id) : null;
  const editable = part && CATALOG[part.type].kind !== "board";
  elements.undoButton.disabled = !history.canUndo;
  elements.redoButton.disabled = !history.canRedo;
  elements.rotateButton.disabled = !editable;
  elements.duplicateButton.disabled = !editable;
  elements.deleteButton.disabled = !(editable || selection?.kind === "wire");
}

function renderSelectionPanel() {
  const panel = elements.selectionPanel;
  panel.replaceChildren();
  const selection = workspace.selection;
  if (!selection) {
    panel.textContent = "Select a part or wire. Click a pin to start a wire.";
    return;
  }
  if (selection.kind === "component") {
    const info = BOARD_PART.components[selection.id];
    if (!info) {
      return;
    }
    const title = document.createElement("p");
    title.innerHTML = `<strong></strong> <span class="status-chip"></span>`;
    title.querySelector("strong").textContent = info.title;
    const chip = title.querySelector(".status-chip");
    chip.dataset.status = info.status === "visual" ? "editor" : info.status === "provisional" ? "provisional" : "simulated";
    chip.textContent = { simulated: "simulated", visual: "visual only", provisional: "simulated · position provisional" }[info.status];
    panel.append(title);
    for (const line of info.lines) {
      const row = document.createElement("p");
      row.className = "muted";
      row.textContent = line;
      panel.append(row);
    }
    const livePins = COMPONENT_PINS[selection.id] ?? [];
    if (livePins.length) {
      const live = document.createElement("p");
      live.className = "component-live";
      live.textContent = simulationLive()
        ? livePins.map((gpio) => `${gpio}: ${describePin(state.board, gpio).label}`).join(" · ")
        : `Pins ${livePins.join(", ")} — run the simulation to see live values`;
      panel.append(live);
    }
    return;
  }
  if (selection.kind === "wire") {
    const connection = history.diagram.connections[selection.index];
    if (!connection) {
      return;
    }
    const title = document.createElement("p");
    title.textContent = `Wire ${connection[0]} → ${connection[1]}`;
    const label = document.createElement("label");
    label.textContent = "Color ";
    const select = document.createElement("select");
    select.id = "wireColorSelect";
    for (const color of WIRE_COLORS) {
      const option = document.createElement("option");
      option.value = color;
      option.textContent = color;
      option.selected = color === connection[2];
      select.append(option);
    }
    select.addEventListener("change", () => workspace.setWireColor(select.value));
    label.append(select);
    const hint = document.createElement("p");
    hint.className = "muted";
    hint.textContent = "Drag an inner segment to reroute. Delete removes the wire.";
    panel.append(title, label, hint);
    return;
  }
  const part = findPart(history.diagram, selection.id);
  if (!part) {
    return;
  }
  const definition = CATALOG[part.type];
  const title = document.createElement("p");
  title.innerHTML = `<strong></strong> <span class="status-chip"></span>`;
  title.querySelector("strong").textContent = `${part.id} · ${definition.title}`;
  const chip = title.querySelector(".status-chip");
  chip.textContent = definition.kind === "board" ? "simulated (Renode)" : definition.status === "simulated" ? "simulated (logic level)" : "editor only";
  chip.dataset.status = definition.kind === "board" ? "simulated" : definition.status;
  const description = document.createElement("p");
  description.className = "muted";
  description.textContent = definition.description ?? "";
  panel.append(title, description);

  if (definition.kind === "led") {
    panel.append(attrSelect(part, "color", ["red", "green", "blue", "yellow", "white", "orange"]));
    const led = state.circuit.leds[part.id];
    if (led?.warning) {
      const warning = document.createElement("p");
      warning.className = "warning";
      warning.textContent = led.warning;
      panel.append(warning);
    }
  } else if (definition.kind === "resistor") {
    panel.append(attrSelect(part, "value", ["220", "330", "470", "1k", "4.7k", "10k"]));
  }
}

function attrSelect(part, key, values) {
  const label = document.createElement("label");
  label.textContent = `${key[0].toUpperCase()}${key.slice(1)} `;
  const select = document.createElement("select");
  select.dataset.attr = key;
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = value === part.attrs[key];
    select.append(option);
  }
  select.addEventListener("change", () => {
    workspace.execute(commands.setAttr(part.id, key, part.attrs[key], select.value));
    renderSelectionPanel();
  });
  label.append(select);
  return label;
}

/** Pin table: on-board pins plus every board GPIO that is wired in the diagram. */
function renderPinTable() {
  const live = simulationLive();
  const gpios = new Map([["PF0", "SW2"], ["PF1", "Red LED"], ["PF2", "Blue LED"], ["PF3", "Green LED"], ["PF4", "SW1"]]);
  for (const [from, to] of history.diagram.connections) {
    for (const endpoint of [from, to]) {
      const parsed = splitEndpoint(endpoint);
      const part = parsed && findPart(history.diagram, parsed.partId);
      if (part && CATALOG[part.type].kind === "board") {
        const role = BOARD_PART.role(parsed.pin);
        if (role?.kind === "gpio" && !gpios.has(role.gpio)) {
          gpios.set(role.gpio, `${parsed.pin} (wired)`);
        }
      }
    }
  }
  const rows = [...gpios].map(([gpio, role]) => {
    const { label, detail } = live ? describePin(state.board, gpio) : { label: "—", detail: "" };
    const row = document.createElement("tr");
    row.dataset.pin = gpio;
    row.className = `pin-${label.toLowerCase()}`;
    for (const text of [gpio, role, label, detail]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    return row;
  });
  elements.pinTable.replaceChildren(...rows);
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

function renderLibrary() {
  elements.partLibrary.replaceChildren(
    ...LIBRARY.map((type) => {
      const definition = CATALOG[type];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "library-item";
      button.dataset.type = type;
      button.setAttribute("role", "menuitem");
      const name = document.createElement("strong");
      name.textContent = definition.title;
      const chip = document.createElement("span");
      chip.className = "status-chip";
      chip.dataset.status = definition.status;
      chip.textContent = definition.status === "simulated" ? "simulated" : "editor only";
      const description = document.createElement("small");
      description.textContent = definition.description;
      button.append(name, chip, description);
      button.addEventListener("click", () => {
        workspace.addPart(type);
        elements.partLibrary.hidden = true;
        elements.addPartButton.setAttribute("aria-expanded", "false");
      });
      return button;
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
  state.appliedDrives.clear();
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
  state.appliedDrives.clear();
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

async function drivePin(pin, level) {
  if (!state.session.id) {
    return;
  }
  try {
    await api(`/api/sessions/${state.session.id}/input`, { body: { pin, level } });
  } catch (error) {
    log(`External drive ${pin}=${level} failed: ${error.message}`, "error");
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
    if (event.state === "floating" && event.drive === "none") {
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

let refreshScheduled = false;
function scheduleRefresh() {
  if (refreshScheduled) {
    return;
  }
  refreshScheduled = true;
  requestAnimationFrame(() => {
    refreshScheduled = false;
    reevaluateCircuit();
    render();
    if (workspace.selection?.kind === "component") {
      renderSelectionPanel(); // live pin values for the selected component
    }
  });
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
      state.appliedDrives.clear();
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
  case "external-drive":
    log(`External circuit drives ${message.pin} ${message.level === "release" ? "released" : message.level.toUpperCase()}`, "info", message.virtualTimeNs);
    break;
  case "session-limit":
    log(`Session limit reached (${message.kind}).`, "error");
    break;
  default:
    break;
  }
  scheduleRefresh();
}

// ---------------------------------------------------------------------------
// Examples and initialization
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
  if (example.diagram) {
    loadDiagramText(example.diagram, `the "${example.title}" circuit`);
  }
  render();
}

async function initialize() {
  renderCapabilities();
  renderLibrary();
  renderToolbar();
  renderSelectionPanel();
  workspace.fit();
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
// Wiring of controls
// ---------------------------------------------------------------------------

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

elements.zoomInButton.addEventListener("click", () => workspace.zoom(1.25));
elements.zoomOutButton.addEventListener("click", () => workspace.zoom(0.8));
elements.fitButton.addEventListener("click", () => workspace.fit());
elements.gridToggle.addEventListener("click", () => { workspace.showGrid = !workspace.showGrid; });
elements.snapToggle.addEventListener("click", () => { workspace.snapToGrid = !workspace.snapToGrid; });
elements.undoButton.addEventListener("click", () => workspace.undo());
elements.redoButton.addEventListener("click", () => workspace.redo());
elements.rotateButton.addEventListener("click", () => workspace.rotateSelection());
elements.duplicateButton.addEventListener("click", () => workspace.duplicateSelection());
elements.deleteButton.addEventListener("click", () => workspace.deleteSelection());
elements.addPartButton.addEventListener("click", () => {
  const open = elements.partLibrary.hidden;
  elements.partLibrary.hidden = !open;
  elements.addPartButton.setAttribute("aria-expanded", String(open));
});
elements.saveDiagramButton.addEventListener("click", () => {
  const blob = new Blob([serializeDiagram(history.diagram)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "diagram.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
  workspaceMessage("Saved diagram.json.");
});
elements.loadDiagramInput.addEventListener("change", async () => {
  const file = elements.loadDiagramInput.files?.[0];
  if (file) {
    loadDiagramText(await file.text(), file.name);
  }
  elements.loadDiagramInput.value = "";
});

elements.consoleTabs.forEach((tab) => tab.addEventListener("click", () => selectConsoleTab(tab.dataset.console)));
elements.clearConsoleButton.addEventListener("click", () => {
  elements.consoleOutput.replaceChildren();
  elements.eventsOutput.replaceChildren();
  state.eventCount = 0;
  elements.eventCount.textContent = "0";
});
window.addEventListener("beforeunload", closeStream);

// Expose read-only hooks for automated browser tests.
window.__tm4c = Object.freeze({
  workspace,
  get diagram() {
    return history.diagram;
  },
  serialize: () => serializeDiagram(history.diagram),
  load: (text) => loadDiagramText(text, "test input"),
});

updateLineNumbers();
initialize();
