import { test as base, expect, Page, BrowserContext } from "@playwright/test";

import {
  UserManagement,
  createUserManagement,
  TestUser,
} from "../utils/user-management";

// Export the test object and expect
export { expect };

// Export user management types and utilities
export { UserManagement, createUserManagement };
export type { TestUser };

// Worker-scoped fixtures to maintain state across serial tests
type WorkerFixtures = {
  sharedContext: BrowserContext;
  sharedPage: Page;
};

// Test-scoped fixtures
type TestFixtures = {
  userManagement: UserManagement;
  page: Page; // Override the built-in page fixture
};

// Create a test object with custom fixtures
export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Worker-scoped context that persists across all tests in the worker
  sharedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      await use(context);
      await context.close();
    },
    { scope: "worker" },
  ],

  // Worker-scoped page that persists across all tests in the worker
  sharedPage: [
    async ({ sharedContext }, use) => {
      const page = await sharedContext.newPage();
      await use(page);
    },
    { scope: "worker" },
  ],

  // Override the page fixture to use the shared page
  page: async ({ sharedPage }, use) => {
    await use(sharedPage);
  },

  // User management fixture using the shared page
  userManagement: async ({ page }, use) => {
    const userManagement = createUserManagement(page);
    await use(userManagement);
  },
});

// Export for backwards compatibility
export const testWithUserManagement = test;
