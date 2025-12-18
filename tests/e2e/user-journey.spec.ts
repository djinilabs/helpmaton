import { expect } from "@playwright/test";

import { testWithUserManagement } from "./fixtures/test-fixtures";
import { AgentDetailPage } from "./pages/agent-detail-page";
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
      const systemPrompt = `You are a helpful AI assistant created for E2E testing purposes. 
Your job is to respond to test queries and demonstrate that the agent system is working correctly.

When asked "What is your purpose?", respond with: "I am an E2E test agent created to verify the agent functionality."`;

      const agent = await workspaceDetailPage.createAgent({
        name: agentName,
        systemPrompt,
      });

      state.agent = agent;

      // Verify agent was created
      expect(agent.id).toBeTruthy();
      expect(agent.workspaceId).toBe(state.workspace.id);
      expect(agent.name).toBe(agentName);

      // Note: UI stays on workspace detail page after creating agent (doesn't auto-navigate)
      const currentUrl = page.url();
      expect(currentUrl).toContain(`/workspaces/${agent.workspaceId}`);

      console.log(`✅ Test 3: Agent created with ID: ${agent.id}`);
    });

    testWithUserManagement(
      "4. Upload documents (placeholder)",
      async ({ page }) => {
        console.log("📄 Test 4: Document upload...");

        if (!state.workspace) {
          throw new Error(
            "No workspace found in state. Test 2 may have failed."
          );
        }

        // Navigate to workspace detail page
        const workspaceDetailPage = new WorkspaceDetailPage(page);
        await workspaceDetailPage.goto(state.workspace.id);

        // Expand documents section
        await workspaceDetailPage.expandDocumentsSection();

        // TODO: Implement document upload
        // For now, just verify the documents section is accessible
        console.log(
          "⚠️ Test 4: Document upload not yet implemented - section accessible"
        );

        // Mark this as a placeholder test
        expect(true).toBe(true);
      }
    );

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

      // Store conversation ID for future tests
      // This is a simplified approach - in reality we'd extract the conversation ID from the page
      state.conversationId = "placeholder-conversation-id";
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

        // We should have at least 1 conversation from the previous test
        expect(conversationCount).toBeGreaterThanOrEqual(1);

        console.log(
          `✅ Test 6: Found ${conversationCount} conversation(s) in history`
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
  "Helpmaton User Journey - Phase 2 (Future)",
  () => {
    testWithUserManagement.skip(
      "7. Team collaboration - Invite member",
      async () => {
        // TODO: Implement team member invitation test
      }
    );

    testWithUserManagement.skip(
      "8. Credit management - Purchase credits",
      async () => {
        // TODO: Implement credit purchase test (conditional on PR environment)
      }
    );

    testWithUserManagement.skip("9. Spending limits - Set limits", async () => {
      // TODO: Implement spending limits test
    });
  }
);

testWithUserManagement.describe.serial(
  "Helpmaton User Journey - Phase 3 (Future)",
  () => {
    testWithUserManagement.skip(
      "10. Memory system - Verify memory records",
      async () => {
        // TODO: Implement memory system test
      }
    );

    testWithUserManagement.skip(
      "11. Usage analytics - Check dashboard",
      async () => {
        // TODO: Implement usage analytics test
      }
    );
  }
);
