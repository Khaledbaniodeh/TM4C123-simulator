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
      for (const node of document.querySelectorAll("button, select, input, [role=button]")) {
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
      // The inspector (selection, pins) may stack below the canvas in a scroll area; it must be reachable.
      const inspector = document.querySelector(".inspector");
      inspector?.scrollIntoView({ block: "nearest" });
      const inspectorRect = inspector?.getBoundingClientRect();
      const inspectorReachable = Boolean(inspectorRect && inspectorRect.width > 0 && inspectorRect.right <= viewport.width + 1 && inspectorRect.top < viewport.height);
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
      };
    });
    console.log(`::notice title=layout ${size.width}x${size.height}::${JSON.stringify(metrics)}`);
    await page.screenshot({ path: `test-results/layout-${size.width}x${size.height}.png` });
    expect(metrics.clipped).toEqual([]);
    expect(metrics.scroll.width).toBeLessThanOrEqual(size.width);
    expect(metrics.inspectorReachable).toBe(true);
    await page.click("#stopButton");
    expect(errors).toEqual([]);
  });
}
