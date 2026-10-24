/*
 * UX review walkthrough (verification branch only, not for merge): drives a
 * student's first session through the real UI and captures a screenshot per
 * step, plus GitHub notices for behaviour the review needs to know about
 * (keyboard reachability, what survives an example switch or a reload).
 * Findings are recorded, not asserted; only the flow itself must work.
 */
import { expect, test } from "@playwright/test";

const anchor = (page, partId, pin) => page.locator(`.pin-anchor[data-part="${partId}"][data-pin="${pin}"]`);
const shot = (page, name) => page.screenshot({ path: `test-results/review-${name}.png` });
const notice = (title, value) => console.log(`::notice title=review ${title}::${typeof value === "string" ? value : JSON.stringify(value)}`);

async function open(page, size) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();
  return errors;
}

for (const size of [{ width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  test(`first open at ${size.width}x${size.height}`, async ({ page }) => {
    const errors = await open(page, size);
    await shot(page, `01-first-open-${size.width}x${size.height}`);
    expect(errors).toEqual([]);
  });
}

test("edit a circuit: library, add, select, wire, inspect", async ({ page }) => {
  const errors = await open(page, { width: 1280, height: 720 });
  await page.getByRole("button", { name: /Part/ }).click();
  await expect(page.locator("#partLibrary")).toBeVisible();
  await shot(page, "02-library-open");
  await page.locator('.library-item[data-type="led"]').click();
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  await shot(page, "03-part-added-selected");

  await anchor(page, "board1", "J1.10").click();
  await page.mouse.move(700, 560, { steps: 4 });
  await shot(page, "04-wire-draft");
  await anchor(page, "led1", "A").click();
  await expect(page.locator('.wire[data-from="board1:J1.10"][data-to="led1:A"]')).toHaveCount(1);
  await shot(page, "05-wire-selected"); // a finished wire is selected automatically

  // Keyboard reachability of the whole toolbar: Tab from Part through every focusable control.
  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "led1" }));
  await page.locator("#addPartButton").focus();
  const order = ["addPartButton"];
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => {
      const el = document.activeElement;
      return el.id || el.getAttribute("aria-label") || el.textContent.trim().slice(0, 12) || el.tagName;
    });
    order.push(id);
    if (!(await page.evaluate(() => Boolean(document.activeElement.closest(".simulator-toolbar"))))) {
      break;
    }
  }
  notice("toolbar tab order", order.join(" > "));
  expect(errors).toEqual([]);
});

test("build errors, run, pause, stop, console and events", async ({ page }) => {
  const errors = await open(page, { width: 1280, height: 720 });
  const source = await page.inputValue("#codeEditor");
  await page.fill("#codeEditor", source.replace(/int\s+main\s*\(\s*void\s*\)\s*\{/, "int main(void)\n{\n    undeclared_symbol = 1"));
  await page.click("#compileButton");
  await expect(page.locator("#problemCount")).not.toHaveText("0", { timeout: 60_000 });
  await shot(page, "06-build-error-console");
  await page.getByRole("tab", { name: /Problems/ }).click();
  await shot(page, "07-build-error-problems");
  await page.getByRole("tab", { name: /Console/ }).click();

  await page.fill("#codeEditor", source);
  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running", { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot(page, "08-running");
  await page.click("#pauseButton");
  await expect(page.locator("#simulationStatus")).not.toHaveText("Running");
  // Halted: the Run button offers Resume, and Pause, with nothing to pause, is disabled.
  await expect(page.locator("#simulationStatus")).toHaveText("Halted");
  await expect(page.locator("#pauseButton")).toBeDisabled();
  await expect(page.locator("#runButton")).toBeEnabled();
  await expect(page.locator("#runButton")).toHaveText("▶ Resume");
  notice("paused status", await page.locator("#simulationStatus").textContent());
  await shot(page, "09-paused");
  await page.click("#stopButton");
  await expect(page.locator("#simulationStatus")).not.toHaveText(/Running|Halted/);
  notice("stopped status", await page.locator("#simulationStatus").textContent());
  await shot(page, "10-stopped");

  await page.selectOption("#exampleSelect", "lcd1602-hello");
  await page.click("#runButton");
  await expect(page.locator('.part[data-part="lcd1"] .part-lcd')).toHaveAttribute("data-row0", "Hello, TM4C123! ", { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const consoleLines = await page.locator("#consoleOutput > *").count();
  const gpioLines = await page.locator("#consoleOutput > *", { hasText: "(GPIO output)" }).count();
  notice("console lines while LCD runs", { consoleLines, gpioLines, events: await page.locator("#eventCount").textContent() });
  await page.getByRole("tab", { name: /Events/ }).click();
  await shot(page, "11-events-tab");
  await page.click("#stopButton");
  expect(errors).toEqual([]);
});

test("recovery: invalid diagram, example switch, reload", async ({ page }) => {
  const errors = await open(page, { width: 1280, height: 720 });
  await page.evaluate(() => window.__tm4c.load("{ not json"));
  await shot(page, "12-invalid-diagram");

  // Work in progress: an added part and an edited source line.
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  const edited = `${await page.inputValue("#codeEditor")}\n/* my edit */\n`;
  await page.fill("#codeEditor", edited);

  // Switching to an example without its own circuit, then one with a circuit.
  await page.selectOption("#exampleSelect", "gpiof-blink");
  const afterPlainSwitch = {
    codeKept: (await page.inputValue("#codeEditor")).includes("/* my edit */"),
    partKept: await page.locator('.part[data-part="led1"]').count() === 1,
    undoEnabled: await page.locator("#undoButton").isEnabled(),
  };
  notice("switch to example without circuit", afterPlainSwitch);
  await page.selectOption("#exampleSelect", "external-led-button");
  notice("switch to example with circuit", {
    userLedReplaced: await page.locator('.part[data-type="led"]').count(),
    undoEnabled: await page.locator("#undoButton").isEnabled(),
  });

  // Reload: what is restored?
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="pushbutton"]').click();
  const partsBefore = await page.locator(".part").count();
  await page.fill("#codeEditor", "/* reload test */\n");
  await page.reload();
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();
  notice("after reload", {
    partsBefore,
    partsAfter: await page.locator(".part").count(),
    codeKept: (await page.inputValue("#codeEditor")).includes("reload test"),
    example: await page.inputValue("#exampleSelect"),
  });
  await shot(page, "13-after-reload");
  expect(errors).toEqual([]);
});
