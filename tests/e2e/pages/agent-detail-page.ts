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
    // Note: AgentChat uses a textarea element
    this.chatInput = page.locator('textarea[placeholder="Type your message..."]');
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
      // Wait for accordion to expand by checking aria-expanded attribute
      await this.page.waitForFunction(
        ({ title }) => {
          const buttons = Array.from(document.querySelectorAll("button"));
          const button = buttons.find((btn) =>
            btn.textContent?.includes(title)
          );
          return button?.getAttribute("aria-expanded") === "true";
        },
        { title: sectionTitle },
        { timeout: 5000 }
      );
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

    // Wait for accordion content area to be visible (ensures expansion is complete)
    const accordionContent = this.page.locator('[id="accordion-content-test"]');
    await accordionContent.waitFor({ state: "visible", timeout: 10000 });

    // Wait for the form to appear (more reliable than waiting for textarea directly)
    // This handles lazy loading and ensures the component has rendered
    const chatForm = this.page.locator('form:has(textarea)');
    await chatForm.waitFor({ state: "visible", timeout: 60000 });

    // Now find the textarea within the form (should be immediate since form is visible)
    const textareaInForm = chatForm.locator('textarea[placeholder="Type your message..."]');
    await textareaInForm.waitFor({ state: "visible", timeout: 10000 });

    // Fill and submit using the form-scoped locator
    await textareaInForm.fill(message);
    await this.clickElement(this.chatSubmitButton);
  }

  /**
   * Wait for agent response to appear
   */
  async waitForAgentResponse(timeoutMs: number = 30000): Promise<string> {
    // Wait for a response message to appear
    // Agent responses typically appear with role="assistant" or in a specific container
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

    // Wait for accordion content area to be visible (ensures expansion is complete)
    const accordionContent = this.page.locator('[id="accordion-content-test"]');
    await accordionContent.waitFor({ state: "visible", timeout: 10000 });

    // Wait for the form to appear (more reliable than waiting for textarea directly)
    const chatForm = this.page.locator('form:has(textarea)');
    await chatForm.waitFor({ state: "visible", timeout: 60000 });

    // Now find the textarea within the form
    const textareaInForm = chatForm.locator('textarea[placeholder="Type your message..."]');
    await textareaInForm.waitFor({ state: "visible", timeout: 10000 });

    await textareaInForm.fill(message);
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

    // Wait for loading to complete - either conversations appear or "No conversations yet" message
    // Wait for "Loading..." text to disappear (if present)
    const loadingLocator = this.page.locator("text=Loading...");
    try {
      await loadingLocator.waitFor({ state: "hidden", timeout: 15000 });
    } catch {
      // Loading might not be present or already gone, continue
    }

    // Wait for either conversations or the empty state message to appear
    await this.page.waitForSelector(
      'div.border-2.border-neutral-300.rounded-xl.p-4.bg-white.cursor-pointer, p:has-text("No conversations yet")',
      { timeout: 15000 }
    );

    // Count conversation items by looking for the conversation card structure
    // Conversations are rendered as divs with specific styling classes (p-4, not p-6)
    // Note: The selector matches conversation cards within the conversations section
    const conversations = this.page
      .locator('[id="accordion-content-conversations"]')
      .locator(
        "div.border-2.border-neutral-300.rounded-xl.p-4.bg-white.cursor-pointer"
      );

    return await conversations.count();
  }

  /**
   * Verify that the latest conversation contains the expected user message
   * Returns true if the conversation contains the message, false otherwise
   */
  async verifyLatestConversationContainsMessage(
    expectedMessage: string
  ): Promise<boolean> {
    await this.expandConversationsSection();

    // Wait for conversations to load
    const loadingLocator = this.page.locator("text=Loading...");
    try {
      await loadingLocator.waitFor({ state: "hidden", timeout: 15000 });
    } catch {
      // Loading might not be present or already gone, continue
    }

    // Get the first conversation (most recent)
    const conversations = this.page
      .locator('[id="accordion-content-conversations"]')
      .locator(
        "div.border-2.border-neutral-300.rounded-xl.p-4.bg-white.cursor-pointer"
      )
      .first();

    const conversationCount = await conversations.count();
    if (conversationCount === 0) {
      return false;
    }

    // Get the text content of the first conversation
    const conversationText = await conversations.textContent();
    if (!conversationText) {
      return false;
    }

    // Check if the expected message is in the conversation text
    // The conversation card might show a preview or summary
    return conversationText.includes(expectedMessage);
  }

  /**
   * Expand Memory section
   */
  async expandMemorySection(): Promise<void> {
    await this.expandAccordion("MEMORY RECORDS");
  }

  /**
   * Verify memory records section is accessible
   * Note: Memory records might be empty, but the UI should be accessible
   */
  async verifyMemoryRecordsAccessible(): Promise<boolean> {
    await this.expandMemorySection();

    // Wait for memory records section to load
    // Check for either memory records or empty state message
    try {
      // Wait for the temporal grain selector to appear (indicates UI is loaded)
      await this.page.waitForSelector(
        'select:has(option:has-text("Working Memory"))',
        { timeout: 10000, state: "visible" }
      );

      // Wait for loading to complete
      const loadingText = this.page.locator("text=Loading memory records...");
      try {
        await loadingText.waitFor({ state: "hidden", timeout: 15000 });
      } catch {
        // Loading might not be present or already gone, continue
      }

      // Check if we have memory records or empty state
      // Memory records are rendered as divs with border-2 border-neutral-300 classes
      const hasRecords = await this.page
        .locator("div.border-2.border-neutral-300.rounded-xl.p-4.bg-white")
        .filter({ hasText: /./ }) // Has some content
        .count()
        .then((count) => count > 0)
        .catch(() => false);

      const hasEmptyState = await this.page
        .locator("text=/No memory records found|No records found/i")
        .isVisible()
        .catch(() => false);

      // Section is accessible if either records exist or empty state is shown
      // Or if the "Memory Records" heading is visible (indicates UI loaded)
      const hasHeading = await this.page
        .locator('h3:has-text("Memory Records")')
        .isVisible()
        .catch(() => false);

      return hasRecords || hasEmptyState || hasHeading;
    } catch {
      return false;
    }
  }

  /**
   * Get memory records count
   */
  async getMemoryRecordsCount(): Promise<number> {
    await this.expandMemorySection();

    // Wait for memory records section to load
    await this.page.waitForSelector(
      'select:has(option:has-text("Working Memory"))',
      { timeout: 10000, state: "visible" }
    );

    // Wait for loading to complete
    const loadingText = this.page.locator("text=Loading memory records...");
    try {
      await loadingText.waitFor({ state: "hidden", timeout: 15000 });
    } catch {
      // Loading might not be present or already gone, continue
    }

    // Count memory records
    // Memory records are rendered as divs with specific classes
    const memoryRecords = this.page
      .locator("div.border-2.border-neutral-300.rounded-xl.p-4.bg-white")
      .filter({ hasText: /./ }); // Has some content (not empty)

    return await memoryRecords.count();
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

  /**
   * Expand Stream Server section
   */
  async expandStreamServerSection(): Promise<void> {
    await this.expandAccordion("STREAM SERVER");
  }

  /**
   * Create a stream server with the given allowed origins
   */
  async createStreamServer(allowedOrigins: string): Promise<void> {
    await this.expandStreamServerSection();

    // Wait for accordion content to be visible
    const accordionContent = this.page.locator(
      '[id="accordion-content-stream-server"]'
    );
    await accordionContent.waitFor({ state: "visible", timeout: 10000 });

    // Check if stream server already exists
    const createButton = this.page.locator(
      'button:has-text("Create Stream Server")'
    );
    const testButton = this.page.locator('button:has-text("Test")');

    // If create button exists, we need to create the stream server
    if (await createButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Click "Create Stream Server" button
      await this.clickElement(createButton);

      // Wait for the form to appear - look for form with label "Allowed Origins"
      const form = this.page
        .locator('form')
        .filter({ has: this.page.locator('label:has-text("Allowed Origins")') })
        .first();
      await form.waitFor({ state: "visible", timeout: 10000 });

      // Fill in allowed origins - find input within the form
      const originsInput = form.locator('input[type="text"]').first();
      await originsInput.waitFor({ state: "visible", timeout: 5000 });
      await originsInput.fill(allowedOrigins);

      // Submit the form
      const submitButton = form.locator(
        'button[type="submit"]:has-text("Create")'
      );
      await this.clickElement(submitButton);

      // Wait for stream server to be created (Test button should appear)
      await testButton.waitFor({ state: "visible", timeout: 15000 });
    } else {
      // Stream server already exists, verify it's visible
      await testButton.waitFor({ state: "visible", timeout: 5000 });
    }
  }

  /**
   * Open the test streaming server dialog
   * Returns true if dialog opened successfully, false if stream URL is not available
   */
  async openTestStreamServerDialog(): Promise<boolean> {
    await this.expandStreamServerSection();

    // Wait for accordion content to be visible
    const accordionContent = this.page.locator(
      '[id="accordion-content-stream-server"]'
    );
    await accordionContent.waitFor({ state: "visible", timeout: 10000 });

    // Check if the Test button is enabled (requires stream URL)
    const testButton = this.page
      .locator('button:has-text("Test")')
      .first();
    
    const isEnabled = await testButton.isEnabled().catch(() => false);
    if (!isEnabled) {
      // Stream URL is not available, dialog won't open
      return false;
    }

    // Click the "Test" button
    await this.clickElement(testButton);

    // Wait for the dialog to open (modal with "Test Stream Server" heading)
    // The dialog only renders if streamUrlData?.url exists
    try {
      const dialog = this.page.locator('h2:has-text("Test Stream Server")');
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      return true;
    } catch {
      // Dialog didn't appear - likely stream URL is not available
      return false;
    }
  }

  /**
   * Send a message in the test streaming dialog
   */
  async sendMessageInStreamDialog(message: string): Promise<void> {
    // The dialog contains an AgentChat component
    // Wait for the dialog to be visible
    const dialog = this.page.locator('h2:has-text("Test Stream Server")');
    await dialog.waitFor({ state: "visible", timeout: 10000 });

    // Find the AgentChat form within the dialog
    const dialogContent = dialog.locator("..").locator("..");
    const chatForm = dialogContent.locator('form:has(textarea)');
    await chatForm.waitFor({ state: "visible", timeout: 10000 });

    // Find the textarea within the dialog
    const textarea = chatForm.locator(
      'textarea[placeholder="Type your message..."]'
    );
    await textarea.waitFor({ state: "visible", timeout: 10000 });

    // Fill and submit
    await textarea.fill(message);
    const submitButton = chatForm.locator('button[type="submit"]:has-text("Send")');
    await this.clickElement(submitButton);
  }

  /**
   * Wait for agent response in the test streaming dialog
   */
  async waitForAgentResponseInStreamDialog(
    timeoutMs: number = 30000
  ): Promise<string> {
    // The dialog contains an AgentChat component
    // Wait for response to appear within the dialog
    const dialog = this.page.locator('h2:has-text("Test Stream Server")');
    await dialog.waitFor({ state: "visible", timeout: 10000 });

    const dialogContent = dialog.locator("..").locator("..");
    const responseLocator = dialogContent
      .locator('[role="assistant"]')
      .or(dialogContent.locator('div:has-text("assistant")'))
      .last();

    await this.waitForElement(responseLocator, timeoutMs);
    return await this.getElementText(responseLocator);
  }

  /**
   * Close the test streaming server dialog
   */
  async closeTestStreamServerDialog(): Promise<void> {
    // Find the Close button in the dialog
    const dialog = this.page.locator('h2:has-text("Test Stream Server")');
    await dialog.waitFor({ state: "visible", timeout: 10000 });

    const dialogHeader = dialog.locator("..");
    const closeButton = dialogHeader.locator('button:has-text("Close")');
    await this.clickElement(closeButton);

    // Wait for dialog to close
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
  }
}
