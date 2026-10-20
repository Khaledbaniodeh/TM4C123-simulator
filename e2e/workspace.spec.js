/*
 * Browser-visible effects of real execution: the LED in the page must follow
 * PF1 as reported by the Renode GPIO model, for firmware compiled on demand.
 */
import { expect, test } from "@playwright/test";

async function runExample(page, id) {
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(11);
  await page.selectOption("#exampleSelect", id);
  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running");
}

const pinRow = (page, pin) => page.locator(`#pinTable tr[data-pin="${pin}"]`);

test("A: real firmware lights the red LED; Reset MCU turns it off", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#redLed")).not.toHaveClass(/active/);
  await runExample(page, "gpiof-red-led");

  await expect(page.locator("#redLed")).toHaveClass(/active/);
  await expect(pinRow(page, "PF1")).toContainText("HIGH");
  await expect(pinRow(page, "PF1")).toContainText("GPIO output");
  await expect(page.locator("#elfInfo")).toContainText("ELF32 ARM");
  await expect(page.locator("#consoleOutput")).toContainText("SYSCTL: GPIOF clock enabled");

  await page.click("#pauseButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Halted");
  await page.click("#resetButton");
  await expect(page.locator("#redLed")).not.toHaveClass(/active/);
  await expect(pinRow(page, "PF1")).toContainText("FLOATING");

  await page.click("#runButton");
  await expect(page.locator("#redLed")).toHaveClass(/active/);

  await page.screenshot({ path: "test-results/workspace-red-led.png" });
  await page.click("#stopButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Stopped");
});

test("B: identical configuration with DATA low keeps the LED off", async ({ page }) => {
  await runExample(page, "gpiof-led-off");
  await expect(pinRow(page, "PF1")).toContainText("LOW");
  await expect(pinRow(page, "PF1")).toContainText("GPIO output");
  await expect(page.locator("#redLed")).not.toHaveClass(/active/);
  await page.click("#stopButton");
});

test("D: holding SW1 lights the LED through polling firmware", async ({ page }) => {
  await runExample(page, "sw1-red-led");
  await expect(pinRow(page, "PF4")).toContainText("internal pull-up");
  await expect(page.locator("#redLed")).not.toHaveClass(/active/);

  const sw1 = page.locator("#sw1Button");
  await sw1.hover();
  await page.mouse.down();
  await expect(pinRow(page, "PF4")).toContainText("LOW");
  await expect(page.locator("#redLed")).toHaveClass(/active/);
  await page.screenshot({ path: "test-results/workspace-sw1-pressed.png" });
  await page.mouse.up();
  await expect(page.locator("#redLed")).not.toHaveClass(/active/);
  await page.click("#stopButton");
});

test("edited source invalidates the build, and compile errors are reported", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(11);
  await page.click("#compileButton");
  await expect(page.locator("#editorStatus")).toHaveText("Built");

  await page.locator("#codeEditor").press("End");
  await page.locator("#codeEditor").type(" this is not C");
  await expect(page.locator("#editorStatus")).toHaveText("Changed since build");

  await page.click("#runButton");
  await expect(page.locator("#problemCount")).not.toHaveText("0");
  await expect(page.locator("#problemsOutput")).toContainText("error");
  await expect(page.locator("#simulationStatus")).toHaveText("No firmware running");
  await expect(page.locator("#redLed")).not.toHaveClass(/active/);
});
