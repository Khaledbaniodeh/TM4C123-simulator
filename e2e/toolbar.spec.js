/*
 * Circuit toolbar geometry and appearance at three viewport sizes: every
 * button's position and size is recorded (GitHub notice) and must match the
 * layout measured before the toolbar icons changed (no button may shift or
 * wrap); the toolbar is captured in disabled, hover, and focus states.
 * Undo, Redo, Duplicate, and Delete use monochrome SVG icons in the button's text color,
 * drawn with the same size and stroke so they read as one icon set.
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

    // SVG icons: no text glyph, decorative, 11 px, stroked in the button's text color.
    const iconOf = (id) => page.evaluate((buttonId) => {
      const button = document.querySelector(`#${buttonId}`);
      const svg = button.querySelector("svg.toolbar-icon");
      const box = svg?.getBoundingClientRect();
      const style = svg ? getComputedStyle(svg) : null;
      return {
        text: button.textContent.trim(),
        svg: Boolean(svg),
        hidden: svg?.getAttribute("aria-hidden"),
        focusable: svg?.getAttribute("focusable"),
        size: box ? `${Math.round(box.width)}x${Math.round(box.height)}` : null,
        stroke: style?.stroke ?? null,
        strokeStyle: style ? `${style.strokeWidth} ${style.strokeLinecap} ${style.strokeLinejoin}` : null,
        fill: style?.fill ?? null,
        color: getComputedStyle(button).color,
        label: button.getAttribute("aria-label"),
        title: button.title,
        disabled: button.disabled,
      };
    }, id);
    const expected = {
      undoButton: { label: "Undo", title: "Undo (Ctrl+Z)" },
      redoButton: { label: "Redo", title: "Redo (Ctrl+Y)" },
      deleteButton: { label: "Delete selection", title: "Delete (Del)" },
      duplicateButton: { label: "Duplicate selected part", title: "Duplicate (Ctrl+D)" },
    };
    const icons = {};
    for (const [id, names] of Object.entries(expected)) {
      icons[id] = await iconOf(id);
      expect(icons[id], id).toEqual({
        text: "",
        svg: true,
        hidden: "true",
        focusable: "false",
        size: "11x11",
        stroke: icons[id].color,
        strokeStyle: icons[id].strokeStyle,
        fill: "none",
        color: icons[id].color,
        ...names,
        disabled: true,
      });
    }
    // One visual language: same size, stroke weight, caps, joins, and color source.
    for (const id of ["undoButton", "redoButton", "duplicateButton"]) {
      expect(icons[id].strokeStyle, id).toBe(icons.deleteButton.strokeStyle);
      expect(icons[id].size, id).toBe(icons.deleteButton.size);
      expect(icons[id].color, id).toBe(icons.deleteButton.color);
    }
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-disabled.png` });

    // Select a part so Delete is enabled.
    await page.getByRole("button", { name: /Part/ }).click();
    await page.locator('.library-item[data-type="led"]').click();
    await expect(page.getByRole("button", { name: "Delete selection" })).toBeEnabled();
    const enabled = await geometry();
    expect(enabled, "enabling buttons does not move them").toBe(disabled);
    await expect(page.getByRole("button", { name: "Duplicate selected part" })).toBeEnabled();

    // The icon group (Undo ... Delete) at the browser's actual rendered pixel size.
    const group = await page.evaluate(() => {
      const first = document.querySelector("#undoButton").getBoundingClientRect();
      const last = document.querySelector("#deleteButton").getBoundingClientRect();
      return { x: first.left - 4, y: first.top - 4, width: last.right - first.left + 8, height: first.height + 8 };
    });
    await page.screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-icons-actual-size.png`, clip: group });

    // Duplicate: hover color, keyboard focus (Tab from Rotate), button click, Ctrl+D, and undo.
    await page.getByRole("button", { name: "Duplicate selected part" }).hover();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#duplicateButton svg")).stroke))
      .toBe(await page.evaluate(() => getComputedStyle(document.querySelector("#duplicateButton")).color));
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-duplicate-hover.png` });
    await page.mouse.move(0, 0);
    await page.locator("#rotateButton").focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement.id)).toBe("duplicateButton");
    expect(await page.evaluate(() => document.activeElement.matches(":focus-visible"))).toBe(true);
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-duplicate-focus.png` });
    await page.keyboard.press("Enter"); // keyboard activation duplicates like a click
    await expect(page.locator('.part[data-part="led2"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Duplicate selected part" }).click();
    await expect(page.locator('.part[data-part="led3"]')).toHaveCount(1);
    await page.locator("#circuitCanvas").press("Control+d");
    await expect(page.locator('.part[data-part="led4"]')).toHaveCount(1);
    expect(await geometry(), "duplicating does not move toolbar buttons").toBe(disabled);

    // Undo reverts one duplicate each: button click, keyboard focus (Tab from Part) + Enter, and Ctrl+Z.
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    await expect(undo).toBeEnabled();
    await undo.hover();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#undoButton svg")).stroke))
      .toBe(await page.evaluate(() => getComputedStyle(document.querySelector("#undoButton")).color));
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-undo-hover.png` });
    await undo.click();
    await expect(page.locator('.part[data-part="led4"]')).toHaveCount(0);
    await page.mouse.move(0, 0);
    await page.locator("#addPartButton").focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement.id)).toBe("undoButton");
    expect(await page.evaluate(() => document.activeElement.matches(":focus-visible"))).toBe(true);
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-undo-focus.png` });
    await page.keyboard.press("Enter");
    await expect(page.locator('.part[data-part="led3"]')).toHaveCount(0);
    await page.locator("#circuitCanvas").press("Control+z");
    await expect(page.locator('.part[data-part^="led"]')).toHaveCount(1);
    expect(await geometry(), "undoing does not move toolbar buttons").toBe(disabled);

    // Redo restores each undone duplicate: button click, keyboard focus (Tab from Undo) + Enter,
    // Ctrl+Y, and Ctrl+Shift+Z after one more undo.
    const redo = page.getByRole("button", { name: "Redo", exact: true });
    await expect(redo).toBeEnabled();
    await redo.hover();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#redoButton svg")).stroke))
      .toBe(await page.evaluate(() => getComputedStyle(document.querySelector("#redoButton")).color));
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-redo-hover.png` });
    await redo.click();
    await expect(page.locator('.part[data-part="led2"]')).toHaveCount(1);
    await page.mouse.move(0, 0);
    await page.locator("#undoButton").focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement.id)).toBe("redoButton");
    expect(await page.evaluate(() => document.activeElement.matches(":focus-visible"))).toBe(true);
    await page.locator(".simulator-toolbar").screenshot({ path: `test-results/toolbar-${size.width}x${size.height}-redo-focus.png` });
    await page.keyboard.press("Enter");
    await expect(page.locator('.part[data-part="led3"]')).toHaveCount(1);
    await page.locator("#circuitCanvas").press("Control+y");
    await expect(page.locator('.part[data-part="led4"]')).toHaveCount(1);
    await expect(redo).toBeDisabled();
    await page.locator("#circuitCanvas").press("Control+z");
    await expect(page.locator('.part[data-part="led4"]')).toHaveCount(0);
    await page.locator("#circuitCanvas").press("Control+Shift+z");
    await expect(page.locator('.part[data-part="led4"]')).toHaveCount(1);
    await expect(redo).toBeDisabled();
    expect(await geometry(), "redoing does not move toolbar buttons").toBe(disabled);
    for (let i = 0; i < 3; i++) {
      await page.locator("#circuitCanvas").press("Control+z");
    }
    await expect(page.locator('.part[data-part^="led"]')).toHaveCount(1);
    await page.evaluate(() => window.__tm4c.workspace.select({ kind: "part", id: "led1" }));
    await expect(page.getByRole("button", { name: "Delete selection" })).toBeEnabled();
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

    // Undo the delete, then the add: the history is empty again and Undo is disabled.
    await undo.click();
    await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
    await undo.click();
    await expect(page.locator('.part[data-part^="led"]')).toHaveCount(0);
    await expect(undo).toBeDisabled();
    expect(await geometry(), "Undo disabled again: no toolbar button moved").toBe(disabled);

    // Redo replays the add and then the delete; with nothing left to redo it is disabled.
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
    await redo.click();
    await expect(page.locator('.part[data-part="led1"]')).toHaveCount(0);
    await expect(redo).toBeDisabled();
    await expect(undo).toBeEnabled();
    expect(await geometry(), "Redo disabled again: no toolbar button moved").toBe(disabled);
    expect(errors).toEqual([]);
  });
}
