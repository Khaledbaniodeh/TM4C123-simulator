"use strict";

/*
 * TM4C123 Educational Web Simulator
 * Visual UI Prototype
 *
 * Important:
 * This file does not compile or execute real Cortex-M4 firmware.
 * It only demonstrates the intended browser workflow.
 */

const files = {
  main: `/*
 * TM4C123 Educational Web Simulator
 * Reference firmware example
 *
 * Turn on the built-in red LED connected to PF1.
 */

#include <stdint.h>

#define REG32(address) (*((volatile uint32_t *)(address)))

#define SYSCTL_RCGCGPIO_R REG32(0x400FE608u)
#define SYSCTL_PRGPIO_R   REG32(0x400FEA08u)

#define GPIO_PORTF_DATA_R  REG32(0x400253FCu)
#define GPIO_PORTF_DIR_R   REG32(0x40025400u)
#define GPIO_PORTF_AFSEL_R REG32(0x40025420u)
#define GPIO_PORTF_DEN_R   REG32(0x4002551Cu)
#define GPIO_PORTF_AMSEL_R REG32(0x40025528u)
#define GPIO_PORTF_PCTL_R  REG32(0x4002552Cu)

#define PF1_RED_LED (1u << 1)

int main(void)
{
    SYSCTL_RCGCGPIO_R |= (1u << 5);

    while ((SYSCTL_PRGPIO_R & (1u << 5)) == 0u)
    {
    }

    GPIO_PORTF_AFSEL_R &= ~PF1_RED_LED;
    GPIO_PORTF_PCTL_R  &= ~(0xFu << 4);
    GPIO_PORTF_AMSEL_R &= ~PF1_RED_LED;
    GPIO_PORTF_DIR_R   |= PF1_RED_LED;
    GPIO_PORTF_DEN_R   |= PF1_RED_LED;

    GPIO_PORTF_DATA_R |= PF1_RED_LED;

    while (1)
    {
    }
}`,

  diagram: `{
  "version": 1,
  "author": "TM4C123 Educational Web Simulator",
  "parts": [
    {
      "id": "launchpad1",
      "type": "board-tm4c123g",
      "top": 120,
      "left": 250,
      "attrs": {}
    }
  ],
  "connections": []
}`,

  project: `{
  "name": "GPIOF Red LED",
  "board": "tm4c123g-launchpad",
  "entry": "main.c",
  "toolchain": "arm-none-eabi-gcc",
  "status": "prototype"
}`
};

const state = {
  activeFile: "main",
  running: false,
  compiled: false,
  zoom: 100,
  virtualTime: 0,
  timerId: null
};

const elements = {
  compileButton: document.querySelector("#compileButton"),
  runButton: document.querySelector("#runButton"),
  stopButton: document.querySelector("#stopButton"),
  resetButton: document.querySelector("#resetButton"),

  editor: document.querySelector("#codeEditor"),
  lineNumbers: document.querySelector("#lineNumbers"),
  cursorPosition: document.querySelector("#cursorPosition"),
  editorStatus: document.querySelector("#editorStatus"),

  fileTabs: document.querySelectorAll(".file-tab"),

  simulationStatus: document.querySelector("#simulationStatus"),
  stateIndicator: document.querySelector("#stateIndicator"),
  virtualTime: document.querySelector("#virtualTime"),
  footerStatus: document.querySelector("#footerStatus"),

  redLed: document.querySelector("#redLed"),
  blueLed: document.querySelector("#blueLed"),
  greenLed: document.querySelector("#greenLed"),

  sw1Button: document.querySelector("#sw1Button"),
  sw2Button: document.querySelector("#sw2Button"),

  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  fitButton: document.querySelector("#fitButton"),
  zoomValue: document.querySelector("#zoomValue"),
  launchpadBoard: document.querySelector("#launchpadBoard"),

  consoleOutput: document.querySelector("#consoleOutput"),
  clearConsoleButton: document.querySelector("#clearConsoleButton")
};

function getCurrentTimestamp() {
  const now = new Date();

  return now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function logMessage(message, level = "info") {
  const line = document.createElement("div");
  line.className = "console-line";

  const timestamp = document.createElement("span");
  timestamp.className = "console-time";
  timestamp.textContent = getCurrentTimestamp();

  const messageLevel = document.createElement("span");
  messageLevel.className = `console-level ${level}`;
  messageLevel.textContent = level.toUpperCase();

  const text = document.createElement("span");
  text.textContent = message;

  line.append(timestamp, messageLevel, text);

  elements.consoleOutput.appendChild(line);
  elements.consoleOutput.scrollTop =
    elements.consoleOutput.scrollHeight;
}

function updateLineNumbers() {
  const lineCount = elements.editor.value.split("\n").length;

  elements.lineNumbers.textContent = Array.from(
    { length: lineCount },
    (_, index) => index + 1
  ).join("\n");
}

function updateCursorPosition() {
  const cursorIndex = elements.editor.selectionStart;
  const textBeforeCursor =
    elements.editor.value.substring(0, cursorIndex);

  const lines = textBeforeCursor.split("\n");
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;

  elements.cursorPosition.textContent =
    `Ln ${line}, Col ${column}`;
}

function updateSimulationStatus(status) {
  elements.simulationStatus.textContent = status;
  elements.footerStatus.textContent = status;

  elements.stateIndicator.classList.remove(
    "stopped",
    "running",
    "compiling"
  );

  if (status === "Running") {
    elements.stateIndicator.classList.add("running");
    return;
  }

  if (status === "Compiling") {
    elements.stateIndicator.classList.add("compiling");
    return;
  }

  elements.stateIndicator.classList.add("stopped");
}

function setLedState(led, enabled) {
  led.classList.toggle("active", enabled);
}

function stopVirtualClock() {
  if (state.timerId !== null) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function startVirtualClock() {
  stopVirtualClock();

  state.timerId = window.setInterval(() => {
    state.virtualTime += 10;
    elements.virtualTime.textContent =
      `${state.virtualTime} ms`;
  }, 100);
}

function loadFile(fileName) {
  files[state.activeFile] = elements.editor.value;
  state.activeFile = fileName;

  elements.editor.value = files[fileName];
  elements.editorStatus.textContent = "Saved";

  elements.fileTabs.forEach((tab) => {
    tab.classList.toggle(
      "active",
      tab.dataset.tab === fileName
    );
  });

  updateLineNumbers();
  updateCursorPosition();

  logMessage(`Opened ${fileName}.`, "info");
}

function compilePrototype() {
  if (state.running) {
    logMessage(
      "Stop the simulation before compiling.",
      "warning"
    );

    return;
  }

  updateSimulationStatus("Compiling");
  elements.compileButton.disabled = true;
  elements.runButton.disabled = true;

  logMessage(
    "Starting prototype firmware build...",
    "info"
  );

  logMessage(
    "Toolchain target: ARM Cortex-M4.",
    "info"
  );

  window.setTimeout(() => {
    const source = files.main;

    if (!source.includes("int main")) {
      state.compiled = false;

      logMessage(
        "Compilation failed: main() was not found.",
        "error"
      );

      updateSimulationStatus("Build Failed");
      elements.compileButton.disabled = false;
      elements.runButton.disabled = false;

      return;
    }

    state.compiled = true;

    logMessage(
      "Source validation completed.",
      "success"
    );

    logMessage(
      "Prototype ELF artifact created.",
      "success"
    );

    logMessage(
      "Important: this is simulated UI feedback; no real compiler is connected.",
      "warning"
    );

    updateSimulationStatus("Ready");
    elements.compileButton.disabled = false;
    elements.runButton.disabled = false;
  }, 900);
}

function runPrototype() {
  if (state.running) {
    return;
  }

  if (!state.compiled) {
    logMessage(
      "No build artifact found. Running prototype auto-build.",
      "warning"
    );

    compilePrototype();

    window.setTimeout(() => {
      if (state.compiled) {
        runPrototype();
      }
    }, 1100);

    return;
  }

  state.running = true;

  elements.runButton.disabled = true;
  elements.compileButton.disabled = true;
  elements.stopButton.disabled = false;

  updateSimulationStatus("Running");
  startVirtualClock();

  logMessage(
    "Simulation session started.",
    "success"
  );

  logMessage(
    "Reset handler entered at virtual address 0x00000000.",
    "info"
  );

  window.setTimeout(() => {
    if (!state.running) {
      return;
    }

    logMessage(
      "SYSCTL_RCGCGPIO: GPIO Port F clock enabled.",
      "info"
    );
  }, 350);

  window.setTimeout(() => {
    if (!state.running) {
      return;
    }

    logMessage(
      "GPIOF_DIR: PF1 configured as output.",
      "info"
    );
  }, 650);

  window.setTimeout(() => {
    if (!state.running) {
      return;
    }

    logMessage(
      "GPIOF_DEN: PF1 digital function enabled.",
      "info"
    );
  }, 950);

  window.setTimeout(() => {
    if (!state.running) {
      return;
    }

    const source = files.main;

    if (
      source.includes("GPIO_PORTF_DATA_R") &&
      source.includes("PF1_RED_LED")
    ) {
      setLedState(elements.redLed, true);

      logMessage(
        "GPIOF_DATA: PF1 became HIGH.",
        "success"
      );

      logMessage(
        "Browser event: built-in red LED is ON.",
        "success"
      );
    } else {
      logMessage(
        "PF1 output command was not detected in the prototype source.",
        "warning"
      );
    }
  }, 1250);
}

function stopPrototype() {
  if (!state.running) {
    return;
  }

  state.running = false;

  stopVirtualClock();

  elements.runButton.disabled = false;
  elements.compileButton.disabled = false;
  elements.stopButton.disabled = true;

  updateSimulationStatus("Stopped");

  logMessage(
    `Simulation stopped at virtual time ${state.virtualTime} ms.`,
    "warning"
  );
}

function resetPrototype() {
  stopVirtualClock();

  state.running = false;
  state.virtualTime = 0;

  elements.virtualTime.textContent = "0 ms";

  setLedState(elements.redLed, false);
  setLedState(elements.blueLed, false);
  setLedState(elements.greenLed, false);

  elements.runButton.disabled = false;
  elements.compileButton.disabled = false;
  elements.stopButton.disabled = true;

  updateSimulationStatus("Ready");

  logMessage(
    "Board and peripheral state reset.",
    "info"
  );
}

function pressBoardButton(buttonName, pinName, element) {
  element.classList.add("pressed");

  logMessage(
    `${buttonName} pressed: ${pinName} = LOW.`,
    "info"
  );
}

function releaseBoardButton(buttonName, pinName, element) {
  element.classList.remove("pressed");

  logMessage(
    `${buttonName} released: ${pinName} = HIGH.`,
    "info"
  );
}

function updateZoom(newZoom) {
  state.zoom = Math.max(65, Math.min(135, newZoom));

  elements.zoomValue.textContent = `${state.zoom}%`;

  const scale = state.zoom / 100;

  elements.launchpadBoard.style.transform =
    `translate(-50%, -50%) scale(${scale})`;
}

elements.fileTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    loadFile(tab.dataset.tab);
  });
});

elements.editor.addEventListener("input", () => {
  files[state.activeFile] = elements.editor.value;
  elements.editorStatus.textContent = "Modified";

  updateLineNumbers();
  updateCursorPosition();
});

elements.editor.addEventListener(
  "click",
  updateCursorPosition
);

elements.editor.addEventListener(
  "keyup",
  updateCursorPosition
);

elements.editor.addEventListener("scroll", () => {
  elements.lineNumbers.scrollTop =
    elements.editor.scrollTop;
});

elements.compileButton.addEventListener(
  "click",
  compilePrototype
);

elements.runButton.addEventListener(
  "click",
  runPrototype
);

elements.stopButton.addEventListener(
  "click",
  stopPrototype
);

elements.resetButton.addEventListener(
  "click",
  resetPrototype
);

elements.clearConsoleButton.addEventListener(
  "click",
  () => {
    elements.consoleOutput.textContent = "";
  }
);

elements.zoomInButton.addEventListener(
  "click",
  () => updateZoom(state.zoom + 10)
);

elements.zoomOutButton.addEventListener(
  "click",
  () => updateZoom(state.zoom - 10)
);

elements.fitButton.addEventListener(
  "click",
  () => updateZoom(100)
);

elements.sw1Button.addEventListener(
  "mousedown",
  () => pressBoardButton(
    "SW1",
    "PF4",
    elements.sw1Button
  )
);

elements.sw1Button.addEventListener(
  "mouseup",
  () => releaseBoardButton(
    "SW1",
    "PF4",
    elements.sw1Button
  )
);

elements.sw1Button.addEventListener(
  "mouseleave",
  () => {
    elements.sw1Button.classList.remove("pressed");
  }
);

elements.sw2Button.addEventListener(
  "mousedown",
  () => pressBoardButton(
    "SW2",
    "PF0",
    elements.sw2Button
  )
);

elements.sw2Button.addEventListener(
  "mouseup",
  () => releaseBoardButton(
    "SW2",
    "PF0",
    elements.sw2Button
  )
);

elements.sw2Button.addEventListener(
  "mouseleave",
  () => {
    elements.sw2Button.classList.remove("pressed");
  }
);

elements.editor.value = files.main;

updateLineNumbers();
updateCursorPosition();
updateSimulationStatus("Ready");

logMessage(
  "TM4C123 visual simulator prototype loaded.",
  "success"
);

logMessage(
  "Open main.c, select Compile, then select Run.",
  "info"
);

logMessage(
  "No real compiler or execution engine is connected yet.",
  "warning"
);
