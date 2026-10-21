/*
 * Circuit workspace end-to-end tests: board rendering, pin anchors and
 * tooltips, pan/zoom, part editing with undo/redo, wiring and validation,
 * diagram serialization, and external parts driven by real firmware.
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const anchor = (page, partId, pin) => page.locator(`.pin-anchor[data-part="${partId}"][data-pin="${pin}"]`);

async function center(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function openWorkspace(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();
  return errors;
}

async function viewBox(page) {
  return (await page.locator("#circuitCanvas").getAttribute("viewBox")).split(/\s+/).map(Number);
}

test("renders the LaunchPad with 40 header pin anchors in portrait orientation", async ({ page }) => {
  const errors = await openWorkspace(page);
  const board = page.locator('.part[data-type="tm4c123gxl-launchpad"]');
  await expect(page.locator('.part-anchors[data-part="board1"] .pin-anchor')).toHaveCount(40);
  const box = await board.locator(".part-hitbox").boundingBox();
  expect(box.height).toBeGreaterThan(box.width);

  // J1/J3 on the left, J4/J2 on the right; pin 1 at the top of each header.
  const j1 = await center(anchor(page, "board1", "J1.1"));
  const j3 = await center(anchor(page, "board1", "J3.1"));
  const j4 = await center(anchor(page, "board1", "J4.1"));
  const j2 = await center(anchor(page, "board1", "J2.1"));
  expect(j1.x).toBeLessThan(j3.x);
  expect(j3.x).toBeLessThan(j4.x);
  expect(j4.x).toBeLessThan(j2.x);
  expect((await center(anchor(page, "board1", "J1.10"))).y).toBeGreaterThan(j1.y);

  await expect(page.locator("#redLed")).not.toHaveClass(/active/);
  expect(errors).toEqual([]);
});

test("pin tooltips show header, GPIO, functions, and simulation state", async ({ page }) => {
  await openWorkspace(page);
  await anchor(page, "board1", "J3.10").hover();
  const tooltip = page.locator("#pinTooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("J3 pin 10 · PF1");
  await expect(tooltip).toContainText("On-board red LED");
  await expect(tooltip).toContainText("Simulation: not running");
  await anchor(page, "board1", "J3.9").hover();
  await expect(tooltip).toContainText("AIN0");
  await expect(tooltip).toContainText("sampled by ADC0/ADC1");
});

test("zooms, pans, and fits the view", async ({ page }) => {
  await openWorkspace(page);
  const initial = await viewBox(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  const zoomed = await viewBox(page);
  expect(zoomed[2]).toBeLessThan(initial[2]);

  // Drag empty canvas space to pan.
  const stage = await page.locator("#circuitCanvas").boundingBox();
  await page.mouse.move(stage.x + 15, stage.y + 15);
  await page.mouse.down();
  await page.mouse.move(stage.x + 115, stage.y + 65, { steps: 5 });
  await page.mouse.up();
  const panned = await viewBox(page);
  expect(panned[0]).toBeLessThan(zoomed[0]);
  expect(panned[2]).toBeCloseTo(zoomed[2], 5);

  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.wheel(0, -400);
  expect((await viewBox(page))[2]).toBeLessThan(panned[2]);

  await page.getByRole("button", { name: /Fit/ }).click();
  const fitted = await viewBox(page);
  expect(fitted).not.toEqual(panned);
});

test("adds, drags, rotates, duplicates, deletes parts with undo/redo", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  const led = page.locator('.part[data-part="led1"]');
  await expect(led).toHaveCount(1);
  const before = await led.getAttribute("transform");

  const box = await led.locator(".part-hitbox").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 3 + 30, { steps: 6 });
  await page.mouse.up();
  const moved = await led.getAttribute("transform");
  expect(moved).not.toEqual(before);
  // Snapped to the 0.1-inch (9.6-unit) grid.
  const [left, top] = moved.match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number);
  expect(Math.abs(left / 9.6 - Math.round(left / 9.6))).toBeLessThan(1e-6);
  expect(Math.abs(top / 9.6 - Math.round(top / 9.6))).toBeLessThan(1e-6);

  await page.locator("#circuitCanvas").press("r");
  await expect(led).toHaveAttribute("transform", /rotate\(90/);

  await page.locator("#circuitCanvas").press("Control+d");
  await expect(page.locator('.part[data-part="led2"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Delete selection" }).click();
  await expect(page.locator('.part[data-part="led2"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click(); // restore led2
  await expect(page.locator('.part[data-part="led2"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click(); // remove duplicate
  await page.getByRole("button", { name: "Undo" }).click(); // un-rotate
  await expect(led).not.toHaveAttribute("transform", /rotate/);
  await page.getByRole("button", { name: "Undo" }).click(); // un-move
  await expect(led).toHaveAttribute("transform", before);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(led).toHaveAttribute("transform", moved);
});

test("creates wires that stay attached to pins, and rejects invalid wires", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();

  await anchor(page, "board1", "J1.10").click();
  await expect(page.locator("#workspaceMessage")).toContainText("Wiring from board1:J1.10");
  await anchor(page, "led1", "A").click();
  const wire = page.locator('.wire[data-from="board1:J1.10"][data-to="led1:A"]');
  await expect(wire).toHaveCount(1);

  const endpointsMatch = async () => page.evaluate(() => {
    const { workspace } = window.__tm4c;
    const ends = [...document.querySelectorAll('.wire[data-to="led1:A"] .wire-end')].map((c) => ({ x: Number(c.getAttribute("cx")), y: Number(c.getAttribute("cy")) }));
    const a = workspace.pinPosition("board1:J1.10");
    const b = workspace.pinPosition("led1:A");
    const close = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
    return ends.length === 2 && close(ends[0], a) && close(ends[1], b);
  });
  expect(await endpointsMatch()).toBe(true);

  // Moving the LED keeps the wire attached.
  const box = await page.locator('.part[data-part="led1"] .part-hitbox').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 4 + 40, { steps: 5 });
  await page.mouse.up();
  expect(await endpointsMatch()).toBe(true);
  for (const d of await wire.locator(".wire-core").getAttribute("d").then((text) => [text])) {
    // Every segment is horizontal or vertical.
    const points = [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    for (let i = 1; i < points.length; i++) {
      expect(points[i][0] === points[i - 1][0] || points[i][1] === points[i - 1][1]).toBe(true);
    }
  }

  // Supply to ground is rejected.
  await anchor(page, "board1", "J1.1").click();
  await anchor(page, "board1", "J2.1").click();
  await expect(page.locator("#workspaceMessage")).toContainText("short");
  await expect(page.locator('.wire[data-from="board1:J1.1"]')).toHaveCount(0);
  await page.locator("#circuitCanvas").press("Escape");

  // Duplicate wire is rejected.
  await anchor(page, "led1", "A").click();
  await anchor(page, "board1", "J1.10").click();
  await expect(page.locator("#workspaceMessage")).toContainText("already connected");
  await page.locator("#circuitCanvas").press("Escape");

  // Recolor and delete through the selection panel.
  // (An L-shaped wire's bounding-box center may be off the path, so select it directly.)
  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "wire", index: 0 }));
  await expect(wire).toHaveClass(/is-selected/);
  await page.locator("#wireColorSelect").selectOption("orange");
  await expect(wire.locator(".wire-core")).toHaveAttribute("stroke", "#ea8a1d");
  await page.locator("#circuitCanvas").press("Delete");
  await expect(wire).toHaveCount(0);
});

test("saves and reloads diagram.json without changing parts or connections", async ({ page }) => {
  await openWorkspace(page);
  await page.selectOption("#exampleSelect", "external-led-button");
  await expect(page.locator(".wire")).toHaveCount(5);
  const serialized = await page.evaluate(() => window.__tm4c.serialize());

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save" }).click();
  const download = await downloadPromise;
  const saved = await readFile(await download.path(), "utf8");
  expect(saved).toBe(serialized);

  // Clear, then load the saved file through the file input.
  await page.evaluate(() => window.__tm4c.load(JSON.stringify({ version: 1, parts: [{ type: "tm4c123gxl-launchpad", id: "board1", top: 0, left: 0 }], connections: [] })));
  await expect(page.locator(".wire")).toHaveCount(0);
  await page.locator("#loadDiagramInput").setInputFiles({ name: "diagram.json", mimeType: "application/json", buffer: Buffer.from(saved) });
  await expect(page.locator(".wire")).toHaveCount(5);
  expect(await page.evaluate(() => window.__tm4c.serialize())).toBe(saved);

  // Invalid diagrams are rejected with a message and leave the circuit untouched.
  await page.locator("#loadDiagramInput").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":1,"parts":[],"connections":[["x:1","y:2","red",[]]]}') });
  await expect(page.locator("#workspaceMessage")).toContainText("Could not load bad.json");
  expect(await page.evaluate(() => window.__tm4c.serialize())).toBe(saved);
});

test("F: an external button and LED work through real firmware", async ({ page }) => {
  await openWorkspace(page);
  await page.selectOption("#exampleSelect", "external-led-button");
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running");
  await expect(page.locator('#pinTable tr[data-pin="PA7"]')).toContainText("LOW");
  await expect(page.locator(".part-led.lit")).toHaveCount(0);

  const button = page.locator('.part[data-part="btn1"] .button-cap');
  await button.hover();
  await page.mouse.down();
  await expect(page.locator('#pinTable tr[data-pin="PA6"]')).toContainText("LOW");
  await expect(page.locator('#pinTable tr[data-pin="PA7"]')).toContainText("HIGH");
  await expect(page.locator('.part[data-part="led1"] .part-led')).toHaveClass(/lit/);
  await page.screenshot({ path: "test-results/workspace-external-led.png" });
  await page.mouse.up();
  await expect(page.locator('#pinTable tr[data-pin="PA7"]')).toContainText("LOW");
  await expect(page.locator(".part-led.lit")).toHaveCount(0);

  await anchor(page, "board1", "J1.10").hover();
  await expect(page.locator("#pinTooltip")).toContainText("Simulation: LOW (GPIO output)");
  await page.click("#stopButton");
});

test("critical controls have accessible names", async ({ page }) => {
  await openWorkspace(page);
  for (const name of ["Compile", "▶ Run", "Zoom in", "Zoom out", "Undo", "Redo", "Rotate selected part", "Delete selection"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(1);
  }
  await expect(page.getByRole("application", { name: /Circuit canvas/ })).toBeVisible();
  await expect(page.locator("#sw1Button")).toHaveAttribute("role", "button");
  await expect(page.locator("#sw1Button")).toHaveAttribute("aria-label", /SW1/);
});

test("pins stay hoverable and wireable after a wire is attached", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  await anchor(page, "board1", "J1.10").click();
  await anchor(page, "led1", "A").click();
  await expect(page.locator(".wire")).toHaveCount(1);

  await anchor(page, "board1", "J1.10").hover();
  await expect(page.locator("#pinTooltip")).toContainText("1 wire connected");
  await anchor(page, "board1", "J1.10").click();
  await expect(page.locator("#workspaceMessage")).toContainText("Wiring from board1:J1.10");
  await anchor(page, "led1", "C").click();
  await expect(page.locator(".wire")).toHaveCount(2);
});

test("pin hit targets, tooltips, and wire endpoints stay correct across zoom and pan", async ({ page }) => {
  await openWorkspace(page);
  const radius = () => page.locator('.pin-anchor[data-pin="J2.4"]').getAttribute("r").then(Number);
  const views = [
    { name: "fit", buttons: [], wheel: 0 },
    { name: "zoomed-out", buttons: ["Zoom out", "Zoom out", "Zoom out"], wheel: 0 },
    // Wheel zoom is anchored at the cursor, so zooming over the pin keeps it in view.
    { name: "zoomed-in", buttons: [], wheel: 3 },
  ];
  const radii = {};
  for (const view of views) {
    await page.getByRole("button", { name: /Fit/ }).click();
    for (const button of view.buttons) {
      await page.getByRole("button", { name: button, exact: true }).click();
    }
    for (let i = 0; i < view.wheel; i++) {
      const pin = await center(anchor(page, "board1", "J2.4"));
      await page.mouse.move(pin.x, pin.y);
      await page.mouse.wheel(0, -300);
    }
    radii[view.name] = await radius();
    await anchor(page, "board1", "J2.4").hover();
    await expect(page.locator("#pinTooltip")).toContainText("J2 pin 4 · PF0");
    await page.screenshot({ path: `test-results/board-${view.name}.png` });
  }
  // Close-up of the right-hand headers and their label columns for visual review.
  await page.getByRole("button", { name: /Fit/ }).click();
  for (let i = 0; i < 2; i++) {
    const pin = await center(anchor(page, "board1", "J4.3"));
    await page.mouse.move(pin.x, pin.y);
    await page.mouse.wheel(0, -300);
  }
  await page.mouse.move(5, 5);
  await page.screenshot({ path: "test-results/board-headers-closeup.png" });

  // Hit targets grow (in world units) when zoomed out, never below the drawn pad.
  expect(radii["zoomed-out"]).toBeGreaterThan(radii["zoomed-in"]);
  expect(radii["zoomed-in"]).toBeGreaterThanOrEqual(9.6 * 0.32 - 1e-9);
  expect(radii["zoomed-out"]).toBeLessThanOrEqual(9.6 * 0.48 + 1e-9);

  // Wire created while zoomed in and panned lands exactly on both pins.
  await page.getByRole("button", { name: /Fit/ }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const stage = await page.locator("#circuitCanvas").boundingBox();
  await page.mouse.move(stage.x + 12, stage.y + 12);
  await page.mouse.down();
  await page.mouse.move(stage.x + 52, stage.y + 32, { steps: 4 });
  await page.mouse.up();
  await anchor(page, "board1", "J3.3").click();
  await anchor(page, "board1", "J4.8").click();
  const aligned = await page.evaluate(() => {
    const { workspace } = window.__tm4c;
    const ends = [...document.querySelectorAll('.wire[data-from="board1:J3.3"] .wire-end')].map((c) => [Number(c.getAttribute("cx")), Number(c.getAttribute("cy"))]);
    const a = workspace.pinPosition("board1:J3.3");
    const b = workspace.pinPosition("board1:J4.8");
    return ends.length === 2 && Math.hypot(ends[0][0] - a.x, ends[0][1] - a.y) < 1e-6 && Math.hypot(ends[1][0] - b.x, ends[1][1] - b.y) < 1e-6;
  });
  expect(aligned).toBe(true);
});

test("dragging moves a part by the screen distance divided by the zoom", async ({ page }) => {
  await openWorkspace(page);
  // Zoom first: the new part is then placed inside the zoomed view (it goes beside the board, not under the zoom center).
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="resistor"]').click();
  const part = page.locator('.part[data-part="r1"]');
  const before = (await part.getAttribute("transform")).match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number);
  const zoom = await page.evaluate(() => window.__tm4c.workspace.zoomLevel);
  const box = await part.locator(".part-hitbox").boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 4 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 96, start.y + 48, { steps: 8 });
  await page.mouse.up();
  const after = (await part.getAttribute("transform")).match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number);
  const snap = (v) => Math.round(v / 9.6) * 9.6;
  expect(after[0] - before[0]).toBeCloseTo(snap(96 / zoom), 3);
  expect(after[1] - before[1]).toBeCloseTo(snap(48 / zoom), 3);
  // The part's pin anchors moved with it.
  const anchorsTransform = await page.locator('.part-anchors[data-part="r1"]').getAttribute("transform");
  expect(anchorsTransform).toBe(await part.getAttribute("transform"));
});

test("board components are selectable with honest status", async ({ page }) => {
  await openWorkspace(page);
  const select = async (id) => {
    const hit = page.locator(`[data-component="${id}"] > .lp-hit`);
    const box = await hit.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  await select("U1");
  await expect(page.locator("#selectionPanel")).toContainText("TM4C123GH6PM target MCU");
  await expect(page.locator("#selectionPanel .status-chip")).toHaveText("simulated");
  await expect(page.locator('[data-component="U1"]')).toHaveClass(/is-selected/);
  await select("J9");
  await expect(page.locator("#selectionPanel")).toContainText("DEVICE USB");
  await expect(page.locator("#selectionPanel .status-chip")).toHaveText("visual only");
  await select("J5");
  await expect(page.locator("#selectionPanel")).toContainText("Tag-Connect TC2050");
  await expect(page.locator("#selectionPanel .status-chip")).toHaveText("visual only");
  await select("RESET");
  await expect(page.locator("#selectionPanel")).toContainText("SPMR240 part RESET");
  await expect(page.locator("#selectionPanel .status-chip")).toHaveText("simulated");
  // Clicking components must not move the board.
  await expect(page.locator('.part[data-part="board1"]')).toHaveAttribute("transform", "translate(0 0)");
});

test("selected RGB LED shows firmware-driven pin state", async ({ page }) => {
  await openWorkspace(page);
  await page.selectOption("#exampleSelect", "gpiof-red-led");
  const box = await page.locator('[data-component="D1"] > .lp-hit').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#selectionPanel")).toContainText("run the simulation to see live values");
  await expect(page.locator("#redLed")).not.toHaveClass(/active/);
  await page.click("#runButton");
  await expect(page.locator("#selectionPanel .component-live")).toContainText("PF1: HIGH");
  await expect(page.locator("#redLed")).toHaveClass(/active/);
  await expect(page.locator("#greenLed")).not.toHaveClass(/active/);
  await expect(page.locator("#blueLed")).not.toHaveClass(/active/);
  await page.screenshot({ path: "test-results/board-rgb-live.png" });

  // Pressing and releasing the board's RESET switch resets the real MCU; the firmware runs again.
  await page.locator("#resetButton_board").hover();
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator("#consoleOutput")).toContainText("MCU reset");
  await expect(page.locator("#redLed")).toHaveClass(/active/);
  await page.click("#stopButton");
});

test("L: the LCD1602 shows text written by real firmware over Port B", async ({ page }) => {
  const errors = await openWorkspace(page);
  await page.selectOption("#exampleSelect", "lcd1602-hello");
  const lcd = page.locator('.part[data-part="lcd1"] .part-lcd');
  await expect(lcd).toHaveCount(1);
  await expect(lcd).toHaveAttribute("data-row0", "");
  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running");
  await expect(lcd).toHaveAttribute("data-row0", "Hello, TM4C123! ", { timeout: 60_000 });
  await expect(lcd).toHaveAttribute("data-row1", /^LCD1602 □ n=\d {3}$/);
  await expect(lcd).toHaveAttribute("aria-label", /Hello, TM4C123!/);
  // The heart is drawn from the firmware's CGRAM bitmap, not from a font.
  await expect(page.locator('.part[data-part="lcd1"] .lcd-dot').first()).toBeVisible();
  // RW is tied to GND in the circuit and driven LOW by firmware (D-024).
  await expect(page.locator('#pinTable tr[data-pin="PB1"]')).toContainText("LOW");
  await page.screenshot({ path: "test-results/workspace-lcd1602.png" });

  await anchor(page, "lcd1", "E").hover();
  await expect(page.locator("#pinTooltip")).toContainText("Interface: 4-bit");
  await page.click("#stopButton");
  await expect(lcd).toHaveAttribute("data-row0", "");
  expect(errors).toEqual([]);
});

test("M: the potentiometer knob drives AIN0 through the real ADC model", async ({ page }) => {
  const errors = await openWorkspace(page);
  await page.selectOption("#exampleSelect", "adc-potentiometer");
  await expect(page.locator('.part[data-part="pot1"]')).toHaveCount(1);
  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running");
  // 50 % of 3.3 V -> code 2048 -> blue (PF2).
  await expect(page.locator('#pinTable tr[data-pin="PF2"]')).toContainText("HIGH", { timeout: 30_000 });

  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "pot1" }));
  const slider = page.locator("#potPosition");
  await expect(slider).toHaveValue("50");
  await expect(page.locator("#potReadout")).toContainText("1.650 V at 50% → PE3");
  await slider.fill("95");
  await expect(page.locator('#pinTable tr[data-pin="PF1"]')).toContainText("HIGH", { timeout: 30_000 });
  await expect(page.locator('.part[data-part="pot1"] .part-pot')).toHaveAttribute("data-position", "95");
  await page.screenshot({ path: "test-results/workspace-adc-potentiometer.png" });
  await slider.fill("5");
  await expect(page.locator('#pinTable tr[data-pin="PF3"]')).toContainText("HIGH", { timeout: 30_000 });
  await expect(page.locator('#pinTable tr[data-pin="PF1"]')).toContainText("LOW");

  await anchor(page, "pot1", "SIG").hover();
  await expect(page.locator("#pinTooltip")).toContainText("Drives ADC input PE3");
  await page.click("#stopButton");
  expect(errors).toEqual([]);
});

test("N: the die temperature control reaches the ADC temperature sensor", async ({ page }) => {
  const errors = await openWorkspace(page);
  await page.selectOption("#exampleSelect", "adc-temperature");
  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running");
  await expect(page.locator('#pinTable tr[data-pin="PF3"]')).toContainText("HIGH", { timeout: 30_000 }); // 25 C -> green

  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "component", id: "U1" }));
  const temperature = page.locator("#dieTemperature");
  await expect(temperature).toHaveValue("25");
  await temperature.fill("45");
  await temperature.press("Enter");
  await temperature.blur();
  await expect(page.locator('#pinTable tr[data-pin="PF1"]')).toContainText("HIGH", { timeout: 30_000 }); // red
  await expect(page.locator("#consoleOutput")).toContainText("Die temperature set to 45 °C");
  await page.click("#stopButton");
  expect(errors).toEqual([]);
});

test("a freshly drawn wire can be rerouted by dragging any segment; undo restores it", async ({ page }) => {
  const errors = await openWorkspace(page);
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  await anchor(page, "board1", "J1.10").click();
  await anchor(page, "led1", "A").click();
  const wire = page.locator('.wire[data-from="board1:J1.10"][data-to="led1:A"]');
  await expect(wire).toHaveCount(1);
  expect(await page.evaluate(() => window.__tm4c.diagram.connections[0][3])).toEqual([]);

  // Midpoint of the first segment (at the board pin) in screen coordinates, and its orientation.
  const target = await page.evaluate(() => {
    const path = document.querySelector('.wire[data-to="led1:A"] .wire-core');
    const points = [...path.getAttribute("d").matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const [a, b] = points;
    const svg = document.querySelector("#circuitCanvas");
    const point = svg.createSVGPoint();
    point.x = (a.x + b.x) / 2;
    point.y = (a.y + b.y) / 2;
    const screen = point.matrixTransform(path.getScreenCTM());
    return { x: screen.x, y: screen.y, horizontal: a.y === b.y, count: points.length };
  });
  expect(target.count).toBeLessThanOrEqual(3); // straight or L-shaped: no inner segment before this change

  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  const dx = target.horizontal ? 0 : 48;
  const dy = target.horizontal ? 48 : 0;
  await page.mouse.move(target.x + dx, target.y + dy, { steps: 6 });
  await page.mouse.up();

  const routing = await page.evaluate(() => window.__tm4c.diagram.connections[0][3]);
  expect(routing.length).toBeGreaterThan(0);
  // Ends still on their pins, and every segment axis-aligned.
  const check = await page.evaluate(() => {
    const { workspace } = window.__tm4c;
    const ends = [...document.querySelectorAll('.wire[data-to="led1:A"] .wire-end')].map((c) => ({ x: Number(c.getAttribute("cx")), y: Number(c.getAttribute("cy")) }));
    const close = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
    const d = document.querySelector('.wire[data-to="led1:A"] .wire-core').getAttribute("d");
    const points = [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const aligned = points.every((p, i) => i === 0 || p[0] === points[i - 1][0] || p[1] === points[i - 1][1]);
    return { attached: close(ends[0], workspace.pinPosition("board1:J1.10")) && close(ends[1], workspace.pinPosition("led1:A")), aligned, count: points.length };
  });
  expect(check).toEqual({ attached: true, aligned: true, count: expect.any(Number) });
  expect(check.count).toBeGreaterThan(3);
  await page.screenshot({ path: "test-results/workspace-wire-reroute.png" });

  await page.locator("#circuitCanvas").press("Control+z");
  expect(await page.evaluate(() => window.__tm4c.diagram.connections[0][3])).toEqual([]);
  await page.locator("#circuitCanvas").press("Control+y");
  expect(await page.evaluate(() => window.__tm4c.diagram.connections[0][3])).toEqual(routing);
  expect(errors).toEqual([]);
});

test("selection-panel inputs keep their element, value, and focus while events stream", async ({ page }) => {
  const errors = await openWorkspace(page);
  await page.selectOption("#exampleSelect", "lcd1602-hello"); // emits pin events continuously
  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running");
  await expect(page.locator('.part[data-part="lcd1"] .part-lcd')).toHaveAttribute("data-row0", "Hello, TM4C123! ", { timeout: 60_000 });

  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "component", id: "U1" }));
  const input = page.locator("#dieTemperature");
  await input.evaluate((node) => { node.dataset.probe = "same-element"; });
  await input.focus();
  await input.fill("33");
  const eventsBefore = Number(await page.locator("#eventCount").textContent());
  await page.waitForTimeout(1500); // many animation frames with simulator events
  expect(Number(await page.locator("#eventCount").textContent())).toBeGreaterThan(eventsBefore);
  await expect(input).toHaveAttribute("data-probe", "same-element");
  await expect(input).toHaveValue("33");
  await expect(input).toBeFocused();
  await page.click("#stopButton");
  expect(errors).toEqual([]);
});

test("multi-selection: Shift+click, group drag, nudge, copy/paste, delete, box select, select all — all undoable", async ({ page }) => {
  const errors = await openWorkspace(page);
  await page.selectOption("#exampleSelect", "external-led-button");
  await expect(page.locator('.part[data-part="btn1"]')).toHaveCount(1);
  const original = await page.evaluate(() => window.__tm4c.serialize());
  const parts = () => page.evaluate(() => Object.fromEntries(window.__tm4c.diagram.parts.map((p) => [p.id, { left: p.left, top: p.top }])));
  // A screen point that really hits the given part (not a wire or pin on top of it),
  // or, with id = null, empty canvas near (x, y).
  const pointOn = (id, near = null) => page.evaluate(({ id, near }) => {
    const canvas = document.querySelector("#circuitCanvas").getBoundingClientRect();
    const box = id ? document.querySelector(`.part[data-part="${id}"] .part-hitbox`).getBoundingClientRect() : null;
    const origin = near ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    for (let radius = 0; radius < 80; radius += 3) {
      for (let step = 0; step < 16; step++) {
        const angle = (step / 16) * 2 * Math.PI;
        const x = origin.x + radius * Math.cos(angle);
        const y = origin.y + radius * Math.sin(angle);
        if (x < canvas.left + 2 || x > canvas.right - 2 || y < canvas.top + 2 || y > canvas.bottom - 2) {
          continue;
        }
        const hit = document.elementFromPoint(x, y);
        const onWireOrPin = hit?.closest(".wire, .pin-anchor");
        const part = hit?.closest(".part")?.dataset.part ?? null;
        if (!onWireOrPin && part === id) {
          return { x, y };
        }
      }
    }
    return null;
  }, { id, near });
  const centerOf = async (id) => pointOn(id);
  const wiresAttached = () => page.evaluate(() => {
    const { workspace, diagram } = window.__tm4c;
    const close = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
    return diagram.connections.every(([from, to], index) => {
      const ends = [...document.querySelectorAll(`.wire[data-wire="${index}"] .wire-end`)].map((c) => ({ x: Number(c.getAttribute("cx")), y: Number(c.getAttribute("cy")) }));
      return ends.length === 2 && close(ends[0], workspace.pinPosition(from)) && close(ends[1], workspace.pinPosition(to));
    });
  });

  // Shift+drag on empty canvas (here: below btn1 in the example layout) draws a box;
  // it selects the part it touches, never the board.
  const btn = await page.locator('.part[data-part="btn1"] .part-hitbox').boundingBox();
  const corner = await pointOn(null, { x: btn.x + btn.width * 0.25, y: btn.y + btn.height + 10 });
  expect(corner).not.toBeNull();
  await page.keyboard.down("Shift");
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(btn.x + btn.width * 0.6, btn.y + btn.height * 0.6, { steps: 6 });
  await expect(page.locator(".selection-box")).toHaveCount(1);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.locator(".selection-box")).toHaveCount(0);
  expect(await page.evaluate(() => window.__tm4c.workspace.selection)).toEqual({ kind: "part", id: "btn1" });
  await page.locator("#circuitCanvas").press("Escape");

  // Shift+click builds a group.
  const ledPoint = await pointOn("led1");
  await page.mouse.click(ledPoint.x, ledPoint.y);
  const resistorPoint = await pointOn("r1");
  await page.keyboard.down("Shift");
  await page.mouse.click(resistorPoint.x, resistorPoint.y);
  await page.keyboard.up("Shift");
  await expect(page.locator("#selectionPanel")).toContainText("2 parts selected");
  await expect(page.locator(".part.is-selected")).toHaveCount(2);

  // Dragging one member moves both by the same snapped amount; wires stay on their pins.
  const before = await parts();
  const start = await centerOf("led1");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y + 30, { steps: 8 });
  await page.mouse.up();
  const moved = await parts();
  const dx = moved.led1.left - before.led1.left;
  const dy = moved.led1.top - before.led1.top;
  expect(Math.abs(dx)).toBeGreaterThan(0);
  expect(moved.r1.left - before.r1.left).toBeCloseTo(dx, 6);
  expect(moved.r1.top - before.r1.top).toBeCloseTo(dy, 6);
  expect(moved.btn1).toEqual(before.btn1);
  expect(Math.abs(Math.round(dx / 9.6) * 9.6 - dx)).toBeLessThan(1e-6); // snapped to the 0.1 in grid
  expect(await wiresAttached()).toBe(true);

  // One undo step restores both; redo re-applies.
  await page.locator("#circuitCanvas").press("Control+z");
  expect(await parts()).toEqual(before);
  await page.locator("#circuitCanvas").press("Control+y");
  expect(await parts()).toEqual(moved);

  // Arrow keys nudge the group: 0.1 in, and 1 in with Shift.
  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "group", parts: ["led1", "r1"], wires: [] }));
  await page.locator("#circuitCanvas").press("ArrowRight");
  await page.locator("#circuitCanvas").press("Shift+ArrowDown");
  const nudged = await parts();
  expect(nudged.led1.left - moved.led1.left).toBeCloseTo(9.6, 6);
  expect(nudged.r1.top - moved.r1.top).toBeCloseTo(96, 6);
  expect(nudged.btn1).toEqual(before.btn1);

  // Copy/paste: fresh ids, the wire between the copied parts comes along, the selection is the copy.
  await page.locator("#circuitCanvas").press("Control+c");
  await expect(page.locator("#workspaceMessage")).toContainText("Copied 2 parts and 1 wire between them");
  await page.locator("#circuitCanvas").press("Control+v");
  await expect(page.locator('.part[data-part="led2"]')).toHaveCount(1);
  await expect(page.locator('.part[data-part="r2"]')).toHaveCount(1);
  await expect(page.locator('.wire[data-from="r2:1"][data-to="led2:A"]')).toHaveCount(1);
  await expect(page.locator("#selectionPanel")).toContainText("2 parts and 1 wire selected");
  expect(await wiresAttached()).toBe(true);
  await page.screenshot({ path: "test-results/workspace-multi-selection.png" });

  // Delete removes the pasted group; undo brings it back.
  await page.locator("#circuitCanvas").press("Delete");
  await expect(page.locator('.part[data-part="led2"]')).toHaveCount(0);
  await expect(page.locator('.wire[data-to="led2:A"]')).toHaveCount(0);
  await page.locator("#circuitCanvas").press("Control+z");
  await expect(page.locator('.part[data-part="led2"]')).toHaveCount(1);
  await expect(page.locator('.wire[data-from="r2:1"][data-to="led2:A"]')).toHaveCount(1);

  // Select all: every part except the board, and every wire.
  await page.locator("#circuitCanvas").press("Control+a");
  const all = await page.evaluate(() => window.__tm4c.workspace.selection);
  expect(all.kind).toBe("group");
  expect(all.parts).not.toContain("board1");
  expect(all.parts.sort()).toEqual(["btn1", "led1", "led2", "r1", "r2"]);
  expect(all.wires.length).toBe(await page.evaluate(() => window.__tm4c.diagram.connections.length));

  // Undo everything: the diagram is exactly the example again.
  for (let i = 0; i < 6; i++) {
    await page.locator("#circuitCanvas").press("Control+z");
  }
  expect(await page.evaluate(() => window.__tm4c.serialize())).toBe(original);
  expect(errors).toEqual([]);
});
