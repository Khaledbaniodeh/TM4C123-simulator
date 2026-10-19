/*
 * Browser end-to-end tests against the real orchestrator (real GCC + Renode).
 *
 * Locally, set PW_CHANNEL=msedge (or chrome) to use an installed browser
 * instead of downloading Playwright's Chromium.
 */
import { defineConfig } from "@playwright/test";

const port = 5199;

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.PW_CHANNEL || undefined,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node apps/orchestrator/src/server.js --port ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
