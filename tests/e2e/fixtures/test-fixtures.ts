import { test, expect } from "@playwright/test";

import { UserManagement, createUserManagement, TestUser } from "../utils/user-management";

// Export the test object and expect
export { test, expect };

// Export user management types and utilities
export { UserManagement, createUserManagement };
export type { TestUser };

// Enhanced test fixture that includes user management
export const testWithUserManagement = test.extend<{
  userManagement: UserManagement;
}>({
  userManagement: async ({ page }, use) => {
    const userManagement = createUserManagement(page);

    await use(userManagement);
  },
});

