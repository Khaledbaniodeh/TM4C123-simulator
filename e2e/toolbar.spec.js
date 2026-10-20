/*
 * Circuit toolbar geometry and appearance at three viewport sizes: every
 * button's position and size is recorded (GitHub notice) and must match the
 * layout measured before the toolbar icons changed (no button may shift or
 * wrap); the toolbar is captured in disabled, hover, and focus states.
 * The Delete button uses a monochrome SVG icon in the button's text color.
 */
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

// Measured on e57faf4 (Unicode glyph icons), CI Linux Chromium.
const BASELINE = {
  "1024x768": "addPartButton:452,185,52x27 undoButton:532,185,27x27 redoButton:567,185,27x27 rotateButton:602,185,27x27 duplicateButton:637,185,27x27 deleteButton:672,185,27x27 zoomOutButton:726,185,27x27 zoomInButton:813,185,27x27 fitButton:848,185,40x27 gridToggle:896,185,40x27 snapToggle:944,185,44x27 saveDiagramButton:452,216,43x27 Load:503,216,42x27",
  "1280x720": "addPartButton:447,186,52x27 undoButton:526,186,27x27 redoButton:561,186,27x27 rotateButton:596,186,27x27 duplicateButton:631,186,27x27 deleteButton:666,186,27x27 zoomOutButton:720,186,27x27 zoomInButton:807,186,27x27 fitButton:842,186,40x27 gridToggle:890,186,40x27 snapToggle:938,186,44x27 saveDiagramButton:1009,186,43x27 Load:1060,186,42x27",
  "1920x1080": "addPartButton:665,168,52x27 undoButton:744,168,27x27 redoButton:779,168,27x27 rotateButton:814,168,27x27 duplicateButton:849,168,27x27 deleteButton:884,168,27x27 zoomOutButton:938,168,27x27 zoomInButton:1025,168,27x27 fitButton:1060,168,40x27 gridToggle:1108,168,40x27 snapToggle:1156,168,44x27 saveDiagramButton:1227,168,43x27 Load:1278,168,42x27",
};

for (const size of SIZES) {
  test(`circuit toolbar at ${size.width}x${size.height}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.locator("#exampleSelect option")).toHaveCount(14);
    await expect(page.locator('.part[data-type="tm4c123gxl-launchpad"]')).toBeVisible();

    const geometry = () => page.evaluate(() =>
      [...document.querySelectorAll(".simulator-toolbar > button, .simulator-toolbar > .library-anchor > button, .simulator-toolbar > label.file-button")].map((node) => {
        const r = node.getBoundingClientRect();
        return `${node.id || node.textContent.trim()}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`;
      }).join(" "));

    const disabled = await geometry();
    console.log(`::notice title=toolbar ${size.width}x${size.height} (nothing selected)::${disabled}`);
    expect(disabled, "no toolbar button shifted, resized, or wrapped").toBe(BASELINE[`${size.width}x${size.height}`]);

    // Delete: monochrome SVG in the button's text color; same label, tooltip, and state.
    const icon = await page.evaluate(() => {
      const button = document.querySelector("#deleteButton");
      const svg = button.querySelector("svg.toolbar-icon");
      const box = svg?.getBoundingClientRect();
      return {
        text: button.textContent.trim(),
        svg: Boolean(svg),
        hidden: svg?.getAttribute("aria-hidden"),
        focusable: svg?.getAttribute("focusable"),
        size: box ? `${Math.round(box.width)}x${Math.round(box.height)}` : null,
        stroke: svg ? getComputedStyle(svg).stroke : null,
        fill: svg ? getComputedStyle(svg).fill : null,
        color: getComputedStyle(button).color,
        title: button.title,
        disabled: button.disabled,
      };
    });
    expect(icon).toEqual({
      text: "",
      svg: true,
      hidden: "true",
      focusable: "false",
      size: "13x13",
      stroke: icon.color,
      fill: "none",
      color: icon.color,
      title: "Delete (Del)",
      disabled: true,
    });
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-disabled.png` });

    // Select a part so Delete is enabled.
    await page.getByRole("button", { name: /Part/ }).click();
    await page.locator('.library-item[data-type="led"]').click();
    await expect(page.getByRole("button", { name: "Delete selection" })).toBeEnabled();
    const enabled = await geometry();
    expect(enabled, "enabling buttons does not move them").toBe(disabled);
    await page.getByRole("button", { name: "Delete selection" }).hover();
    // The icon follows the hover text color.
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#deleteButton svg")).stroke))
      .toBe(await page.evaluate(() => getComputedStyle(document.querySelector("#deleteButton")).color));
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-hover.png` });
    await page.getByRole("button", { name: "Delete selection" }).focus();
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-focus.png` });

    // Clicking Delete still removes the selected part.
    await page.getByRole("button", { name: "Delete selection" }).click();
    await expect(page.locator('.part[data-part="led1"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete selection" })).toBeDisabled();

    // The keyboard shortcut is unchanged: undo, reselect, and press Delete on the canvas.
    await page.locator("#circuitCanvas").press("Control+z");
    await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
    await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "led1" }));
    await expect(page.getByRole("button", { name: "Delete selection" })).toBeEnabled();
    await page.locator("#circuitCanvas").press("Delete");
    await expect(page.locator('.part[data-part="led1"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
