/*
 * Collision-aware placement: with the LaunchPad in the middle of the view
 * and an external button nearby, pasted and duplicated groups land on free,
 * visible canvas (never on the board or the button), keep their shape, grid
 * alignment, wiring, and selection, never move the view or existing parts,
 * and undo back to the original. A zoomed-in (constrained) view still gets
 * a visible placement. Screenshots at three viewport sizes.
 */
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];
const GRID = 9.6;

for (const size of SIZES) {
  test(`collision-aware paste and duplicate at ${size.width}x${size.height}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.locator("#exampleSelect option")).toHaveCount(14);
    await page.selectOption("#exampleSelect", "external-led-button");
    await expect(page.locator('.part[data-part="btn1"]')).toHaveCount(1);
    const original = await page.evaluate(() => window.__tm4c.serialize());
    // Zoom out from Fit so there is free canvas around the board (which stays in the middle).
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Zoom out" }).click();
    }
    const view = await page.evaluate(() => window.__tm4c.workspace.viewBox);
    const fixed = await page.evaluate(() => Object.fromEntries(window.__tm4c.diagram.parts.map((p) => [p.id, [p.left, p.top]])));

    await page.evaluate(() => window.__tm4c.workspace.select({ kind: "group", parts: ["led1", "r1"], wires: [] }));
    await page.locator("#circuitCanvas").focus();
    await page.locator("#circuitCanvas").press("Control+c");

    const sourceShape = await page.evaluate(() => {
      const parts = window.__tm4c.diagram.parts;
      const led = parts.find((p) => p.id === "led1");
      const r = parts.find((p) => p.id === "r1");
      return { x: r.left - led.left, y: r.top - led.top, led: [led.left, led.top] };
    });

    // The newest group: visible, off the board and the button, same shape, on grid, wired, selected.
    const checkNewest = async (label) => {
      const state = await page.evaluate(() => {
        const { workspace, diagram } = window.__tm4c;
        const selection = workspace.selection;
        const canvas = document.querySelector("#circuitCanvas").getBoundingClientRect();
        const rectOf = (id) => document.querySelector(`.part[data-part="${id}"] .part-hitbox`).getBoundingClientRect();
        const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
        const ids = selection?.kind === "group" ? selection.parts : [];
        const rects = ids.map(rectOf);
        const board = rectOf("board1");
        const button = rectOf("btn1");
        const parts = ids.map((id) => diagram.parts.find((p) => p.id === id));
        const led = parts.find((p) => p.type === "led");
        const r = parts.find((p) => p.type === "resistor");
        const wireIndex = diagram.connections.findIndex(([from, to]) => from === `${r.id}:1` && to === `${led.id}:A`);
        const ends = [...document.querySelectorAll(`.wire[data-wire="${wireIndex}"] .wire-end`)].map((c) => ({ x: Number(c.getAttribute("cx")), y: Number(c.getAttribute("cy")) }));
        const close = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
        return {
          kind: selection?.kind,
          visible: rects.length === 2 && rects.every((rect) => rect.left >= canvas.left - 1 && rect.right <= canvas.right + 1 && rect.top >= canvas.top - 1 && rect.bottom <= canvas.bottom + 1),
          onBoard: rects.some((rect) => overlaps(rect, board)),
          onButton: rects.some((rect) => overlaps(rect, button)),
          shape: { x: r.left - led.left, y: r.top - led.top },
          led: [led.left, led.top],
          attached: ends.length === 2 && close(ends[0], workspace.pinPosition(`${r.id}:1`)) && close(ends[1], workspace.pinPosition(`${led.id}:A`)),
          view: workspace.viewBox,
          message: document.querySelector("#workspaceMessage").textContent,
        };
      });
      expect(state.kind, label).toBe("group");
      expect(state.visible, `${label}: visible`).toBe(true);
      expect(state.onBoard, `${label}: not on the LaunchPad`).toBe(false);
      expect(state.onButton, `${label}: not on the external button`).toBe(false);
      expect(state.shape.x, label).toBeCloseTo(sourceShape.x, 6);
      expect(state.shape.y, label).toBeCloseTo(sourceShape.y, 6);
      for (const axis of [0, 1]) {
        const steps = (state.led[axis] - sourceShape.led[axis]) / GRID;
        expect(Math.abs(steps - Math.round(steps)), `${label}: on the 0.1 in grid`).toBeLessThan(1e-6);
      }
      expect(state.attached, `${label}: wire on its pins`).toBe(true);
      expect(state.view, `${label}: no pan or zoom`).toEqual(view);
      expect(state.message.length, `${label}: short feedback`).toBeLessThan(80);
      return state;
    };

    let firstPaste = null;
    for (let i = 1; i <= 6; i++) {
      await page.locator("#circuitCanvas").press("Control+v");
      const state = await checkNewest(`paste ${i}`);
      firstPaste ??= state.led;
    }
    for (let i = 1; i <= 3; i++) {
      await page.locator("#circuitCanvas").press("Control+d");
      await checkNewest(`duplicate ${i}`);
    }
    // Existing parts never move to make room.
    const after = await page.evaluate(() => Object.fromEntries(window.__tm4c.diagram.parts.map((p) => [p.id, [p.left, p.top]])));
    for (const [id, position] of Object.entries(fixed)) {
      expect(after[id], `${id} unchanged`).toEqual(position);
    }
    await page.screenshot({ path: `test-results/placement-${size.width}x${size.height}.png` });

    // Constrained view: zoomed in so the board fills it. The paste is still visible and the view unchanged.
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Zoom in" }).click();
    }
    const tight = await page.evaluate(() => window.__tm4c.workspace.viewBox);
    await page.locator("#circuitCanvas").press("Control+v");
    const constrained = await page.evaluate(() => {
      const { workspace } = window.__tm4c;
      const canvas = document.querySelector("#circuitCanvas").getBoundingClientRect();
      const ids = workspace.selection?.parts ?? [];
      const rects = ids.map((id) => document.querySelector(`.part[data-part="${id}"] .part-hitbox`).getBoundingClientRect());
      return {
        count: ids.length,
        visible: rects.every((rect) => rect.left >= canvas.left - 1 && rect.right <= canvas.right + 1 && rect.top >= canvas.top - 1 && rect.bottom <= canvas.bottom + 1),
        view: workspace.viewBox,
      };
    });
    expect(constrained.count).toBe(2);
    expect(constrained.visible).toBe(true);
    expect(constrained.view).toEqual(tight);
    await expect(page.locator("#workspaceMessage")).toContainText(/into (free space in )?view/);
    await page.screenshot({ path: `test-results/placement-constrained-${size.width}x${size.height}.png` });

    // 6 pastes + 3 duplicates + 1 constrained paste = 10 undo steps back to the example.
    for (let i = 0; i < 10; i++) {
      await page.locator("#circuitCanvas").press("Control+z");
    }
    expect(await page.evaluate(() => window.__tm4c.serialize())).toBe(original);
    // Redo replays the first paste exactly where it was placed.
    await page.locator("#circuitCanvas").press("Control+y");
    const redone = await page.evaluate(() => {
      const led = window.__tm4c.diagram.parts.find((p) => p.id === "led2");
      return led ? [led.left, led.top] : null;
    });
    expect(redone).toEqual(firstPaste);
    expect(errors).toEqual([]);
  });
}
