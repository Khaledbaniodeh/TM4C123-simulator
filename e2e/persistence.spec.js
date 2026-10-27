/*
 * The student's work survives reloads and example switches: the edited
 * main.c and the circuit are restored exactly from this browser's storage,
 * an example switch asks before replacing edits (Cancel changes nothing),
 * untouched examples switch without asking, and missing, full, or corrupt
 * storage is reported honestly instead of pretending the work was saved.
 */
import { expect, test } from "@playwright/test";

const DIAGRAM_KEY = "tm4c123-simulator:diagram-draft";
const SOURCE_KEY = "tm4c123-simulator:source-draft";

async function open(page, size = { width: 1280, height: 720 }) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(size);
  await page.goto("/");
  await ready(page);
  return errors;
}

async function ready(page) {
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();
  await expect(page.locator("#exampleSummary")).not.toBeEmpty();
}

async function reload(page) {
  await page.reload();
  await ready(page);
}

const exampleSource = (page, id) => page.evaluate(async (exampleId) => {
  const { examples } = await (await fetch("/api/examples")).json();
  return examples.find((e) => e.id === exampleId).source;
}, id);
const circuit = (page) => page.evaluate(() => window.__tm4c.serialize());
const source = (page) => page.inputValue("#codeEditor");

async function addLedAndWire(page) {
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  await page.locator('.pin-anchor[data-part="board1"][data-pin="J1.10"]').click();
  await page.locator('.pin-anchor[data-part="led1"][data-pin="A"]').click();
  await expect(page.locator('.wire[data-from="board1:J1.10"][data-to="led1:A"]')).toHaveCount(1);
}

/** Fails the test if any dialog opens. */
function forbidDialogs(page) {
  const seen = [];
  page.on("dialog", (dialog) => {
    seen.push(dialog.message());
    dialog.dismiss();
  });
  return seen;
}

test("edited main.c survives a reload exactly, then builds and runs", async ({ page }) => {
  const errors = await open(page);
  const original = await source(page);
  const edited = original.replace("int main(void)", "/* student edit: é ✓\ttab */\nint main(void)");
  expect(edited).not.toBe(original);
  await page.fill("#codeEditor", edited);
  await expect(page.locator("#draftStatus")).toHaveText("Saved in this browser");

  await reload(page);
  expect(await source(page)).toBe(edited);
  await expect(page.locator("#exampleSelect")).toHaveValue("gpiof-red-led");
  await expect(page.locator("#workspaceMessage")).toContainText("Restored your main.c from this browser");
  await expect(page.locator("#consoleOutput")).toContainText("Restored your edited main.c");
  await expect(page.locator("#editorStatus")).toHaveText("Not built");
  await expect(page.locator("#draftStatus")).toHaveText("Saved in this browser");
  await page.screenshot({ path: "test-results/persistence-restored-1280x720.png" });

  // The restored source is what gets compiled and run.
  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running", { timeout: 60_000 });
  await expect(page.locator("#editorStatus")).toHaveText("Built");
  await expect(page.locator("#redLed")).toHaveClass(/active/);
  await page.click("#stopButton");
  expect(errors).toEqual([]);
});

test("an edited circuit survives a reload exactly; undo history starts fresh", async ({ page }) => {
  const errors = await open(page);
  await addLedAndWire(page);
  await page.locator("#circuitCanvas").press("Escape");
  const before = await circuit(page);

  await reload(page);
  expect(await circuit(page)).toBe(before);
  await expect(page.locator("#workspaceMessage")).toContainText("Restored your circuit from this browser");
  expect(await source(page)).toBe(await exampleSource(page, "gpiof-red-led"));
  await expect(page.locator("#undoButton")).toBeDisabled(); // history is per page session (documented)

  // Editing continues normally, with undo/redo.
  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "led1" }));
  await page.locator("#circuitCanvas").press("r");
  await expect(page.locator('.part[data-part="led1"]')).toHaveAttribute("transform", /rotate\(90/);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await circuit(page)).toBe(before);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator('.part[data-part="led1"]')).toHaveAttribute("transform", /rotate\(90/);
  expect(errors).toEqual([]);
});

test("code and circuit of an example with its own circuit restore together", async ({ page }) => {
  const dialogs = forbidDialogs(page);
  const errors = await open(page);
  await page.selectOption("#exampleSelect", "external-led-button");
  await expect(page.locator('.part[data-part="btn1"]')).toHaveCount(1);
  await page.fill("#codeEditor", `${await source(page)}\n/* my change */\n`);
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="resistor"]').click();
  const code = await source(page);
  const wiring = await circuit(page);

  await reload(page);
  await expect(page.locator("#exampleSelect")).toHaveValue("external-led-button");
  expect(await source(page)).toBe(code);
  expect(await circuit(page)).toBe(wiring);
  await expect(page.locator("#workspaceMessage")).toContainText("Restored your main.c and circuit");
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test("switching examples with edits asks first; Cancel changes nothing", async ({ page }) => {
  const errors = await open(page);
  await page.selectOption("#exampleSelect", "external-led-button");
  await page.fill("#codeEditor", `${await source(page)}\n/* keep me */\n`);
  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "led1" }));
  await page.locator("#circuitCanvas").press("r");
  const code = await source(page);
  const wiring = await circuit(page);

  const messages = [];
  page.once("dialog", (dialog) => {
    messages.push(dialog.message());
    dialog.dismiss();
  });
  await page.selectOption("#exampleSelect", "lcd1602-hello");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('Load example "L');
  expect(messages[0]).toContain("your edited main.c and circuit");
  await expect(page.locator("#exampleSelect")).toHaveValue("external-led-button");
  expect(await source(page)).toBe(code);
  expect(await circuit(page)).toBe(wiring);
  await expect(page.locator('.part[data-part="lcd1"]')).toHaveCount(0);

  // Undo history is intact: the rotation can still be undone.
  await expect(page.locator("#undoButton")).toBeEnabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('.part[data-part="led1"]')).not.toHaveAttribute("transform", /rotate/);

  // Only code edited now: the message names only the code.
  page.once("dialog", (dialog) => {
    messages.push(dialog.message());
    dialog.dismiss();
  });
  await page.selectOption("#exampleSelect", "systick-blink");
  expect(messages[1]).toContain("your edited main.c with");
  expect(errors).toEqual([]);
});

test("confirming loads the example's own code and circuit; circuit-less examples get the bare board", async ({ page }) => {
  const errors = await open(page);
  await page.selectOption("#exampleSelect", "external-led-button");
  await page.fill("#codeEditor", "/* replaced */\n");
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="pushbutton"]').click();

  page.once("dialog", (dialog) => dialog.accept());
  await page.selectOption("#exampleSelect", "lcd1602-hello");
  await expect(page.locator("#exampleSelect")).toHaveValue("lcd1602-hello");
  expect(await source(page)).toBe(await exampleSource(page, "lcd1602-hello"));
  await expect(page.locator('.part[data-part="lcd1"]')).toHaveCount(1);
  await expect(page.locator('.part[data-type="pushbutton"]')).toHaveCount(0);
  await expect(page.locator("#undoButton")).toBeDisabled();

  // Untouched now: a reload restores the example quietly, and switching does not ask.
  const dialogs = forbidDialogs(page);
  await reload(page);
  await expect(page.locator("#exampleSelect")).toHaveValue("lcd1602-hello");
  await expect(page.locator("#workspaceMessage")).not.toContainText("Restored");
  await page.selectOption("#exampleSelect", "gpiof-blink");
  expect(await source(page)).toBe(await exampleSource(page, "gpiof-blink"));
  await expect(page.locator(".part")).toHaveCount(1); // only the LaunchPad: no LCD left behind
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test("unedited examples switch without asking, also after an edit is undone", async ({ page }) => {
  const dialogs = forbidDialogs(page);
  const errors = await open(page);
  for (const id of ["external-led-button", "lcd1602-hello", "adc-potentiometer", "gpiof-red-led"]) {
    await page.selectOption("#exampleSelect", id);
    await expect(page.locator("#exampleSelect")).toHaveValue(id);
    expect(await source(page)).toBe(await exampleSource(page, id));
  }
  await addLedAndWire(page);
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Undo", exact: true }).click();
  }
  await page.fill("#codeEditor", `${await source(page)} `);
  await page.fill("#codeEditor", await exampleSource(page, "gpiof-red-led"));
  await page.selectOption("#exampleSelect", "systick-blink");
  await expect(page.locator("#exampleSelect")).toHaveValue("systick-blink");
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test("unavailable storage: the page works and says the work is not saved", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("storage disabled", "SecurityError");
      },
    });
  });
  const errors = await open(page, { width: 1024, height: 768 });
  await expect(page.locator("#draftStatus")).toHaveText("Not saved: browser storage unavailable");
  await expect(page.locator("#draftStatus")).toHaveAttribute("title", /will be lost on reload/);
  await expect(page.locator("#consoleOutput")).toContainText("Browser storage is unavailable");
  await page.fill("#codeEditor", "/* edit */\n");
  await expect(page.locator("#draftStatus")).toHaveText("Not saved: browser storage unavailable");
  await page.screenshot({ path: "test-results/persistence-unavailable-1024x768.png" });
  // Switching still protects the unsaved edit.
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.selectOption("#exampleSelect", "systick-blink");
  expect(await source(page)).toBe("/* edit */\n");
  expect(errors).toEqual([]);
});

test("full storage: a refused write is reported, never shown as saved", async ({ page }) => {
  await page.addInitScript((key) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      }
      return setItem.call(this, name, value);
    };
  }, SOURCE_KEY);
  const errors = await open(page);
  await expect(page.locator("#draftStatus")).toHaveText("Not saved: browser storage full or blocked");
  await expect(page.locator("#consoleOutput")).toContainText("QuotaExceededError");
  await addLedAndWire(page); // the circuit draft still saves, but the status stays honest
  await expect(page.locator("#draftStatus")).toHaveText("Not saved: browser storage full or blocked");
  expect(errors).toEqual([]);
});

test("corrupt drafts are set aside, reported, and the example is shown", async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(([diagramKey, sourceKey]) => {
    localStorage.setItem(diagramKey, "{ not json");
    localStorage.setItem(sourceKey, "also not json");
  }, [DIAGRAM_KEY, SOURCE_KEY]);
  await reload(page);
  await expect(page.locator("#consoleOutput")).toContainText("could not be read; it was set aside");
  await expect(page.locator(".part")).toHaveCount(1);
  expect(await source(page)).toBe(await exampleSource(page, "gpiof-red-led"));
  const aside = await page.evaluate(([diagramKey, sourceKey]) => [
    localStorage.getItem(`${diagramKey}:unreadable`),
    localStorage.getItem(`${sourceKey}:unreadable`),
  ], [DIAGRAM_KEY, SOURCE_KEY]);
  expect(aside).toEqual(["{ not json", "also not json"]);
  await expect(page.locator("#draftStatus")).toHaveText("Saved in this browser");
  expect(errors).toEqual([]);
});

test("a circuit draft saved before source drafts existed still restores", async ({ page }) => {
  const errors = await open(page);
  await addLedAndWire(page);
  const legacy = await circuit(page);
  // Exactly what the previous version stored: the circuit only.
  await page.evaluate(([diagramKey, text]) => {
    localStorage.clear();
    localStorage.setItem(diagramKey, text);
  }, [DIAGRAM_KEY, legacy]);
  await reload(page);
  expect(await circuit(page)).toBe(legacy);
  await expect(page.locator("#exampleSelect")).toHaveValue("gpiof-red-led");
  expect(await source(page)).toBe(await exampleSource(page, "gpiof-red-led"));
  await expect(page.locator("#workspaceMessage")).toContainText("Restored your circuit");

  // The restored circuit counts as an edit: switching asks.
  const messages = [];
  page.once("dialog", (dialog) => {
    messages.push(dialog.message());
    dialog.dismiss();
  });
  await page.selectOption("#exampleSelect", "systick-blink");
  expect(messages[0]).toContain("your circuit changes");
  expect(await circuit(page)).toBe(legacy);
  expect(errors).toEqual([]);
});

for (const size of [{ width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  test(`draft status fits the firmware header at ${size.width}x${size.height}`, async ({ page }) => {
    await open(page, size);
    await expect(page.locator("#draftStatus")).toHaveText("Saved in this browser");
    const fit = await page.evaluate(() => {
      const header = document.querySelector(".editor-panel .pane-header").getBoundingClientRect();
      const status = document.querySelector("#draftStatus").getBoundingClientRect();
      const badge = document.querySelector("#editorStatus").getBoundingClientRect();
      return {
        inside: status.left >= header.left && status.right <= header.right && status.top >= header.top && status.bottom <= header.bottom,
        oneLine: status.height < 20,
        clearOfBadge: status.left >= badge.right,
        headerHeight: Math.round(header.height),
      };
    });
    console.log(`::notice title=draft status ${size.width}x${size.height}::${JSON.stringify(fit)}`);
    expect(fit).toEqual({ inside: true, oneLine: true, clearOfBadge: true, headerHeight: fit.headerHeight });
    expect(fit.headerHeight).toBeLessThanOrEqual(64);
    await page.locator(".editor-panel .pane-header").screenshot({ path: `test-results/persistence-status-${size.width}x${size.height}.png` });
  });
}
