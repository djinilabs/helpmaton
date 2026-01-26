import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { defineConfig, devices } from "@playwright/test";

import { e2eConfig } from "./tests/e2e/config/env";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./tests/e2e",
  /* Run tests in files in parallel */
  fullyParallel: false, // Set to false to allow serial tests to share context
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ["list"], // Use list reporter for stdout output
    ["json", { outputFile: "test-results/results.json" }],
    ["junit", { outputFile: "test-results/results.xml" }],
    ["html", { outputFolder: "playwright-report" }], // HTML report for better debugging
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: e2eConfig.app.baseUrl,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: e2eConfig.recording.trace,

    /* Take screenshot on failure */
    screenshot: e2eConfig.recording.screenshot,

    /* Record video on failure */
    video: e2eConfig.recording.video,

    /* Increase timeout for tests that need to wait for emails */
    actionTimeout: e2eConfig.test.actionTimeout,

    /* Add navigation timeout */
    navigationTimeout: 30000,
  },

  /* Global test timeout */
  timeout: e2eConfig.test.timeout, // 3 minutes (extended to 10 minutes (600000ms) for chained test suites)

  /* Configure projects for major browsers */
  /* NOTE: We only use Chromium to reduce download size and CI time.
   * To install only Chromium, run: pnpm test:e2e:install
   * This installs Chromium with system dependencies, avoiding downloads of Firefox and WebKit.
   */
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Add browser-specific settings for better reliability
        launchOptions: {
          args: [
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-features=TranslateUI",
            "--disable-ipc-flooding-protection",
            "--disable-blink-features=AutomationControlled",
          ],
        },
      },
    },
  ],

  /* Global setup and teardown */
  globalSetup: join(__dirname, "./tests/e2e/global-setup.ts"),
  globalTeardown: join(__dirname, "./tests/e2e/global-teardown.ts"),

  /* Add test retry configuration */
  workers: process.env.CI ? 1 : undefined, // Reduce workers in CI to avoid resource conflicts
});
