import type { Page } from "puppeteer-core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-core is installed in container image

import { escapeXml, aomToXml, extractAOM } from "../aomUtils";
import * as puppeteerContentLoading from "../puppeteerContentLoading";

describe("aomUtils", () => {
  describe("escapeXml", () => {
    it("should escape ampersand", () => {
      expect(escapeXml("Test & Value")).toBe("Test &amp; Value");
    });

    it("should escape less than", () => {
      expect(escapeXml("Test < Value")).toBe("Test &lt; Value");
    });

    it("should escape greater than", () => {
      expect(escapeXml("Test > Value")).toBe("Test &gt; Value");
    });

    it("should escape double quotes", () => {
      expect(escapeXml('Test " Value')).toBe("Test &quot; Value");
    });

    it("should escape single quotes", () => {
      expect(escapeXml("Test ' Value")).toBe("Test &apos; Value");
    });

    it("should escape multiple special characters", () => {
      expect(escapeXml('Test & < > " \' Value')).toBe(
        "Test &amp; &lt; &gt; &quot; &apos; Value"
      );
    });

    it("should handle empty string", () => {
      expect(escapeXml("")).toBe("");
    });
  });

  describe("aomToXml", () => {
    it("should convert simple AOM tree to XML", () => {
      const aomTree: Record<string, unknown> = {
        role: "document",
        name: "Test Document",
        children: [
          {
            role: "heading",
            name: "Heading 1",
          },
        ],
      };

      const xml = aomToXml(aomTree);
      expect(xml).toContain("<document");
      expect(xml).toContain('name="Test Document"');
      expect(xml).toContain("<heading");
      expect(xml).toContain('name="Heading 1"');
    });

    it("should handle empty children", () => {
      const aomTree: Record<string, unknown> = {
        role: "button",
        name: "Click me",
      };

      const xml = aomToXml(aomTree);
      expect(xml).toContain("<button");
      expect(xml).toContain('name="Click me"');
      expect(xml).toContain("/>"); // Self-closing tag
    });

    it("should escape XML special characters in attributes", () => {
      const aomTree: Record<string, unknown> = {
        role: "text",
        name: 'Test & "Value"',
        value: "Content < > '",
      };

      const xml = aomToXml(aomTree);
      expect(xml).toContain('name="Test &amp; &quot;Value&quot;"');
      expect(xml).toContain('value="Content &lt; &gt; &apos;"');
    });

    it("should handle nested children", () => {
      const aomTree: Record<string, unknown> = {
        role: "document",
        children: [
          {
            role: "section",
            children: [
              {
                role: "paragraph",
                value: "Text content",
              },
            ],
          },
        ],
      };

      const xml = aomToXml(aomTree);
      expect(xml).toContain("<document>");
      expect(xml).toContain("<section>");
      expect(xml).toContain("<paragraph");
      expect(xml).toContain('value="Text content"');
    });

    it("should handle ARIA attributes", () => {
      const aomTree: Record<string, unknown> = {
        role: "checkbox",
        name: "Check me",
        checked: true,
        disabled: false,
        expanded: true,
        selected: false,
        readonly: true,
        required: false,
        invalid: false,
      };

      const xml = aomToXml(aomTree);
      expect(xml).toContain('checked="true"');
      expect(xml).toContain('disabled="false"');
      expect(xml).toContain('expanded="true"');
      expect(xml).toContain('selected="false"');
      expect(xml).toContain('readonly="true"');
      expect(xml).toContain('required="false"');
      expect(xml).toContain('invalid="false"');
    });

    it("should use default role if not provided", () => {
      const aomTree: Record<string, unknown> = {
        name: "Test",
      };

      const xml = aomToXml(aomTree);
      expect(xml).toContain("<node");
    });

    it("should handle indentation", () => {
      const aomTree: Record<string, unknown> = {
        role: "document",
        children: [
          {
            role: "heading",
            name: "Title",
          },
        ],
      };

      const xml = aomToXml(aomTree, 2);
      // Should have 2 levels of indentation (4 spaces per level)
      expect(xml).toContain("    <document");
      expect(xml).toContain("      <heading");
    });
  });

  describe("extractAOM", () => {
    beforeEach(() => {
      // Mock delay to avoid actual waiting in tests
      vi.spyOn(puppeteerContentLoading, "delay").mockResolvedValue(undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should extract AOM from page and return XML", async () => {
      const waitPromise = Promise.resolve(undefined);
      const catchFn = vi.fn().mockResolvedValue(undefined);
      const waitPromiseWithCatch = Object.assign(waitPromise, {
        catch: catchFn,
      });

      const mockPage = {
        waitForFunction: vi.fn().mockReturnValue(waitPromiseWithCatch),
        evaluate: vi.fn().mockResolvedValue({
          role: "document",
          name: "Test Page",
          children: [],
        }),
      } as unknown as Page;

      const result = await extractAOM(mockPage);

      expect(result).toContain("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
      expect(result).toContain("<aom>");
      expect(result).toContain("</aom>");
      expect(mockPage.waitForFunction).toHaveBeenCalled();
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it("should handle waitForFunction timeout gracefully", async () => {
      const waitPromise = Promise.resolve(undefined);
      const catchFn = vi.fn().mockResolvedValue(undefined);
      const waitPromiseWithCatch = Object.assign(waitPromise, {
        catch: catchFn,
      });

      const mockPage = {
        waitForFunction: vi.fn().mockReturnValue(waitPromiseWithCatch),
        evaluate: vi.fn().mockResolvedValue({
          role: "document",
          children: [],
        }),
      } as unknown as Page;

      const result = await extractAOM(mockPage);

      expect(result).toContain("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
    });
  });
});

