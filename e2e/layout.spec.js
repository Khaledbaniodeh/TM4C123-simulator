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
      const consoleOutput = document.querySelector("#consoleOutput");
      const consoleLineHeight = parseFloat(getComputedStyle(consoleOutput).lineHeight);
      const consoleLines = Math.floor((consoleOutput.clientHeight - 20) / consoleLineHeight);
      // Before any scrolling: the circuit canvas lies fully inside its visible panel area,
      // so Fit shows the whole circuit.
      const area = document.querySelector(".simulation-canvas").getBoundingClientRect();
      const canvasVisible = canvas.top >= area.top - 1 && canvas.bottom <= area.bottom + 1 && canvas.height > 150;
      // The inspector (selection, pins) may stack below the canvas in a scroll area; it must be reachable.
      const inspector = document.querySelector(".inspector");
      inspector?.scrollIntoView({ block: "nearest" });
      const inspectorRect = inspector?.getBoundingClientRect();
      const inspectorReachable = Boolean(inspectorRect && inspectorRect.width > 0 && inspectorRect.right <= viewport.width + 1 && inspectorRect.top < viewport.height);
      // Lines of text in the trust notice and in the simulator's board name (distinct line boxes of their text).
      const lines = (node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const bottoms = [...range.getClientRects()].filter((r) => r.width > 0).map((r) => r.bottom).sort((a, b) => a - b);
        return bottoms.filter((bottom, i) => i === 0 || bottom - bottoms[i - 1] > 8).length;
      };
      const noticeLines = lines(document.querySelector("#modeNotice"));
      const boardTitleLines = lines(document.querySelector(".simulator-header h2"));
      const panels = [...document.querySelectorAll("main > *, .layout > *, body > div > *")]
        .slice(0, 8)
        .map((node) => `${node.id || node.className || node.tagName}:${Math.round(node.getBoundingClientRect().width)}`);
      return {
        viewport,
        scroll: { width: root.scrollWidth, height: root.scrollHeight },
        canvas: { width: Math.round(canvas.width), height: Math.round(canvas.height) },
        clipped,
        panels,
        inspectorReachable,
        canvasVisible,
        consoleHeight: Math.round(consolePanel.height),
        consoleLines,
        noticeLines,
        boardTitleLines,
        toolchain: document.querySelector("#toolchainInfo").textContent.trim(),
      };
    });
    console.log(`::notice title=layout ${size.width}x${size.height}::${JSON.stringify(metrics)}`);
    // Screenshot what the user sees first (undo the inspector scroll used for the check).
    await page.evaluate(() => document.querySelector(".simulation-canvas").scrollTo(0, 0));
    await page.screenshot({ path: `test-results/layout-${size.width}x${size.height}.png` });
    expect(metrics.clipped).toEqual([]);
    expect(metrics.scroll.width).toBeLessThanOrEqual(size.width);
    expect(metrics.inspectorReachable).toBe(true);
    expect(metrics.canvasVisible).toBe(true);
    // Short screens give the circuit more height; the console stays usable everywhere.
    expect(metrics.consoleLines).toBeGreaterThanOrEqual(3);
    if (size.height <= 820) {
      expect(metrics.consoleHeight).toBeLessThanOrEqual(122);
    } else {
      expect(metrics.consoleHeight).toBeGreaterThanOrEqual(148);
    }
    if (size.width === 1280 && size.height === 720) {
      expect(metrics.canvas.height, "canvas height at 1280x720 (was 323 px)").toBeGreaterThanOrEqual(350);
    }
    // The trust notice keeps its warning and fits one line from 1280 px (it took two before); the board
    // name never wraps (at 1024 px the virtual time wrapped it onto two lines).
    await expect(page.locator("#modeNotice")).toContainText("not sandboxed — only run code you trust");
    expect(metrics.toolchain).toMatch(/^GCC \d+\.\d+\.\d+ · Renode \d+\.\d+\.\d+$/);
    if (size.width >= 1280) {
      expect(metrics.noticeLines, "trust notice lines").toBe(1);
    }
    expect(metrics.boardTitleLines, "board name lines").toBe(1);
    await page.click("#stopButton");
    expect(errors).toEqual([]);
  });
}
