/*
 * Smart paste: repeated pastes and duplicates stay visible without moving
 * the view, keep relative positions, grid alignment, and wiring, select the
 * new items, and undo back to the original diagram. Run at three viewport
 * sizes with a screenshot each.
 */
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];
const GRID = 9.6;

for (const size of SIZES) {
  test(`smart paste keeps pasted items visible at ${size.width}x${size.height}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.locator("#exampleSelect option")).toHaveCount(14);
    await page.selectOption("#exampleSelect", "external-led-button");
    await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
    const original = await page.evaluate(() => window.__tm4c.serialize());

    // Zoom in so a 0.3 in cascade soon leaves the visible area.
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    const view = await page.evaluate(() => window.__tm4c.workspace.viewBox);

    await page.evaluate(() => window.__tm4c.workspace.select({ kind: "group", parts: ["led1", "r1"], wires: [] }));
    await page.locator("#circuitCanvas").focus();
    await page.locator("#circuitCanvas").press("Control+c");
    await expect(page.locator("#workspaceMessage")).toContainText("Copied 2 parts and 1 wire");

    const source = await page.evaluate(() => {
      const parts = window.__tm4c.diagram.parts;
      const led = parts.find((p) => p.id === "led1");
      const r = parts.find((p) => p.id === "r1");
      return { led: { left: led.left, top: led.top }, offset: { x: r.left - led.left, y: r.top - led.top } };
    });

    // Checks the newest pasted/duplicated pair: visible, same shape, on the grid, wired, selected.
    const checkNewest = async (label) => {
      const state = await page.evaluate(() => {
        const { workspace, diagram } = window.__tm4c;
        const selection = workspace.selection;
        const canvas = document.querySelector("#circuitCanvas").getBoundingClientRect();
        const ids = selection?.kind === "group" ? selection.parts : [];
        const rects = ids.map((id) => document.querySelector(`.part[data-part="${id}"] .part-hitbox`).getBoundingClientRect());
        const visible = rects.length > 0 && rects.every((r) => r.left >= canvas.left - 1 && r.right <= canvas.right + 1 && r.top >= canvas.top - 1 && r.bottom <= canvas.bottom + 1);
        const parts = ids.map((id) => diagram.parts.find((p) => p.id === id));
        const led = parts.find((p) => p.type === "led");
        const r = parts.find((p) => p.type === "resistor");
        const wireIndex = diagram.connections.findIndex(([from, to]) => from === `${r.id}:1` && to === `${led.id}:A`);
        const ends = [...document.querySelectorAll(`.wire[data-wire="${wireIndex}"] .wire-end`)].map((c) => ({ x: Number(c.getAttribute("cx")), y: Number(c.getAttribute("cy")) }));
        const close = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
        const attached = ends.length === 2 && close(ends[0], workspace.pinPosition(`${r.id}:1`)) && close(ends[1], workspace.pinPosition(`${led.id}:A`));
        return {
          kind: selection?.kind,
          wires: selection?.wires?.length ?? 0,
          visible,
          led: { left: led.left, top: led.top },
          offset: { x: r.left - led.left, y: r.top - led.top },
          attached,
          view: workspace.viewBox,
        };
      });
      expect(state.kind, label).toBe("group");
      expect(state.wires, label).toBe(1);
      expect(state.visible, `${label}: pasted parts inside the visible canvas`).toBe(true);
      expect(state.view, `${label}: no pan or zoom`).toEqual(view);
      expect(state.offset.x, label).toBeCloseTo(source.offset.x, 6);
      expect(state.offset.y, label).toBeCloseTo(source.offset.y, 6);
      const steps = { x: (state.led.left - source.led.left) / GRID, y: (state.led.top - source.led.top) / GRID };
      expect(Math.abs(steps.x - Math.round(steps.x)), `${label}: on the 0.1 in grid`).toBeLessThan(1e-6);
      expect(Math.abs(steps.y - Math.round(steps.y)), `${label}: on the 0.1 in grid`).toBeLessThan(1e-6);
      expect(state.attached, `${label}: wire on its pins`).toBe(true);
      return state;
    };

    let relocated = false;
    const positions = new Set();
    for (let i = 1; i <= 10; i++) {
      await page.locator("#circuitCanvas").press("Control+v");
      const state = await checkNewest(`paste ${i}`);
      positions.add(`${state.led.left},${state.led.top}`);
      relocated ||= /in the middle of the view/.test(await page.locator("#workspaceMessage").textContent());
    }
    expect(relocated, "the cascade left the view at least once and smart paste placed items in view").toBe(true);
    expect(positions.size, "pastes do not stack exactly on top of each other").toBe(10);
    await page.screenshot({ path: `test-results/smart-paste-${size.width}x${size.height}.png` });

    // Ctrl+D on the pasted group follows the same rule.
    for (let i = 1; i <= 5; i++) {
      await page.locator("#circuitCanvas").press("Control+d");
      await checkNewest(`duplicate ${i}`);
    }

    // Every paste and duplicate is one undo step; undoing all restores the example.
    for (let i = 0; i < 15; i++) {
      await page.locator("#circuitCanvas").press("Control+z");
    }
    expect(await page.evaluate(() => window.__tm4c.serialize())).toBe(original);
    expect(errors).toEqual([]);
  });
}
