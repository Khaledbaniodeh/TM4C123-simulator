/*
 * Drag-to-connect: press on a pin, drag, release on another pin creates the
 * wire through the same path as clicking it (validation, colour, one undo
 * step), and the committed wire matches its preview. A tiny movement is still
 * a click; releasing on the start pin, an invalid pin, empty canvas, or
 * outside the canvas creates nothing; pointercancel and other pointers never
 * commit. Click-then-click wiring is unchanged.
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
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  await page.locator("#circuitCanvas").press("Escape");
  await page.evaluate(() => window.addEventListener("pointerdown", (e) => { window.__pointerId = e.pointerId; }, { capture: true }));
  return errors;
}

const pin = async (page, part, name) => {
  const box = await page.locator(`.pin-anchor[data-part="${part}"][data-pin="${name}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const wires = (page) => page.locator(".wire");
const draftActive = async (page) => (await page.locator(".wire-draft").count()) > 0;
const message = (page) => page.locator("#workspaceMessage");
const coreD = (page) => page.locator('.wire[data-from="board1:J1.10"][data-to="led1:A"] .wire-core').getAttribute("d");
const norm = (d) => d?.replace(/\s+/g, " ").trim();

/** Press on J1.10, drag to (x, y) in `steps`, and return the preview path just before release. */
async function pressAndDrag(page, to, steps = 12) {
  const a = await pin(page, "board1", "J1.10");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  return page.locator(".wire-draft").getAttribute("d");
}

for (const size of SIZES) {
  test(`drag-to-connect at ${size.width}x${size.height}, at Fit and zoomed`, async ({ page }) => {
    const errors = await open(page, size);
    for (const zoom of ["fit", "zoomed"]) {
      await page.getByRole("button", { name: "Fit", exact: true }).click();
      if (zoom === "zoomed") {
        // Zoom in as far as both pins stay visible (up to 2 steps).
        for (let i = 0; i < 2; i++) {
          await page.getByRole("button", { name: "Zoom in", exact: true }).click();
          const canvas = await page.locator("#circuitCanvas").boundingBox();
          const inside = (p) => p.x > canvas.x + 6 && p.y > canvas.y + 6 && p.x < canvas.x + canvas.width - 6 && p.y < canvas.y + canvas.height - 6;
          if (!inside(await pin(page, "board1", "J1.10")) || !inside(await pin(page, "led1", "A"))) {
            await page.getByRole("button", { name: "Zoom out", exact: true }).click();
            break;
          }
        }
      }
      const before = await page.evaluate(() => window.__tm4c.serialize());
      const preview = await pressAndDrag(page, await pin(page, "led1", "A"));
      if (zoom === "fit") {
        await page.screenshot({ path: `test-results/drag-connect-${size.width}x${size.height}.png` });
      }
      await page.mouse.up();
      await expect(wires(page)).toHaveCount(1);
      await expect(message(page)).toHaveText("Connected board1:J1.10 → led1:A.");
      expect(await draftActive(page)).toBe(false);
      expect(norm(await coreD(page)), "the committed wire matches its preview").toBe(norm(preview));
      const connected = await page.evaluate(() => window.__tm4c.serialize());

      // One undo step removes exactly this wire; redo restores it exactly.
      await page.locator("#circuitCanvas").press("Control+z");
      await expect(wires(page)).toHaveCount(0);
      expect(await page.evaluate(() => window.__tm4c.serialize())).toBe(before);
      await page.locator("#circuitCanvas").press("Control+y");
      await expect(wires(page)).toHaveCount(1);
      expect(await page.evaluate(() => window.__tm4c.serialize())).toBe(connected);
      await page.locator("#circuitCanvas").press("Control+z");
      await expect(wires(page)).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test("a tiny movement is a click: the wire starts, and click-then-click still completes it", async ({ page }) => {
  const errors = await open(page);
  const a = await pin(page, "board1", "J1.10");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 2, a.y + 1, { steps: 2 });
  await page.mouse.up();
  expect(await draftActive(page)).toBe(true);
  await expect(wires(page)).toHaveCount(0);
  await expect(message(page)).toContainText("Wiring from board1:J1.10");
  const b = await pin(page, "led1", "A");
  await page.mouse.move(b.x, b.y, { steps: 8 });
  const preview = await page.locator(".wire-draft").getAttribute("d");
  await page.mouse.down();
  await page.mouse.up();
  await expect(wires(page)).toHaveCount(1);
  expect(norm(await coreD(page))).toBe(norm(preview));
  expect(errors).toEqual([]);
});

test("releasing on the start pin, empty canvas, or outside the canvas creates nothing", async ({ page }) => {
  const errors = await open(page);
  const a = await pin(page, "board1", "J1.10");
  // Away and back to the start pin.
  await pressAndDrag(page, { x: a.x + 60, y: a.y - 40 });
  await page.mouse.move(a.x, a.y, { steps: 6 });
  await page.mouse.up();
  await expect(wires(page)).toHaveCount(0);
  expect(await draftActive(page)).toBe(true); // continues as after a click
  await page.locator("#circuitCanvas").press("Escape");
  await expect(message(page)).toHaveText("Wire cancelled.");

  // Empty canvas.
  const canvas = await page.locator("#circuitCanvas").boundingBox();
  await pressAndDrag(page, { x: canvas.x + 40, y: canvas.y + 40 });
  await page.mouse.up();
  await expect(wires(page)).toHaveCount(0);
  expect(await draftActive(page)).toBe(true);
  await page.locator("#circuitCanvas").press("Escape");

  // Outside the canvas (over the inspector), then back: no stuck gesture; a click on the target completes once.
  const inspector = await page.locator(".inspector").boundingBox();
  await pressAndDrag(page, { x: inspector.x + 40, y: inspector.y + 40 });
  await page.mouse.up();
  await expect(wires(page)).toHaveCount(0);
  const b = await pin(page, "led1", "A");
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(wires(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("releasing on an already-connected pin shows the existing message and keeps the wire in progress", async ({ page }) => {
  const errors = await open(page);
  const b = await pin(page, "led1", "A");
  await pressAndDrag(page, b);
  await page.mouse.up();
  await expect(wires(page)).toHaveCount(1);
  await pressAndDrag(page, b);
  await page.mouse.up();
  await expect(message(page)).toHaveText("These pins are already connected.");
  await expect(wires(page)).toHaveCount(1);
  expect(await draftActive(page)).toBe(true);
  await page.locator("#circuitCanvas").press("Escape");
  expect(errors).toEqual([]);
});

test("pointercancel and other pointers never commit a wire", async ({ page }) => {
  const errors = await open(page);
  const b = await pin(page, "led1", "A");
  // A pointerup from another pointer over the target does not complete the press.
  await pressAndDrag(page, b);
  await page.evaluate(({ x, y }) => {
    document.elementFromPoint(x, y).dispatchEvent(new PointerEvent("pointerup", { pointerId: 99, clientX: x, clientY: y, bubbles: true, isPrimary: false }));
  }, b);
  await expect(wires(page)).toHaveCount(0);
  await page.mouse.up(); // the real release by the pressing pointer completes it
  await expect(wires(page)).toHaveCount(1);
  await page.locator("#circuitCanvas").press("Control+z");
  await expect(wires(page)).toHaveCount(0);

  // pointercancel mid-drag: releasing over the target afterwards must not connect.
  await pressAndDrag(page, { x: b.x - 30, y: b.y + 30 });
  await page.evaluate(({ x, y }) => {
    document.elementFromPoint(x, y).dispatchEvent(new PointerEvent("pointercancel", { pointerId: window.__pointerId, clientX: x, clientY: y, bubbles: true }));
  }, { x: b.x - 30, y: b.y + 30 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await expect(wires(page)).toHaveCount(0);
  expect(await draftActive(page)).toBe(true); // the wire in progress continues as after a click
  await page.locator("#circuitCanvas").press("Escape");
  expect(errors).toEqual([]);
});

test("after drag-to-connect: the part drags with its wire, segments reroute, and the wire validates as before", async ({ page }) => {
  const errors = await open(page);
  await pressAndDrag(page, await pin(page, "led1", "A"));
  await page.mouse.up();
  await expect(wires(page)).toHaveCount(1);
  // Drag the LED: the wire end follows its pin.
  const box = await page.locator('.part[data-part="led1"] .part-hitbox').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 4 + 30, { steps: 8 });
  await page.mouse.up();
  const attached = await page.evaluate(() => {
    const ends = [...document.querySelectorAll('.wire[data-to="led1:A"] .wire-end')].map((c) => ({ x: Number(c.getAttribute("cx")), y: Number(c.getAttribute("cy")) }));
    const p = window.__tm4c.workspace.pinPosition("led1:A");
    return Math.abs(ends[1].x - p.x) < 1e-6 && Math.abs(ends[1].y - p.y) < 1e-6;
  });
  expect(attached).toBe(true);
  // Drag the wire's last segment: it reroutes, one undo restores it.
  const target = await page.evaluate(() => {
    const path = document.querySelector('.wire[data-to="led1:A"] .wire-core');
    const points = [...path.getAttribute("d").matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const i = points.length - 2;
    const svg = document.querySelector("#circuitCanvas");
    const p = svg.createSVGPoint();
    p.x = (points[i].x + points[i + 1].x) / 2;
    p.y = (points[i].y + points[i + 1].y) / 2;
    const s = p.matrixTransform(path.getScreenCTM());
    return { x: s.x, y: s.y, horizontal: points[i].y === points[i + 1].y };
  });
  const before = await page.evaluate(() => window.__tm4c.serialize());
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + (target.horizontal ? 0 : 40), target.y + (target.horizontal ? 40 : 0), { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__tm4c.diagram.connections[0][3].length)).toBeGreaterThan(0);
  await page.locator("#circuitCanvas").press("Control+z");
  expect(await page.evaluate(() => window.__tm4c.serialize())).toBe(before);
  await expect(wires(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});
