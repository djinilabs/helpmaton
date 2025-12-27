import { Page, Locator } from "@playwright/test";

import { BasePage } from "./base-page";

export class HomePage extends BasePage {
  // Locators
  private usageDashboard: Locator;
  private usageTitle: Locator;

  constructor(page: Page) {
    super(page);

    // Usage dashboard locators
    this.usageDashboard = page.locator('h2:has-text("YOUR USAGE")');
    this.usageTitle = page.locator('h2:has-text("YOUR USAGE")');
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
    await this.page.waitForSelector('h1:has-text("Dashboard")', {
      timeout: 15000,
    });
  }

  /**
   * Expand usage section (if needed)
   * Note: Usage dashboard is always visible on the home page
   */
  async waitForUsageDashboard(): Promise<void> {
    // Wait for the usage dashboard title to appear
    await this.page.waitForSelector('h2:has-text("YOUR USAGE")', {
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

    try {
      // Look for token statistics in the usage stats component
      // The UsageStats component displays tokens and cost
      const tokenElements = this.page.locator("text=/tokens/i");
      const tokenCount = await tokenElements.count();

      if (tokenCount > 0) {
        // Try to extract total tokens
        const totalTokensText = await this.page
          .locator("text=/total.*tokens/i")
          .first()
          .textContent()
          .catch(() => null);

        if (totalTokensText) {
          const match = totalTokensText.match(/[\d,]+/);
          if (match) {
            stats.totalTokens = parseInt(match[0].replace(/,/g, ""), 10);
          }
        }
      }
    } catch {
      // Token stat not found
    }

    try {
      // Look for cost information
      const costText = await this.page
        .locator("text=/USD|\\$|cost/i")
        .first()
        .textContent()
        .catch(() => null);

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
    const heading = this.page.locator('h1:has-text("Dashboard")');
    return await this.getElementText(heading);
  }
}




