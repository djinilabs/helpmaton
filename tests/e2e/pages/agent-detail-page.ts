import { Page, Locator } from "@playwright/test";

import { BasePage } from "./base-page";

export class AgentDetailPage extends BasePage {
  // Locators
  private testAgentAccordion: Locator;
  private conversationsAccordion: Locator;
  private memoryAccordion: Locator;
  private usageAccordion: Locator;
  private backButton: Locator;
  private chatInput: Locator;
  private chatSubmitButton: Locator;

  constructor(page: Page) {
    super(page);

    // Accordion section locators
    this.testAgentAccordion = page.locator('[id="test"]');
    this.conversationsAccordion = page.locator('[id="conversations"]');
    this.memoryAccordion = page.locator('[id="memory"]');
    this.usageAccordion = page.locator('[id="usage"]');
    this.backButton = page.locator('button:has-text("Back")').first();

    // Chat interface locators
    // Note: AgentChat uses an input element, not textarea
    this.chatInput = page.locator('input[placeholder="Type your message..."]');
    this.chatSubmitButton = page.locator(
      'button[type="submit"]:has-text("Send")'
    );
  }

  /**
   * Navigate to agent detail page
   */
  async goto(workspaceId: string, agentId: string): Promise<void> {
    await this.page.goto(`/workspaces/${workspaceId}/agents/${agentId}`);
    await this.waitForPageLoad();
  }

  /**
   * Wait for agent detail page to load
   */
  async waitForAgentDetailPage(): Promise<void> {
    // Wait for agent name heading
    await this.page.waitForSelector("h1.text-4xl", { timeout: 10000 });
  }

  /**
   * Expand an accordion section
   */
  async expandAccordion(sectionTitle: string): Promise<void> {
    // Find the button by its heading text (more reliable than id)
    const accordion = this.page
      .locator(`button:has-text("${sectionTitle}")`)
      .first();

    // Check if already expanded by checking aria-expanded attribute
    const isExpanded =
      (await accordion.getAttribute("aria-expanded")) === "true";

    if (!isExpanded) {
      await this.clickElement(accordion);
      // Wait for animation
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Navigate back to workspace detail
   */
  async goBack(): Promise<void> {
    await this.clickElement(this.backButton);
    await this.page.waitForURL(/\/workspaces\/[^/]+$/, { timeout: 10000 });
  }

  /**
   * Expand Test Agent section
   */
  async expandTestSection(): Promise<void> {
    await this.expandAccordion("TEST AGENT");
  }

  /**
   * Send a message to the agent
   */
  async sendMessage(message: string): Promise<void> {
    await this.expandTestSection();

    // Wait for chat input to be visible
    await this.waitForElement(this.chatInput);

    // Fill and submit
    await this.fillInput(this.chatInput, message);
    await this.clickElement(this.chatSubmitButton);
  }

  /**
   * Wait for agent response to appear
   */
  async waitForAgentResponse(timeoutMs: number = 30000): Promise<string> {
    // Wait for a response message to appear
    // Agent responses typically appear in a specific container or with specific styling
    const responseLocator = this.page
      .locator('[role="assistant"]')
      .or(this.page.locator('div:has-text("assistant")'))
      .last();

    await this.waitForElement(responseLocator, timeoutMs);
    return await this.getElementText(responseLocator);
  }

  /**
   * Send a message and wait for response
   */
  async sendMessageAndWaitForResponse(message: string): Promise<string> {
    await this.sendMessage(message);
    return await this.waitForAgentResponse();
  }

  /**
   * Verify streaming response is working
   * (check that text appears gradually)
   */
  async verifyStreamingResponse(message: string): Promise<boolean> {
    await this.expandTestSection();
    await this.fillInput(this.chatInput, message);
    await this.clickElement(this.chatSubmitButton);

    // Check if response appears gradually (streaming indicator)
    // Look for streaming indicator or progressive text updates
    const streamingIndicator = this.page
      .locator('[data-streaming="true"]')
      .or(this.page.locator(".animate-pulse"));

    try {
      await streamingIndicator.waitFor({ state: "visible", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Expand Conversations section
   */
  async expandConversationsSection(): Promise<void> {
    await this.expandAccordion("RECENT CONVERSATIONS");
  }

  /**
   * Get conversation history count
   */
  async getConversationCount(): Promise<number> {
    await this.expandConversationsSection();

    // Count conversation items
    const conversations = this.page
      .locator("[data-conversation-id]")
      .or(this.page.locator('div:has-text("conversation")'));

    return await conversations.count();
  }

  /**
   * Expand Memory section
   */
  async expandMemorySection(): Promise<void> {
    await this.expandAccordion("MEMORY RECORDS");
  }

  /**
   * Verify memory records exist
   */
  async verifyMemoryRecordsExist(): Promise<boolean> {
    await this.expandMemorySection();

    // Check for memory records
    const memoryRecords = this.page
      .locator("[data-memory-record]")
      .or(this.page.locator('div:has-text("memory")'));

    const count = await memoryRecords.count();
    return count > 0;
  }

  /**
   * Expand Usage section
   */
  async expandUsageSection(): Promise<void> {
    await this.expandAccordion("AGENT USAGE");
  }

  /**
   * Get agent usage statistics
   */
  async getUsageStats(): Promise<{
    totalTokens?: number;
    totalCost?: number;
  }> {
    await this.expandUsageSection();

    // Extract usage stats from the page
    const stats: { totalTokens?: number; totalCost?: number } = {};

    try {
      const tokenText = await this.page
        .locator("text=/tokens/i")
        .first()
        .textContent();
      if (tokenText) {
        const match = tokenText.match(/[\d,]+/);
        if (match) {
          stats.totalTokens = parseInt(match[0].replace(/,/g, ""));
        }
      }
    } catch {
      // Token stat not found
    }

    try {
      const costText = await this.page
        .locator("text=/cost|USD/i")
        .first()
        .textContent();
      if (costText) {
        const match = costText.match(/[\d.]+/);
        if (match) {
          stats.totalCost = parseFloat(match[0]);
        }
      }
    } catch {
      // Cost stat not found
    }

    return stats;
  }

  /**
   * Get agent name
   */
  async getAgentName(): Promise<string> {
    const heading = this.page.locator("h1.text-4xl");
    return await this.getElementText(heading);
  }

  /**
   * Get agent system prompt
   */
  async getSystemPrompt(): Promise<string> {
    const promptContainer = this.page
      .locator('div:has-text("System Prompt:")')
      .locator("..")
      .locator("div.text-sm");
    return await this.getElementText(promptContainer);
  }
}
