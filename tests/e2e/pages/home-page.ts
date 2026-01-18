import { Page, Locator } from "@playwright/test";

import { BasePage } from "./base-page";

export class HomePage extends BasePage {
  // Locators
  private usageDashboard: Locator;
  private usageTitle: Locator;

  constructor(page: Page) {
    super(page);

    // Usage dashboard locators
    this.usageDashboard = page.locator('h2:has-text("Your usage")');
    this.usageTitle = page.locator('h2:has-text("Your usage")');
  }

  /**
   * Navigate to home page
   */
  async goto(): Promise<void> {
    await this.page.goto("/");
    await this.waitForPageLoad();
  }

  /**
   * Wait for home page to load
   */
  async waitForHomePage(): Promise<void> {
    // Wait for the dashboard heading
    await this.page.waitForSelector('h1:has-text("Your dashboard")', {
      timeout: 15000,
    });
  }

  /**
   * Expand usage section (if needed)
   * Note: Usage dashboard is always visible on the home page
   */
  async waitForUsageDashboard(): Promise<void> {
    // Wait for the usage dashboard title to appear
    await this.page.waitForSelector('h2:has-text("Your usage")', {
      timeout: 15000,
      state: "visible",
    });

    // Wait for loading to complete
    // Check if "Loading usage data..." text disappears
    const loadingText = this.page.locator("text=Loading usage data...");
    try {
      await loadingText.waitFor({ state: "hidden", timeout: 20000 });
    } catch {
      // Loading might not be present or already gone, continue
    }
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(): Promise<{
    totalTokens?: number;
    totalCost?: number;
    inputTokens?: number;
    outputTokens?: number;
  }> {
    await this.waitForUsageDashboard();

    const stats: {
      totalTokens?: number;
      totalCost?: number;
      inputTokens?: number;
      outputTokens?: number;
    } = {};

    // Helper function to extract a stat value by label
    const extractStatValue = async (
      labelText: string,
      isNumber: boolean = true
    ): Promise<number | undefined> => {
      try {
        // Find the container that has the label text
        // The structure is: container div > label div (with text) > value div (with text-3xl)
        const container = this.page
          .locator(`.rounded-xl:has-text("${labelText}")`)
          .first();

        if (await container.isVisible({ timeout: 5000 })) {
          // Find the value div within this container (the one with text-3xl class)
          const valueDiv = container.locator(".text-3xl").first();
          const valueText = await valueDiv.textContent().catch(() => null);

          if (valueText) {
            // Remove commas, currency symbols, and whitespace
            const cleaned = valueText.replace(/[$,\s]/g, "").trim();
            const parsed = isNumber
              ? parseInt(cleaned, 10)
              : parseFloat(cleaned);
            if (!isNaN(parsed)) {
              return parsed;
            }
          }
        }
      } catch {
        // Stat not found
      }
      return undefined;
    };

    // Extract each stat value
    stats.inputTokens = await extractStatValue("Input Tokens", true);
    stats.outputTokens = await extractStatValue("Output Tokens", true);
    stats.totalTokens = await extractStatValue("Total Tokens", true);
    stats.totalCost = await extractStatValue("Total Cost", false);

    return stats;
  }

  /**
   * Verify usage dashboard is visible
   */
  async verifyUsageDashboardVisible(): Promise<boolean> {
    try {
      await this.waitForUsageDashboard();
      return await this.usageTitle.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Get dashboard heading text
   */
  async getDashboardHeading(): Promise<string> {
    const heading = this.page.locator('h1:has-text("Your dashboard")');
    return await this.getElementText(heading);
  }
}
