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
    await this.page.goto(url, { waitUntil: "domcontentloaded" });

    // Wait for network to be idle (important for PR environments where assets may load slower)
    try {
      await this.page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {
      // If networkidle times out, continue anyway - page might still be usable
    }

    // Wait for the login form to appear (this ensures React has rendered)
    // Use a longer timeout for PR environments
    try {
      await this.emailInput.waitFor({ state: "visible", timeout: 20000 });
    } catch {
      // If email input doesn't appear, the page might have redirected or be in a different state
      // Wait a bit more and check the URL
      await this.page.waitForTimeout(2000);
      const currentUrl = this.page.url();
      if (
        !currentUrl.includes("/api/auth/signin") &&
        !currentUrl.endsWith("/")
      ) {
        // Page might have redirected - try navigating again
        await this.page.goto(url, { waitUntil: "domcontentloaded" });
        await this.emailInput.waitFor({ state: "visible", timeout: 20000 });
      } else {
        throw new Error(
          `Login form not found after navigation to ${url}. Current URL: ${currentUrl}`
        );
      }
    }
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
          const checkEmailText = this.page.locator("text=/check.*email/i");
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
      const checkEmailText = this.page.locator("text=/check.*email/i");
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
    const checkEmailText = this.page.locator("text=/check.*email/i");
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
