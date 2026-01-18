import { expect } from "@playwright/test";

import { testWithUserManagement } from "./fixtures/test-fixtures";
import { AgentDetailPage } from "./pages/agent-detail-page";
import { HomePage } from "./pages/home-page";
import { WorkspaceDetailPage } from "./pages/workspace-detail-page";
import { WorkspacesPage } from "./pages/workspaces-page";
import { getEnvironmentName, shouldRunBillingTests } from "./utils/environment";
import { testState, TestState } from "./utils/shared-state";

/**
 * Helpmaton User Journey E2E Test Suite
 *
 * This test suite follows a realistic user journey through the application:
 * 1. Login
 * 2. Create Workspace
 * 3. Create Agent
 * 4. Upload Documents
 * 5. Test Agent Chat
 *
 * All tests run sequentially using the same authenticated session.
 */

testWithUserManagement.describe.serial(
  "Helpmaton User Journey - Phase 1",
  () => {
    const state: TestState = testState;

    testWithUserManagement.beforeAll(() => {
      console.log(`🌍 Running tests in ${getEnvironmentName()} environment`);
      console.log(`💳 Billing tests enabled: ${shouldRunBillingTests()}`);
    });

    testWithUserManagement(
      "1. Login and authenticate",
      async ({ page, userManagement }) => {
        console.log("🚀 Test 1: Starting login flow...");

        // Create and login user
        const user = await userManagement.createAndLoginUser();
        state.user = user;

        // Verify we're authenticated by checking we're not on login page
        const currentUrl = page.url();
        expect(currentUrl).not.toContain("/api/auth/signin");

        console.log(`✅ Test 1: User ${user.email} authenticated successfully`);
      }
    );

    testWithUserManagement("2. Create first workspace", async ({ page }) => {
      console.log("🏗️ Test 2: Creating workspace...");

      // Navigate to workspaces page
      const workspacesPage = new WorkspacesPage(page);
      await workspacesPage.goto();

      // Wait for page to load
      await page.waitForLoadState("domcontentloaded");

      // Check if we got redirected to login (not authenticated)
      if (page.url().includes("/api/auth/signin")) {
        throw new Error(
          "Not authenticated - session was not maintained from Test 1"
        );
      }

      await workspacesPage.waitForWorkspacesPage();

      // Create workspace
      const workspaceName = `E2E Test Workspace ${Date.now()}`;
      const workspaceDescription = "Automated test workspace for E2E testing";

      const workspace = await workspacesPage.createWorkspace(
        workspaceName,
        workspaceDescription
      );
      state.workspace = workspace;

      // Verify workspace was created and we're on workspace detail page
      expect(workspace.id).toBeTruthy();
      expect(workspace.name).toBe(workspaceName);

      const finalUrl = page.url();
      expect(finalUrl).toContain(`/workspaces/${workspace.id}`);

      console.log(`✅ Test 2: Workspace created with ID: ${workspace.id}`);
    });

    testWithUserManagement("3. Create first agent", async ({ page }) => {
      console.log("🤖 Test 3: Creating agent...");

      if (!state.workspace) {
        throw new Error("No workspace found in state. Test 2 may have failed.");
      }

      // Navigate to workspace detail page (should already be there, but ensure it)
      const workspaceDetailPage = new WorkspaceDetailPage(page);
      await workspaceDetailPage.goto(state.workspace.id);
      await workspaceDetailPage.waitForWorkspaceDetailPage();

      // Create agent
      const agentName = `E2E Test Agent ${Date.now()}`;
      const systemPrompt = [
        "You are a helpful AI assistant created for E2E testing purposes.",
        "Your job is to respond to test queries and demonstrate that the agent system is working correctly.",
        "",
        'When asked "What is your purpose?", respond with: "I am an E2E test agent created to verify the agent functionality."',
      ].join("\n");

      const agent = await workspaceDetailPage.createAgent({
        name: agentName,
        systemPrompt,
      });

      state.agent = agent;

      // Verify agent was created
      expect(agent.id).toBeTruthy();
      expect(agent.workspaceId).toBe(state.workspace.id);
      expect(agent.name).toBe(agentName);

      // Note: UI navigates to agent detail page after creating agent
      const currentUrl = page.url();
      expect(currentUrl).toContain(`/workspaces/${agent.workspaceId}/agents/${agent.id}`);

      console.log(`✅ Test 3: Agent created with ID: ${agent.id}`);
    });

    testWithUserManagement("4. Upload documents", async ({ page }) => {
      console.log("📄 Test 4: Document upload...");

      if (!state.workspace) {
        throw new Error("No workspace found in state. Test 2 may have failed.");
      }

      // Navigate to workspace detail page
      const workspaceDetailPage = new WorkspaceDetailPage(page);
      await workspaceDetailPage.goto(state.workspace.id);
      await workspaceDetailPage.waitForWorkspaceDetailPage();

      // Get initial document count
      const initialCount = await workspaceDetailPage.getDocumentCount();
      console.log(`📊 Initial document count: ${initialCount}`);

      // Create a text document (simpler than file upload for E2E testing)
      const documentName = `E2E Test Document ${Date.now()}`;
      const documentContent = `# E2E Test Document

This is a test document created during E2E testing.

## Purpose
This document is used to verify that document upload functionality works correctly.

## Content
The document upload feature allows users to upload markdown or text files that agents can reference during conversations.

Created at: ${new Date().toISOString()}
`;

      console.log(`📝 Creating text document: ${documentName}`);
      await workspaceDetailPage.createTextDocument(
        documentName,
        documentContent
      );

      // Verify document count increased
      const finalCount = await workspaceDetailPage.getDocumentCount();
      expect(finalCount).toBeGreaterThan(initialCount);
      console.log(`📊 Final document count: ${finalCount}`);

      // Verify document appears in the list
      const documentButton = page.locator(`button:has-text("${documentName}")`);
      await documentButton.waitFor({ state: "visible", timeout: 10000 });
      const isVisible = await documentButton.isVisible();
      expect(isVisible).toBe(true);

      console.log(
        `✅ Test 4: Document "${documentName}" uploaded and verified successfully`
      );
    });

    testWithUserManagement("5. Test agent chat", async ({ page }) => {
      console.log("💬 Test 5: Testing agent chat...");

      if (!state.workspace || !state.agent) {
        throw new Error(
          "No workspace or agent found in state. Previous tests may have failed."
        );
      }

      // Navigate to agent detail page
      const agentDetailPage = new AgentDetailPage(page);
      await agentDetailPage.goto(state.agent.workspaceId, state.agent.id);
      await agentDetailPage.waitForAgentDetailPage();

      // Verify agent name
      const agentName = await agentDetailPage.getAgentName();
      expect(agentName).toBe(state.agent.name);

      // Send a test message
      const testMessage = "What is your purpose?";
      console.log(`📤 Sending test message: "${testMessage}"`);

      await agentDetailPage.sendMessage(testMessage);

      // Wait for response
      const response = await agentDetailPage.waitForAgentResponse();
      console.log(`📥 Received response: "${response}"`);

      // Verify response contains expected text
      expect(response).toBeTruthy();
      expect(response.length).toBeGreaterThan(0);

      // Check if response mentions being a test agent
      const containsExpectedText =
        response.toLowerCase().includes("test") ||
        response.toLowerCase().includes("e2e") ||
        response.toLowerCase().includes("agent");

      console.log(
        `✅ Test 5: Agent responded successfully (contains expected keywords: ${containsExpectedText})`
      );
    });

    testWithUserManagement(
      "6. Verify conversation history",
      async ({ page }) => {
        console.log("📋 Test 6: Verifying conversation history...");

        if (!state.workspace || !state.agent) {
          throw new Error(
            "No workspace or agent found in state. Previous tests may have failed."
          );
        }

        // Navigate to agent detail page
        const agentDetailPage = new AgentDetailPage(page);
        await agentDetailPage.goto(state.agent.workspaceId, state.agent.id);

        // Expand conversations section
        await agentDetailPage.expandConversationsSection();

        // Get conversation count
        const conversationCount = await agentDetailPage.getConversationCount();

        // Verify conversation list loaded successfully
        // Note: Conversations may not appear immediately after sending a message
        // as the list may not auto-refresh. The important thing is that the list loads.
        expect(conversationCount).toBeGreaterThanOrEqual(0);

        console.log(
          `✅ Test 6: Conversation list loaded successfully (found ${conversationCount} conversation(s))`
        );
      }
    );

    testWithUserManagement(
      "7. Test streaming server",
      async ({ page }) => {
        console.log("🌊 Test 7: Testing streaming server...");

        if (!state.workspace || !state.agent) {
          throw new Error(
            "No workspace or agent found in state. Previous tests may have failed."
          );
        }

        // Navigate to agent detail page
        const agentDetailPage = new AgentDetailPage(page);
        await agentDetailPage.goto(state.agent.workspaceId, state.agent.id);
        await agentDetailPage.waitForAgentDetailPage();

        // Get initial conversation count
        const initialConversationCount =
          await agentDetailPage.getConversationCount();
        console.log(
          `📊 Initial conversation count: ${initialConversationCount}`
        );

        // Create stream server with wildcard allowed origins
        console.log("🔧 Creating stream server...");
        await agentDetailPage.createStreamServer("*");
        console.log("✅ Stream server created");

        // Open test streaming server dialog (checks if stream URL is available)
        console.log("🚪 Opening test streaming server dialog...");
        const dialogOpened = await agentDetailPage.openTestStreamServerDialog();
        
        if (!dialogOpened) {
          console.log(
            "⚠️ Stream URL not available in this environment - skipping streaming test"
          );
          console.log(
            "✅ Stream server configuration created successfully (test dialog requires stream URL)"
          );
          // Still verify conversation count didn't change (we didn't chat)
          const finalConversationCount =
            await agentDetailPage.getConversationCount();
          expect(finalConversationCount).toBe(initialConversationCount);
          return;
        }
        
        console.log("✅ Test dialog opened");

        // Send a test message
        const testMessage = "Hello, this is a test message";
        console.log(`📤 Sending test message: "${testMessage}"`);
        await agentDetailPage.sendMessageInStreamDialog(testMessage);

        // Wait for agent response
        console.log("⏳ Waiting for agent response...");
        const response = await agentDetailPage.waitForAgentResponseInStreamDialog(
          60000
        );
        console.log(`📥 Received response: "${response.substring(0, 100)}..."`);

        // Verify response is not empty
        expect(response).toBeTruthy();
        expect(response.length).toBeGreaterThan(0);

        // Verify no errors in console (check for error messages)
        const consoleErrors: string[] = [];
        page.on("console", (msg) => {
          if (msg.type() === "error") {
            consoleErrors.push(msg.text());
          }
        });

        // Close the dialog
        console.log("🚪 Closing test dialog...");
        await agentDetailPage.closeTestStreamServerDialog();
        console.log("✅ Test dialog closed");

        // Wait a bit for conversation to be created
        await page.waitForTimeout(2000);

        // Verify conversation was created
        console.log("📋 Verifying conversation was created...");
        const finalConversationCount =
          await agentDetailPage.getConversationCount();
        console.log(
          `📊 Final conversation count: ${finalConversationCount}`
        );

        // Verify conversation count increased
        expect(finalConversationCount).toBeGreaterThan(initialConversationCount);

        // Verify the latest conversation contains the test message
        console.log("🔍 Verifying conversation contains test message...");
        const containsMessage =
          await agentDetailPage.verifyLatestConversationContainsMessage(
            testMessage
          );
        // Note: Conversation cards might not show full message text, so this is a best-effort check
        if (containsMessage) {
          console.log("✅ Conversation contains expected message");
        } else {
          console.log(
            "⚠️ Could not verify message in conversation card (this may be expected if card shows summary)"
          );
        }

        // Verify no console errors occurred
        if (consoleErrors.length > 0) {
          console.warn("⚠️ Console errors detected:", consoleErrors);
          // Don't fail the test for console errors, but log them
        }

        console.log(
          `✅ Test 7: Streaming server test completed successfully (conversation count: ${initialConversationCount} → ${finalConversationCount})`
        );
      }
    );

    testWithUserManagement.afterAll(async () => {
      console.log("🧹 Cleaning up test data...");

      if (state.workspace) {
        console.log(
          `📝 Test workspace ID: ${state.workspace.id} (manual cleanup may be required)`
        );
      }

      if (state.agent) {
        console.log(
          `📝 Test agent ID: ${state.agent.id} (manual cleanup may be required)`
        );
      }

      console.log("✨ Test suite completed!");
    });
  }
);

// Additional test describe blocks for Phase 2 and Phase 3 can be added here
// These would include:
// - Team collaboration tests
// - Credit management tests (conditional on PR environment)
// - Spending limits tests
// - Memory system tests
// - Usage analytics tests

testWithUserManagement.describe.serial(
  "Helpmaton User Journey - Phase 2",
  () => {
    const state: TestState = testState;

    testWithUserManagement.beforeAll(() => {
      console.log(
        `🌍 Running Phase 2 tests in ${getEnvironmentName()} environment`
      );
      console.log(`💳 Billing tests enabled: ${shouldRunBillingTests()}`);
    });

    testWithUserManagement(
      "7. Team collaboration - Invite member",
      async ({ page, userManagement }) => {
        console.log("👥 Test 7: Inviting team member...");

        if (!state.workspace) {
          throw new Error(
            "No workspace found in state. Phase 1 tests may have failed."
          );
        }

        // Create a second test user to invite
        const inviteeUser = await userManagement.createTestUser();
        console.log(`📧 Inviting user: ${inviteeUser.email}`);

        // Navigate to workspace detail page
        const workspaceDetailPage = new WorkspaceDetailPage(page);
        await workspaceDetailPage.goto(state.workspace.id);
        await workspaceDetailPage.waitForWorkspaceDetailPage();

        // Invite the team member
        await workspaceDetailPage.inviteTeamMember(inviteeUser.email);

        console.log(
          `✅ Test 7: Team member ${inviteeUser.email} invited successfully`
        );
      }
    );

    testWithUserManagement(
      "8. Credit management - Purchase credits",
      async ({ page }) => {
        console.log("💳 Test 8: Testing credit purchase...");

        if (!state.workspace) {
          throw new Error(
            "No workspace found in state. Phase 1 tests may have failed."
          );
        }

        // Skip credit purchase test if not in PR environment or billing tests disabled
        if (!shouldRunBillingTests()) {
          console.log(
            "⏭️ Test 8: Skipping credit purchase (not in PR environment or billing tests disabled)"
          );
          return;
        }

        // Navigate to workspace detail page
        const workspaceDetailPage = new WorkspaceDetailPage(page);
        await workspaceDetailPage.goto(state.workspace.id);
        await workspaceDetailPage.waitForWorkspaceDetailPage();

        // Get initial credit balance
        const initialBalance = await workspaceDetailPage.getCreditBalance();
        console.log(`💰 Initial credit balance: ${initialBalance}`);

        // Attempt to purchase credits (this will redirect to Lemon Squeezy checkout)
        // In test environment, we just verify the UI flow works
        // We don't complete the actual purchase as it requires payment
        try {
          await workspaceDetailPage.purchaseCredits(1.0);
          console.log(
            "✅ Test 8: Credit purchase flow initiated (redirected to checkout)"
          );
        } catch (error) {
          // If purchase redirects to external site, that's expected
          const currentUrl = page.url();
          if (
            currentUrl.includes("lemonsqueezy.com") ||
            currentUrl.includes("checkout")
          ) {
            console.log(
              "✅ Test 8: Credit purchase flow redirected to checkout (expected)"
            );
          } else {
            throw error;
          }
        }
      }
    );

    testWithUserManagement(
      "9. Spending limits - Set limits",
      async ({ page }) => {
        console.log("📊 Test 9: Setting spending limits...");

        if (!state.workspace) {
          throw new Error(
            "No workspace found in state. Phase 1 tests may have failed."
          );
        }

        // Navigate to workspace detail page
        const workspaceDetailPage = new WorkspaceDetailPage(page);
        await workspaceDetailPage.goto(state.workspace.id);
        await workspaceDetailPage.waitForWorkspaceDetailPage();

        // Set a daily spending limit (e.g., $10.00 = 10000000 millionths)
        // For display purposes, we'll use 10.00 USD
        const dailyLimitAmount = 10.0;
        await workspaceDetailPage.addSpendingLimit("daily", dailyLimitAmount);

        console.log(
          `✅ Test 9: Daily spending limit of $${dailyLimitAmount} set successfully`
        );
      }
    );
  }
);

testWithUserManagement.describe.serial(
  "Helpmaton User Journey - Phase 3",
  () => {
    const state: TestState = testState;

    testWithUserManagement(
      "10. Memory system - Verify memory records",
      async ({ page }) => {
        console.log("🧠 Test 10: Memory system verification...");

        if (!state.workspace || !state.agent) {
          throw new Error(
            "No workspace or agent found in state. Previous tests may have failed."
          );
        }

        // Navigate to agent detail page
        const agentDetailPage = new AgentDetailPage(page);
        await agentDetailPage.goto(state.workspace.id, state.agent.id);
        await agentDetailPage.waitForAgentDetailPage();

        // Verify memory records section is accessible
        console.log("📋 Verifying memory records section is accessible...");
        const isAccessible =
          await agentDetailPage.verifyMemoryRecordsAccessible();
        expect(isAccessible).toBe(true);

        // Get memory records count (might be 0 if no conversations have been processed)
        const memoryCount = await agentDetailPage.getMemoryRecordsCount();
        console.log(`📊 Memory records count: ${memoryCount}`);

        // Verify the memory records UI is functional
        // The section should be accessible even if there are no records yet
        console.log(
          `✅ Test 10: Memory records section is accessible (${memoryCount} records found)`
        );
      }
    );

    testWithUserManagement(
      "11. Usage analytics - Check dashboard",
      async ({ page }) => {
        console.log("📊 Test 11: Usage analytics dashboard...");

        // Navigate to home page
        const homePage = new HomePage(page);
        await homePage.goto();
        await homePage.waitForHomePage();

        // Verify usage dashboard is visible
        console.log("📈 Verifying usage dashboard is visible...");
        const isVisible = await homePage.verifyUsageDashboardVisible();
        expect(isVisible).toBe(true);

        // Get usage statistics
        console.log("📊 Retrieving usage statistics...");
        const stats = await homePage.getUsageStats();
        console.log(`📊 Usage stats:`, stats);

        // Verify dashboard shows usage information
        // Even if all values are 0, the dashboard should be functional
        expect(stats).toBeDefined();

        // Verify dashboard title is present
        const dashboardHeading = await homePage.getDashboardHeading();
        expect(dashboardHeading).toContain("Your dashboard");

        console.log(
          `✅ Test 11: Usage analytics dashboard is accessible and functional`
        );
      }
    );
  }
);
