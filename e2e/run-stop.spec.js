/*
 * Stop, then Run again at once. The session reports "stopped" on its event
 * stream before the Stop request is answered, so Run is available while that
 * answer is still on its way; when it arrives it must not end or disconnect
 * the new session. (Found in CI: showcase "6: SW1 and an external
 * pushbutton" stuck at "Stopped" when Run followed Stop within ~300 ms.)
 * The answer to the Stop request is held back here, so the timing is
 * certain; the stop itself reaches the real server at once.
 */
import { expect, test } from "@playwright/test";

test("Run right after Stop starts the new session, even while the old Stop is still being answered", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.locator("#exampleSelect option")).toHaveCount(14);
  await expect(page.locator("#exampleSelect")).toHaveValue("gpiof-red-led");

  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running", { timeout: 90_000 });
  await expect(page.locator("#redLed")).toHaveClass(/active/, { timeout: 60_000 });

  // The server stops the session now; the page gets the HTTP answer only when released.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/sessions/*/control", async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page.click("#stopButton");
  // "stopped" arrives on the session's own event stream, and Run is available again.
  await expect(page.locator("#simulationStatus")).toHaveText("Stopped", { timeout: 30_000 });
  await expect(page.locator("#runButton")).toBeEnabled();

  await page.click("#runButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Running", { timeout: 90_000 });
  await expect(page.locator("#redLed")).toHaveClass(/active/, { timeout: 60_000 });

  // The old Stop's answer arrives while the new session runs.
  const answered = page.waitForResponse((response) => response.url().includes("/control"));
  release();
  await answered;
  await page.unroute("**/api/sessions/*/control");

  // The new session goes on: still running, its event stream alive (virtual time advances).
  const virtualTime = () => page.locator("#virtualTime").textContent();
  const before = await virtualTime();
  await expect.poll(virtualTime, { timeout: 30_000 }).not.toBe(before);
  await expect(page.locator("#simulationStatus")).toHaveText("Running");
  await expect(page.locator("#redLed")).toHaveClass(/active/);

  // And Stop still stops it.
  await page.click("#stopButton");
  await expect(page.locator("#simulationStatus")).toHaveText("Stopped", { timeout: 30_000 });
  expect(errors).toEqual([]);
});
