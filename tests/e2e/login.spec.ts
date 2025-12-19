import { testWithUserManagement, TestUser } from "./fixtures/test-fixtures";

/**
 * E2E Test for Login Feature
 *
 * This test verifies the complete login workflow:
 * 1. User can submit email for magic link
 * 2. Magic link email is received
 * 3. User can click magic link to authenticate
 * 4. User is successfully authenticated
 */
testWithUserManagement.describe("Login Feature", () => {
  let testUser: TestUser;

  testWithUserManagement.beforeEach(async ({ page, userManagement }) => {
    // Clear authentication state before each test
    // This ensures each test starts from an unauthenticated state

    // First, navigate to a page to ensure we have a page context
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Clear cookies, localStorage, and sessionStorage (all authentication state)
    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Navigate to signout endpoint to ensure we're logged out server-side
    await page.goto("/api/auth/signout", { waitUntil: "domcontentloaded" });

    // Clear storage again after signout (in case signout set any new values)
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Navigate to home page and wait for login form
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Wait for login form to appear (with longer timeout for PR environments)
    await page.waitForSelector(
      '#email, input[type="email"], input[name="email"]',
      { timeout: 20000, state: "visible" }
    );

    // Create a fresh test user for each test
    testUser = await userManagement.createTestUser();
  });

  testWithUserManagement(
    "should complete full login workflow successfully",
    async ({ userManagement }) => {
      console.log("🚀 Starting login E2E test...");

      // Step 1: Initiate magic link login
      console.log("📝 Step 1: Initiating magic link login...");
      await userManagement.initiateMagicLinkLogin(testUser.email);
      console.log("✅ Magic link request sent");

      // Step 2: Wait for magic link email
      console.log("📧 Step 2: Waiting for magic link email...");
      await userManagement.waitForMagicLink(testUser);
      console.log("✅ Magic link email received");

      // Step 3: Complete authentication
      console.log("🔐 Step 3: Completing authentication...");
      await userManagement.completeMagicLinkAuth(testUser);
      console.log("✅ Authentication completed");

      // Step 4: Verify authentication
      console.log("✅ Step 4: Verifying authentication...");
      await userManagement.verifyUserAuthenticated();
      console.log("✅ User is authenticated");

      console.log("🎉 Login E2E test completed successfully!");
    }
  );

  testWithUserManagement(
    "should create and login user in one operation",
    async ({ userManagement }) => {
      console.log("🚀 Starting create and login test...");

      // Use the convenience method to create and login in one step
      const user = await userManagement.createAndLoginUser();

      console.log(`✅ User ${user.email} created and logged in successfully`);
    }
  );
});
