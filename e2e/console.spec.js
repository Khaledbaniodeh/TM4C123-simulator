/*
 * Console clarity, with real firmware in Renode: messages carry a severity
 * and a source; the compact view (default) folds runs of GPIO pin changes
 * into one row and the detailed view shows each; level, source, and text
 * filters never hide an error; compiler output folds under its error; the
 * view stays where the reader scrolled; the number of rows in the page stays
 * bounded however long the simulation runs.
 */
import { expect, test } from "@playwright/test";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];
const MAX_ROWS = 400;

async function open(page, size = { width: 1280, height: 720 }) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  return errors;
}

const rows = (page) => page.locator("#consoleOutput > .console-line");
const rowTexts = (page) => page.evaluate(() => [...document.querySelectorAll("#consoleOutput > .console-line")].map((row) => ({
  level: row.dataset.level,
  category: row.dataset.category,
  text: row.querySelector(".console-message").textContent,
})));
const chip = (page, name) => page.locator("#consoleTools .console-chip", { hasText: name });

async function runLcd(page) {
  await page.selectOption("#exampleSelect", "lcd1602-hello");
  await page.click("#runButton");
  await expect(page.locator('.part[data-part="lcd1"] .part-lcd')).toHaveAttribute("data-row0", "Hello, TM4C123! ", { timeout: 90_000 });
}

test("compact and detailed views of a running LCD example; the page keeps a bounded number of rows", async ({ page }) => {
  const errors = await open(page);
  await runLcd(page);
  await page.waitForTimeout(2000); // a few hundred pin changes
  await expect(chip(page, "Compact")).toHaveAttribute("aria-pressed", "true");
  const compact = await rowTexts(page);
  const folded = compact.filter((r) => r.category === "gpio" && /^GPIO: \d+ pin changes \(/.test(r.text));
  expect(folded.length, JSON.stringify(compact.slice(-5))).toBeGreaterThan(0);
  expect(compact.length).toBeLessThanOrEqual(MAX_ROWS);
  await page.screenshot({ path: "test-results/console-compact-1280x720.png" });

  await chip(page, "Detailed").click();
  await expect(chip(page, "Detailed")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await rowTexts(page)).filter((r) => r.category === "gpio" && /\(GPIO output\)$/.test(r.text)).length).toBeGreaterThan(folded.length);
  // However long it runs, the page holds at most MAX_ROWS rows and says how many older ones are not shown.
  await expect.poll(async () => Number(await page.locator("#eventCount").textContent()), { timeout: 90_000 }).toBeGreaterThan(MAX_ROWS + 200);
  await expect(page.locator("#consoleSummary")).toHaveText(/\d+ older not shown/);
  expect(await rows(page).count()).toBeLessThanOrEqual(MAX_ROWS);
  await page.screenshot({ path: "test-results/console-detailed-1280x720.png" });

  // Reading older messages: the view stays put while new ones arrive; at the bottom it follows them.
  await page.evaluate(() => { document.querySelector("#consoleOutput").scrollTop = 0; });
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => document.querySelector("#consoleOutput").scrollTop)).toBeLessThan(30);
  await page.evaluate(() => { const o = document.querySelector("#consoleOutput"); o.scrollTop = o.scrollHeight; });
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => { const o = document.querySelector("#consoleOutput"); return o.scrollHeight - o.scrollTop - o.clientHeight; })).toBeLessThan(30);

  await page.click("#stopButton");
  await chip(page, "Compact").click();
  expect(errors).toEqual([]);
});

test("filters never hide an error, and compiler output folds under it", async ({ page }) => {
  const errors = await open(page);
  const source = await page.inputValue("#codeEditor");
  await page.fill("#codeEditor", source.replace(/int\s+main\s*\(\s*void\s*\)\s*\{/, "int main(void)\n{\n    undeclared_symbol = 1;"));
  await page.click("#compileButton");
  await expect(page.locator("#problemCount")).not.toHaveText("0", { timeout: 90_000 });
  await page.getByRole("tab", { name: /Console/ }).click();
  await expect(page.locator("#consoleErrorCount")).toBeVisible();
  await expect(page.locator("#consoleErrorCount")).toHaveText("1");

  const failed = page.locator("#consoleOutput > .console-line", { hasText: "Build failed" });
  await expect(failed).toHaveCount(1);
  await expect(failed).toHaveAttribute("data-level", "error");
  await expect(failed).toHaveAttribute("data-category", "build");
  // The compiler's own lines are not separate error rows any more: they fold under the one error.
  const details = failed.locator("details.console-details");
  await expect(details.locator("summary")).toHaveText(/Compiler output \(\d+ lines?\)/);
  await details.locator("summary").click();
  await expect(details.locator("pre")).toContainText("undeclared_symbol");
  await page.screenshot({ path: "test-results/console-build-error-1280x720.png" });

  // Every filter at once: no warnings, no info, another source, a text that matches nothing. The error stays.
  await chip(page, "Warnings").click();
  await chip(page, "Info").click();
  await page.selectOption("#consoleCategory", "gpio");
  await page.fill("#consoleFilter", "zzz-no-match");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Build failed");
  await expect(page.locator("#consoleSummary")).toHaveText(/\d+ hidden by filters/);
  await page.screenshot({ path: "test-results/console-filtered-1280x720.png" });

  // Filters undone: everything is back.
  await page.fill("#consoleFilter", "");
  await page.selectOption("#consoleCategory", "all");
  await chip(page, "Warnings").click();
  await chip(page, "Info").click();
  await expect(page.locator("#consoleOutput")).toContainText("Workspace ready");
  await expect(page.locator("#consoleSummary")).toHaveText("");

  // A source filter shows only that source (plus errors).
  await page.selectOption("#consoleCategory", "build");
  const shown = await rowTexts(page);
  expect(shown.every((r) => r.category === "build" || r.level === "error"), JSON.stringify(shown)).toBe(true);
  await page.selectOption("#consoleCategory", "all");

  // Clear empties the console and its error count.
  await page.click("#clearConsoleButton");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator("#consoleErrorCount")).toBeHidden();
  expect(errors).toEqual([]);
});

for (const size of SIZES) {
  test(`console header stays on one line at ${size.width}x${size.height}`, async ({ page }) => {
    const errors = await open(page, size);
    const header = await page.locator(".console-header").boundingBox();
    expect(header.height).toBeLessThanOrEqual(36);
    for (const selector of ["#consoleTools .console-chip", "#consoleCategory", "#consoleFilter", "#clearConsoleButton"]) {
      for (const box of await page.locator(selector).evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()))) {
        expect(box.right, selector).toBeLessThanOrEqual(size.width);
        expect(box.top, selector).toBeGreaterThanOrEqual(header.y - 1);
        expect(box.bottom, selector).toBeLessThanOrEqual(header.y + header.height + 1);
      }
    }
    // The tools belong to the Console tab only.
    await page.getByRole("tab", { name: /Problems/ }).click();
    await expect(page.locator("#consoleTools")).toBeHidden();
    await page.getByRole("tab", { name: /Console/ }).click();
    await expect(page.locator("#consoleTools")).toBeVisible();
    await page.screenshot({ path: `test-results/console-header-${size.width}x${size.height}.png` });
    expect(errors).toEqual([]);
  });
}
