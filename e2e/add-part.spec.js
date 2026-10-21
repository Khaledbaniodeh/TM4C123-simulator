/*
 * Add Part placement: a part added from the library lands on free, visible
 * canvas (never on the LaunchPad or another part when there is room), on the
 * grid, selected, without moving the view; repeated additions do not stack.
 * A zoomed-in view with no free space still places the part in view and says
 * that it overlaps. The new part edits, wires, undoes, and persists normally.
 */
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];
const GRID = 9.6;

async function open(page, size) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();
  return errors;
}

async function addPart(page, type) {
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator(`.library-item[data-type="${type}"]`).click();
}

/** Screen boxes of every part, the canvas, and the current view. */
const layout = (page) => page.evaluate(() => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  return {
    parts: Object.fromEntries([...document.querySelectorAll(".part")].map((el) => [el.dataset.part, box(el.querySelector(".part-hitbox"))])),
    canvas: box(document.querySelector("#circuitCanvas")),
    view: { ...window.__tm4c.workspace.viewBox },
    positions: Object.fromEntries(window.__tm4c.diagram.parts.map((p) => [p.id, [p.left, p.top]])),
  };
});

const overlaps = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5
  && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
const inside = (a, c) => a.x >= c.x - 0.5 && a.y >= c.y - 0.5 && a.x + a.width <= c.x + c.width + 0.5 && a.y + a.height <= c.y + c.height + 0.5;
const onGrid = (v) => Math.abs(v / GRID - Math.round(v / GRID)) < 1e-6;

for (const size of SIZES) {
  test(`added parts land on free, visible canvas at ${size.width}x${size.height}`, async ({ page }) => {
    const errors = await open(page, size);
    const before = await layout(page);
    const added = [];
    for (const [type, id] of [["led", "led1"], ["resistor", "r1"], ["pushbutton", "btn1"], ["led", "led2"], ["potentiometer", "pot1"]]) {
      await addPart(page, type);
      await expect(page.locator(`.part[data-part="${id}"]`)).toHaveCount(1);
      await expect(page.locator(".selection-panel")).toContainText(id); // the new part is selected
      added.push(id);
      if (id === "led1") {
        await page.screenshot({ path: `test-results/add-part-first-${size.width}x${size.height}.png` });
      }
    }
    const after = await layout(page);
    console.log(`::notice title=add part ${size.width}x${size.height}::${JSON.stringify(Object.fromEntries(added.map((id) => [id, after.positions[id]])))}`);
    expect(after.view, "the view does not pan or zoom").toEqual(before.view);
    expect(after.positions.board1, "the board does not move").toEqual(before.positions.board1);
    for (const id of added) {
      expect(inside(after.parts[id], after.canvas), `${id} visible`).toBe(true);
      expect(overlaps(after.parts[id], after.parts.board1), `${id} off the board`).toBe(false);
      for (const other of added.filter((o) => o !== id)) {
        expect(overlaps(after.parts[id], after.parts[other]), `${id} does not overlap ${other}`).toBe(false);
      }
      expect(after.positions[id].every(onGrid), `${id} on the grid`).toBe(true);
    }
    await page.screenshot({ path: `test-results/add-part-${size.width}x${size.height}.png` });
    expect(errors).toEqual([]);
  });
}

test("placement is deterministic and respects existing example parts", async ({ page }) => {
  const errors = await open(page, { width: 1280, height: 720 });
  await page.selectOption("#exampleSelect", "external-led-button");
  await expect(page.locator('.part[data-part="btn1"]')).toHaveCount(1);
  await addPart(page, "led");
  const first = await layout(page);
  for (const id of ["board1", "led1", "r1", "btn1"]) {
    expect(overlaps(first.parts.led2, first.parts[id]), `led2 clear of ${id}`).toBe(false);
  }
  expect(inside(first.parts.led2, first.canvas)).toBe(true);

  // Undo, add again: the same spot (deterministic); redo is replaced by the new add.
  await page.locator("#circuitCanvas").press("Control+z");
  await expect(page.locator('.part[data-part="led2"]')).toHaveCount(0);
  await addPart(page, "led");
  expect((await layout(page)).positions.led2).toEqual(first.positions.led2);
  expect(errors).toEqual([]);
});

test("a new part moves, rotates, wires, undoes, redoes, and persists", async ({ page }) => {
  const errors = await open(page, { width: 1280, height: 720 });
  await addPart(page, "led");
  const led = page.locator('.part[data-part="led1"]');
  const placed = (await layout(page)).positions.led1;

  const box = await led.locator(".part-hitbox").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 4 + 20, { steps: 5 });
  await page.mouse.up();
  const dragged = (await layout(page)).positions.led1;
  expect(dragged).not.toEqual(placed);
  await page.locator("#circuitCanvas").press("r");
  await expect(led).toHaveAttribute("transform", /rotate\(90/);
  await page.locator('.pin-anchor[data-part="board1"][data-pin="J1.10"]').click();
  await page.locator('.pin-anchor[data-part="led1"][data-pin="A"]').click();
  await expect(page.locator('.wire[data-from="board1:J1.10"][data-to="led1:A"]')).toHaveCount(1);

  // Undo wire, rotate, move, add; redo all four.
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await undo.click();
  await expect(page.locator(".wire")).toHaveCount(0);
  await undo.click();
  await expect(led).not.toHaveAttribute("transform", /rotate/);
  await undo.click();
  expect((await layout(page)).positions.led1).toEqual(placed);
  await undo.click();
  await expect(led).toHaveCount(0);
  for (let i = 0; i < 4; i++) {
    await redo.click();
  }
  await expect(page.locator(".wire")).toHaveCount(1);
  await expect(led).toHaveAttribute("transform", /rotate\(90/);
  const final = await page.evaluate(() => window.__tm4c.serialize());

  // Workspace persistence (PR #18): a reload restores the circuit exactly.
  await page.reload();
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.__tm4c.serialize())).toBe(final);
  expect(errors).toEqual([]);
});

test("zoomed in with no free space: the part stays in view and the message says it overlaps", async ({ page }) => {
  const errors = await open(page, { width: 1280, height: 720 });
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  }
  const before = await layout(page);
  await addPart(page, "led");
  await expect(page.locator("#workspaceMessage")).toHaveText("Added into view; no free space, so it overlaps.");
  const after = await layout(page);
  expect(after.view).toEqual(before.view);
  expect(inside(after.parts.led1, after.canvas)).toBe(true);
  expect(after.positions.led1.every(onGrid)).toBe(true);
  await page.screenshot({ path: "test-results/add-part-crowded-1280x720.png" });
  expect(errors).toEqual([]);
});
