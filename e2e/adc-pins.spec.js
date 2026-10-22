/*
 * ADC pin presentation: in the potentiometer example, PE3 (AIN0) shows the
 * wiper voltage from the circuit model, before a run ("on Run") and while the
 * real firmware runs (applied to the simulated ADC), instead of only the
 * digital buffer's FLOATING / not driven. Pin table and board pin tooltip say
 * the same; a broken supply wire shows "NO SOURCE"; digital pins are unchanged.
 */
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

async function open(page, size = { width: 1280, height: 720 }) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await page.selectOption("#exampleSelect", "adc-potentiometer");
  await expect(page.locator('.part[data-part="pot1"]')).toHaveCount(1);
  return errors;
}

const row = (page, pin) => page.locator(`#pinTable tr[data-pin="${pin}"]`);
const cells = (page, pin) => row(page, pin).locator("td").allTextContents();
async function tooltip(page, pin) {
  await page.mouse.move(0, 0);
  await page.locator(`.pin-anchor[data-part="board1"][data-pin="${pin}"]`).hover();
  const [header, number] = pin.split(".");
  await expect(page.locator("#pinTooltip")).toContainText(`${header} pin ${number} `); // this pin's tooltip, not a stale one
  return page.locator("#pinTooltip").textContent();
}

test("PE3 shows the AIN0 source before and during a real run; table and tooltip agree", async ({ page }) => {
  const errors = await open(page);

  // Before running: the modeled voltage, marked as applied on Run; nothing claims the simulator has it.
  expect(await cells(page, "PE3")).toEqual(["PE3", "J3.9 (wired)", "1.650 V", "pot1 → AIN0 (on Run)"]);
  await expect(row(page, "PE3")).toHaveClass("pin-analog");
  let tip = await tooltip(page, "J3.9");
  expect(tip).toContain("Analog: 1.650 V from pot1 on AIN0 (circuit model, ideal divider), applied when the simulation runs");
  expect(tip).toContain("Simulation: not running");
  await expect(row(page, "PF1")).toContainText("—"); // digital pins: no state before a run

  // Running the compiled firmware: applied to the simulated ADC (50 % -> code 2048 -> blue LED).
  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running", { timeout: 60_000 });
  await expect(row(page, "PF2")).toContainText("HIGH", { timeout: 30_000 });
  expect(await cells(page, "PE3")).toEqual(["PE3", "J3.9 (wired)", "1.650 V", "pot1 → AIN0"]);
  tip = await tooltip(page, "J3.9");
  expect(tip).toContain("Analog: 1.650 V from pot1 on AIN0 (circuit model, ideal divider), applied to the simulated ADC");
  expect(tip).toMatch(/Digital \(GPIO model\): \w+/); // the digital view is still there, labelled as such
  expect(tip).not.toContain("Simulation: FLOATING");
  // Digital pins keep their GPIO reporting.
  expect(await cells(page, "PF2")).toEqual(["PF2", "Blue LED", "HIGH", "GPIO output"]);
  expect(await tooltip(page, "J3.10")).not.toContain("Analog:"); // PF1: no ADC input

  // Turning the knob updates the voltage, the table, and the firmware's LED choice.
  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "pot1" }));
  await page.locator("#potPosition").fill("95");
  await expect(row(page, "PE3")).toContainText("3.135 V");
  await expect(row(page, "PF1")).toContainText("HIGH", { timeout: 30_000 });
  expect(await tooltip(page, "J3.9")).toContain("Analog: 3.135 V from pot1 on AIN0");
  await page.click("#stopButton");
  expect(errors).toEqual([]);
});

test("a broken supply wire shows NO SOURCE; removing the wiper wire returns to digital reporting", async ({ page }) => {
  const errors = await open(page);
  const gndWire = await page.evaluate(() => window.__tm4c.diagram.connections.findIndex((c) => c.includes("pot1:GND")));
  expect(gndWire).toBeGreaterThanOrEqual(0);
  await page.evaluate((index) => window.__tm4c.workspace.select({ kind: "wire", index }), gndWire);
  await page.locator("#circuitCanvas").press("Delete");
  expect(await cells(page, "PE3")).toEqual(["PE3", "J3.9 (wired)", "NO SOURCE", "pot1 → AIN0, VCC/GND open"]);
  expect(await tooltip(page, "J3.9")).toContain("Analog: pot1 drives AIN0, but its VCC/GND are not wired to supply pins, so no voltage is applied");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await cells(page, "PE3")).toEqual(["PE3", "J3.9 (wired)", "1.650 V", "pot1 → AIN0 (on Run)"]);

  const sigWire = await page.evaluate(() => window.__tm4c.diagram.connections.findIndex((c) => c.includes("pot1:SIG")));
  await page.evaluate((index) => window.__tm4c.workspace.select({ kind: "wire", index }), sigWire);
  await page.locator("#circuitCanvas").press("Delete");
  await expect(row(page, "PE3")).toHaveCount(0); // no longer wired: not listed, as for any unwired header pin
  expect(await tooltip(page, "J3.9")).not.toContain("Analog:");
  expect(errors).toEqual([]);
});

test("after a reload the restored circuit shows its analog source at once", async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "pot1" }));
  await page.locator("#potPosition").fill("25");
  await expect(row(page, "PE3")).toContainText("0.825 V");
  await page.reload();
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  expect(await cells(page, "PE3")).toEqual(["PE3", "J3.9 (wired)", "0.825 V", "pot1 → AIN0 (on Run)"]);
  expect(errors).toEqual([]);
});

for (const size of SIZES) {
  test(`analog pin row fits the pin table at ${size.width}x${size.height}`, async ({ page }) => {
    const errors = await open(page, size);
    await page.click("#runButton");
    await expect(page.locator("#simulationStatus")).toHaveText("Running", { timeout: 60_000 });
    await expect(row(page, "PE3")).toContainText("pot1 → AIN0");
    await expect(row(page, "PF2")).toContainText("HIGH", { timeout: 30_000 });
    // The table element is stable; its rows are rebuilt on every refresh while the firmware runs.
    await page.locator(".pin-table").scrollIntoViewIfNeeded();
    const fit = await page.evaluate(() => {
      const table = document.querySelector(".pin-table").getBoundingClientRect();
      const cellsInRow = [...document.querySelectorAll('#pinTable tr[data-pin="PE3"] td')].map((td) => td.getBoundingClientRect());
      const other = document.querySelector('#pinTable tr[data-pin="PF2"]').getBoundingClientRect();
      return {
        inside: cellsInRow.every((c) => c.left >= table.left - 0.5 && c.right <= table.right + 0.5),
        rowHeight: Math.round(document.querySelector('#pinTable tr[data-pin="PE3"]').getBoundingClientRect().height),
        digitalRowHeight: Math.round(other.height),
      };
    });
    console.log(`::notice title=adc row ${size.width}x${size.height}::${JSON.stringify(fit)}`);
    expect(fit.inside).toBe(true);
    await page.screenshot({ path: `test-results/adc-pins-${size.width}x${size.height}.png` });
    await page.locator(".inspector").screenshot({ path: `test-results/adc-pins-inspector-${size.width}x${size.height}.png` });
    await page.click("#stopButton");
    expect(errors).toEqual([]);
  });
}
