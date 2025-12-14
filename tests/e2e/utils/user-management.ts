import { Page } from "@playwright/test";

import { LoginPage } from "../pages/login-page";

import { TestmailClient } from "./testmail";

export interface TestUser {
  email: string;
  magicLink?: string;
  testmail: TestmailClient;
}

export interface LoginOptions {
  waitForEmailTimeout?: number;
}

export class UserManagement {
  private page: Page;
  private loginPage: LoginPage;

  constructor(page: Page) {
    this.page = page;
    this.loginPage = new LoginPage(page);
  }

  /**
   * Creates a new test user with a unique email address
   */
  async createTestUser(): Promise<TestUser> {
    const namespace = process.env.TESTMAIL_NAMESPACE;
    if (!namespace) {
      throw new Error("TESTMAIL_NAMESPACE environment variable is required");
    }
    const testmail = new TestmailClient(namespace);
    console.log(`Created Testmail inbox: ${testmail.emailAddress}`);

    return {
      email: testmail.emailAddress,
      testmail,
    };
  }

  /**
   * Initiates the magic link login process by submitting the email
   */
  async initiateMagicLinkLogin(email: string): Promise<void> {
    // Navigate to login page
    await this.loginPage.goto("/");

    // Verify login form is visible
    await this.loginPage.verifyLoginForm();

    // Request magic link
    await this.loginPage.requestMagicLink(email);

    // Wait for form submission to process
    await this.loginPage.waitForMagicLinkRequest();

    console.log(`Magic link login initiated for: ${email}`);
  }

  /**
   * Waits for and extracts the magic link from the email
   */
  async waitForMagicLink(
    user: TestUser,
    timeout: number = 120000
  ): Promise<string> {
    console.log(`Fetching magic link email from Testmail for: ${user.email}`);

    const magicLinkEmail = await user.testmail.waitForMessage(timeout);
    if (!magicLinkEmail) {
      throw new Error(`No magic link email received for ${user.email}`);
    }

    const magicLink = this.extractMagicLinkFromEmail(
      magicLinkEmail.text || ""
    );
    user.magicLink = magicLink;

    console.log(`✅ Magic link extracted: ${magicLink}`);
    return magicLink;
  }

  /**
   * Completes the magic link authentication process
   */
  async completeMagicLinkAuth(user: TestUser): Promise<void> {
    if (!user.magicLink) {
      throw new Error("No magic link available. Call waitForMagicLink first.");
    }

    console.log("Navigating to magic link...");
    await this.page.goto(user.magicLink);
    await this.page.waitForLoadState("domcontentloaded");

    // Wait for the authentication to complete and session to be established
    console.log("Waiting for authentication to complete...");

    // Wait for the page to fully load and settle
    await this.page.waitForLoadState("load");

    // Check if we're on a callback URL and wait for redirect
    const currentUrl = this.page.url();
    if (currentUrl.includes("/api/auth/callback")) {
      console.log("On auth callback URL, waiting for redirect...");
      // Wait for redirect to complete (next-auth redirects after callback)
      await this.page.waitForURL(/^(?!.*\/api\/auth\/callback)/, {
        timeout: 15000,
      });
      await this.page.waitForLoadState("load");
    }

    console.log(`✅ Magic link authentication completed for: ${user.email}`);
  }

  /**
   * Verifies that the user is successfully authenticated
   */
  async verifyUserAuthenticated(): Promise<void> {
    console.log("Verifying user authentication...");

    // Wait for the page to fully load
    await this.page.waitForLoadState("domcontentloaded");

    const currentUrl = this.page.url();
    console.log(`Current URL during verification: ${currentUrl}`);

    // Check if we're redirected away from login (which indicates successful auth)
    // or if we can see authenticated content
    if (currentUrl.includes("/api/auth/signin")) {
      throw new Error("Still on login page - authentication may have failed");
    }

    // Look for indicators that user is authenticated
    // Helpmaton might show workspaces or other authenticated content
    const authenticatedIndicators = [
      this.page.locator('text=/workspace/i'),
      this.page.locator('text=/sign out/i'),
      this.page.locator('button:has-text("Sign out")'),
      this.page.locator('a:has-text("Workspaces")'),
    ];

    // Wait for any authenticated indicator to appear
    try {
      await Promise.any(
        authenticatedIndicators.map((indicator) =>
          indicator.waitFor({ state: "visible", timeout: 5000 }).catch(() => Promise.reject())
        )
      );
      console.log("✅ User successfully authenticated - authenticated content found");
      return;
    } catch {
      // If none of the indicators appear, continue to check URL-based authentication
    }

    // If we're not on login and not seeing error, assume authenticated
    if (!currentUrl.includes("/api/auth/signin") && !currentUrl.includes("/error")) {
      console.log("✅ User appears to be authenticated (not on login page)");
      return;
    }

    throw new Error(
      `User authentication verification failed. Current URL: ${currentUrl}.`
    );
  }

  /**
   * Complete magic link login workflow for a new user
   */
  async completeMagicLinkLoginWorkflow(
    user: TestUser,
    options: LoginOptions = {}
  ): Promise<void> {
    const { waitForEmailTimeout = 120000 } = options;

    try {
      // Step 1: Initiate magic link login
      await this.initiateMagicLinkLogin(user.email);

      // Step 2: Wait for and extract magic link
      await this.waitForMagicLink(user, waitForEmailTimeout);

      // Step 3: Complete authentication
      await this.completeMagicLinkAuth(user);

      // Step 4: Verify authentication
      await this.verifyUserAuthenticated();

      console.log(
        `🎉 Magic link login workflow completed successfully for: ${user.email}`
      );
    } catch (error) {
      console.error(
        `❌ Magic link login workflow failed for ${user.email}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Creates and logs in a new user in one operation
   */
  async createAndLoginUser(
    options: LoginOptions = {}
  ): Promise<TestUser> {
    // Create the test user
    const user = await this.createTestUser();

    // Complete the full login workflow
    await this.completeMagicLinkLoginWorkflow(user, options);

    return user;
  }

  /**
   * Cleans up the test user's Testmail inbox
   */
  async cleanupUser(user: TestUser): Promise<void> {
    console.log(`Cleaning up Testmail inbox for: ${user.email}`);
    await user.testmail.cleanup();
  }

  /**
   * Helper function to extract magic link from email content
   */
  private extractMagicLinkFromEmail(emailBody: string): string {
    // Try to find a link in the email content
    const linkRegex = /https?:\/\/[^\s<>"']+/g;

    const links = emailBody.match(linkRegex);

    if (links && links.length > 0) {
      // Return the first link that looks like a magic link
      // next-auth uses /api/auth/callback/email for email magic links
      const magicLink = links.find(
        (link: string) =>
          link.includes("/api/auth/callback/email") ||
          link.includes("/api/auth/callback") ||
          (link.includes("/api/auth/") && !link.includes("signin"))
      );

      if (magicLink) {
        return magicLink;
      }

      // If no obvious magic link found, return the first link
      return links[0];
    }

    throw new Error("No magic link found in email");
  }
}

/**
 * Factory function to create a UserManagement instance
 */
export function createUserManagement(page: Page): UserManagement {
  return new UserManagement(page);
}

