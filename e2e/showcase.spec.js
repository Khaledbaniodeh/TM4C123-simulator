/*
 * Showcase walkthrough: the presentation flow, end to end, with real
 * compiled firmware running in Renode and real pointer/keyboard gestures.
 * Each step asserts the behaviour it shows and saves a screenshot
 * (test-results/showcase-*.png) used for the README and the demo script.
 */
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];
const G = 9.6;

async function open(page, size = { width: 1280, height: 720 }) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();
  return errors;
}
const shot = (page, name) => page.screenshot({ path: `test-results/showcase-${name}.png` });
const pin = async (page, part, name) => {
  const box = await page.locator(`.pin-anchor[data-part="${part}"][data-pin="${name}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const row = (page, gpio) => page.locator(`#pinTable tr[data-pin="${gpio}"]`);
const run = async (page) => {
  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running", { timeout: 90_000 });
};

for (const size of SIZES) {
  test(`1-5: open, inspect the LaunchPad, compile real C, run it, LED driven by the MCU (${size.width}x${size.height})`, async ({ page }) => {
    const errors = await open(page, size);
    await shot(page, `01-open-${size.width}x${size.height}`);
    // Inspect: a header pin tooltip from the board's pin map.
    await page.locator('.pin-anchor[data-part="board1"][data-pin="J3.10"]').hover();
    await expect(page.locator("#pinTooltip")).toContainText("J3 pin 10 · PF1");
    // Compile: arm-none-eabi-gcc -> Cortex-M4 ELF.
    await page.click("#compileButton");
    await expect(page.locator("#editorStatus")).toHaveText("Built", { timeout: 90_000 });
    await expect(page.locator("#elfInfo")).toContainText("ELF32 ARM");
    await expect(page.locator("#consoleOutput")).toContainText("Build succeeded");
    // Run on Renode: PF1 is driven HIGH by the firmware -> red LED on.
    await run(page);
    await expect(page.locator("#redLed")).toHaveClass(/active/, { timeout: 30_000 });
    await expect(row(page, "PF1")).toContainText("HIGH");
    await expect(row(page, "PF1")).toContainText("GPIO output");
    await page.mouse.move(5, 5);
    await shot(page, `02-running-red-led-${size.width}x${size.height}`);
    await page.click("#stopButton");
    expect(errors).toEqual([]);
  });
}

test("6: SW1 and an external pushbutton drive real GPIO inputs", async ({ page }) => {
  const errors = await open(page);
  await page.selectOption("#exampleSelect", "sw1-red-led");
  await run(page);
  await expect(row(page, "PF4")).toContainText("internal pull-up", { timeout: 30_000 });
  await page.locator("#sw1Button").hover();
  await page.mouse.down();
  await expect(row(page, "PF4")).toContainText("LOW");
  await expect(page.locator("#redLed")).toHaveClass(/active/);
  await shot(page, "03-sw1-pressed-1280x720");
  await page.mouse.up();
  await expect(page.locator("#redLed")).not.toHaveClass(/active/);
  await page.click("#stopButton");

  await page.selectOption("#exampleSelect", "external-led-button");
  await run(page);
  await expect(row(page, "PA7")).toContainText("LOW", { timeout: 30_000 });
  await page.locator('.part[data-part="btn1"] .button-cap').hover();
  await page.mouse.down();
  await expect(row(page, "PA7")).toContainText("HIGH");
  await expect(page.locator('.part[data-part="led1"] .part-led')).toHaveClass(/lit/);
  await shot(page, "04-external-button-1280x720");
  await page.mouse.up();
  await page.click("#stopButton");
  expect(errors).toEqual([]);
});

test("7-8: drag-to-connect, and panning while wiring keeps the wire", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  await page.locator("#circuitCanvas").press("Escape");
  // J2 is the outer right header: its route to the LED beside the board crosses no other pin.
  const a = await pin(page, "board1", "J2.3");
  const b = await pin(page, "led1", "A");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 14 });
  await shot(page, "05-drag-to-connect-1280x720");
  await page.mouse.up();
  await expect(page.locator(".wire")).toHaveCount(1);
  await expect(page.locator("#workspaceMessage")).toHaveText("Connected board1:J2.3 → led1:A.");
  await page.mouse.move(5, 5);
  await shot(page, "06-connected-1280x720");

  // Start a wire from the cathode, then middle-drag the view: the wire stays, its end under the pointer.
  const c = await pin(page, "led1", "C");
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.up();
  const canvas = await page.locator("#circuitCanvas").boundingBox();
  const start = { x: canvas.x + canvas.width * 0.35, y: canvas.y + canvas.height * 0.5 };
  await page.mouse.move(start.x, start.y, { steps: 4 });
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(start.x + 160, start.y - 40, { steps: 16 });
  await page.mouse.up({ button: "middle" });
  await expect(page.locator(".wire-draft")).toHaveCount(1);
  await expect(page.locator("#workspaceMessage")).toContainText("Wiring from led1:C");
  await shot(page, "07-pan-while-wiring-1280x720");
  await page.locator("#circuitCanvas").press("Escape");
  expect(errors).toEqual([]);
});

for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  test(`9: LCD1602 driven by firmware over Port B (${size.width}x${size.height})`, async ({ page }) => {
    const errors = await open(page, size);
    await page.selectOption("#exampleSelect", "lcd1602-hello");
    await run(page);
    await expect(page.locator('.part[data-part="lcd1"] .part-lcd')).toHaveAttribute("data-row0", "Hello, TM4C123! ", { timeout: 90_000 });
    await expect(page.locator('.part[data-part="lcd1"] .part-lcd')).toHaveAttribute("data-row1", /LCD1602 . n=\d/, { timeout: 90_000 });
    await page.mouse.move(5, 5);
    await shot(page, `08-lcd1602-${size.width}x${size.height}`);
    await page.click("#stopButton");
    expect(errors).toEqual([]);
  });
}

test("10: potentiometer into ADC0 with live pin information", async ({ page }) => {
  const errors = await open(page);
  await page.selectOption("#exampleSelect", "adc-potentiometer");
  await run(page);
  await expect(row(page, "PF2")).toContainText("HIGH", { timeout: 30_000 });
  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "pot1" }));
  await page.locator("#potPosition").fill("95");
  await expect(row(page, "PE3")).toContainText("3.135 V");
  await expect(row(page, "PE3")).toContainText("pot1 → AIN0");
  await expect(row(page, "PF1")).toContainText("HIGH", { timeout: 30_000 });
  await page.mouse.move(5, 5);
  await shot(page, "09-adc-potentiometer-1280x720");
  await page.click("#stopButton");
  expect(errors).toEqual([]);
});

test("11: work survives a reload, and loading a file asks before replacing a circuit", async ({ page }) => {
  const errors = await open(page);
  const source = await page.inputValue("#codeEditor");
  await page.fill("#codeEditor", source.replace("int main(void)", "/* my change */\nint main(void)"));
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  await page.locator("#circuitCanvas").press("Escape");
  await page.reload();
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator("#workspaceMessage")).toContainText("Restored your main.c and circuit from this browser");
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  expect(await page.inputValue("#codeEditor")).toContain("/* my change */");
  await shot(page, "10-restored-after-reload-1280x720");

  const prompts = [];
  page.once("dialog", (dialog) => {
    prompts.push(dialog.message());
    dialog.dismiss();
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Load diagram.json", exact: true }).focus();
  await page.keyboard.press("Enter");
  await (await chooser).setFiles({
    name: "other.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 1, parts: [{ type: "tm4c123gxl-launchpad", id: "board1", top: 0, left: 0 }], connections: [] })),
  });
  await expect(page.locator("#workspaceMessage")).toHaveText("Kept your circuit; other.json was not loaded.");
  expect(prompts[0]).toContain("This replaces your current circuit");
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  await shot(page, "11-safe-load-kept-1280x720");
  expect(errors).toEqual([]);
});

test("routing evidence: example F as shipped vs. two GND wires rerouted by the user (segment routing, no engine change)", async ({ page }) => {
  const errors = await open(page);
  await page.selectOption("#exampleSelect", "external-led-button");
  await expect(page.locator('.part[data-part="btn1"]')).toHaveCount(1);
  const measure = () => page.evaluate((grid) => {
    const ws = window.__tm4c.workspace;
    const pins = [...document.querySelectorAll(".pin-anchor")].map((n) => ({ id: `${n.dataset.part}:${n.dataset.pin}`, ...ws.pinPosition(`${n.dataset.part}:${n.dataset.pin}`) }));
    const dist = (p, a, b) => {
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1)));
      return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
    };
    return [...document.querySelectorAll(".wire")].map((w) => {
      const points = [...w.querySelector(".wire-core").getAttribute("d").matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      const own = new Set([w.dataset.from, w.dataset.to]);
      const crossed = pins.filter((p) => !own.has(p.id) && points.some((q, i) => i > 0 && dist(p, points[i - 1], q) < 0.45 * grid)).map((p) => p.id);
      return `${w.dataset.from}→${w.dataset.to}: ${crossed.length}${crossed.length ? ` (${crossed.join(" ")})` : ""}`;
    });
  }, G);
  const shipped = await measure();
  await shot(page, "12-example-f-as-shipped-1280x720");
  // What a user's segment drag produces: from the source, go vertical to the GND pin's row first, then straight in.
  const rerouted = await page.evaluate(() => {
    const ws = window.__tm4c.workspace;
    const diagram = JSON.parse(window.__tm4c.serialize());
    for (const connection of diagram.connections) {
      if (connection[1] === "board1:J3.2") {
        const a = ws.pinPosition(connection[0]);
        const b = ws.pinPosition(connection[1]);
        connection[3] = [`v${Math.round((b.y - a.y) * 1000) / 1000}`];
      }
    }
    return JSON.stringify(diagram);
  });
  expect(await page.evaluate((t) => window.__tm4c.load(t), rerouted)).toBe(true);
  const after = await measure();
  await shot(page, "13-example-f-rerouted-1280x720");
  console.log(`::notice title=showcase routing F::${JSON.stringify({ shipped, after })}`);
  await writeFile("test-results/showcase-routing-f.json", JSON.stringify({ shipped, after }, null, 2));
  expect(errors).toEqual([]);
});
