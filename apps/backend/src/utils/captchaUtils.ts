import { badRequest } from "@hapi/boom";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-core is installed in container image
import type { Page } from "puppeteer-core";

import { delay } from "./puppeteerContentLoading";

/**
 * Check if page contains a CAPTCHA or human verification challenge
 * Detects common CAPTCHA indicators including text patterns and DOM elements
 */
export async function detectCaptcha(page: Page): Promise<boolean> {
  try {
    // Check for common CAPTCHA indicators
    const captchaIndicators = await page.evaluate(() => {
      const bodyText = document.body?.innerText?.toLowerCase() || "";
      const title = document.title?.toLowerCase() || "";

      // Common CAPTCHA phrases
      const phrases = [
        "prove you're human",
        "verify you're human",
        "are you a robot",
        "captcha",
        "challenge",
        "cloudflare",
        "access denied",
        "checking your browser",
        "please wait",
        "just a moment",
        "verify you are not a robot",
        "security check",
      ];

      // Check body text and title
      const hasPhrase = phrases.some(
        (phrase) => bodyText.includes(phrase) || title.includes(phrase)
      );

      // Check for common CAPTCHA iframe/container selectors
      const hasCaptchaElement = !!(
        document.querySelector("[data-sitekey]") || // reCAPTCHA
        document.querySelector("[site-key]") || // Reddit reputation-recaptcha
        document.querySelector("reputation-recaptcha") || // Reddit's custom reCAPTCHA element
        document.querySelector(".cf-browser-verification") || // Cloudflare
        document.querySelector("#challenge-form") || // Cloudflare
        document.querySelector('[class*="captcha"]') ||
        document.querySelector('[id*="captcha"]') ||
        document.querySelector('[class*="challenge"]') ||
        document.querySelector('[id*="challenge"]') ||
        document.querySelector('iframe[src*="recaptcha"]') ||
        document.querySelector('iframe[src*="hcaptcha"]') ||
        document.querySelector('iframe[src*="cloudflare"]')
      );

      return hasPhrase || hasCaptchaElement;
    });

    return captchaIndicators;
  } catch {
    // If evaluation fails, assume no CAPTCHA (better to try than fail)
    return false;
  }
}

/**
 * Wait for async CAPTCHA elements to load (e.g., Reddit's reputation-recaptcha)
 * These are often loaded asynchronously via web components
 */
export async function waitForCaptchaElements(page: Page): Promise<void> {
  try {
    await page
      .waitForFunction(
        () => {
          // Check if reCAPTCHA iframes have loaded
          const recaptchaIframes = document.querySelectorAll(
            'iframe[src*="recaptcha"], iframe[src*="google.com/recaptcha"]'
          );
          // Check if custom CAPTCHA elements have initialized
          const customCaptchaElements = document.querySelectorAll(
            "reputation-recaptcha, [site-key], [data-sitekey]"
          );
          // Wait for at least one CAPTCHA-related element to be present
          // or wait a bit longer for async loaders
          return (
            recaptchaIframes.length > 0 || customCaptchaElements.length > 0
          );
        },
        { timeout: 10000 }
      )
      .catch(() => {
        console.log(
          "[captcha-utils] No CAPTCHA iframes detected within timeout, proceeding..."
        );
      });
  } catch {
    // Continue if waiting fails
  }

  // Additional wait for async loaders to initialize (Reddit uses async loaders)
  await delay(2000);
}

/**
 * Attempt to solve CAPTCHAs on page and child frames
 * Returns true if CAPTCHAs were solved successfully, false otherwise
 */
export async function solveCaptchas(page: Page): Promise<boolean> {
  const twoCaptchaApiKey = process.env.TWOCAPTCHA_API_KEY;

  if (!twoCaptchaApiKey) {
    // No API key, just check and return
    const hasCaptcha = await detectCaptcha(page);
    if (hasCaptcha) {
      throw badRequest(
        "The requested URL requires human verification (CAPTCHA). " +
          "This page cannot be scraped automatically. Please try a different URL or use an alternative data source."
      );
    }
    return false;
  }

  // Check for CAPTCHA after navigation
  const hasCaptcha = await detectCaptcha(page);

  if (hasCaptcha) {
    console.log(
      "[captcha-utils] CAPTCHA detected via detection function, attempting to solve..."
    );
  } else {
    console.log(
      "[captcha-utils] No CAPTCHA detected via detection function, but attempting solveRecaptchas() anyway (plugin may detect it)..."
    );
  }

  try {
    // First, check if there are any reCAPTCHA iframes visible
    const captchaInfo = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll("iframe")).map(
        (iframe) => ({
          src: iframe.src || iframe.getAttribute("src") || "",
          id: iframe.id || "",
          className: iframe.className || "",
        })
      );
      const recaptchaIframes = iframes.filter(
        (iframe) =>
          iframe.src.includes("recaptcha") ||
          iframe.src.includes("google.com/recaptcha")
      );
      const customElements = Array.from(
        document.querySelectorAll(
          "reputation-recaptcha, [site-key], [data-sitekey]"
        )
      ).map((el) => ({
        tagName: el.tagName,
        siteKey:
          el.getAttribute("site-key") ||
          el.getAttribute("data-sitekey") ||
          "",
      }));
      return {
        totalIframes: iframes.length,
        recaptchaIframes: recaptchaIframes.length,
        recaptchaIframeSrcs: recaptchaIframes.map((f) => f.src),
        customElements: customElements.length,
        customElementInfo: customElements,
      };
    });
    console.log("[captcha-utils] CAPTCHA detection info:", captchaInfo);

    // Explicitly call solveRecaptchas() to trigger solving with logging
    // This method is provided by puppeteer-extra-plugin-recaptcha
    console.log("[captcha-utils] Calling solveRecaptchas() on main frame...");
    const mainFrameResult = await (
      page as unknown as {
        solveRecaptchas: () => Promise<{
          captchas: unknown[];
          solutions: unknown[];
          solved: unknown[];
          error?: string;
        }>;
      }
    ).solveRecaptchas();

    console.log("[captcha-utils] Main frame solveRecaptchas() result:", {
      captchasFound: mainFrameResult.captchas.length,
      solutionsReceived: mainFrameResult.solutions.length,
      solved: mainFrameResult.solved.length,
      error: mainFrameResult.error,
    });

    // Also check child frames (CAPTCHAs are often in iframes)
    // This is critical for reCAPTCHA detection as they're usually in iframes
    const childFrames = page.mainFrame().childFrames();
    console.log(
      `[captcha-utils] Checking ${childFrames.length} child frames for CAPTCHAs...`
    );

    let totalCaptchasInFrames = 0;
    for (let i = 0; i < childFrames.length; i++) {
      const frame = childFrames[i];
      try {
        const frameUrl = frame.url();
        console.log(
          `[captcha-utils] Calling solveRecaptchas() on child frame ${
            i + 1
          } (URL: ${frameUrl.substring(0, 100)})...`
        );
        const frameResult = await (
          frame as unknown as {
            solveRecaptchas: () => Promise<{
              captchas: unknown[];
              solutions: unknown[];
              solved: unknown[];
              error?: string;
            }>;
          }
        ).solveRecaptchas();

        console.log(
          `[captcha-utils] Child frame ${i + 1} solveRecaptchas() result:`,
          {
            captchasFound: frameResult.captchas.length,
            solutionsReceived: frameResult.solutions.length,
            solved: frameResult.solved.length,
            error: frameResult.error,
          }
        );
        totalCaptchasInFrames += frameResult.captchas.length;
      } catch (frameError) {
        console.warn(
          `[captcha-utils] Error solving CAPTCHA in child frame ${i + 1}:`,
          frameError
        );
      }
    }

    // If any CAPTCHAs were found by the plugin, wait for solving to complete
    // Only trust the plugin's detection, not our own detection function
    const totalCaptchasFound =
      mainFrameResult.captchas.length + totalCaptchasInFrames;

    if (totalCaptchasFound > 0) {
      // Wait for solving to complete (plugin typically takes 10-30 seconds)
      console.log(
        `[captcha-utils] ${totalCaptchasFound} CAPTCHA(s) found by plugin, waiting up to 35 seconds for solving to complete...`
      );
      await delay(35000);

      // Re-check for CAPTCHA after solving attempt
      const stillHasCaptcha = await detectCaptcha(page);
      if (stillHasCaptcha) {
        console.warn(
          "[captcha-utils] CAPTCHA solving failed or CAPTCHA still present after timeout"
        );
        throw badRequest(
          "The requested URL requires human verification (CAPTCHA). " +
            "Automatic CAPTCHA solving timed out or failed. Please try again or use an alternative data source."
        );
      } else {
        console.log(
          "[captcha-utils] CAPTCHA solved successfully - no longer detected on page"
        );
        return true;
      }
    } else {
      console.log(
        "[captcha-utils] No CAPTCHAs found by plugin, proceeding with scraping"
      );
      return false;
    }
  } catch (error) {
    console.error("[captcha-utils] Error during CAPTCHA solving:", error);
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    throw badRequest(
      `The requested URL requires human verification (CAPTCHA). ` +
        `Automatic CAPTCHA solving encountered an error: ${errorMessage}. Please try again or use an alternative data source.`
    );
  }
}

