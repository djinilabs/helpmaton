import { Page, Locator } from "@playwright/test";

import { BasePage } from "./base-page";

export class LoginPage extends BasePage {
  // Locators
  readonly emailInput: Locator;
  readonly submitButton: Locator;
  readonly successMessage: Locator;
  readonly errorMessage: Locator;
  readonly loadingSpinner: Locator;

  constructor(page: Page) {
    super(page);

    // Initialize locators for email login
    this.emailInput = page.locator(
      '#email, input[type="email"], input[name="email"]'
    );
    this.submitButton = page.locator(
      'button[type="submit"], button:has-text("SEND SIGN-IN LINK"), button:has-text("SENDING...")'
    );
    this.successMessage = page.locator(
      '[data-testid="success-message"], .success-message, .alert-success'
    );
    this.errorMessage = page.locator(
      '[data-testid="error-message"], .error-message, .alert-error'
    );
    this.loadingSpinner = page.locator(
      '[data-testid="loading-spinner"], .loading, .spinner'
    );
  }

  /**
   * Navigate to login page
   */
  async goto(url: string = "/"): Promise<void> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Navigate to the page
        await this.page.goto(url, { waitUntil: "domcontentloaded" });

        // Wait for network to be idle (important for PR environments where assets may load slower)
        try {
          await this.page.waitForLoadState("networkidle", { timeout: 20000 });
        } catch {
          // If networkidle times out, continue anyway - page might still be usable
        }

        // Wait for the session check to complete by waiting for LoadingScreen to disappear
        // The RequiresSession component shows LoadingScreen while status === "loading"
        // We need to wait for it to transition to either "unauthenticated" (shows Login) or "authenticated" (redirects)
        await this.page.waitForFunction(
          () => {
            // Check if we're on a different page (redirected because authenticated)
            if (
              window.location.pathname !== "/" &&
              window.location.pathname !== "/api/auth/signin"
            ) {
              return true; // We've been redirected, which is fine
            }

            // Check if login form is visible
            const emailInput = document.querySelector(
              '#email, input[type="email"][name="email"]'
            ) as HTMLInputElement | null;
            if (emailInput && emailInput.offsetParent !== null) {
              return true; // Login form is visible
            }

            // Check if we're still showing a loading screen
            // Look for common loading indicators
            const loadingIndicators = [
              ...Array.from(document.querySelectorAll(".animate-spin")),
              ...Array.from(
                document.querySelectorAll('[data-testid="loading-spinner"]')
              ),
              ...Array.from(document.querySelectorAll(".loading")),
              ...Array.from(document.querySelectorAll(".spinner")),
            ];

            // Check if any loading indicator is visible
            const hasVisibleLoading = loadingIndicators.some((el) => {
              const htmlEl = el as HTMLElement;
              return htmlEl.offsetParent !== null;
            });

            // If we have visible loading indicators, we're still loading
            if (hasVisibleLoading) {
              return false;
            }

            // If we're here, loading is done but login form isn't visible
            // This might mean we're authenticated and redirected, or there's an error
            // Wait a bit more for potential redirect
            return false;
          },
          { timeout: 30000 }
        );

        // Additional wait to ensure React has finished rendering
        await this.page.waitForTimeout(1000);

        // Check if we've been redirected (user might be authenticated)
        const currentUrl = this.page.url();
        if (currentUrl !== url && !currentUrl.includes("/api/auth/signin")) {
          // We've been redirected, which means user might be authenticated
          // Navigate back to the login page and clear auth state
          await this.page.context().clearCookies();
          await this.page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
          });
          // Try again
          if (attempt < maxRetries) {
            await this.page.waitForTimeout(1000);
            continue;
          }
        }

        // Now wait for the email input to be visible
        await this.emailInput.waitFor({ state: "visible", timeout: 20000 });
        // Success - login form is visible
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries) {
          // Wait a bit and try navigating again
          await this.page.waitForTimeout(2000);
          // Clear auth state before retry
          await this.page.context().clearCookies();
          await this.page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
          });
        }
      }
    }

    // All retries failed - provide detailed error
    const currentUrl = this.page.url();
    const pageTitle = await this.page.title().catch(() => "unknown");

    throw new Error(
      `Login form not found after ${maxRetries} attempts navigating to ${url}.\n` +
        `Current URL: ${currentUrl}\n` +
        `Page title: ${pageTitle}\n` +
        `Last error: ${lastError?.message}\n` +
        `Page has email input: ${await this.emailInput
          .isVisible()
          .catch(() => false)}`
    );
  }

  /**
   * Fill in email address for magic link
   */
  async fillEmail(email: string): Promise<void> {
    await this.fillInput(this.emailInput, email);
  }

  /**
   * Submit the email form to request magic link
   */
  async submitEmail(): Promise<void> {
    // Wait for network to be idle before submitting to ensure page is ready
    await this.page.waitForLoadState("networkidle");
    await this.clickElement(this.submitButton);
  }

  /**
   * Complete the magic link request process
   */
  async requestMagicLink(email: string): Promise<void> {
    await this.fillEmail(email);
    await this.submitEmail();
  }

  /**
   * Wait for the magic link request to complete
   */
  async waitForMagicLinkRequest(): Promise<void> {
    // Wait for navigation to complete after form submission
    // NextAuth may redirect to an error page or stay on the login page
    try {
      // Wait for navigation to complete (with timeout)
      await this.page
        .waitForLoadState("networkidle", { timeout: 10000 })
        .catch(() => {
          // Navigation might not happen, continue
        });

      // Wait a bit for any redirects to complete
      await this.page.waitForTimeout(2000);

      // Check if we've been redirected to an error page
      const currentUrl = this.page.url();
      if (currentUrl.includes("/api/auth/error")) {
        // Try to extract error information from the page
        const errorText = await this.page.textContent("body").catch(() => "");
        const errorParam = new URL(currentUrl).searchParams.get("error");
        const errorMessage = errorParam
          ? decodeURIComponent(errorParam)
          : errorText || "Unknown authentication error";

        throw new Error(
          `Magic link request failed - redirected to error page: ${errorMessage}`
        );
      }

      // If we're still on the login page, check button state
      if (currentUrl.includes("/api/auth/signin") || currentUrl.endsWith("/")) {
        // Wait for button text to NOT be "SENDING..." anymore (with a reasonable timeout)
        try {
          await this.page.waitForFunction(
            () => {
              const button = document.querySelector('button[type="submit"]');
              if (!button) return false;
              const text = button.textContent?.trim() || "";
              return !text.includes("SENDING...");
            },
            { timeout: 30000 }
          );

          // Wait a bit for any error messages to appear
          await this.page.waitForTimeout(1000);

          // Check if there's an error message
          if (await this.hasErrorMessage()) {
            const errorText = await this.getErrorMessage();
            throw new Error(`Magic link request failed: ${errorText}`);
          }

          // Verify button is back to normal state
          const buttonText = await this.submitButton.textContent();
          if (buttonText?.includes("SENDING...")) {
            throw new Error("Button is still in SENDING state after timeout");
          }

          // Check for success indicator (like "Check your email" message)
          const checkEmailText = this.page.locator(
            "text=/check.*(email|inbox)/i"
          );
          const hasCheckEmail = await checkEmailText
            .isVisible()
            .catch(() => false);
          if (hasCheckEmail) {
            // Success - email was sent
            return;
          }
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.includes("Magic link request failed") ||
              error.message.includes("timeout"))
          ) {
            throw error;
          }
        }
      }

      // If we're not on login or error page, assume success (might have redirected elsewhere)
      // Check for success indicator as fallback
      const checkEmailText = this.page.locator(
        "text=/check (your )?(email|inbox)/i"
      );
      const hasCheckEmail = await checkEmailText.isVisible().catch(() => false);
      if (hasCheckEmail) {
        return;
      }

      // If we can't determine success/failure, get button state for debugging
      let buttonState = "unknown";
      let buttonVisible = false;
      let buttonCount = 0;
      try {
        buttonCount = await this.submitButton.count();
        buttonVisible = await this.submitButton.isVisible().catch(() => false);
        if (buttonVisible) {
          buttonState = (await this.submitButton.textContent()) || "empty";
        } else {
          buttonState = "not visible";
        }
      } catch (err) {
        buttonState = `error: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }

      const errorVisible = await this.hasErrorMessage();

      throw new Error(
        `Magic link request may have failed. ` +
          `Button count: ${buttonCount}, visible: ${buttonVisible}, state: ${buttonState}, ` +
          `Error visible: ${errorVisible}, URL: ${currentUrl}`
      );
    } catch (error) {
      // Re-throw if it's already a formatted error
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(
        `Unexpected error waiting for magic link request: ${error}`
      );
    }
  }

  /**
   * Check if the magic link request was successful
   */
  async isMagicLinkRequestSuccessful(): Promise<boolean> {
    const successMsg = await this.getSuccessMessage();
    return successMsg.length > 0 || (await this.hasSuccessIndicator());
  }

  /**
   * Check for success indicator (like "Check your email" message)
   */
  async hasSuccessIndicator(): Promise<boolean> {
    const checkEmailText = this.page.locator(
      "text=/check (your )?(email|inbox)/i"
    );
    return await this.isElementVisible(checkEmailText);
  }

  /**
   * Get the success message text
   */
  async getSuccessMessage(): Promise<string> {
    if (await this.isElementVisible(this.successMessage)) {
      return await this.getElementText(this.successMessage);
    }
    return "";
  }

  /**
   * Get the error message text
   */
  async getErrorMessage(): Promise<string> {
    if (await this.isElementVisible(this.errorMessage)) {
      return await this.getElementText(this.errorMessage);
    }
    return "";
  }

  /**
   * Check if there's an error message
   */
  async hasErrorMessage(): Promise<boolean> {
    return await this.isElementVisible(this.errorMessage);
  }

  /**
   * Check if the form is in loading state
   */
  async isLoading(): Promise<boolean> {
    return await this.isElementVisible(this.loadingSpinner);
  }

  /**
   * Wait for loading to complete
   */
  async waitForLoadingComplete(): Promise<void> {
    if (await this.isLoading()) {
      await this.loadingSpinner.waitFor({ state: "hidden" });
    }
    // Also wait for button to not be in "SENDING..." state
    await this.submitButton.waitFor({
      state: "visible",
      timeout: 10000,
    });
  }

  /**
   * Verify that the page has loaded
   */
  async verifyPageLoaded(): Promise<void> {
    // Wait for the page to be fully loaded
    await this.waitForPageLoad();
    // Check if we can see the login form
    // Use longer timeout (20s) for PR environments where page load may be slower
    await this.emailInput.waitFor({ state: "visible", timeout: 20000 });
  }

  /**
   * Verify that the login form is visible
   */
  async verifyLoginForm(): Promise<void> {
    await this.verifyPageLoaded();
    // Verify the form elements are available
    // Use longer timeout (20s) for PR environments where page load may be slower
    await this.emailInput.waitFor({ state: "visible", timeout: 20000 });
    await this.submitButton.waitFor({ state: "visible", timeout: 20000 });
  }
}
