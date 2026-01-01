// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - @sparticuz/chromium is installed in container image
// Lazy-load chromium to avoid import errors in test environments
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chromium: any = null;

/**
 * Get @sparticuz/chromium module, lazy-loaded to avoid import errors in test environments
 */
export function getChromium(): any {
  if (!chromium) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      chromium = require("@sparticuz/chromium");
    } catch (error) {
      // In test environments, @sparticuz/chromium might not be available
      // This is fine - the code will use local Chrome paths instead
      console.warn(
        "[puppeteer-config] @sparticuz/chromium not available, will use local Chrome paths:",
        error instanceof Error ? error.message : String(error)
      );
      // Return null to indicate module is not available
      return null;
    }
  }
  return chromium;
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-extra is installed in container image
import puppeteer from "puppeteer-extra";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-extra-plugin-recaptcha is installed in container image
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-extra-plugin-stealth is installed in container image
import StealthPlugin from "puppeteer-extra-plugin-stealth";

/**
 * Configure Puppeteer with stealth and reCAPTCHA plugins
 * Stealth plugin makes the browser appear more human-like
 * reCAPTCHA plugin uses 2Captcha as the provider for solving CAPTCHAs
 */
export function configurePuppeteer(): void {
  // Create stealth plugin instance and explicitly enable all evasions
  const stealthPlugin = StealthPlugin();

  // By default, all evasions are enabled, but we verify and log them
  // Get all available evasions and ensure they're all enabled
  const availableEvasions = stealthPlugin.availableEvasions;
  const enabledEvasions = stealthPlugin.enabledEvasions;

  // Log enabled evasions for debugging
  console.log(
    `[puppeteer-config] Stealth plugin configured with ${enabledEvasions.size} of ${availableEvasions.size} evasions enabled:`,
    Array.from(enabledEvasions).join(", ")
  );

  // If not all evasions are enabled by default, explicitly enable them
  if (enabledEvasions.size < availableEvasions.size) {
    console.warn(
      `[puppeteer-config] Not all evasions enabled by default. Enabling all ${availableEvasions.size} evasions...`
    );
    // Create new plugin instance with all evasions explicitly enabled
    const allEvasionsPlugin = StealthPlugin({
      enabledEvasions: availableEvasions,
    });
    puppeteer.use(allEvasionsPlugin);
    console.log(
      `[puppeteer-config] All ${allEvasionsPlugin.enabledEvasions.size} evasions now enabled`
    );
  } else {
    puppeteer.use(stealthPlugin);
  }

  const twoCaptchaApiKey = process.env.TWOCAPTCHA_API_KEY;

  if (twoCaptchaApiKey) {
    // Enable debug logging for puppeteer-extra plugins
    // This will log when CAPTCHAs are detected and solved
    if (!process.env.DEBUG) {
      process.env.DEBUG = "puppeteer-extra,puppeteer-extra-plugin:*";
    } else if (!process.env.DEBUG.includes("puppeteer-extra")) {
      process.env.DEBUG = `${process.env.DEBUG},puppeteer-extra,puppeteer-extra-plugin:*`;
    }

    // Configure reCAPTCHA plugin with 2Captcha
    puppeteer.use(
      RecaptchaPlugin({
        provider: {
          id: "2captcha",
          token: twoCaptchaApiKey,
        },
        visualFeedback: true, // Show a notification when solving a CAPTCHA
      })
    );
    console.log(
      "[puppeteer-config] Puppeteer configured with 2Captcha reCAPTCHA solver (API key: " +
        (twoCaptchaApiKey.substring(0, 8) + "...") +
        ")"
    );
  } else {
    console.warn(
      "[puppeteer-config] TWOCAPTCHA_API_KEY not set - CAPTCHA solving will not be available"
    );
  }
}

// Configure Puppeteer on module load
configurePuppeteer();

