/*
 * Live hover feedback: what the pointer is over stays current when the
 * circuit, the view, or the simulator state changes under a pointer that does
 * not move. The pin tooltip lists the pin's wires right after a wire is made,
 * deleted, undone, or redone; a wire in progress keeps ending under the
 * pointer through keyboard zoom and Fit; the tooltip follows a running
 * simulation; and the status hint matches the wiring gesture (click vs drag).
 */
import { expect, test } from "@playwright/test";

const GRID = 9.6;

async function open(page, size = { width: 1280, height: 720 }) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  await page.locator("#circuitCanvas").press("Escape");
  return errors;
}

const pin = async (page, part, name) => {
  const box = await page.locator(`.pin-anchor[data-part="${part}"][data-pin="${name}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const tooltip = (page) => page.locator("#pinTooltip");
const message = (page) => page.locator("#workspaceMessage");

/** A point on empty canvas (only the grid underneath), searched on a coarse raster. */
const emptyPoint = (page) => page.evaluate(() => {
  const svg = document.querySelector("#circuitCanvas");
  const r = svg.getBoundingClientRect();
  for (let y = r.y + 40; y < r.y + r.height - 40; y += 20) {
    for (let x = r.x + 40; x < r.x + r.width - 40; x += 20) {
      const node = document.elementFromPoint(x, y);
      if (node === svg || node?.classList?.contains("grid")) {
        return { x, y };
      }
    }
  }
  return null;
});

/**
 * Where the wire preview ends vs where it should end for the screen point `pointer`, in world units:
 * the pin under the pointer, otherwise the snapped world point under it.
 */
const previewEndDeviation = (page, pointer) => page.evaluate(({ pointer, grid }) => {
  const svg = document.querySelector("#circuitCanvas");
  const d = document.querySelector(".wire-draft")?.getAttribute("d");
  if (!d) {
    return null;
  }
  const end = [...d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) })).at(-1);
  const pinNode = document.elementFromPoint(pointer.x, pointer.y)?.closest?.(".pin-anchor");
  let expected;
  if (pinNode) {
    expected = window.__tm4c.workspace.pinPosition(`${pinNode.dataset.part}:${pinNode.dataset.pin}`);
  } else {
    const p = svg.createSVGPoint();
    p.x = pointer.x;
    p.y = pointer.y;
    const world = p.matrixTransform(svg.getScreenCTM().inverse());
    expected = { x: Math.round(world.x / grid) * grid, y: Math.round(world.y / grid) * grid };
  }
  return +Math.hypot(end.x - expected.x, end.y - expected.y).toFixed(3);
}, { pointer, grid: GRID });

test("the pin tooltip shows the pin's wires right after a wire is made, deleted, undone, or redone", async ({ page }) => {
  const errors = await open(page);
  const canvas = page.locator("#circuitCanvas");
  const a = await pin(page, "board1", "J1.10");
  await page.mouse.move(a.x, a.y);
  await expect(tooltip(page)).toContainText("J1 pin 10");
  await expect(tooltip(page)).toContainText("Not connected");
  await page.mouse.click(a.x, a.y);
  const b = await pin(page, "led1", "A");
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await expect(tooltip(page)).toContainText("led1 · Anode");
  await expect(tooltip(page)).toContainText("Not connected");

  // Click the target: the wire is made, and the tooltip under the unmoved pointer says so at once.
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator(".wire")).toHaveCount(1);
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page)).toContainText("Wired to board1:J1.10");
  await page.screenshot({ path: "test-results/live-tooltip-after-connect-1280x720.png" });

  // The new wire is selected: Delete, undo, and redo, all from the keyboard, pointer still on the pin.
  await canvas.press("Delete");
  await expect(page.locator(".wire")).toHaveCount(0);
  await expect(tooltip(page)).toContainText("Not connected");
  await canvas.press("Control+z");
  await expect(page.locator(".wire")).toHaveCount(1);
  await expect(tooltip(page)).toContainText("Wired to board1:J1.10");
  await canvas.press("Control+y");
  await expect(page.locator(".wire")).toHaveCount(0);
  await expect(tooltip(page)).toContainText("Not connected");
  await canvas.press("Control+z");
  await expect(tooltip(page)).toContainText("Wired to board1:J1.10");

  // A second wire on the same pin: the count follows.
  const c = await pin(page, "board1", "J2.10");
  await page.mouse.click(c.x, c.y);
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator(".wire")).toHaveCount(2);
  await expect(tooltip(page)).toContainText("Wired to board1:J1.10, board1:J2.10 (2 wires)");
  expect(errors).toEqual([]);
});

test("a wire in progress keeps ending under the pointer through keyboard zoom and Fit", async ({ page }) => {
  const errors = await open(page);
  const canvas = page.locator("#circuitCanvas");
  const a = await pin(page, "board1", "J1.10");
  await page.mouse.click(a.x, a.y);
  const spot = await emptyPoint(page);
  expect(spot, "an empty spot exists").not.toBeNull();
  await page.mouse.move(spot.x, spot.y, { steps: 6 });
  expect(await previewEndDeviation(page, spot)).toBe(0);
  const zoom = () => page.locator("#zoomValue").textContent();
  for (const key of ["+", "+", "-", "0", "=", "f"]) {
    const before = await zoom();
    await canvas.press(key);
    if (key !== "f" && key !== "0") {
      await expect(page.locator("#zoomValue")).not.toHaveText(before);
    }
    expect(await previewEndDeviation(page, spot), `after "${key}"`).toBe(0);
  }
  await expect(page.locator(".wire-draft")).toHaveCount(1);
  await expect(message(page)).toContainText("Wiring from board1:J1.10");
  await page.screenshot({ path: "test-results/live-preview-after-keyboard-zoom-1280x720.png" });
  await canvas.press("Escape");
  await expect(message(page)).toHaveText("Wire cancelled.");
  expect(errors).toEqual([]);
});

test("the hint matches the gesture: click a target after a click, release on one during a drag", async ({ page }) => {
  const errors = await open(page);
  const a = await pin(page, "board1", "J1.10");
  await page.mouse.click(a.x, a.y);
  await expect(message(page)).toHaveText("Wiring from board1:J1.10 — click a target pin (Esc cancels).");
  await page.locator("#circuitCanvas").press("Escape");

  // Press and drag from the pin: the hint says to release on the target.
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y - 30, { steps: 6 });
  await expect(message(page)).toHaveText("Wiring from board1:J1.10 — release on a target pin (Esc cancels).");
  // Released on empty canvas: the wire waits for a click on its target, and the hint says so.
  await page.mouse.up();
  await expect(page.locator(".wire-draft")).toHaveCount(1);
  await expect(message(page)).toHaveText("Wiring from board1:J1.10 — click a target pin (Esc cancels).");
  const b = await pin(page, "led1", "A");
  await page.mouse.click(b.x, b.y);
  await expect(message(page)).toHaveText("Connected board1:J1.10 → led1:A.");

  // A drag that ends on the target connects directly.
  await page.locator("#circuitCanvas").press("Control+z");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await expect(message(page)).toContainText("release on a target pin");
  await page.mouse.up();
  await expect(message(page)).toHaveText("Connected board1:J1.10 → led1:A.");
  expect(errors).toEqual([]);
});

test("the pin tooltip follows a running simulation without moving the pointer", async ({ page }) => {
  const errors = await open(page);
  // Example A (shown at start) drives PF1 (J3.10, the red LED) high.
  await expect(page.locator("#exampleSelect")).toHaveValue("gpiof-red-led");
  const p = await pin(page, "board1", "J3.10");
  await page.mouse.move(p.x, p.y);
  await expect(tooltip(page)).toContainText("J3 pin 10 · PF1");
  await expect(tooltip(page)).toContainText("Simulation: not running");
  // Run from the keyboard, so the pointer stays on the pin.
  await page.locator("#runButton").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#simulationStatus")).toHaveText("Running", { timeout: 120_000 });
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page)).not.toContainText("Simulation: not running", { timeout: 60_000 });
  await expect(tooltip(page)).toContainText(/Simulation: HIGH/i);
  await page.screenshot({ path: "test-results/live-tooltip-running-1280x720.png" });
  await page.locator("#stopButton").focus();
  await page.keyboard.press("Enter");
  await expect(tooltip(page)).toContainText("Simulation: not running", { timeout: 60_000 });
  expect(errors).toEqual([]);
});
