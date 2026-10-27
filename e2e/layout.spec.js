/*
 * Layout at common viewport sizes, with the LCD example running: no control
 * may be clipped off-screen and the page must not overflow horizontally (at
 * 1024x768 the top bar used to push Stop and Save out of reach). Metrics
 * are also printed as GitHub notices, with a screenshot per size.
 */
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

for (const size of SIZES) {
  test(`layout evidence at ${size.width}x${size.height}`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.locator("#exampleSelect option")).toHaveCount(14);
    await page.selectOption("#exampleSelect", "lcd1602-hello");
    await page.click("#runButton");
    await expect(page.locator("#simulationStatus")).toHaveText("Running");
    await expect(page.locator('.part[data-part="lcd1"] .part-lcd')).toHaveAttribute("data-row0", "Hello, TM4C123! ", { timeout: 60_000 });

    const metrics = await page.evaluate(() => {
      const viewport = { width: innerWidth, height: innerHeight };
      const root = document.scrollingElement;
      const clipped = [];
      for (const node of document.querySelectorAll("button, select, input, [role=button], label.file-button")) {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (rect.width === 0 || style.visibility === "hidden" || node.closest("[hidden]")) {
          continue;
        }
        if (rect.right > viewport.width + 1 || rect.bottom > viewport.height + 1 || rect.left < -1) {
          clipped.push(`${node.id || node.getAttribute("aria-label") || node.textContent.trim().slice(0, 20)}@${Math.round(rect.right)}x${Math.round(rect.bottom)}`);
        }
      }
      const canvas = document.querySelector("#circuitCanvas").getBoundingClientRect();
      const consolePanel = document.querySelector(".console-panel").getBoundingClientRect();
      // Before any scrolling: the circuit canvas lies fully inside its visible panel area,
      // so Fit shows the whole circuit.
      const area = document.querySelector(".simulation-canvas").getBoundingClientRect();
      const canvasVisible = canvas.top >= area.top - 1 && canvas.bottom <= area.bottom + 1 && canvas.height > 150;
      // Lines of text (distinct line boxes) in the trust notice and in the simulation state pill.
      const lines = (node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const bottoms = [...range.getClientRects()].filter((r) => r.width > 0).map((r) => r.bottom).sort((a, b) => a - b);
        return bottoms.filter((bottom, i) => i === 0 || bottom - bottoms[i - 1] > 8).length;
      };
      const noticeLines = lines(document.querySelector("#modeNotice"));
      const stateLines = lines(document.querySelector(".simulation-state"));
      const panels = [...document.querySelectorAll("main > *, .layout > *, body > div > *")]
        .slice(0, 8)
        .map((node) => `${node.id || node.className || node.tagName}:${Math.round(node.getBoundingClientRect().width)}`);
      return {
        viewport,
        scroll: { width: root.scrollWidth, height: root.scrollHeight },
        canvas: { width: Math.round(canvas.width), height: Math.round(canvas.height) },
        clipped,
        panels,
        canvasVisible,
        consoleHeight: Math.round(consolePanel.height),
        noticeLines,
        stateLines,
        toolchain: document.querySelector("#toolchainInfo").textContent.trim(),
      };
    });
    console.log(`::notice title=layout ${size.width}x${size.height}::${JSON.stringify(metrics)}`);
    await page.screenshot({ path: `test-results/layout-${size.width}x${size.height}.png` });
    expect(metrics.clipped).toEqual([]);
    expect(metrics.scroll.width).toBeLessThanOrEqual(size.width);
    expect(metrics.canvasVisible).toBe(true);
    // The circuit gets the height: the output panel is folded to one line until opened
    // (canvas height at 1280x720: 323 px originally, 371 px before the shell redesign).
    expect(metrics.consoleHeight).toBeLessThanOrEqual(36);
    if (size.width === 1280 && size.height === 720) {
      expect(metrics.canvas.height, "canvas height at 1280x720").toBeGreaterThanOrEqual(480);
    }
    // The trust notice keeps its warning on one line in the status bar at every size; the state pill is one line.
    await expect(page.locator("#modeNotice")).toContainText("not sandboxed — only run code you trust");
    expect(metrics.toolchain).toMatch(/^GCC \d+\.\d+\.\d+ · Renode \d+\.\d+\.\d+$/);
    expect(metrics.noticeLines, "trust notice lines").toBe(1);
    expect(metrics.stateLines, "state pill lines").toBe(1);

    // Opened, the console shows at least three lines; the inspector (selection, pins) is one click away.
    await page.getByRole("tab", { name: /Console/ }).click();
    const consoleLines = await page.evaluate(() => {
      const output = document.querySelector("#consoleOutput");
      return Math.floor((output.clientHeight - 16) / parseFloat(getComputedStyle(output).lineHeight));
    });
    expect(consoleLines).toBeGreaterThanOrEqual(3);
    if ((await page.locator(".simulator-panel").getAttribute("data-inspector")) === "closed") {
      await page.locator("#inspectorToggle").click();
    }
    const inspector = await page.locator(".inspector").evaluate((node) => node.getBoundingClientRect().toJSON());
    expect(inspector.width).toBeGreaterThan(200);
    expect(inspector.right).toBeLessThanOrEqual(size.width + 1);
    await expect(page.locator("#pinTable")).toBeVisible();
    await page.screenshot({ path: `test-results/layout-panels-${size.width}x${size.height}.png` });
    await page.click("#stopButton");
    expect(errors).toEqual([]);
  });
}
