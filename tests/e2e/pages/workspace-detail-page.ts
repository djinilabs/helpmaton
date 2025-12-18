import { Page, Locator } from "@playwright/test";

import { BasePage } from "./base-page";

export class WorkspaceDetailPage extends BasePage {
  // Locators
  private agentsAccordion: Locator;
  private documentsAccordion: Locator;
  private documentsUploadAccordion: Locator;
  private teamAccordion: Locator;
  private creditsAccordion: Locator;
  private backButton: Locator;

  constructor(page: Page) {
    super(page);

    // Accordion section locators - using the accordion structure
    this.agentsAccordion = page.locator('[id="agents"]');
    this.documentsAccordion = page.locator('[id="documents"]');
    this.documentsUploadAccordion = page.locator('[id="documents-upload"]');
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
    // Wait for one of the accordion sections to appear
    await this.page.waitForSelector('[id="agents"]', { timeout: 10000 });
  }

  /**
   * Expand an accordion section
   */
  async expandAccordion(sectionId: string): Promise<void> {
    const accordion = this.page.locator(`[id="${sectionId}"]`);
    await this.clickElement(accordion);
    // Wait a bit for animation
    await this.page.waitForTimeout(500);
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
    await this.expandAccordion("agents");
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
    await this.page.waitForSelector('h2:has-text("Create Agent")', {
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

    // Wait for modal to close and navigation to agent detail page
    await this.page.waitForSelector('h2:has-text("Create Agent")', {
      state: "detached",
      timeout: 10000,
    });
    await this.page.waitForURL(/\/workspaces\/[^/]+\/agents\/[^/]+$/, {
      timeout: 10000,
    });

    // Extract workspace ID and agent ID from URL
    const url = this.page.url();
    const match = url.match(/\/workspaces\/([^/]+)\/agents\/([^/]+)$/);
    if (!match) {
      throw new Error("Failed to extract workspace ID and agent ID from URL");
    }

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
    await this.expandAccordion("documents");
  }

  /**
   * Expand Document Upload section
   */
  async expandDocumentUploadSection(): Promise<void> {
    await this.expandAccordion("documents-upload");
  }

  /**
   * Upload a document
   */
  async uploadDocument(filePath: string, fileName: string): Promise<void> {
    await this.expandDocumentUploadSection();

    // Wait for file input
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);

    // Wait for upload to complete
    await this.page.waitForSelector(`text=${fileName}`, { timeout: 15000 });
  }

  /**
   * Expand Team section
   */
  async expandTeamSection(): Promise<void> {
    await this.expandAccordion("team");
  }

  /**
   * Invite a team member
   */
  async inviteTeamMember(email: string): Promise<void> {
    await this.expandTeamSection();

    // Wait for invite input
    const emailInput = this.page.locator('input[type="email"]');
    await this.fillInput(emailInput, email);

    // Click invite button
    const inviteButton = this.page.locator('button:has-text("Invite")');
    await this.clickElement(inviteButton);

    // Wait for success message or invitation to appear
    await this.page.waitForTimeout(2000);
  }

  /**
   * Expand Credits section
   */
  async expandCreditsSection(): Promise<void> {
    await this.expandAccordion("credits");
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
   * Get workspace name
   */
  async getWorkspaceName(): Promise<string> {
    const heading = this.page.locator("h1.text-4xl");
    return await this.getElementText(heading);
  }
}
