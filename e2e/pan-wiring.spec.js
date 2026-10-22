/*
 * Panning while wiring: with a wire in progress, dragging empty canvas (left
 * button) or dragging with the middle button pans the view and keeps the
 * wire, whose source stays on its pin and whose preview end stays under the
 * pointer; a release after panning never connects. A plain click on empty
 * canvas still cancels, as do Esc and presses on parts. The wire then
 * completes normally on a distant pin.
 */
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];
const GRID = 9.6;

async function open(page, size = { width: 1280, height: 720 }, example = null) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  if (example) {
    await page.selectOption("#exampleSelect", example);
  }
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  await page.locator("#circuitCanvas").press("Escape");
  return errors;
}

const ledId = (example) => (example ? "led2" : "led1");
const pin = async (page, part, name) => {
  const box = await page.locator(`.pin-anchor[data-part="${part}"][data-pin="${name}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const view = (page) => page.evaluate(() => ({ ...window.__tm4c.workspace.viewBox }));
const draftActive = async (page) => (await page.locator(".wire-draft").count()) > 0;
const wires = (page) => page.locator(".wire");
const message = (page) => page.locator("#workspaceMessage");

/** A point on empty canvas (only the grid underneath), searched on a coarse raster. */
const emptyPoint = (page) => page.evaluate(() => {
  const svg = document.querySelector("#circuitCanvas");
  const r = svg.getBoundingClientRect();
  for (let y = r.y + 30; y < r.y + r.height - 40; y += 20) {
    for (let x = r.x + 30; x < r.x + r.width - 30; x += 20) {
      const node = document.elementFromPoint(x, y);
      if (node === svg || node?.classList?.contains("grid")) {
        return { x, y };
      }
    }
  }
  return null;
});

/** Preview geometry: the source end on its pin, and the free end vs the pointer (world units). */
const preview = (page, pointer, from = "board1:J1.10") => page.evaluate(({ pointer, from, grid }) => {
  const svg = document.querySelector("#circuitCanvas");
  const d = document.querySelector(".wire-draft")?.getAttribute("d");
  if (!d) {
    return null;
  }
  const points = [...d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  const source = window.__tm4c.workspace.pinPosition(from);
  const p = svg.createSVGPoint();
  p.x = pointer.x;
  p.y = pointer.y;
  const world = p.matrixTransform(svg.getScreenCTM().inverse());
  const expected = { x: Math.round(world.x / grid) * grid, y: Math.round(world.y / grid) * grid };
  const end = points.at(-1);
  return {
    sourceOnPin: Math.hypot(points[0].x - source.x, points[0].y - source.y) < 1e-6,
    endDeviation: +Math.hypot(end.x - expected.x, end.y - expected.y).toFixed(6),
  };
}, { pointer, from, grid: GRID });

async function startWire(page) {
  const a = await pin(page, "board1", "J1.10");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator(".wire-draft")).toHaveCount(1);
}

/** Drag from `start` by (dx, dy) with the given button; returns the pointer's final position. */
async function drag(page, start, dx, dy, button = "left", steps = 12) {
  await page.mouse.move(start.x, start.y, { steps: 4 });
  await page.mouse.down({ button });
  await page.mouse.move(start.x + dx, start.y + dy, { steps });
  await page.mouse.up({ button });
  return { x: start.x + dx, y: start.y + dy };
}

for (const size of SIZES) {
  test(`pan while wiring, then connect, at ${size.width}x${size.height} (Fit: left drag; zoomed in: middle drag)`, async ({ page }) => {
    const errors = await open(page, size);
    // Fit: left-drag on empty canvas pans and keeps the wire.
    await startWire(page);
    let before = await view(page);
    let start = await emptyPoint(page);
    expect(start, "an empty spot exists at Fit").not.toBeNull();
    let end = await drag(page, start, -70, 40);
    expect(await view(page)).not.toEqual(before);
    expect(await draftActive(page)).toBe(true);
    await expect(wires(page)).toHaveCount(0);
    await expect(message(page)).toContainText("Wiring from board1:J1.10");
    expect(await preview(page, end)).toEqual({ sourceOnPin: true, endDeviation: 0 });
    let target = await pin(page, "led1", "A");
    await page.mouse.move(target.x, target.y, { steps: 10 });
    const before1 = await page.locator(".wire-draft").getAttribute("d");
    await page.mouse.down();
    await page.mouse.up();
    await expect(wires(page)).toHaveCount(1);
    expect(await page.locator('.wire[data-to="led1:A"] .wire-core').getAttribute("d")).toBe(before1);
    await page.locator("#circuitCanvas").press("Control+z");
    await expect(wires(page)).toHaveCount(0);

    // Zoomed in until the LED is out of view: a middle-drag pans it into view; the wire then completes.
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    }
    const canvas = await page.locator("#circuitCanvas").boundingBox();
    const source = await pin(page, "board1", "J1.10");
    const inView = (p) => p.x > canvas.x && p.y > canvas.y && p.x < canvas.x + canvas.width && p.y < canvas.y + canvas.height;
    if (!inView(source)) {
      // Bring the source pin into view first (no wire yet: an ordinary pan).
      await drag(page, { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 }, canvas.x + canvas.width / 2 - source.x, canvas.y + canvas.height / 2 - source.y, "middle");
    }
    await startWire(page);
    target = await pin(page, "led1", "A");
    const center = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    before = await view(page);
    end = await drag(page, center, center.x - target.x, center.y - target.y, "middle", 20);
    expect(await view(page)).not.toEqual(before);
    expect(await draftActive(page)).toBe(true);
    await expect(wires(page)).toHaveCount(0);
    expect((await preview(page, end)).sourceOnPin).toBe(true);
    target = await pin(page, "led1", "A");
    expect(inView(target), "the distant target is now in view").toBe(true);
    await page.mouse.move(target.x, target.y, { steps: 6 });
    if (size.width === 1280) {
      await page.screenshot({ path: "test-results/pan-wiring-zoomed-1280x720.png" });
    }
    await page.mouse.down();
    await page.mouse.up();
    await expect(wires(page)).toHaveCount(1);
    await expect(message(page)).toHaveText("Connected board1:J1.10 → led1:A.");
    await page.screenshot({ path: `test-results/pan-wiring-${size.width}x${size.height}.png` });
    expect(errors).toEqual([]);
  });
}

test("a plain click (or a tiny move) on empty canvas still cancels; Esc cancels after a pan; a press on a part cancels", async ({ page }) => {
  const errors = await open(page);
  for (const jitter of [0, 2]) {
    await startWire(page);
    const p = await emptyPoint(page);
    const before = await view(page);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.mouse.down();
    if (jitter) {
      await page.mouse.move(p.x + jitter, p.y + 1, { steps: 2 });
    }
    await page.mouse.up();
    expect(await draftActive(page)).toBe(false);
    await expect(message(page)).toHaveText("Wire cancelled.");
    await expect(wires(page)).toHaveCount(0);
    if (!jitter) {
      expect(await view(page)).toEqual(before);
    }
  }
  // Pan, then Esc.
  await startWire(page);
  await drag(page, await emptyPoint(page), 50, 30);
  expect(await draftActive(page)).toBe(true);
  await page.locator("#circuitCanvas").press("Escape");
  expect(await draftActive(page)).toBe(false);
  await expect(message(page)).toHaveText("Wire cancelled.");
  // A press on a part body cancels, as before.
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await startWire(page);
  const led = await page.locator('.part[data-part="led1"] .part-hitbox').boundingBox();
  await page.mouse.click(led.x + led.width / 2, led.y + 4);
  expect(await draftActive(page)).toBe(false);
  // Shift+drag on empty canvas while wiring cancels, as before (no box select mid-wire).
  await startWire(page);
  const s = await emptyPoint(page);
  await page.keyboard.down("Shift");
  await drag(page, s, 40, 40);
  await page.keyboard.up("Shift");
  expect(await draftActive(page)).toBe(false);
  expect(errors).toEqual([]);
});

test("releasing a pan over a pin never connects; drag-to-connect and click-to-connect still work after panning", async ({ page }) => {
  const errors = await open(page);
  // A middle-drag that starts on the target pin moves the view with it: the release is over that pin.
  await startWire(page);
  const target = await pin(page, "led1", "A");
  const end = await drag(page, target, -30, 20, "middle");
  const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest?.(".pin-anchor")?.dataset.pin ?? null, end);
  expect(under, "the release really is over the pin").toBe("A");
  await expect(wires(page)).toHaveCount(0);
  expect(await draftActive(page)).toBe(true);
  await page.locator("#circuitCanvas").press("Escape");

  // After a pan while wiring: complete by drag-to-connect from a fresh press, and by click.
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await startWire(page);
  await drag(page, await emptyPoint(page), 40, -30);
  const t = await pin(page, "led1", "A");
  await page.mouse.move(t.x, t.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(wires(page)).toHaveCount(1);
  await page.locator("#circuitCanvas").press("Control+z");
  const a = await pin(page, "board1", "J1.10");
  const b = await pin(page, "led1", "A");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await expect(wires(page)).toHaveCount(1);
  await page.locator("#circuitCanvas").press("Control+z");
  await expect(wires(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("pointercancel and another pointer during a pan while wiring", async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => window.addEventListener("pointerdown", (e) => { window.__pointerId = e.pointerId; }, { capture: true }));
  await startWire(page);
  const p = await emptyPoint(page);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(p.x + 30, p.y + 20, { steps: 6 });
  // Another pointer's release: the pan continues.
  await page.evaluate(({ x, y }) => document.querySelector("#circuitCanvas").dispatchEvent(new PointerEvent("pointerup", { pointerId: 99, clientX: x, clientY: y, bubbles: true })), p);
  const mid = await view(page);
  await page.mouse.move(p.x + 60, p.y + 40, { steps: 6 });
  expect(await view(page), "still panning").not.toEqual(mid);
  // pointercancel ends the pan without cancelling (or completing) the wire.
  await page.evaluate(({ x, y }) => document.querySelector("#circuitCanvas").dispatchEvent(new PointerEvent("pointercancel", { pointerId: window.__pointerId, clientX: x, clientY: y, bubbles: true })), p);
  const afterCancel = await view(page);
  await page.mouse.move(p.x + 90, p.y + 60, { steps: 4 });
  expect(await view(page), "no stuck pan").toEqual(afterCancel);
  await page.mouse.up();
  expect(await draftActive(page)).toBe(true);
  await expect(wires(page)).toHaveCount(0);
  await page.locator("#circuitCanvas").press("Escape");
  expect(errors).toEqual([]);
});

test("normal workspace gestures are unchanged when no wire is in progress", async ({ page }) => {
  const errors = await open(page);
  // Pan clears the selection as before.
  await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "led1" }));
  const before = await view(page);
  await drag(page, await emptyPoint(page), 40, 20);
  expect(await view(page)).not.toEqual(before);
  expect(await page.evaluate(() => window.__tm4c.workspace.selection)).toBeNull();
  // Shift+drag box-selects.
  const led = await page.locator('.part[data-part="led1"] .part-hitbox').boundingBox();
  await page.keyboard.down("Shift");
  // From empty canvas beyond the LED's bottom-right (the LED sits right of the board) back across it.
  await drag(page, { x: led.x + led.width + 15, y: led.y + led.height + 15 }, -(led.width + 30), -(led.height + 30));
  await page.keyboard.up("Shift");
  expect(await page.evaluate(() => JSON.stringify(window.__tm4c.workspace.selection))).toContain("led1");
  // A part still drags.
  const fresh = await page.locator('.part[data-part="led1"] .part-hitbox').boundingBox();
  const moveFrom = await page.evaluate(() => window.__tm4c.diagram.parts.find((p) => p.id === "led1").left);
  await drag(page, { x: fresh.x + fresh.width / 2, y: fresh.y + fresh.height / 4 }, 48, 0);
  expect(await page.evaluate(() => window.__tm4c.diagram.parts.find((p) => p.id === "led1").left)).not.toBe(moveFrom);
  expect(errors).toEqual([]);
});

test("while the firmware runs: pan while wiring, connect, and the pushbutton still works", async ({ page }) => {
  const errors = await open(page, { width: 1280, height: 720 }, "external-led-button");
  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running", { timeout: 60_000 });
  await expect(page.locator('#pinTable tr[data-pin="PA7"]')).toContainText("LOW", { timeout: 30_000 });
  // Wire J1.9 (PA6, the button input) to the new LED's anode with a pan in between.
  const a = await pin(page, "board1", "J3.2");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator(".wire-draft")).toHaveCount(1);
  await drag(page, await emptyPoint(page), -40, 20, "middle");
  expect(await draftActive(page)).toBe(true);
  const c = await pin(page, ledId(true), "C");
  await page.mouse.move(c.x, c.y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator(`.wire[data-to="${ledId(true)}:C"], .wire[data-from="${ledId(true)}:C"]`)).toHaveCount(1);
  await expect(page.locator("#simulationStatus")).toHaveText("Running");
  // The external pushbutton still presses through the GPIO model.
  const button = page.locator('.part[data-part="btn1"] .button-cap');
  await button.hover();
  await page.mouse.down();
  await expect(page.locator('#pinTable tr[data-pin="PA7"]')).toContainText("HIGH", { timeout: 30_000 });
  await page.mouse.up();
  await expect(page.locator('#pinTable tr[data-pin="PA7"]')).toContainText("LOW", { timeout: 30_000 });
  await page.click("#stopButton");
  expect(errors).toEqual([]);
});
