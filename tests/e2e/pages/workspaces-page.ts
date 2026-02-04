import { Page, Locator } from "@playwright/test";

import { BasePage } from "./base-page";

export class WorkspacesPage extends BasePage {
  // Locators
  private createWorkspaceButton: Locator;
  private createWorkspaceModal: Locator;
  private workspaceNameInput: Locator;
  private workspaceDescriptionInput: Locator;
  private createButton: Locator;
  private cancelButton: Locator;

  constructor(page: Page) {
    super(page);

    // Main page locators
    this.createWorkspaceButton = page
      .locator('button:has-text("Create a workspace")')
      .first();

    // Modal locators: form modal is the one with name/description inputs (after choice step)
    this.createWorkspaceModal = page
      .locator("div.fixed.inset-0")
      .filter({ has: page.locator("input#name") });
    this.workspaceNameInput = page.locator("input#name");
    this.workspaceDescriptionInput = page.locator("textarea#description");
    this.createButton = page.locator(
      'button[type="submit"]:has-text("Create workspace")'
    );
    this.cancelButton = page.locator(
      'button[type="button"]:has-text("Cancel")'
    );
  }

  /**
   * Navigate to workspaces page
   */
  async goto(): Promise<void> {
    await this.page.goto("/workspaces");
    await this.waitForPageLoad();
  }

  /**
   * Wait for workspaces page to load
   */
  async waitForWorkspacesPage(): Promise<void> {
    // Wait for the page to load and the main heading to appear
    await this.page.waitForLoadState("domcontentloaded");
    // Use a more flexible selector that works with the page structure
    await this.page.waitForSelector("h1", { timeout: 15000 });
    // Verify we're on the workspaces page by checking the heading text
    const heading = await this.page.locator("h1").first().textContent();
    if (!heading?.toLowerCase().includes("workspaces")) {
      throw new Error(
        `Expected to be on Workspaces page, but found heading: "${heading}"`
      );
    }
  }

  /**
   * Open the create workspace modal.
   * If the choice modal appears (Guided setup / Name and description only), clicks "Name and description only" to open the form.
   */
  async openCreateWorkspaceModal(): Promise<void> {
    await this.clickElement(this.createWorkspaceButton);
    // Choice modal may appear first: "Create a workspace" with "Name and description only" and "Guided setup"
    const choiceOption = this.page.locator(
      'button:has-text("Name and description only")'
    );
    const choiceVisible = await choiceOption.isVisible().catch(() => false);
    if (choiceVisible) {
      await this.clickElement(choiceOption);
    }
    await this.waitForElement(this.createWorkspaceModal);
  }

  /**
   * Fill in the workspace form
   */
  async fillWorkspaceForm(name: string, description?: string): Promise<void> {
    await this.fillInput(this.workspaceNameInput, name);
    if (description) {
      await this.fillInput(this.workspaceDescriptionInput, description);
    }
  }

  /**
   * Submit the create workspace form
   */
  async submitCreateWorkspace(): Promise<void> {
    await this.clickElement(this.createButton);
    // Wait for modal to close
    await this.createWorkspaceModal.waitFor({
      state: "detached",
      timeout: 10000,
    });
  }

  /**
   * Create a new workspace (complete flow)
   * @returns Object with workspace id and name
   */
  async createWorkspace(
    name: string,
    description?: string
  ): Promise<{ id: string; name: string }> {
    await this.openCreateWorkspaceModal();
    await this.fillWorkspaceForm(name, description);
    await this.submitCreateWorkspace();

    // Wait for navigation to workspace detail page
    await this.page.waitForURL(/\/workspaces\/[^/]+$/, { timeout: 10000 });

    // Extract workspace ID from URL
    const url = this.page.url();
    const match = url.match(/\/workspaces\/([^/]+)$/);
    if (!match) {
      throw new Error("Failed to extract workspace ID from URL");
    }

    return {
      id: match[1],
      name,
    };
  }

  /**
   * Click on a workspace card to navigate to its detail page
   */
  async navigateToWorkspace(workspaceName: string): Promise<void> {
    const workspaceCard = this.page.locator(
      `div:has(h2:text("${workspaceName}"))`
    );
    await this.clickElement(workspaceCard);
    await this.page.waitForURL(/\/workspaces\/[^/]+$/, { timeout: 10000 });
  }

  /**
   * Get list of workspace names
   */
  async getWorkspaceNames(): Promise<string[]> {
    const workspaceHeadings = this.page.locator(
      "h2.text-3xl.font-bold.text-neutral-900"
    );
    return await workspaceHeadings.allTextContents();
  }

  /**
   * Verify workspace appears in the list
   */
  async verifyWorkspaceExists(workspaceName: string): Promise<boolean> {
    const workspaceCard = this.page.locator(`h2:has-text("${workspaceName}")`);
    return await this.isElementVisible(workspaceCard);
  }
}

