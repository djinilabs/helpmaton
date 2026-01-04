import { mkdirSync } from "fs";

import { internal } from "@hapi/boom";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-extra is installed in container image
import type { Browser } from "puppeteer-core";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-extra is installed in container image
import puppeteer from "puppeteer-extra";

import { getChromium } from "./puppeteerConfig";

/**
 * Ensure /tmp directory exists for Chromium extraction
 * This is needed in Lambda environments where /tmp is writable
 */
export function ensureTmpDirectory(): void {
  if (process.env.LAMBDA_TASK_ROOT) {
    try {
      mkdirSync("/tmp", { recursive: true });
      console.log(
        "[puppeteer-browser] Ensured /tmp directory exists for Chromium extraction"
      );
    } catch (mkdirError) {
      console.warn(
        "[puppeteer-browser] Failed to create /tmp directory:",
        mkdirError
      );
    }
  }
}

/**
 * Launch Puppeteer browser with appropriate args for Lambda/local environments
 * @param proxyServer - Proxy server URL (e.g., "http://gate.decodo.com:10001")
 * @returns Browser instance
 */
export async function launchBrowser(proxyServer: string): Promise<Browser> {
  // Ensure /tmp exists for @sparticuz/chromium extraction (it's writable in Lambda)
  ensureTmpDirectory();

  // Use @sparticuz/chromium's recommended args if in Lambda, otherwise use custom args
  const isLambda = !!process.env.LAMBDA_TASK_ROOT;

  if (isLambda) {
    const chromiumModule = getChromium();
    if (chromiumModule) {
      // Optional: Disable graphics mode for better performance in Lambda
      chromiumModule.setGraphicsMode = false;

      // Use @sparticuz/chromium's recommended configuration
      // Add proxy and site isolation args to chromium's default args
      const chromiumArgs = [
        ...chromiumModule.args,
        `--proxy-server=${proxyServer}`,
        // Disable site isolation to allow access to cross-origin iframes (needed for reCAPTCHA detection)
        // "--disable-features=IsolateOrigins,site-per-process,SitePerProcess",
        // "--flag-switches-begin",
        // "--disable-site-isolation-trials",
        // "--flag-switches-end",
        // "--disable-gpu",
        // "--disable-dev-shm-usage",
        // "--disable-accelerated-2d-canvas",
        // "--no-first-run",
      ];

      console.log("[puppeteer-browser] Chromium args:", chromiumArgs);

      // 1. Point to the binary inside node_modules
      // Since we are in Docker, we know the path is fixed at /var/task/...
      const executablePath = await chromiumModule.executablePath(
        "/var/task/node_modules/@sparticuz/chromium/bin"
      );

      const browser = await puppeteer.launch({
        args: chromiumArgs,
        defaultViewport: chromiumModule.defaultViewport,
        headless: chromiumModule.headless,
        executablePath,
      });

      if (!browser) {
        throw internal("Failed to launch browser");
      }

      return browser;
    } else {
      throw internal("Failed to load @sparticuz/chromium module");
    }
  } else {
    console.log("[puppeteer-browser] Local development - using custom args");
    // Local development - use custom args
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu",
        `--proxy-server=${proxyServer}`,
        // Stealth options to reduce CAPTCHA triggers
        "--disable-blink-features=AutomationControlled", // Hide automation
        // Disable site isolation to allow access to cross-origin iframes (needed for reCAPTCHA detection)
        "--disable-features=IsolateOrigins,site-per-process,SitePerProcess",
        "--flag-switches-begin",
        "--disable-site-isolation-trials",
        "--flag-switches-end",
      ],
      defaultViewport: { width: 1920, height: 1080 },
    });

    if (!browser) {
      throw internal("Failed to launch browser");
    }

    return browser;
  }
}

