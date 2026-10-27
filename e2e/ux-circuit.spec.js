/*
 * Building circuits: the component library (search, groups, drawings,
 * keyboard), insertion, and what the canvas shows while a wire is drawn.
 * Real pointer and keyboard input in the real app; screenshots per state.
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
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();
  return errors;
}

const pin = async (page, part, name) => {
  const box = await page.locator(`.pin-anchor[data-part="${part}"][data-pin="${name}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

for (const size of SIZES) {
  const tag = `${size.width}x${size.height}`;
  test(`the library lists every part with its drawing, grouped, inside the window, at ${tag}`, async ({ page }) => {
    const errors = await open(page, size);
    await page.getByRole("button", { name: /Part/ }).click();
    const library = page.locator("#partLibrary");
    await expect(library).toBeVisible();
    await expect(page.locator("#librarySearch")).toBeFocused();
    const items = library.locator(".library-item");
    await expect(items).toHaveCount(6);
    for (const type of ["led", "resistor", "pushbutton", "potentiometer", "lcd1602", "logic-analyzer"]) {
      const item = library.locator(`.library-item[data-type="${type}"]`);
      await expect(item).toBeVisible();
      // The part's own artwork, not a placeholder.
      expect(await item.locator("svg.library-preview").evaluate((svg) => svg.querySelectorAll("path, rect, circle, line, polyline, text").length)).toBeGreaterThan(2);
    }
    await expect(library.locator(".library-group")).toHaveText(["Outputs", "Inputs", "Passive", "Displays", "Instruments"]);
    await expect(library.locator('.library-item[data-type="logic-analyzer"] .status-chip')).toHaveText("editor only");
    await expect(library.locator('.library-item[data-type="led"] .status-chip')).toHaveText("simulated");
    const box = await library.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    await page.screenshot({ path: `test-results/ux-library-${tag}.png` });
    expect(errors).toEqual([]);
  });
}

test("search, arrow keys and Enter add a part; it is selected, and the library closes", async ({ page }) => {
  const errors = await open(page);
  await page.locator("#circuitCanvas").focus();
  await page.keyboard.press("a");
  await expect(page.locator("#librarySearch")).toBeFocused();
  await page.keyboard.type("pot");
  const visible = page.locator("#partLibrary .library-item:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveAttribute("data-type", "potentiometer");
  await page.screenshot({ path: "test-results/ux-library-search-1280x720.png" });
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('#partLibrary .library-item[data-type="potentiometer"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('.part[data-part="pot1"]')).toHaveCount(1);
  await expect(page.locator("#partLibrary")).toBeHidden();
  await expect(page.locator("#selectionPanel")).toContainText("pot1");

  // No match: says so, and names what is supported. Enter in the search box adds the first match.
  await page.getByRole("button", { name: /Part/ }).click();
  await page.keyboard.type("servo");
  await expect(page.locator("#partLibrary .library-empty")).toBeVisible();
  await expect(page.locator("#partLibrary .library-item:visible")).toHaveCount(0);
  await page.locator("#librarySearch").fill("lcd");
  await page.keyboard.press("Enter");
  await expect(page.locator('.part[data-part="lcd1"]')).toHaveCount(1);

  // A press outside closes it; Escape closes it and returns to the button.
  await page.getByRole("button", { name: /Part/ }).click();
  await expect(page.locator("#partLibrary")).toBeVisible();
  await page.mouse.click(5, 300);
  await expect(page.locator("#partLibrary")).toBeHidden();
  await page.getByRole("button", { name: /Part/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#partLibrary")).toBeHidden();
  await expect(page.locator("#addPartButton")).toBeFocused();
  expect(errors).toEqual([]);
});

test("while a wire is drawn every pin shows as a target and the start is marked; finishing or Esc clears it", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: /Part/ }).click();
  await page.locator('.library-item[data-type="led"]').click();
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  await page.locator("#circuitCanvas").press("Escape");
  const canvas = page.locator("#circuitCanvas");

  // Click-to-click: the canvas is in wiring mode until the wire is made.
  const a = await pin(page, "board1", "J2.3");
  await page.mouse.click(a.x, a.y);
  await expect(canvas).toHaveClass(/is-wiring/);
  await expect(page.locator('.pin-anchor[data-part="board1"][data-pin="J2.3"]')).toHaveClass(/is-source/);
  expect(await page.locator('.pin-anchor[data-part="led1"][data-pin="A"]').evaluate((node) => getComputedStyle(node).fill)).not.toBe("rgba(0, 0, 0, 0)");
  await page.mouse.move(a.x - 40, a.y + 30);
  await page.screenshot({ path: "test-results/ux-wiring-targets-1280x720.png" });
  await canvas.press("Escape");
  await expect(canvas).not.toHaveClass(/is-wiring/);
  await expect(page.locator(".pin-anchor.is-source")).toHaveCount(0);

  // Drag-to-connect: the same feedback, cleared when the wire is created.
  const start = await pin(page, "board1", "J2.3");
  const end = await pin(page, "led1", "A");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await expect(canvas).toHaveClass(/is-wiring/);
  await page.mouse.up();
  await expect(page.locator(".wire")).toHaveCount(1);
  await expect(canvas).not.toHaveClass(/is-wiring/);
  await expect(page.locator("#workspaceMessage")).toHaveText("Connected board1:J2.3 → led1:A.");
  expect(errors).toEqual([]);
});
