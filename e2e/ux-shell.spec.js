/*
 * The application shell: the circuit gets the space; the output panel and
 * inspector fold away until needed; the code | circuit split is resizable;
 * help and keyboard shortcuts are discoverable; a first-run pointer leads to
 * Run. Every check drives the real app (real GCC and Renode where it runs
 * firmware) and saves a screenshot per state and size.
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

const box = (page, selector) => page.locator(selector).evaluate((node) => node.getBoundingClientRect().toJSON());
const shot = (page, name) => page.screenshot({ path: `test-results/ux-${name}.png` });

for (const size of SIZES) {
  const tag = `${size.width}x${size.height}`;
  test(`the circuit gets the space; tools and the trust notice stay on screen, at ${tag}`, async ({ page }) => {
    const errors = await open(page, size);

    // No horizontal scrolling; every control inside the viewport.
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    for (const id of ["#exampleSelect", "#compileButton", "#runButton", "#pauseButton", "#resetButton", "#stopButton", "#helpButton", "#addPartButton", "#inspectorToggle", "#loadDiagramButton"]) {
      const b = await box(page, id);
      expect(b.right, id).toBeLessThanOrEqual(size.width);
      expect(b.bottom, id).toBeLessThanOrEqual(size.height);
      expect(b.width, id).toBeGreaterThan(0);
    }
    // The run controls share one row in the top bar.
    const run = await box(page, "#runButton");
    for (const id of ["#compileButton", "#pauseButton", "#resetButton", "#stopButton"]) {
      expect(Math.abs((await box(page, id)).top - run.top), id).toBeLessThan(4);
    }

    // The trust notice is always visible, on one line, in the status bar.
    await expect(page.locator("#modeNotice")).toBeVisible();
    await expect(page.locator("#modeNotice")).toContainText("not sandboxed — only run code you trust");
    expect((await box(page, "#modeNotice")).height).toBeLessThanOrEqual(20);

    // The output panel starts folded to one line; the inspector starts open only on wide screens.
    await expect(page.locator("#consolePanel")).toHaveAttribute("data-open", "false");
    expect((await box(page, "#consolePanel")).height).toBeLessThanOrEqual(36);
    await expect(page.locator(".simulator-panel")).toHaveAttribute("data-inspector", size.width >= 1280 ? "open" : "closed");

    // The canvas: at least 70% of the window height, and at least 44% of its width.
    const canvas = await box(page, "#circuitCanvas");
    console.log(`::notice title=canvas ${tag}::${Math.round(canvas.width)}x${Math.round(canvas.height)}`);
    expect(canvas.height).toBeGreaterThanOrEqual(size.height * 0.7);
    expect(canvas.width).toBeGreaterThanOrEqual(size.width * 0.44);
    await shot(page, `open-${tag}`);
    expect(errors).toEqual([]);
  });
}

test("the output panel folds to one line, shows the newest message, and opens for problems", async ({ page }) => {
  const errors = await open(page);
  const panel = page.locator("#consolePanel");
  await expect(page.locator("#consolePreview")).toContainText("Workspace ready");
  await expect(page.locator("#consoleTools")).toBeHidden();

  // A tab opens it, with the console's tools; the toggle folds it again.
  await page.getByRole("tab", { name: /Console/ }).click();
  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(page.locator("#consoleTools")).toBeVisible();
  expect((await box(page, "#consolePanel")).height).toBeGreaterThan(120);
  await page.getByRole("button", { name: "Hide output" }).click();
  await expect(panel).toHaveAttribute("data-open", "false");

  // A build error opens it on Problems, with the error.
  const source = await page.inputValue("#codeEditor");
  await page.fill("#codeEditor", source.replace(/int\s+main\s*\(\s*void\s*\)\s*\{/, "int main(void)\n{\n    undeclared_symbol = 1;"));
  await page.click("#compileButton");
  await expect(page.locator("#problemCount")).not.toHaveText("0", { timeout: 90_000 });
  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(page.getByRole("tab", { name: /Problems/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#problemsOutput")).toContainText("undeclared_symbol");
  await expect(page.locator("#editorStatus")).toHaveAttribute("data-state", "failed");
  await shot(page, "problems-1280x720");
  expect(errors).toEqual([]);
});

test("the code | circuit split follows the splitter (pointer and keys) and is remembered", async ({ page }) => {
  const errors = await open(page);
  const splitter = page.locator("#splitter");
  const before = (await box(page, "#editorPanel")).width;
  const s = await box(page, "#splitter");
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + 160, s.y + s.height / 2, { steps: 8 });
  await page.mouse.up();
  const dragged = (await box(page, "#editorPanel")).width;
  expect(dragged).toBeGreaterThan(before + 120);

  await splitter.focus();
  const value = Number(await splitter.getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowLeft");
  await expect(splitter).toHaveAttribute("aria-valuenow", String(value - 2));

  // Kept across a reload; a double-click restores the default.
  await page.reload();
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(splitter).toHaveAttribute("aria-valuenow", String(value - 2));
  await splitter.dblclick();
  await expect(splitter).toHaveAttribute("aria-valuenow", "34");
  expect(errors).toEqual([]);
});

test("on a narrow screen the inspector opens for a selected part, unless the user hid it", async ({ page }) => {
  const errors = await open(page, { width: 1024, height: 768 });
  await page.selectOption("#exampleSelect", "external-led-button");
  await expect(page.locator('.part[data-part="led1"]')).toHaveCount(1);
  const panel = page.locator(".simulator-panel");
  await expect(panel).toHaveAttribute("data-inspector", "closed");
  await page.locator('.part[data-part="led1"] .part-hitbox').click();
  await expect(panel).toHaveAttribute("data-inspector", "open");
  await expect(page.locator("#selectionPanel")).toContainText("led1");
  await shot(page, "inspector-1024x768");

  // Hidden by the user: it stays hidden for later selections.
  await page.locator("#inspectorToggle").click();
  await expect(panel).toHaveAttribute("data-inspector", "closed");
  await page.locator('.part[data-part="btn1"] .part-hitbox').click();
  await expect(page.locator("#selectionPanel")).toContainText("btn1");
  await expect(panel).toHaveAttribute("data-inspector", "closed");
  expect(errors).toEqual([]);
});

test("help, shortcuts, and the first-run pointer to Run", async ({ page }) => {
  const errors = await open(page);
  // First visit: a pointer to Run, which never takes a click.
  const hint = page.locator("#runHint");
  await expect(hint).toBeVisible();
  expect(await hint.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");
  await shot(page, "first-run-1280x720");

  // ? opens help with the shortcuts; Esc closes it.
  await page.locator("#circuitCanvas").focus();
  await page.keyboard.press("?");
  await expect(page.locator("#helpPanel")).toBeVisible();
  await expect(page.locator("#helpPanel")).toContainText("Ctrl+Enter");
  await shot(page, "help-1280x720");
  await page.keyboard.press("Escape");
  await expect(page.locator("#helpPanel")).toBeHidden();
  await expect(hint).toBeHidden(); // seen the help: the pointer is done

  // A opens the component library.
  await page.locator("#circuitCanvas").focus();
  await page.keyboard.press("a");
  await expect(page.locator("#partLibrary")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#partLibrary")).toBeHidden();

  // Ctrl+B compiles; Ctrl+Enter runs, even from the editor.
  await page.locator("#circuitCanvas").focus();
  await page.keyboard.press("Control+b");
  await expect(page.locator("#editorStatus")).toHaveText("Built", { timeout: 90_000 });
  await page.locator("#codeEditor").focus();
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("#simulationStatus")).toHaveText("Running", { timeout: 90_000 });
  await expect(page.locator("#redLed")).toHaveClass(/active/, { timeout: 60_000 });
  await shot(page, "running-1280x720");
  await page.click("#stopButton");

  // Not shown again after a reload.
  await page.reload();
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(hint).toBeHidden();
  expect(errors).toEqual([]);
});
