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
import { CATALOG, LIBRARY, LIBRARY_CATEGORIES } from "./workspace/parts.js";
import { Workspace } from "./workspace/canvas.js";
import { History, WIRE_COLORS, commands, createDiagram, findPart, parseDiagram, serializeDiagram, splitEndpoint } from "./workspace/diagram.js";
import { evaluateCircuit } from "./workspace/netlist.js";
import { LcdSimulation, bindLcd } from "./workspace/lcd.js";
import { describeAnalogInput, evaluateAnalog } from "./workspace/analog.js";
import { DraftStore, browserStorage, compareWork } from "./draft-store.js";
import { describeLocation, groupDiagnostics, isNavigable, lineMarks, nextProblem, problemRange, summarize } from "./diagnostics.js";
import { CATEGORIES, ConsoleLog, DEFAULT_FILTER, consoleRows } from "./console-log.js";
import { createShell, isTyping } from "./layout.js";
import { highlightHtml } from "./c-highlight.js";

const CAPABILITIES = [
  { name: "ARM GCC build → Cortex-M4 ELF", status: "verified" },
  { name: "Cortex-M4 execution (Renode)", status: "verified" },
  { name: "SYSCTL clock gating (GPIO, timers, ADC)", status: "verified" },
  { name: "GPIO A–F: DIR / DEN / masked DATA", status: "verified" },
  { name: "Pull-up / pull-down, open drain", status: "verified" },
  { name: "PF0 GPIOLOCK / GPIOCR commit", status: "verified" },
  { name: "GPIO edge interrupts → NVIC → ISR", status: "verified" },
  { name: "Bus fault: unclocked / reserved access", status: "verified" },
  { name: "On-board RGB LED, SW1/SW2", status: "verified" },
  { name: "Wired external LED / resistor / pushbutton (logic level)", status: "verified" },
  { name: "PLL / RCC / RCC2 system clock (16–80 MHz)", status: "verified" },
  { name: "SysTick interrupt and COUNTFLAG at the core clock", status: "verified" },
  { name: "GPTM 16/32-bit periodic timers + IRQs", status: "verified" },
  { name: "CMSIS-style TM4C123.h + SystemInit (50 MHz)", status: "verified" },
  { name: "ADC0/ADC1 SS3, temperature sensor, potentiometer", status: "verified" },
  { name: "LCD1602 (HD44780) in the workspace", status: "verified" },
  { name: "UART0 / serial terminal", status: "missing" },
  { name: "Logic analyzer capture", status: "missing" },
];

const STATUS_LABELS = {
  verified: "Implemented & tested",
  unverified: "Engine-provided, not yet verified",
  missing: "Not implemented yet",
};

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
  editorHighlight: $("#editorHighlight"),
  codeHighlight: $("#codeHighlight"),
  cursorPosition: $("#cursorPosition"),
  editorStatus: $("#editorStatus"),
  draftStatus: $("#draftStatus"),
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
  loadDiagramButton: $("#loadDiagramButton"),
  loadDiagramInput: $("#loadDiagramInput"),
  workspaceMessage: $("#workspaceMessage"),
  consoleTabs: document.querySelectorAll(".console-tab"),
  consoleOutput: $("#consoleOutput"),
  problemsOutput: $("#problemsOutput"),
  eventsOutput: $("#eventsOutput"),
  problemCount: $("#problemCount"),
  consoleErrorCount: $("#consoleErrorCount"),
  consoleTools: $("#consoleTools"),
  consoleCategory: $("#consoleCategory"),
  consoleFilter: $("#consoleFilter"),
  consoleSummary: $("#consoleSummary"),
  eventCount: $("#eventCount"),
  clearConsoleButton: $("#clearConsoleButton"),
  consolePanel: $("#consolePanel"),
  consoleToggle: $("#consoleToggle"),
  consolePreview: $("#consolePreview"),
  workspacePane: $(".workspace"),
  splitter: $("#splitter"),
  simulatorPanel: $(".simulator-panel"),
  inspectorToggle: $("#inspectorToggle"),
  helpPanel: $("#helpPanel"),
  helpButton: $("#helpButton"),
  helpClose: $("#helpClose"),
  runHint: $("#runHint"),
  canvasHint: $("#canvasHint"),
  exampleAbout: $("#exampleAbout"),
  aboutToggle: $("#aboutToggle"),
};

// Layout: split, output panel, inspector, help, first-run hint (see layout.js).
const shell = createShell({
  workspace: elements.workspacePane,
  splitter: elements.splitter,
  simulatorPanel: elements.simulatorPanel,
  inspectorToggle: elements.inspectorToggle,
  consolePanel: elements.consolePanel,
  consoleToggle: elements.consoleToggle,
  helpPanel: elements.helpPanel,
  helpButton: elements.helpButton,
  helpClose: elements.helpClose,
  runHint: elements.runHint,
  runButton: elements.runButton,
}, browserStorage());

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
  /** HD44780 simulations for the LCD1602 parts, by part id (live sessions only). */
  lcds: new Map(),
  /** Last analog evaluation (potentiometers) and the voltages applied to the simulator. */
  analog: { pots: {}, inputs: {}, errors: [], notes: [] },
  appliedAnalog: new Map(),
  /** Die temperature for the ADC's internal sensor (°C). */
  dieCelsius: 25,
  /**
   * The example the work started from: its id, unedited source, and circuit
   * (serialized). Student edits are whatever differs from it.
   */
  baseline: { exampleId: null, source: "", diagramText: serializeDiagram(createDiagram({ author: "" })) },
  /**
   * The current circuit as loaded from a diagram file (serialized), so loading another file over it does not
   * ask; null once any other load (example switch, restore) replaces the circuit.
   */
  importedCircuit: null,
  /** Problems of the last build (diagnostics with their notes) and the source they were reported for. */
  problems: { list: [], source: null },
  /** The editor line marked for the problem last navigated to: { line, severity }, or null. */
  problemLine: null,
};

// Drafts of the student's work in this browser (see draft-store.js).
const drafts = new DraftStore(browserStorage());
const restored = drafts.read((text) => parseDiagram(text, CATALOG));
const history = new History(restored.diagram ?? createDiagram({ author: "" }));
// Analog sources of the restored circuit, for the pin table before anything runs (nothing is sent).
state.analog = evaluateAnalog(history.diagram, CATALOG);

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

/** The compiler's output as lines for a console message's details (at most 200), or null. */
function compilerOutput(text) {
  const lines = (text ?? "").split(/\r?\n/).filter(Boolean);
  return lines.length ? lines.slice(0, 200) : null;
}

/** Rows the console shows at most (the newest); the log itself keeps more (console-log.js). */
const CONSOLE_ROWS = 400;
const consoleLog = new ConsoleLog();
const consoleView = { filter: { ...DEFAULT_FILTER, levels: new Set(DEFAULT_FILTER.levels) }, scheduled: false };

/**
 * Adds a console message. `options`: { category (a CATEGORIES key; default
 * "system"), key (what it is about, e.g. a pin), details (extra lines, shown
 * folded under the message) }. Rendering waits for the next frame, so bursts
 * of simulator events cost one update.
 */
function log(message, level = "info", virtualTimeNs, options = {}) {
  consoleLog.add({ level, message, time: virtualTimeNs, category: options.category ?? "system", key: options.key ?? null, details: options.details ?? null });
  if (level === "error" && !shell.consoleOpen) {
    shell.setConsole(true); // errors are never left folded away
  }
  if (!consoleView.scheduled) {
    consoleView.scheduled = true;
    requestAnimationFrame(() => {
      consoleView.scheduled = false;
      renderConsole();
    });
  }
}

/**
 * Brings the console up to date: rows are updated in place by key (a growing
 * row keeps its element), and the view stays at the bottom only if it was
 * there, so reading older messages is not interrupted.
 */
function renderConsole() {
  const errorsSoFar = consoleLog.errorCount;
  elements.consoleErrorCount.hidden = errorsSoFar === 0;
  elements.consoleErrorCount.textContent = String(errorsSoFar);
  // The folded panel shows the newest message.
  const newest = consoleLog.entries.at(-1);
  elements.consolePreview.textContent = newest ? newest.message : "";
  elements.consolePreview.dataset.level = newest?.level ?? "";
  const output = elements.consoleOutput;
  if (output.hidden) {
    return; // rendered when the Console tab is shown
  }
  const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 24;
  const { rows, hidden, truncated } = consoleRows(consoleLog.entries, consoleView.filter, CONSOLE_ROWS);
  const existing = new Map([...output.children].map((node) => [node.dataset.key, node]));
  const keys = new Set(rows.map((row) => row.key));
  for (const [key, node] of existing) {
    if (!keys.has(key)) {
      node.remove();
    }
  }
  let previous = null;
  for (const row of rows) {
    const signature = `${row.count}|${row.time}|${row.message}`;
    let node = existing.get(row.key);
    if (!node) {
      node = document.createElement("div");
      node.className = "console-line";
      node.dataset.key = row.key;
    }
    if (node.dataset.signature !== signature) {
      fillConsoleRow(node, row);
      node.dataset.signature = signature;
    }
    const position = previous ? previous.nextSibling : output.firstChild;
    if (node !== position) {
      output.insertBefore(node, position);
    }
    previous = node;
  }
  const notes = [];
  if (hidden) {
    notes.push(`${hidden} hidden by filters`);
  }
  if (truncated || consoleLog.dropped) {
    notes.push(`${truncated + consoleLog.dropped} older not shown`);
  }
  elements.consoleSummary.textContent = notes.join(" · ");
  elements.consoleSummary.title = notes.length ? `${notes.join("; ")}. Errors are always shown.` : "Errors are always shown.";
  if (atBottom) {
    output.scrollTop = output.scrollHeight;
  }
}

function fillConsoleRow(node, row) {
  node.dataset.level = row.level;
  node.dataset.category = row.category;
  const time = document.createElement("span");
  time.className = "console-time";
  time.textContent = row.time === undefined ? "" : formatVirtualTime(row.time);
  const badge = document.createElement("span");
  badge.className = `console-level ${row.level}`;
  badge.textContent = row.level.toUpperCase();
  const text = document.createElement("div");
  text.className = "console-text";
  const message = document.createElement("span");
  message.className = "console-message";
  message.textContent = row.message;
  text.append(message);
  if (row.count > 1 && !row.grouped) {
    const count = document.createElement("span");
    count.className = "console-count";
    count.title = `Repeated ${row.count} times`;
    count.textContent = `×${row.count}`;
    text.append(count);
  }
  if (row.details?.length) {
    const details = document.createElement("details");
    details.className = "console-details";
    const summary = document.createElement("summary");
    summary.textContent = `Compiler output (${row.details.length} line${row.details.length === 1 ? "" : "s"})`;
    const pre = document.createElement("pre");
    pre.textContent = row.details.join("\n");
    details.append(summary, pre);
    text.append(details);
  }
  node.replaceChildren(time, badge, text);
}

function setConsoleFilter(changes) {
  Object.assign(consoleView.filter, changes);
  for (const chip of elements.consoleTools.querySelectorAll("[data-view]")) {
    chip.setAttribute("aria-pressed", String(chip.dataset.view === consoleView.filter.view));
  }
  for (const chip of elements.consoleTools.querySelectorAll("[data-level]")) {
    chip.setAttribute("aria-pressed", String(consoleView.filter.levels.has(chip.dataset.level)));
  }
  renderConsole();
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

/**
 * Lists a build's problems (errors and warnings, each followed by its notes)
 * and marks their lines in the editor gutter. `source` is the code they were
 * reported for. Text from the compiler is only ever set as text.
 */
function showProblems(diagnostics, errorText, source = null) {
  const problems = groupDiagnostics(diagnostics);
  state.problems = { list: problems, source };
  elements.problemsOutput.replaceChildren();
  elements.problemCount.textContent = String(problems.length + (errorText && !problems.length ? 1 : 0));
  for (const problem of problems) {
    elements.problemsOutput.append(problemRow(problem), ...problem.notes.map((note) => problemRow(note, true)));
  }
  if (errorText && !problems.length) {
    const row = document.createElement("div");
    row.className = "problem-row error";
    row.textContent = errorText;
    elements.problemsOutput.append(row);
  }
  markProblemLine(null);
  updateLineNumbers();
}

/** One row of the Problems list: a button that goes to the code when the problem has a line in main.c. */
function problemRow(diagnostic, note = false) {
  const navigable = isNavigable(diagnostic);
  const row = document.createElement(navigable ? "button" : "div");
  row.className = `problem-row ${diagnostic.severity}${note ? " note" : ""}${navigable ? "" : " no-location"}`;
  if (navigable) {
    row.type = "button";
    row.title = `Go to ${describeLocation(diagnostic)} (F8: next problem)`;
    row.addEventListener("click", () => goToProblem(diagnostic));
  } else {
    row.title = "No source line: the tool did not report one";
  }
  const parts = [
    ["problem-location", describeLocation(diagnostic)],
    ["problem-severity", `${diagnostic.severity}:`],
    ["problem-message", diagnostic.message],
  ];
  parts.forEach(([className, text], index) => {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    row.append(...(index ? [" ", span] : [span]));
  });
  return row;
}

/** Selects the problem's code (the identifier or symbol at its column), marks its line, and scrolls it into view. */
function goToProblem(diagnostic) {
  const { start, end, line } = problemRange(elements.editor.value, diagnostic.line, diagnostic.column);
  elements.editor.focus();
  elements.editor.setSelectionRange(start, end);
  scrollEditorToLine(line);
  markProblemLine({ line, severity: diagnostic.severity });
  updateCursorPosition();
}

function editorLineHeight() {
  return parseFloat(getComputedStyle(elements.editor).lineHeight) || 20;
}

/** Scrolls the editor so `line` is in view, a third of the way down, unless it already is. */
function scrollEditorToLine(line) {
  const height = editorLineHeight();
  const padding = parseFloat(getComputedStyle(elements.editor).paddingTop) || 0;
  const top = padding + (line - 1) * height;
  const editor = elements.editor;
  if (top < editor.scrollTop || top + height > editor.scrollTop + editor.clientHeight) {
    editor.scrollTop = Math.max(0, top - editor.clientHeight / 3);
  }
}

/** Highlights one editor line for a problem ({ line, severity }), or clears the highlight (null). */
function markProblemLine(mark) {
  state.problemLine = mark;
  positionProblemLine();
}

function positionProblemLine() {
  const band = elements.editorHighlight;
  const mark = state.problemLine;
  band.hidden = !mark;
  if (!mark) {
    return;
  }
  const editor = elements.editor;
  const height = editorLineHeight();
  const padding = parseFloat(getComputedStyle(editor).paddingTop) || 0;
  band.dataset.severity = mark.severity;
  band.style.left = `${editor.offsetLeft}px`;
  band.style.width = `${editor.clientWidth}px`;
  band.style.height = `${height}px`;
  band.style.top = `${editor.offsetTop + padding + (mark.line - 1) * height - editor.scrollTop}px`;
}

/** The editor line the cursor is on (1-based). */
function cursorLine() {
  return elements.editor.value.slice(0, elements.editor.selectionStart).split("\n").length;
}

function selectConsoleTab(name) {
  shell.setConsole(true);
  elements.consoleTabs.forEach((tab) => {
    const active = tab.dataset.console === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  elements.consoleOutput.hidden = name !== "console";
  elements.consoleTools.hidden = name !== "console";
  elements.problemsOutput.hidden = name !== "problems";
  elements.eventsOutput.hidden = name !== "events";
  if (name === "console") {
    renderConsole();
    elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;
  }
}

function workspaceMessage(text, level = "info") {
  elements.workspaceMessage.textContent = text;
  elements.workspaceMessage.dataset.level = level;
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

/**
 * Line numbers, with the lines of the last build's problems marked (hover for
 * the messages). Once the code changes the marks are dimmed: lines may have
 * moved since that build.
 */
function updateLineNumbers() {
  renderCodeColours();
  const count = elements.editor.value.split("\n").length;
  const marks = lineMarks(state.problems.list);
  const stale = state.problems.source !== null && state.problems.source !== elements.editor.value;
  const fragment = document.createDocumentFragment();
  for (let line = 1; line <= count; line++) {
    const mark = marks.get(line);
    const separator = line < count ? "\n" : "";
    if (!mark) {
      fragment.append(`${line}${separator}`);
      continue;
    }
    const span = document.createElement("span");
    span.className = `gutter-mark ${mark.severity}${stale ? " stale" : ""}`;
    span.title = mark.messages.join("\n") + (stale ? "\n(from the last build; the code has changed since)" : "");
    span.textContent = String(line);
    fragment.append(span, separator);
  }
  elements.lineNumbers.replaceChildren(fragment);
}

/**
 * The coloured copy of the code drawn under the editor's transparent text
 * (c-highlight.js), kept at the same scroll position.
 */
function renderCodeColours() {
  elements.codeHighlight.innerHTML = highlightHtml(elements.editor.value);
  syncCodeColours();
}

function syncCodeColours() {
  elements.codeHighlight.scrollTop = elements.editor.scrollTop;
  elements.codeHighlight.scrollLeft = elements.editor.scrollLeft;
}

function updateCursorPosition() {
  const before = elements.editor.value.slice(0, elements.editor.selectionStart).split("\n");
  elements.cursorPosition.textContent = `Ln ${before.length}, Col ${before.at(-1).length + 1}`;
}

function buildIsCurrent() {
  return state.build !== null && state.build.source === elements.editor.value;
}

function updateEditorStatus() {
  const failed = state.problems.source === elements.editor.value && state.problems.list.some((p) => p.severity === "error");
  let status = "pending";
  if (state.busy === "compiling") {
    elements.editorStatus.textContent = "Compiling…";
  } else if (buildIsCurrent()) {
    elements.editorStatus.textContent = "Built";
    status = "built";
  } else if (failed) {
    elements.editorStatus.textContent = `Build failed: ${summarize(state.problems.list)}`;
    status = "failed";
  } else if (state.build) {
    elements.editorStatus.textContent = "Changed since build";
  } else {
    elements.editorStatus.textContent = "Not built";
  }
  elements.editorStatus.dataset.state = status;
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
    if (definition.kind === "lcd1602") {
      const lcd = simulationLive() ? state.lcds.get(part.id) : null;
      return { lcd: lcd ? lcd.snapshot() : null };
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
        const analog = analogInputOf(info.gpio);
        if (analog) {
          info.lines.push(analog.tooltip);
        }
        const digital = analog ? "Digital (GPIO model)" : "Simulation";
        info.lines.push(live ? `${digital}: ${live.label} (${live.detail})` : "Simulation: not running");
      }
      return info;
    }
    const pin = definition.pins.find((p) => p.name === pinName);
    const lines = [definition.status === "simulated" ? "Logic-level model" : "Editor only — no electrical model yet"];
    if (definition.kind === "potentiometer") {
      const pot = state.analog.pots[part.id];
      lines[0] = "Ideal voltage divider (analog)";
      lines.push(pot ? `Wiper: ${pot.reason}` : "Wiper: not evaluated");
      lines.push(pot?.pins.length ? `Drives ADC input ${pot.pins.join(", ")}` : "SIG is not wired to an ADC pin");
    }
    if (definition.kind === "led" && simulationLive()) {
      const led = state.circuit.leds[part.id];
      lines.push(led ? `LED ${led.on ? "ON" : "off"}: ${led.reason}` : "LED off");
    }
    if (definition.kind === "lcd1602") {
      lines[0] = "HD44780 model driven by firmware GPIO writes";
      const binding = bindLcd(history.diagram, CATALOG, part.id);
      lines.push(`Interface: ${binding.interface}${binding.powered ? "" : " (not powered)"}`);
      const lcd = simulationLive() ? state.lcds.get(part.id)?.snapshot() : null;
      if (lcd) {
        lines.push(`${lcd.mode.bits}-bit, ${lcd.mode.lines}-line, display ${lcd.displayOn ? "on" : "off"}, ${lcd.instructions} transfers`);
      }
      lines.push(...binding.errors, ...binding.notes);
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
      log(`${part.id} ${pressed ? "pressed" : "released"}`, "info", state.board.virtualTimeNs, { category: "input" });
      reevaluateCircuit();
    }
    workspace.refreshStates();
  },
});

workspace.addEventListener("change", (event) => {
  saveCircuitDraft();
  syncLcds();
  reevaluateCircuit();
  renderToolbar();
  renderPinTable();
  updateCanvasHint();
  workspaceMessage(event.detail.label);
});

/** First steps over the canvas while the circuit is the bare board. */
function updateCanvasHint() {
  elements.canvasHint.hidden = history.diagram.parts.some((part) => CATALOG[part.type]?.kind !== "board");
}
workspace.addEventListener("clipboard", (event) => {
  const { action, parts, wires, relocated, crowded } = event.detail;
  const what = `${parts} part${parts === 1 ? "" : "s"}${wires ? ` and ${wires} wire${wires === 1 ? "" : "s"} between them` : ""}`;
  if (relocated) {
    // Short enough for one line at 1024 px.
    const verb = { add: "Added", duplicate: "Duplicated" }[action] ?? "Pasted";
    workspaceMessage(crowded ? `${verb} into view; no free space, so it overlaps.` : `${verb} into free space in view.`);
    return;
  }
  workspaceMessage(`${action === "cut" ? "Cut" : "Copied"} ${what}. Ctrl+V pastes.`);
});
workspace.addEventListener("select", () => {
  renderToolbar();
  renderSelectionPanel();
  // A selected part or wire has properties to show; the board alone does not.
  const selection = workspace.selection;
  const part = selection?.kind === "part" ? findPart(history.diagram, selection.id) : null;
  if (selection && !(part && CATALOG[part.type].kind === "board")) {
    shell.revealInspector();
  }
});
workspace.addEventListener("view", () => {
  elements.zoomValue.textContent = `${Math.round(workspace.zoomLevel * 100)}%`;
  elements.gridToggle.setAttribute("aria-pressed", String(workspace.showGrid));
  elements.snapToggle.setAttribute("aria-pressed", String(workspace.snapToGrid));
});
workspace.addEventListener("wire", (event) => {
  const { detail } = event;
  if (detail.state === "started" || detail.state === "waiting") {
    workspaceMessage(`Wiring from ${detail.from} — click a target pin (Esc cancels).`);
  } else if (detail.state === "dragging") {
    workspaceMessage(`Wiring from ${detail.from} — release on a target pin (Esc cancels).`);
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
  state.analog = evaluateAnalog(history.diagram, CATALOG);
  const errors = [...state.circuit.errors, ...state.analog.errors];
  if (errors.length) {
    workspaceMessage(errors[0], "error");
  }
  syncExternalDrives();
  syncAnalogInputs();
}

/** Pushes potentiometer wiper voltages to the ADC model (only changes). */
function syncAnalogInputs() {
  if (!simulationLive() || !state.session.id) {
    return;
  }
  for (const [gpio, volts] of Object.entries(state.analog.inputs)) {
    if (state.appliedAnalog.get(gpio) !== volts) {
      state.appliedAnalog.set(gpio, volts);
      sendAnalog({ analog: gpio, volts });
    }
  }
  for (const gpio of [...state.appliedAnalog.keys()]) {
    if (state.analog.inputs[gpio] === undefined) {
      state.appliedAnalog.delete(gpio);
      sendAnalog({ analog: gpio, volts: null });
    }
  }
}

async function sendAnalog(body) {
  if (!state.session.id) {
    return;
  }
  try {
    await api(`/api/sessions/${state.session.id}/input`, { body });
  } catch (error) {
    log(`Analog input ${JSON.stringify(body)} failed: ${error.message}`, "error", undefined, { category: "input" });
  }
}

/**
 * Keeps one HD44780 simulation per LCD1602 part. Rewiring during a run
 * re-binds the pins but keeps the controller state; a newly added LCD powers
 * up at the current virtual time.
 */
function syncLcds({ restart = false } = {}) {
  if (restart) {
    state.lcds.clear();
  }
  const ids = new Set();
  for (const part of history.diagram.parts) {
    if (CATALOG[part.type]?.kind !== "lcd1602") {
      continue;
    }
    ids.add(part.id);
    const binding = bindLcd(history.diagram, CATALOG, part.id);
    const existing = state.lcds.get(part.id);
    if (existing) {
      existing.binding = binding;
    } else {
      const powerOnNs = restart ? 0n : BigInt(state.board.virtualTimeNs ?? 0);
      state.lcds.set(part.id, Object.assign(new LcdSimulation(binding, { powerOnNs }), { reportedWarnings: 0 }));
    }
  }
  for (const id of [...state.lcds.keys()]) {
    if (!ids.has(id)) {
      state.lcds.delete(id);
    }
  }
}

function feedLcds(event) {
  for (const [id, lcd] of state.lcds) {
    lcd.handleEvent(event);
    const { warnings } = lcd.controller;
    while (lcd.reportedWarnings < warnings.length) {
      const warning = warnings[lcd.reportedWarnings++];
      log(`${id}: ${warning.detail}`, "warning", warning.virtualTimeNs, { category: "peripheral" });
    }
  }
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

// ---------------------------------------------------------------------------
// Drafts of the student's work
// ---------------------------------------------------------------------------

const DRAFT_STATUS = {
  saved: {
    text: "Saved in this browser",
    title: "Your main.c and circuit are kept in this browser's local storage and restored when the page reloads. " +
      "This is not a backup: clearing site data or using another browser loses them. Save downloads the circuit as diagram.json.",
  },
  failed: {
    text: "Not saved: browser storage full or blocked",
    title: "Your latest changes are not stored and will be lost on reload. Keep a copy: Save downloads the circuit " +
      "(diagram.json); copy main.c into a file.",
  },
  unavailable: {
    text: "Not saved: browser storage unavailable",
    title: "This browser does not allow local storage here, so your work will be lost on reload. Keep a copy: Save " +
      "downloads the circuit (diagram.json); copy main.c into a file.",
  },
  idle: { text: "", title: "" },
};

function currentWork() {
  return { source: elements.editor.value, diagramText: serializeDiagram(history.diagram) };
}

function saveCircuitDraft() {
  drafts.saveDiagram(serializeDiagram(history.diagram));
  renderDraftStatus();
}

function saveSourceDraft() {
  const edited = elements.editor.value !== state.baseline.source;
  // Before the examples arrive, keep the restored draft's example.
  const exampleId = state.baseline.exampleId ?? restored.source?.exampleId ?? null;
  drafts.saveSource({ exampleId, source: edited ? elements.editor.value : null });
  renderDraftStatus();
}

let draftWarningShown = false;
function renderDraftStatus() {
  const status = drafts.status;
  const { text, title } = DRAFT_STATUS[status];
  elements.draftStatus.textContent = text;
  elements.draftStatus.title = title;
  elements.draftStatus.dataset.status = status;
  if ((status === "failed" || status === "unavailable") && !draftWarningShown) {
    draftWarningShown = true;
    const reason = status === "failed" ? `Browser storage refused the draft (${drafts.lastError?.name ?? "error"})` : "Browser storage is unavailable";
    log(`${reason}: your code and circuit are not saved and will be lost on reload. Save downloads the circuit; copy main.c into a file.`, "warning", undefined, { category: "workspace" });
  } else if (status === "saved") {
    draftWarningShown = false;
  }
}

function loadDiagramText(text, origin) {
  const { diagram, errors } = parseDiagram(text, CATALOG);
  if (!diagram) {
    workspaceMessage(`Could not load ${origin}: ${errors[0]}`, "error");
    log(`Diagram ${origin} rejected: ${errors.join(" ")}`, "error", undefined, { category: "workspace" });
    return false;
  }
  history.reset(diagram);
  // A replaced circuit starts a new context: only importDiagramFile marks it as a loaded file again.
  state.importedCircuit = null;
  workspace.select(null);
  workspace.render();
  workspace.fit();
  saveCircuitDraft();
  reevaluateCircuit();
  renderToolbar();
  renderPinTable();
  updateCanvasHint();
  workspaceMessage(`Loaded ${origin}.`);
  return true;
}

/**
 * Whether replacing the circuit would lose the student's work: it differs
 * from the example it started from and from the last diagram file loaded.
 * A bare LaunchPad with nothing to undo has nothing to lose.
 */
function circuitAtRisk() {
  const current = serializeDiagram(history.diagram);
  if (current === state.baseline.diagramText || current === state.importedCircuit) {
    return false;
  }
  const bare = history.diagram.connections.length === 0
    && history.diagram.parts.every((part) => CATALOG[part.type].kind === "board");
  return !bare || history.canUndo;
}

/**
 * A diagram file chosen with Load. Invalid files are rejected without
 * touching anything; a valid file that would replace circuit work is
 * confirmed first, before the circuit, its undo history, or its draft
 * change. The firmware source is never affected.
 */
function importDiagramFile(text, name) {
  const { diagram } = parseDiagram(text, CATALOG);
  if (!diagram) {
    loadDiagramText(text, name); // reports the error; the circuit stays
    return;
  }
  if (serializeDiagram(diagram) === serializeDiagram(history.diagram)) {
    workspaceMessage(`${name} matches the current circuit; nothing changed.`);
    return;
  }
  if (circuitAtRisk() && !window.confirm(
    `Load "${name}"?\n\nThis replaces your current circuit and clears its undo history. Your main.c is not changed.` +
      "\n\nChoose Cancel to keep your circuit (Save downloads it as diagram.json first).",
  )) {
    workspaceMessage(`Kept your circuit; ${name} was not loaded.`);
    return;
  }
  if (loadDiagramText(text, name)) {
    state.importedCircuit = serializeDiagram(history.diagram);
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
  // The pill can be narrow; the whole reading is in its tooltip.
  elements.virtualTime.parentElement.title = `Virtual time ${elements.virtualTime.textContent}: emulation time reported by Renode (not wall-clock time)`;

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
  const group = selection?.kind === "group";
  elements.undoButton.disabled = !history.canUndo;
  elements.redoButton.disabled = !history.canRedo;
  elements.rotateButton.disabled = !editable;
  elements.duplicateButton.disabled = !(editable || (group && selection.parts.length > 0));
  elements.deleteButton.disabled = !(editable || selection?.kind === "wire" || group);
}

function componentLiveText(id) {
  const livePins = COMPONENT_PINS[id] ?? [];
  return simulationLive()
    ? livePins.map((gpio) => `${gpio}: ${describePin(state.board, gpio).label}`).join(" · ")
    : `Pins ${livePins.join(", ")} — run the simulation to see live values`;
}

/**
 * Updates only the live pin values of a selected board component. The panel
 * is not rebuilt, so its inputs (e.g. the die temperature) keep their value
 * and focus while simulator events stream in.
 */
function refreshSelectionLive() {
  const selection = workspace.selection;
  const live = elements.selectionPanel.querySelector(".component-live");
  if (selection?.kind === "component" && live) {
    live.textContent = componentLiveText(selection.id);
  }
}

function renderSelectionPanel() {
  const panel = elements.selectionPanel;
  panel.replaceChildren();
  const selection = workspace.selection;
  if (!selection) {
    panel.textContent = "Select a part or wire. Click a pin to start a wire. Shift+click or Shift+drag selects several parts.";
    return;
  }
  if (selection.kind === "group") {
    const title = document.createElement("p");
    const strong = document.createElement("strong");
    const parts = selection.parts.length;
    const wires = selection.wires.length;
    strong.textContent = [parts && `${parts} part${parts === 1 ? "" : "s"}`, wires && `${wires} wire${wires === 1 ? "" : "s"}`].filter(Boolean).join(" and ") + " selected";
    title.append(strong);
    const list = document.createElement("p");
    list.className = "muted";
    list.textContent = selection.parts.join(", ");
    const hint = document.createElement("p");
    hint.className = "muted";
    hint.id = "groupHint";
    hint.textContent = "Drag a selected part to move them together · Arrows nudge 0.1 in (Shift: 1 in) · Ctrl+C / Ctrl+X / Ctrl+V · Ctrl+D duplicates · Delete removes · Shift+click adds or removes";
    panel.append(title, ...(parts ? [list] : []), hint);
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
    if (selection.id === "U1") {
      panel.append(temperatureControl());
    }
    if ((COMPONENT_PINS[selection.id] ?? []).length) {
      const live = document.createElement("p");
      live.className = "component-live";
      live.textContent = componentLiveText(selection.id);
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
    hint.textContent = "Drag any segment to reroute (the ends stay on their pins). Delete removes the wire.";
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
  const MODEL_LABELS = { board: "simulated (Renode)", potentiometer: "simulated (analog)", lcd1602: "simulated (HD44780)" };
  chip.textContent = MODEL_LABELS[definition.kind] ?? (definition.status === "simulated" ? "simulated (logic level)" : "editor only");
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
  } else if (definition.kind === "potentiometer") {
    panel.append(potentiometerControl(part));
  }
}

/** Knob position slider; each released change is one undoable edit. */
function potentiometerControl(part) {
  const wrapper = document.createElement("div");
  const label = document.createElement("label");
  label.textContent = "Position ";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = "potPosition";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  slider.value = String(part.attrs.position ?? 50);
  slider.setAttribute("aria-label", `${part.id} knob position (percent)`);
  const readout = document.createElement("p");
  readout.className = "component-live";
  readout.id = "potReadout";
  const show = () => {
    const pot = state.analog.pots[part.id];
    readout.textContent = pot ? `Wiper: ${pot.reason}${pot.pins.length ? ` → ${pot.pins.join(", ")}` : ""}` : "";
  };
  slider.addEventListener("change", () => {
    const current = findPart(history.diagram, part.id);
    workspace.execute(commands.setAttr(part.id, "position", current.attrs.position ?? 50, Number(slider.value)));
    show();
  });
  label.append(slider);
  wrapper.append(label, readout);
  show();
  return wrapper;
}

/** Die temperature seen by the ADC's internal temperature sensor. */
function temperatureControl() {
  const label = document.createElement("label");
  label.textContent = "Die temperature (°C) ";
  const input = document.createElement("input");
  input.type = "number";
  input.id = "dieTemperature";
  input.min = "-40";
  input.max = "150";
  input.step = "0.5";
  input.value = String(state.dieCelsius);
  input.addEventListener("change", () => {
    const celsius = Number(input.value);
    if (!Number.isFinite(celsius) || celsius < -40 || celsius > 150) {
      input.value = String(state.dieCelsius);
      return;
    }
    state.dieCelsius = celsius;
    if (simulationLive()) {
      sendAnalog({ temperature: celsius });
    }
  });
  label.append(input);
  return label;
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
/** The analog source of an ADC-capable pin (see describeAnalogInput), or null. */
function analogInputOf(gpio) {
  const volts = state.analog.inputs[gpio];
  const applied = simulationLive() && volts !== undefined && state.appliedAnalog.get(gpio) === volts;
  return describeAnalogInput(gpio, state.analog, { applied });
}

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
    // An ADC input wired to a potentiometer shows its analog source, not the digital buffer state.
    const analog = analogInputOf(gpio);
    const { label, detail } = analog
      ? { label: analog.level, detail: analog.detail }
      : live ? describePin(state.board, gpio) : { label: "—", detail: "" };
    const row = document.createElement("tr");
    row.dataset.pin = gpio;
    row.className = analog ? (analog.level === "CONFLICT" ? "pin-conflict" : "pin-analog") : `pin-${label.toLowerCase()}`;
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

/**
 * A small drawing of a part for the library: the part's own artwork (as the
 * canvas draws it, with its default attributes) and its pins.
 */
function partPreview(type) {
  const definition = CATALOG[type];
  const part = { id: "preview", type, left: 0, top: 0, rotate: 0, attrs: structuredClone(definition.defaultAttrs ?? {}) };
  const { width, height } = definition.size;
  const pad = 3;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "library-preview");
  svg.setAttribute("viewBox", `${-pad} ${-pad} ${width + 2 * pad} ${height + 2 * pad}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  // The catalog's render() output is the same trusted markup the canvas uses.
  svg.innerHTML = definition.render(part, {}) +
    definition.pins.map((pin) => `<circle class="preview-pin" cx="${pin.x}" cy="${pin.y}" r="1.6" />`).join("");
  return svg;
}

/** The component library: search, parts grouped by category, each with its drawing and status. */
function renderLibrary() {
  const search = document.createElement("input");
  search.id = "librarySearch";
  search.className = "library-search";
  search.type = "search";
  search.placeholder = "Search parts";
  search.setAttribute("aria-label", "Search parts");
  search.spellcheck = false;
  search.autocomplete = "off";
  const list = document.createElement("div");
  list.className = "library-list";
  const empty = document.createElement("p");
  empty.className = "library-empty";
  empty.textContent = "No part matches. Supported parts: LED, resistor, pushbutton, potentiometer, LCD1602.";
  empty.hidden = true;
  const items = [];
  for (const category of LIBRARY_CATEGORIES) {
    const types = LIBRARY.filter((type) => CATALOG[type].category === category);
    if (!types.length) {
      continue;
    }
    const heading = document.createElement("p");
    heading.className = "library-group";
    heading.textContent = category;
    list.append(heading);
    for (const type of types) {
      const definition = CATALOG[type];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "library-item";
      button.dataset.type = type;
      button.dataset.search = `${definition.title} ${definition.kind} ${category} ${definition.description}`.toLowerCase();
      const text = document.createElement("span");
      text.className = "library-text";
      const name = document.createElement("strong");
      name.textContent = definition.title;
      const description = document.createElement("small");
      description.textContent = definition.description;
      text.append(name, description);
      const chip = document.createElement("span");
      chip.className = "status-chip";
      chip.dataset.status = definition.status;
      chip.textContent = definition.status === "simulated" ? "simulated" : "editor only";
      chip.title = definition.status === "simulated" ? "Behaviour comes from the simulator" : "Can be placed and wired; no electrical behaviour yet";
      button.append(partPreview(type), text, chip);
      button.addEventListener("click", () => {
        setLibraryOpen(false);
        const part = workspace.addPart(type);
        flashPart(part.id);
      });
      heading.dataset.category = category;
      items.push({ button, heading });
      list.append(button);
    }
  }
  const foot = document.createElement("p");
  foot.className = "library-foot";
  foot.innerHTML = "Click a part to add it, then drag it into place. <kbd>A</kbd> opens this list; <kbd>↑</kbd> <kbd>↓</kbd> and <kbd>Enter</kbd> choose.";
  search.addEventListener("input", () => {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = new Set();
    for (const { button } of items) {
      button.hidden = !words.every((word) => button.dataset.search.includes(word));
      if (!button.hidden) {
        shown.add(button.dataset.type);
      }
    }
    for (const heading of list.querySelectorAll(".library-group")) {
      heading.hidden = !LIBRARY.some((type) => CATALOG[type].category === heading.dataset.category && shown.has(type));
    }
    empty.hidden = shown.size > 0;
  });
  // Arrow keys move between the visible parts (and from the search box into the list).
  elements.partLibrary.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    const visible = items.map(({ button }) => button).filter((button) => !button.hidden);
    if (!visible.length) {
      return;
    }
    event.preventDefault();
    const index = visible.indexOf(document.activeElement);
    const next = event.key === "ArrowDown"
      ? visible[index + 1] ?? visible[0]
      : index <= 0 ? search : visible[index - 1];
    next.focus();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      items.map(({ button }) => button).find((button) => !button.hidden)?.click();
    }
  });
  elements.partLibrary.replaceChildren(search, list, empty, foot);
}

/** A short highlight on a part that was just added, so the eye finds it. */
function flashPart(id) {
  const node = elements.canvas.querySelector(`.part[data-part="${CSS.escape(id)}"]`);
  if (!node) {
    return;
  }
  node.classList.remove("just-added");
  void node.getBoundingClientRect();
  node.classList.add("just-added");
  setTimeout(() => node.classList.remove("just-added"), 1200);
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
  log("Compiling main.c with arm-none-eabi-gcc…", "info", undefined, { category: "build" });
  try {
    const result = await api("/api/build", { body: { source } });
    showProblems(result.diagnostics ?? [], result.ok ? null : result.error, source);
    if (!result.ok) {
      state.build = null;
      const summary = summarize(state.problems.list);
      // One error message; the compiler's own output folds under it (and every problem is in the Problems tab).
      log(`Build failed: ${result.error}${summary ? ` (${summary}; see Problems)` : ""}`, "error", undefined, { category: "build", details: compilerOutput(result.log) });
      selectConsoleTab("problems");
      // Show where the first error is, without taking focus from the button that was used.
      const first = state.problems.list.find((p) => p.severity === "error" && isNavigable(p));
      if (first && elements.editor.value === source) {
        const { line } = problemRange(source, first.line, first.column);
        scrollEditorToLine(line);
        markProblemLine({ line, severity: "error" });
      }
      return false;
    }
    state.build = { id: result.buildId, source, elf: result.elf };
    renderElfInfo(result.elf);
    const warnings = (result.diagnostics ?? []).filter((d) => d.severity === "warning").length;
    log(
      `Build succeeded in ${result.durationMs} ms: ${result.elf.bytes}-byte ELF, entry 0x${result.elf.entry.toString(16)}` +
        (warnings ? `, ${warnings} warning(s)` : ""),
      warnings ? "warning" : "success",
      undefined,
      { category: "build", details: warnings ? compilerOutput(result.log) : null },
    );
    return true;
  } catch (error) {
    log(`Build request failed: ${error.message}`, "error", undefined, { category: "build" });
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
  state.appliedAnalog.clear();
  syncLcds({ restart: true });
  state.busy = "starting";
  state.session = { id: null, state: "starting", stream: null };
  render();
  log("Starting Renode and loading the ELF…", "info", undefined, { category: "run" });
  try {
    // Apply the circuit's inputs before the CPU runs (wired drives, potentiometers, die temperature).
    reevaluateCircuit();
    const drives = {};
    for (const [gpio, input] of Object.entries(state.circuit.boardInputs)) {
      if (input.level !== null) {
        drives[gpio] = input.level ? "high" : "low";
        state.appliedDrives.set(gpio, drives[gpio]);
      }
    }
    const analog = { ...state.analog.inputs };
    for (const [gpio, volts] of Object.entries(analog)) {
      state.appliedAnalog.set(gpio, volts);
    }
    const inputs = { drives, analog, temperature: state.dieCelsius };
    const { sessionId } = await api("/api/sessions", { body: { buildId: state.build.id, autoRun: true, inputs } });
    state.session.id = sessionId;
    const stream = new EventSource(`/api/sessions/${sessionId}/events`);
    state.session.stream = stream;
    stream.onmessage = (message) => handleMessage(sessionId, JSON.parse(message.data));
    stream.onerror = () => {
      if (state.session.id === sessionId && !["stopped", "error"].includes(state.session.state)) {
        state.session.state = "error";
        log("Lost the event stream from the simulator.", "error", undefined, { category: "run" });
        closeStream();
        render();
      }
    };
  } catch (error) {
    state.session.state = "error";
    log(`Could not start the simulation: ${error.message}`, "error", undefined, { category: "run" });
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
    log(`${action} failed: ${error.message}`, "error", undefined, { category: "run" });
  }
}

async function stop() {
  const sessionId = state.session.id;
  await control("stop");
  // The session reports "stopped" on its event stream before this request is answered, which
  // enables Run: a new session may have started meanwhile. That one is not this stop's to end.
  if (state.session.id !== sessionId) {
    return;
  }
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
    log(`Input ${name} failed: ${error.message}`, "error", undefined, { category: "input" });
  }
}

async function drivePin(pin, level) {
  if (!state.session.id) {
    return;
  }
  try {
    await api(`/api/sessions/${state.session.id}/input`, { body: { pin, level } });
  } catch (error) {
    log(`External drive ${pin}=${level} failed: ${error.message}`, "error", undefined, { category: "input" });
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
  case "adc-input-warning":
    return [`${event.peripheral}: ${event.detail}`, "warning"];
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
    refreshSelectionLive();
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
      log(message.message, message.state === "error" ? "error" : "info", message.virtualTimeNs, { category: "run" });
    } else if (previous !== message.state && message.state === "running") {
      log("CPU running.", "success", message.virtualTimeNs, { category: "run" });
    } else if (previous !== message.state && message.state === "paused") {
      log("CPU halted.", "info", message.virtualTimeNs, { category: "run" });
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
    feedLcds(event);
    const described = describeEvent(event);
    if (described) {
      log(described[0], described[1], event.virtualTimeNs, {
        category: event.type === "digital-pin-changed" ? "gpio" : "peripheral",
        key: event.pin?.pinId ?? event.peripheral ?? null,
      });
    }
    break;
  }
  case "mcu-reset":
    log("MCU reset: peripherals at reset values, CPU restarts from the vector table.", "info", message.virtualTimeNs, { category: "run" });
    break;
  case "board-input":
    log(`${message.input} ${message.pressed ? "pressed" : "released"}`, "info", message.virtualTimeNs, { category: "input" });
    break;
  case "analog-input":
    log(`External circuit applies ${message.volts === null ? "nothing (disconnected)" : `${message.volts.toFixed(3)} V`} to ${message.pin}`, "info", message.virtualTimeNs, { category: "input" });
    break;
  case "die-temperature":
    log(`Die temperature set to ${message.celsius} °C`, "info", message.virtualTimeNs, { category: "input" });
    break;
  case "external-drive":
    log(`External circuit drives ${message.pin} ${message.level === "release" ? "released" : message.level.toUpperCase()}`, "info", message.virtualTimeNs, { category: "input" });
    break;
  case "session-limit":
    log(`Session limit reached (${message.kind}).`, "error", undefined, { category: "run" });
    break;
  default:
    break;
  }
  scheduleRefresh();
}

// ---------------------------------------------------------------------------
// Examples and initialization
// ---------------------------------------------------------------------------

/** The circuit an example starts from: its diagram.json, or the bare LaunchPad. */
function exampleCircuitText(example) {
  const diagram = example.diagram ? parseDiagram(example.diagram, CATALOG).diagram : null;
  return serializeDiagram(diagram ?? createDiagram({ author: "" }));
}

function showExample(example) {
  elements.exampleSelect.value = example.id;
  elements.exampleSummary.textContent = `${example.summary} Expected: ${example.expected}.`;
  setAboutExpanded(false);
}

/** The example's description: one line, or all of it. */
function setAboutExpanded(expanded) {
  elements.exampleAbout.dataset.expanded = String(expanded);
  elements.aboutToggle.textContent = expanded ? "Less" : "More";
  elements.aboutToggle.setAttribute("aria-expanded", String(expanded));
}

function setSource(text) {
  elements.editor.value = text;
  updateLineNumbers();
  updateCursorPosition();
}

/** Replaces the code and circuit with the example's own (callers confirm first). */
function loadExample(id) {
  const example = state.examples.find((e) => e.id === id);
  if (!example) {
    return;
  }
  showExample(example);
  setSource(example.source);
  showProblems([], null);
  loadDiagramText(exampleCircuitText(example), `the "${example.title}" circuit`);
  state.baseline = { exampleId: example.id, source: example.source, diagramText: serializeDiagram(history.diagram) };
  saveSourceDraft();
  render();
}

/**
 * First example load: work restored from this browser (or typed while the
 * examples were loading) is kept, and the example it started from becomes
 * the baseline again, so edits stay recognizable as edits.
 */
function restoreWork() {
  const draft = restored.source;
  const example = state.examples.find((e) => e.id === draft?.exampleId) ?? state.examples[0];
  if (!example) {
    return;
  }
  const keepSource = draft?.source != null || elements.editor.value !== "";
  const keepCircuit = restored.diagram !== null;
  if (!keepSource && !keepCircuit) {
    loadExample(example.id);
    return;
  }
  showExample(example);
  if (!keepSource) {
    setSource(example.source);
  }
  if (!keepCircuit) {
    loadDiagramText(exampleCircuitText(example), `the "${example.title}" circuit`);
  }
  state.baseline = { exampleId: example.id, source: example.source, diagramText: exampleCircuitText(example) };
  saveSourceDraft();
  const changes = compareWork(currentWork(), state.baseline);
  const what = [changes.source && "main.c", changes.circuit && "circuit"].filter(Boolean).join(" and ");
  if (what) {
    workspaceMessage(`Restored your ${what} from this browser (example "${example.title}").`);
    log(`Restored your edited ${what} from this browser's local storage (started from example "${example.title}").`, "success", undefined, { category: "workspace" });
  }
  render();
}

/** Asks before an example switch would replace edited code or circuit; true = go ahead. */
function confirmExampleSwitch(id) {
  const changes = compareWork(currentWork(), state.baseline);
  if (!changes.source && !changes.circuit) {
    return true;
  }
  const what = changes.source && changes.circuit ? "your edited main.c and circuit" : changes.source ? "your edited main.c" : "your circuit changes";
  const title = state.examples.find((e) => e.id === id)?.title ?? id;
  return window.confirm(
    `Load example "${title}"?\n\nThis replaces ${what} with the example's code and circuit, and cannot be undone.` +
      `\n\nChoose Cancel to keep working${changes.circuit ? " (Save downloads your circuit as diagram.json first)" : ""}.`,
  );
}

async function initialize() {
  renderCapabilities();
  renderLibrary();
  renderToolbar();
  renderSelectionPanel();
  updateCanvasHint();
  workspace.fit();
  render();
  try {
    const health = await api("/api/health");
    const { toolchain } = health;
    // Short enough to keep the notice on one line; the full version string is in the tooltip.
    const gccVersion = toolchain.gcc?.match(/\b\d+\.\d+\.\d+\b/)?.[0];
    elements.toolchainInfo.textContent = toolchain.gcc
      ? ` ${gccVersion ? `GCC ${gccVersion}` : toolchain.gcc} · Renode ${toolchain.renodePinned}`
      : " Toolchain missing — run `npm run setup:tools`.";
    elements.toolchainInfo.title = toolchain.gcc ? `${toolchain.gcc}; Renode ${toolchain.renodePinned}` : "";
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
    restoreWork();
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

elements.exampleSelect.addEventListener("change", () => {
  const id = elements.exampleSelect.value;
  if (confirmExampleSwitch(id)) {
    loadExample(id);
  } else {
    elements.exampleSelect.value = state.baseline.exampleId; // Cancel: nothing changes
  }
});
elements.editor.addEventListener("input", () => {
  markProblemLine(null); // the marked line may have moved
  updateLineNumbers();
  updateCursorPosition();
  updateEditorStatus();
  saveSourceDraft();
});
elements.editor.addEventListener("click", updateCursorPosition);
elements.editor.addEventListener("keyup", updateCursorPosition);
elements.editor.addEventListener("scroll", () => {
  elements.lineNumbers.scrollTop = elements.editor.scrollTop;
  syncCodeColours();
  positionProblemLine();
});
new ResizeObserver(positionProblemLine).observe(elements.editor);
elements.editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    elements.editor.setRangeText("    ", elements.editor.selectionStart, elements.editor.selectionEnd, "end");
    elements.editor.dispatchEvent(new Event("input"));
  } else if (event.key === "F8") {
    // Next problem (Shift+F8: previous), from the cursor's line, wrapping around.
    const target = nextProblem(state.problems.list, cursorLine(), event.shiftKey ? -1 : 1);
    if (target) {
      event.preventDefault();
      goToProblem(target);
    }
  }
});

elements.compileButton.addEventListener("click", () => {
  shell.finishRunHint();
  compile();
});
elements.runButton.addEventListener("click", () => {
  shell.finishRunHint();
  run();
});
elements.aboutToggle.addEventListener("click", () => setAboutExpanded(elements.exampleAbout.dataset.expanded !== "true"));

/** Library open (search box focused, all parts listed) or closed (the Add Part button and the A key). */
function setLibraryOpen(open) {
  const wasOpen = !elements.partLibrary.hidden;
  elements.partLibrary.hidden = !open;
  elements.addPartButton.setAttribute("aria-expanded", String(open));
  if (open && !wasOpen) {
    const search = elements.partLibrary.querySelector(".library-search");
    search.value = "";
    search.dispatchEvent(new Event("input"));
    search.focus();
  }
}
// A press outside the library (and its button) closes it.
document.addEventListener("pointerdown", (event) => {
  if (!elements.partLibrary.hidden && !event.target.closest?.("#partLibrary, #addPartButton")) {
    setLibraryOpen(false);
  }
}, true);

// Application shortcuts. Single keys only act outside text fields; the circuit's own keys (R, Del, arrows, ...)
// are handled by the canvas when it has focus.
document.addEventListener("keydown", (event) => {
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && !event.shiftKey && !event.altKey && event.key === "Enter") {
    event.preventDefault();
    if (!elements.runButton.disabled) {
      elements.runButton.click();
    }
  } else if (ctrl && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "b") {
    event.preventDefault();
    if (!elements.compileButton.disabled) {
      elements.compileButton.click();
    }
  } else if (event.key === "Escape" && (shell.helpOpen || !elements.partLibrary.hidden)) {
    if (!elements.partLibrary.hidden) {
      setLibraryOpen(false);
      elements.addPartButton.focus();
    }
    shell.setHelp(false);
  } else if (!ctrl && !event.altKey && !isTyping(event.target)) {
    if (event.key === "?") {
      event.preventDefault();
      shell.setHelp(!shell.helpOpen);
    } else if (event.key === "a" || event.key === "A") {
      event.preventDefault();
      setLibraryOpen(true);
    }
  }
});
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
elements.addPartButton.addEventListener("click", () => setLibraryOpen(elements.partLibrary.hidden));
elements.saveDiagramButton.addEventListener("click", () => {
  const blob = new Blob([serializeDiagram(history.diagram)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "diagram.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
  workspaceMessage("Saved diagram.json.");
});
// A real button (Tab, Enter, Space) opens the hidden file input's chooser.
elements.loadDiagramButton.addEventListener("click", () => elements.loadDiagramInput.click());
elements.loadDiagramInput.addEventListener("change", async () => {
  const file = elements.loadDiagramInput.files?.[0];
  if (file) {
    importDiagramFile(await file.text(), file.name);
  }
  elements.loadDiagramInput.value = "";
});

elements.consoleTabs.forEach((tab) => tab.addEventListener("click", () => selectConsoleTab(tab.dataset.console)));
elements.consoleCategory.append(
  new Option("All sources", "all"),
  ...Object.entries(CATEGORIES).map(([value, label]) => new Option(label, value)),
);
elements.consoleTools.addEventListener("click", (event) => {
  const chip = event.target.closest(".console-chip");
  if (chip?.dataset.view) {
    setConsoleFilter({ view: chip.dataset.view });
  } else if (chip?.dataset.level) {
    // "Info" covers information and success messages; errors are not a choice (always shown).
    const levels = new Set(consoleView.filter.levels);
    const group = chip.dataset.level === "info" ? ["info", "success"] : [chip.dataset.level];
    const on = !levels.has(chip.dataset.level);
    group.forEach((level) => (on ? levels.add(level) : levels.delete(level)));
    setConsoleFilter({ levels });
  }
});
elements.consoleCategory.addEventListener("change", () => setConsoleFilter({ category: elements.consoleCategory.value }));
elements.consoleFilter.addEventListener("input", () => setConsoleFilter({ text: elements.consoleFilter.value.trim() }));
elements.clearConsoleButton.addEventListener("click", () => {
  consoleLog.clear();
  elements.consoleOutput.replaceChildren();
  renderConsole();
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

// Restore the student's source before anything else runs, so the asynchronous
// example load can tell it apart from an empty editor and keep it.
if (restored.source?.source != null) {
  elements.editor.value = restored.source.source;
}
if (restored.unreadable.length) {
  log(`A saved ${restored.unreadable.join(" and ")} draft could not be read; it was set aside and the example is shown instead.`, "warning", undefined, { category: "workspace" });
}
renderDraftStatus();
updateLineNumbers();
initialize();
