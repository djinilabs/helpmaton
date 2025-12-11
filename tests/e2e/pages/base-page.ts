import { Page, Locator } from "@playwright/test";

export class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Wait for page to load
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState("domcontentloaded");
    await this.page.waitForLoadState("load");
  }

  /**
   * Check if an element is visible
   */
  async isElementVisible(locator: Locator): Promise<boolean> {
    try {
      return await locator.isVisible({ timeout: 5000 });
    } catch {
      return false;
    }
  }

  /**
   * Wait for an element to be visible
   */
  async waitForElement(locator: Locator, timeout: number = 10000): Promise<void> {
    await locator.waitFor({ state: "visible", timeout });
  }

  /**
   * Click an element
   */
  async clickElement(locator: Locator): Promise<void> {
    await locator.waitFor({ state: "visible" });
    await locator.click();
  }

  /**
   * Fill an input field
   */
  async fillInput(locator: Locator, value: string): Promise<void> {
    await locator.waitFor({ state: "visible" });
    await locator.fill(value);
  }

  /**
   * Get element text
   */
  async getElementText(locator: Locator): Promise<string> {
    await locator.waitFor({ state: "visible" });
    return await locator.textContent() || "";
  }
}

