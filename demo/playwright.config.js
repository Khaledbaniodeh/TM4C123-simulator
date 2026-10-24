/*
 * Demo recording only (not part of the test suite): one continuous take of
 * the real app, run by .github/workflows/demo-video.yml.
 *   npx playwright test -c demo/playwright.config.js
 */
import { defineConfig } from "@playwright/test";

const port = 5198;

export default defineConfig({
  testDir: ".",
  testMatch: "record.spec.js",
  timeout: 360_000,
  expect: { timeout: 90_000 },
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  outputDir: "../test-results/demo",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.PW_CHANNEL || undefined,
    // The 1280x720 layout, drawn at 1.5x: frames are 1920x1080.
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1.5,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node apps/orchestrator/src/server.js --port ${port}`,
    cwd: "..",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
