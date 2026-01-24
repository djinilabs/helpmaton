import { join } from "path";

import type { ScreenshotMode, VideoMode, TraceMode } from "@playwright/test";
import { config } from "dotenv";

// Load environment variables from .env file in the e2e directory
// Using relative path from project root since this is a test config
const envPath = join(process.cwd(), "tests", "e2e", ".env");
config({ path: envPath });

// Environment variable configuration with defaults
export const e2eConfig = {
  // Testmail configuration
  testmail: {
    namespace: process.env.TESTMAIL_NAMESPACE,
    apiKey: process.env.TESTMAIL_API_KEY,
  },

  // Application configuration
  app: {
    baseUrl: process.env.BASE_URL || "http://localhost:5173",
  },

  // Test configuration
  test: {
    timeout: parseInt(process.env.TEST_TIMEOUT || "180000"),
    actionTimeout: parseInt(process.env.ACTION_TIMEOUT || "60000"),
    ci: process.env.CI === "true",
    headless: process.env.HEADLESS === "true",
  },

  // Browser configuration
  browser: {
    name: process.env.BROWSER || "chromium",
  },

  // Recording configuration
  recording: {
    screenshot: (process.env.SCREENSHOT || "only-on-failure") as ScreenshotMode,
    video: (process.env.VIDEO || "retain-on-failure") as VideoMode,
    trace: (process.env.TRACE || "on-first-retry") as TraceMode,
  },

  // Billing test configuration
  billing: {
    testMode: process.env.E2E_BILLING_TEST_MODE === "true",
    testCreditAmount: 10.0,
  },
};

// Validate required environment variables
export async function validateEnvironment(options?: {
  promptIfMissing?: boolean;
}): Promise<void> {
  const requiredVars = [
    "TESTMAIL_NAMESPACE",
    "TESTMAIL_API_KEY",
    "MAILGUN_KEY",
  ];
  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length === 0) {
    return;
  }

  if (options?.promptIfMissing && !process.env.CI) {
    const readline = await import("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    for (const varName of missingVars) {
      const value = await new Promise<string>((resolve) => {
        rl.question(`Enter value for ${varName}: `, (answer) => {
          resolve(answer.trim());
        });
      });

      if (value) {
        process.env[varName] = value;
      }
    }

    rl.close();

    const stillMissing = requiredVars.filter(
      (varName) => !process.env[varName]
    );
    if (stillMissing.length === 0) {
      return;
    }
  }

  throw new Error(
    `Missing required environment variables: ${missingVars.join(", ")}\n` +
      `Please create a .env file in the tests/e2e directory with these variables.\n` +
      `See .env.example for reference.`
  );
}

// Export individual configs for convenience
export const { testmail, app, test, browser, recording } = e2eConfig;
