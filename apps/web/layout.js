/*
 * Application shell behaviour: the code | circuit split, the collapsible
 * output panel and inspector, the help panel, and first-run guidance.
 *
 * Layout only: no simulation or circuit state lives here. Preferences (split
 * position, inspector shown or hidden, whether Run has been used) are kept in
 * this browser on a best-effort basis; without storage the defaults apply.
 */

export const PREFS_KEY = "tm4c123-simulator:ui";

/** The inspector starts open on screens at least this wide; narrower ones keep the circuit wide. */
export const INSPECTOR_OPEN_WIDTH = 1280;

const SPLIT_MIN = 25;
const SPLIT_MAX = 65;

/** Default share of the width for the code pane (percent). */
export function defaultSplit(viewportWidth) {
  return viewportWidth >= 1280 ? 34 : 38;
}

/** The split clamped to its range; anything that is not a finite number gives the default. */
export function clampSplit(percent, viewportWidth) {
  return Number.isFinite(percent) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, percent)) : defaultSplit(viewportWidth);
}

/** Whether the inspector starts open: the stored choice, else by screen width. */
export function initialInspector(prefs, viewportWidth) {
  return typeof prefs.inspector === "boolean" ? prefs.inspector : viewportWidth >= INSPECTOR_OPEN_WIDTH;
}

function readPrefs(storage) {
  try {
    const value = JSON.parse(storage?.getItem(PREFS_KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writePrefs(storage, prefs) {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked: the layout still works, it is just not remembered.
  }
}

/** True while the user is typing in a field, where single-key shortcuts must not fire. */
export function isTyping(target) {
  const node = target instanceof Element ? target : null;
  return Boolean(node && (node.closest("input, textarea, select") || node.isContentEditable));
}

/**
 * Wires the shell. `dom` holds the elements; returns the operations the
 * application uses (open the output panel, reveal the inspector, ...).
 */
export function createShell(dom, storage, { onRunHintDone } = {}) {
  const prefs = readPrefs(storage);
  const save = (changes) => {
    Object.assign(prefs, changes);
    writePrefs(storage, prefs);
  };

  // --- Code | circuit split --------------------------------------------------

  function applySplit(percent) {
    const value = clampSplit(percent, window.innerWidth);
    dom.workspace.style.setProperty("--editor-width", `${value}%`);
    dom.splitter.setAttribute("aria-valuenow", String(Math.round(value)));
    return value;
  }
  let split = applySplit(prefs.split);

  dom.splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dom.splitter.setPointerCapture(event.pointerId);
    dom.splitter.classList.add("is-dragging");
    document.body.classList.add("is-resizing");
    const box = dom.workspace.getBoundingClientRect();
    const move = (e) => {
      split = applySplit(((e.clientX - box.left) / box.width) * 100);
    };
    const up = () => {
      dom.splitter.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing");
      dom.splitter.removeEventListener("pointermove", move);
      dom.splitter.removeEventListener("pointerup", up);
      dom.splitter.removeEventListener("pointercancel", up);
      save({ split });
    };
    dom.splitter.addEventListener("pointermove", move);
    dom.splitter.addEventListener("pointerup", up);
    dom.splitter.addEventListener("pointercancel", up);
  });
  dom.splitter.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 5 : 2;
    const next = { ArrowLeft: split - step, ArrowRight: split + step, Home: SPLIT_MIN, End: SPLIT_MAX }[event.key];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    split = applySplit(next);
    save({ split });
  });
  dom.splitter.addEventListener("dblclick", () => {
    split = applySplit(defaultSplit(window.innerWidth));
    save({ split: undefined });
  });

  // --- Inspector -------------------------------------------------------------

  let inspectorOpen = initialInspector(prefs, window.innerWidth);
  function setInspector(open) {
    inspectorOpen = open;
    dom.simulatorPanel.dataset.inspector = open ? "open" : "closed";
    dom.inspectorToggle.setAttribute("aria-pressed", String(open));
    dom.inspectorToggle.title = open ? "Hide the inspector" : "Show the inspector: selection, live pins, firmware image";
  }
  setInspector(inspectorOpen);
  dom.inspectorToggle.addEventListener("click", () => {
    setInspector(!inspectorOpen);
    save({ inspector: inspectorOpen });
  });

  // Opening the inspector narrows the canvas, so it waits until a press (a drag) is over.
  let pointerDown = false;
  let pendingReveal = false;
  document.addEventListener("pointerdown", () => { pointerDown = true; }, true);
  const released = () => {
    pointerDown = false;
    if (pendingReveal) {
      pendingReveal = false;
      setInspector(true);
    }
  };
  document.addEventListener("pointerup", released, true);
  document.addEventListener("pointercancel", released, true);

  /** Shows the inspector for a new selection, unless the user chose to hide it. */
  function revealInspector() {
    if (inspectorOpen || prefs.inspector === false) {
      return;
    }
    if (pointerDown) {
      pendingReveal = true;
    } else {
      setInspector(true);
    }
  }

  // --- Output panel ----------------------------------------------------------

  let consoleOpen = false;
  function setConsole(open) {
    consoleOpen = open;
    dom.consolePanel.dataset.open = String(open);
    dom.consoleToggle.setAttribute("aria-expanded", String(open));
    dom.consoleToggle.setAttribute("aria-label", open ? "Hide output" : "Show output");
  }
  setConsole(false);
  dom.consoleToggle.addEventListener("click", () => setConsole(!consoleOpen));

  // --- Help ------------------------------------------------------------------

  function setHelp(open) {
    dom.helpPanel.hidden = !open;
    dom.helpButton.setAttribute("aria-expanded", String(open));
    if (open) {
      finishRunHint();
      dom.helpClose.focus();
    }
  }
  dom.helpButton.addEventListener("click", () => setHelp(dom.helpPanel.hidden));
  dom.helpClose.addEventListener("click", () => {
    setHelp(false);
    dom.helpButton.focus();
  });

  // --- First run: a pointer to Run until it has been used once ---------------

  function placeRunHint() {
    if (dom.runHint.hidden) {
      return;
    }
    const button = dom.runButton.getBoundingClientRect();
    const width = dom.runHint.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, button.left + button.width / 2 - 24));
    dom.runHint.style.left = `${left}px`;
    dom.runHint.style.top = `${button.bottom + 10}px`;
    dom.runHint.style.setProperty("--arrow-x", `${button.left + button.width / 2 - left - 6}px`);
  }
  function finishRunHint() {
    if (!dom.runHint.hidden) {
      dom.runHint.hidden = true;
    }
    if (!prefs.ranOnce) {
      save({ ranOnce: true });
      onRunHintDone?.();
    }
  }
  dom.runHint.hidden = Boolean(prefs.ranOnce);
  requestAnimationFrame(placeRunHint);
  window.addEventListener("resize", placeRunHint);

  return {
    get consoleOpen() {
      return consoleOpen;
    },
    get inspectorOpen() {
      return inspectorOpen;
    },
    setConsole,
    setInspector,
    revealInspector,
    setHelp,
    get helpOpen() {
      return !dom.helpPanel.hidden;
    },
    finishRunHint,
    placeRunHint,
  };
}
