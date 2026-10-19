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
  await expect(page.locator("#exampleSelect option")).toHaveCount(6);
  await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();
  return errors;
}

async function viewBox(page) {
  return (await page.locator("#circuitCanvas").getAttribute("viewBox")).split(/\s+/).map(Number);
}

test("renders the LaunchPad with 40 header pin anchors in portrait orientation", async ({ page }) => {
  const errors = await openWorkspace(page);
  const board = page.locator('.part[data-type="tm4c123gxl-launchpad"]');
  await expect(board.locator(".pin-anchor")).toHaveCount(40);
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
  await expect(tooltip).toContainText("ADC not modeled yet");
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
