/*
 * Interaction recording only (not part of the test suite): one take of the
 * real app, run by .github/workflows/interaction-video.yml.
 *   npx playwright test -c recordings/playwright.config.js
 */
import { defineConfig } from "@playwright/test";

const port = 5197;

export default defineConfig({
  testDir: ".",
  testMatch: "interaction.spec.js",
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  outputDir: "../test-results/recording",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.PW_CHANNEL || undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node apps/orchestrator/src/server.js --port ${port}`,
    cwd: "..",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
