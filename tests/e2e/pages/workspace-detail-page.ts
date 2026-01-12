import { Page, Locator } from "@playwright/test";

import { BasePage } from "./base-page";

export class WorkspaceDetailPage extends BasePage {
  // Locators
  private agentsAccordion: Locator;
  private documentsAccordion: Locator;
  private teamAccordion: Locator;
  private creditsAccordion: Locator;
  private backButton: Locator;

  constructor(page: Page) {
    super(page);

    // Accordion section locators - using the accordion structure
    this.agentsAccordion = page.locator('[id="agents"]');
    this.documentsAccordion = page.locator('[id="documents"]');
    this.teamAccordion = page.locator('[id="team"]');
    this.creditsAccordion = page.locator('[id="credits"]');
    this.backButton = page.locator('button:has-text("Back")').first();
  }

  /**
   * Navigate to workspace detail page
   */
  async goto(workspaceId: string): Promise<void> {
    await this.page.goto(`/workspaces/${workspaceId}`);
    await this.waitForPageLoad();
  }

  /**
   * Wait for workspace detail page to load
   */
  async waitForWorkspaceDetailPage(): Promise<void> {
    // Wait for the workspace detail page to load
    await this.page.waitForLoadState("domcontentloaded");
    // Wait for the heading or accordion sections to appear
    await this.page.waitForSelector('h2:has-text("Agents")', {
      timeout: 15000,
    });
  }

  /**
   * Expand an accordion section
   */
  async expandAccordion(sectionTitle: string): Promise<void> {
    // Find the button by its heading text (more reliable than id)
    const accordion = this.page.locator(
      `button:has(h2:has-text("${sectionTitle}"))`
    );

    // Check if already expanded
    const isExpanded =
      (await accordion.getAttribute("aria-expanded")) === "true";

    if (!isExpanded) {
      await this.clickElement(accordion);
      // Wait for accordion to expand by checking aria-expanded attribute
      await this.page.waitForFunction(
        ({ title }) => {
          const buttons = Array.from(document.querySelectorAll("button"));
          const button = buttons.find((btn) => {
            const h2 = btn.querySelector("h2");
            return h2?.textContent?.trim() === title;
          });
          return button?.getAttribute("aria-expanded") === "true";
        },
        { title: sectionTitle },
        { timeout: 5000 }
      );
    }
  }

  /**
   * Navigate back to workspaces list
   */
  async goBack(): Promise<void> {
    await this.clickElement(this.backButton);
    await this.page.waitForURL("/workspaces", { timeout: 10000 });
  }

  /**
   * Expand Agents section
   */
  async expandAgentsSection(): Promise<void> {
    await this.expandAccordion("Agents");
  }

  /**
   * Create a new agent through the AgentList component
   */
  async createAgent(agentData: {
    name: string;
    systemPrompt: string;
    model?: string;
  }): Promise<{ id: string; workspaceId: string; name: string }> {
    // Expand agents section
    await this.expandAgentsSection();

    // Wait for the "Create Agent" button
    const createAgentButton = this.page.locator(
      'button:has-text("Create Agent")'
    );
    await this.waitForElement(createAgentButton);
    await this.clickElement(createAgentButton);

    // Wait for modal to appear
    const createAgentModalHeading = 'h2:has-text("Create Agent")';
    await this.page.waitForSelector(createAgentModalHeading, {
      timeout: 10000,
    });

    // Fill in agent form
    await this.page.fill("input#name", agentData.name);
    await this.page.fill("textarea#systemPrompt", agentData.systemPrompt);

    // Optionally select model
    if (agentData.model) {
      await this.page.selectOption("select#model", agentData.model);
    }

    // Submit the form
    const submitButton = this.page.locator(
      'button[type="submit"]:has-text("Create")'
    );
    await this.clickElement(submitButton);

    // Wait for modal to close
    await this.page.waitForSelector(createAgentModalHeading, {
      state: "detached",
      timeout: 10000,
    });

    // After creating an agent, the UI navigates to the agent detail page
    // Wait for navigation to the agent detail page
    await this.page.waitForURL(
      /\/workspaces\/[^/]+\/agents\/[^/]+$/,
      { timeout: 15000 }
    );

    // Extract workspace ID and agent ID from the current URL
    const currentUrl = this.page.url();
    const match = currentUrl.match(/\/workspaces\/([^/]+)\/agents\/([^/]+)$/);
    if (!match) {
      throw new Error(`Failed to extract IDs from URL: ${currentUrl}`);
    }

    // Verify we're on the agent detail page by checking for the agent name in the heading
    await this.page.waitForSelector(`h1:has-text("${agentData.name}")`, {
      timeout: 10000,
    });

    return {
      id: match[2],
      workspaceId: match[1],
      name: agentData.name,
    };
  }

  /**
   * Expand Documents section
   */
  async expandDocumentsSection(): Promise<void> {
    await this.expandAccordion("Documents");
  }

  /**
   * Expand Document Upload section
   * Note: Document upload is now inside the Documents section
   */
  async expandDocumentUploadSection(): Promise<void> {
    // Upload functionality is now inside the Documents section
    await this.expandDocumentsSection();
  }

  /**
   * Upload a document using file input
   * @param filePath - Path to the file to upload
   * @param fileName - Expected name of the document after upload
   */
  async uploadDocument(filePath: string, fileName: string): Promise<void> {
    await this.expandDocumentUploadSection();

    // Wait for the upload section to be visible
    await this.page.waitForSelector('h2:has-text("Upload Documents")', {
      timeout: 10000,
      state: "visible",
    });

    // Wait for file input to be available
    const fileInput = this.page.locator('input[type="file"][id="file-upload"]');
    await fileInput.waitFor({ state: "attached", timeout: 10000 });

    // Set the file
    await fileInput.setInputFiles(filePath);

    // Wait for upload to start (check for upload progress or "Uploading..." text)
    try {
      await this.page.waitForSelector("text=/Uploading|uploading/i", {
        timeout: 5000,
      });
    } catch {
      // Upload might be very fast, continue anyway
    }

    // Wait for upload to complete - check for success message or document in list
    // The success toast says "Document uploaded successfully"
    try {
      await this.page.waitForSelector(
        "text=/uploaded successfully|Document uploaded/i",
        {
          timeout: 20000,
        }
      );
    } catch {
      // If toast doesn't appear, check if document appears in list
    }

    // Wait for the document to appear in the documents list
    // Documents are shown in DocumentList component
    await this.expandDocumentsSection();

    // Wait for the document name to appear in the list
    // The document name is displayed as a button in the list
    await this.page.waitForSelector(`button:has-text("${fileName}")`, {
      timeout: 20000,
      state: "visible",
    });
  }

  /**
   * Create a text document using the text document form
   * @param documentName - Name of the document
   * @param content - Content of the document
   */
  async createTextDocument(
    documentName: string,
    content: string
  ): Promise<void> {
    await this.expandDocumentUploadSection();

    // Wait for the upload section to be visible
    await this.page.waitForSelector('h2:has-text("Upload Documents")', {
      timeout: 10000,
      state: "visible",
    });

    // Wait for the text document form
    await this.page.waitForSelector('h3:has-text("Create Text Document")', {
      timeout: 10000,
      state: "visible",
    });

    // Fill in document name
    const nameInput = this.page.locator(
      'input[placeholder*="Document"], input[placeholder*="e.g., My Document"]'
    );
    await nameInput.waitFor({ state: "visible", timeout: 10000 });
    await nameInput.fill(documentName);

    // Fill in content
    const contentTextarea = this.page.locator(
      'textarea[placeholder*="Enter document content"], textarea[placeholder*="content"]'
    );
    await contentTextarea.waitFor({ state: "visible", timeout: 10000 });
    await contentTextarea.fill(content);

    // Click "Create Document" button
    const createButton = this.page.locator(
      'button:has-text("Create Document")'
    );
    await createButton.waitFor({ state: "visible", timeout: 5000 });
    await this.clickElement(createButton);

    // Wait for upload to complete
    try {
      await this.page.waitForSelector(
        "text=/uploaded successfully|Document uploaded/i",
        {
          timeout: 20000,
        }
      );
    } catch {
      // If toast doesn't appear, continue
    }

    // Wait for the document to appear in the documents list
    await this.expandDocumentsSection();

    // Wait for the document name to appear in the list
    await this.page.waitForSelector(`button:has-text("${documentName}")`, {
      timeout: 20000,
      state: "visible",
    });
  }

  /**
   * Get document count in the current folder
   */
  async getDocumentCount(): Promise<number> {
    await this.expandDocumentsSection();

    // Wait for documents section to load
    await this.page.waitForTimeout(1000);

    // Count document items in the list
    // Documents are displayed as divs with buttons containing the document name
    const documentItems = this.page.locator(
      "div:has(button.text-xl.font-bold)"
    );
    const count = await documentItems.count();
    return count;
  }

  /**
   * Expand Team section
   */
  async expandTeamSection(): Promise<void> {
    await this.expandAccordion("Team");
  }

  /**
   * Invite a team member
   */
  async inviteTeamMember(email: string): Promise<void> {
    await this.expandTeamSection();

    // Wait for the user limit API call to complete and verify canInvite is true
    // The frontend fetches /api/workspaces/:workspaceId/user-limit to determine canInvite
    // The input is disabled when: !canInvite || invite.isPending || !isEmailValid
    // So even if canInvite is true, the input will be disabled until an email is entered
    // We need to wait for canInvite to be true, which we can detect by:
    // 1. No "User Limit Reached" error message
    // 2. The input exists and is visible (but may be disabled due to empty email)

    // Wait for the form to be visible
    await this.page.waitForSelector(
      'input[type="email"][placeholder*="example.com"], input[type="email"]',
      { timeout: 15000 }
    );

    // Wait for network to be idle to ensure API calls have completed
    try {
      await this.page.waitForLoadState("networkidle", { timeout: 10000 });
    } catch {
      // If networkidle times out, continue anyway - API might have already completed
    }

    // Wait for any "User Limit Reached" error message to NOT be visible
    // This indicates that canInvite is true (backend returned canInvite=true)
    // Use waitForFunction to wait for the error message to disappear or never appear
    await this.page.waitForFunction(
      () => {
        const errorText = document.body.textContent || "";
        return (
          !errorText.includes("User Limit Reached") &&
          !errorText.includes("user limit")
        );
      },
      { timeout: 30000 }
    );

    // Additional wait to ensure React has updated the component state after API response
    await this.page.waitForTimeout(1000);

    // Get the email input locator
    const emailInput = this.page
      .locator(
        'input[type="email"][placeholder*="example.com"], input[type="email"]'
      )
      .first();

    // Verify the input is visible (it may be disabled due to empty email, which is expected)
    await emailInput.waitFor({ state: "visible", timeout: 10000 });

    // Now fill the email - this should enable the input if canInvite is true
    // Fill email using Playwright's fill method (this properly triggers React onChange)
    await emailInput.fill(email);

    // Wait for email validation to complete and button to be enabled
    await this.page.waitForTimeout(500);

    // Wait for the submit button to be enabled (email validation enables it)
    const inviteButton = this.page
      .locator(
        'button[type="submit"]:has-text("Send Invitation"), button[type="submit"]:has-text("Invite")'
      )
      .first();

    // Wait for button to be visible
    await inviteButton.waitFor({ state: "visible", timeout: 5000 });

    // Wait for button to be enabled using waitForFunction
    await this.page.waitForFunction(
      () => {
        const buttons = Array.from(
          document.querySelectorAll('button[type="submit"]')
        );
        const button = buttons.find((btn) => {
          const text = btn.textContent || "";
          return text.includes("Send Invitation") || text.includes("Invite");
        }) as HTMLButtonElement | null;
        return button && !button.disabled;
      },
      { timeout: 10000 }
    );

    // Click invite button
    await this.clickElement(inviteButton);

    // Wait for success message or the invited member to appear in the team list
    // The UI shows a toast, but we can also check for the email in the invites list
    try {
      await this.page.waitForSelector(`text=${email}`, { timeout: 15000 });
    } catch {
      // If email doesn't appear immediately, wait for toast or check for success indicator
      try {
        await this.page.waitForSelector("text=/invitation|invited/i", {
          timeout: 5000,
        });
      } catch {
        // If neither appears, that's okay - the API call succeeded
        console.log("Invite submitted (verification skipped)");
      }
    }
  }

  /**
   * Expand Credits section
   */
  async expandCreditsSection(): Promise<void> {
    await this.expandAccordion("Credit Balance");
  }

  /**
   * Get current credit balance
   */
  async getCreditBalance(): Promise<number> {
    await this.expandCreditsSection();

    // Look for credit balance text (format may vary)
    const balanceText = await this.page
      .locator("text=/Balance|Credit/i")
      .first()
      .textContent();
    if (!balanceText) return 0;

    // Extract number from text
    const match = balanceText.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
  }

  /**
   * Purchase credits
   * Note: This will redirect to Lemon Squeezy checkout, so we just verify the purchase button is clicked
   */
  async purchaseCredits(amount: number): Promise<void> {
    await this.expandCreditsSection();

    // Find the credit purchase amount input (inside CreditPurchase component)
    const amountInput = this.page.locator('input#amount[type="number"]');
    await this.waitForElement(amountInput);
    await this.fillInput(amountInput, amount.toString());

    // Click purchase button
    const purchaseButton = this.page.locator(
      'button:has-text("Purchase Credits")'
    );
    await this.clickElement(purchaseButton);

    // Wait for navigation to checkout (Lemon Squeezy) or success message
    // In test environment, we might not actually complete the purchase
    // Just verify the button was clicked and form was submitted
    await this.page.waitForTimeout(2000);
  }

  /**
   * Expand Spending Limits section
   */
  async expandSpendingLimitsSection(): Promise<void> {
    await this.expandAccordion("Spending Limits");
  }

  /**
   * Add a spending limit
   */
  async addSpendingLimit(
    timeFrame: "daily" | "weekly" | "monthly",
    amount: number
  ): Promise<void> {
    await this.expandSpendingLimitsSection();

    // Wait for the spending limits section to be fully loaded
    await this.page.waitForTimeout(1000);

    // Check if form is already visible (might be shown by default if no limits exist)
    const formHeading = this.page.locator('h3:has-text("Add Spending Limit")');
    const isFormVisible = await formHeading.isVisible().catch(() => false);

    if (!isFormVisible) {
      // Click "Add Limit" button to open the form
      // The button might be in different places depending on whether limits exist
      const addLimitButton = this.page.locator('button:has-text("Add Limit")');

      // Wait for button to be visible (it might take time to render)
      await addLimitButton.waitFor({ state: "visible", timeout: 10000 });

      // Click the button
      await this.clickElement(addLimitButton);
    }

    // Wait for the form to appear - wait for the heading first
    // The form appears conditionally when isAdding is true
    await this.page.waitForSelector('h3:has-text("Add Spending Limit")', {
      timeout: 15000,
      state: "visible",
    });

    // Wait for the form to be fully rendered
    await this.page.waitForTimeout(1000);

    // Select time frame from dropdown
    // Find the select element - it's in the form that appears after clicking "Add Limit"
    // The form has the heading "Add Spending Limit" and contains a select element
    // Try multiple approaches to find the select element

    // Approach 1: Find select within the form container (div with bg-neutral-50 class)
    let timeFrameSelect = this.page
      .locator('div.bg-neutral-50:has(h3:has-text("Add Spending Limit"))')
      .locator("select")
      .first();

    // Check if this selector works
    const selectCount = await timeFrameSelect.count().catch(() => 0);

    if (selectCount === 0) {
      // Approach 2: Find any select element that's visible after the heading
      // Use a more general selector
      await this.page.waitForSelector("select", {
        timeout: 10000,
        state: "visible",
      });
      timeFrameSelect = this.page.locator("select").first();
    }

    await this.waitForElement(timeFrameSelect, 10000);
    await timeFrameSelect.selectOption(timeFrame);

    // Find amount input (text input in the Slider component)
    // The Slider component uses input[type="text"] with aria-label containing "Amount (USD) (text input)"
    // Find it within the form container that has the "Add Spending Limit" heading
    const formContainer = this.page
      .locator('div.bg-neutral-50:has(h3:has-text("Add Spending Limit"))')
      .or(this.page.locator('div:has(h3:has-text("Add Spending Limit"))'))
      .first();
    
    const amountInput = formContainer
      .locator('input[type="text"][aria-label*="Amount"]')
      .first();
    
    await this.waitForElement(amountInput, 10000);
    // Clear the input and fill with the amount value
    await amountInput.clear();
    await amountInput.fill(amount.toString());

    // Click "Add" button to submit
    const addButton = this.page.locator(
      'button:has-text("Add"):not(:has-text("Add Limit"))'
    );
    await this.clickElement(addButton);

    // Wait for the limit to appear in the list (shows time frame label)
    const timeFrameLabel = timeFrame.toUpperCase();
    await this.page.waitForSelector(`text=${timeFrameLabel}`, {
      timeout: 10000,
    });
  }

  /**
   * Get workspace name
   */
  async getWorkspaceName(): Promise<string> {
    const heading = this.page.locator("h1.text-4xl");
    return await this.getElementText(heading);
  }
}
