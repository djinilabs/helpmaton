// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-core is installed in container image
import type { Page } from "puppeteer-core";

import { delay } from "./puppeteerContentLoading";

/**
 * Escape XML special characters
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Convert AOM tree to XML
 */
export function aomToXml(node: Record<string, unknown>, indent = 0): string {
  const spaces = "  ".repeat(indent);
  const tagName = node.role || "node";
  const attributes: string[] = [];

  if (node.name && typeof node.name === "string") {
    attributes.push(`name="${escapeXml(node.name)}"`);
  }
  if (node.value && typeof node.value === "string") {
    attributes.push(`value="${escapeXml(node.value)}"`);
  }
  if (node.description && typeof node.description === "string") {
    attributes.push(`description="${escapeXml(node.description)}"`);
  }
  if (node.checked !== undefined) {
    attributes.push(`checked="${escapeXml(String(node.checked))}"`);
  }
  if (node.selected !== undefined) {
    attributes.push(`selected="${escapeXml(String(node.selected))}"`);
  }
  if (node.expanded !== undefined) {
    attributes.push(`expanded="${escapeXml(String(node.expanded))}"`);
  }
  if (node.disabled !== undefined) {
    attributes.push(`disabled="${escapeXml(String(node.disabled))}"`);
  }
  if (node.readonly !== undefined) {
    attributes.push(`readonly="${escapeXml(String(node.readonly))}"`);
  }
  if (node.required !== undefined) {
    attributes.push(`required="${escapeXml(String(node.required))}"`);
  }
  if (node.invalid !== undefined) {
    attributes.push(`invalid="${escapeXml(String(node.invalid))}"`);
  }

  const attrsStr = attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
  const children = (
    Array.isArray(node.children) ? node.children : []
  ) as Record<string, unknown>[];

  if (children.length === 0) {
    return `${spaces}<${tagName}${attrsStr} />`;
  }

  let xml = `${spaces}<${tagName}${attrsStr}>\n`;
  for (const child of children) {
    xml += aomToXml(child, indent + 1) + "\n";
  }
  xml += `${spaces}</${tagName}>`;

  return xml;
}

/**
 * Extract AOM from page with enhanced content extraction
 * Focuses on extracting actual text content, headers, and readable content
 * Handles JavaScript-heavy sites like Reddit that load content dynamically
 */
export async function extractAOM(page: Page): Promise<string> {
  // Wait for initial page load
  await delay(3000);

  // For Reddit and similar sites, wait for content to appear
  // Reddit loads content asynchronously via faceplate-partial and JavaScript
  // Wait for substantial content to appear (not just navigation)
  try {
    await page
      .waitForFunction(
        () => {
          // Check if there's substantial text content (more than just navigation)
          const bodyText = document.body?.innerText || "";
          const hasSubstantialContent = bodyText.length > 1000;

          // Check for Reddit comment/post content indicators
          // Reddit uses various selectors for comments and posts
          const hasCommentContent =
            document.querySelector("[data-testid*='comment']") !== null ||
            document.querySelector("[class*='Comment']") !== null ||
            document.querySelector("[class*='comment']") !== null ||
            document.querySelector("shreddit-comment") !== null ||
            document.querySelector("faceplate-tracker[source='comments']") !==
              null;

          const hasPostContent =
            document.querySelector("[data-testid*='post']") !== null ||
            document.querySelector("[class*='Post']") !== null ||
            document.querySelector("[class*='post']") !== null ||
            document.querySelector("shreddit-post") !== null;

          // For Reddit, look for specific content patterns
          // Reddit comment pages have specific structure
          const hasRedditStructure =
            document.querySelector("shreddit-app") !== null &&
            (hasCommentContent || hasPostContent || hasSubstantialContent);

          return hasSubstantialContent || hasRedditStructure;
        },
        { timeout: 20000 }
      )
      .catch(() => {
        console.warn("[aom-utils] Content wait timeout, proceeding anyway");
      });
  } catch {
    // Continue if waiting fails
  }

  // Additional wait for JavaScript-heavy sites like Reddit
  // Reddit loads content in multiple phases via async requests
  await delay(5000);

  // Additional wait for JavaScript-heavy sites like Reddit
  // Reddit loads content in multiple phases
  await delay(5000);

  // Scroll page multiple times to trigger lazy-loaded content
  for (let i = 0; i < 3; i++) {
    await page.evaluate((scrollFraction) => {
      window.scrollTo(0, (document.body.scrollHeight * scrollFraction) / 3);
    }, i + 1);
    await delay(1500);
  }

  // Scroll back to top
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await delay(1000);

  // Debug: Print comprehensive DOM structure to console before extraction
  const domDebug = await page.evaluate(() => {
    // Helper to extract from Shadow DOM
    function getShadowDOMText(element: Element): string {
      if (element.shadowRoot) {
        return element.shadowRoot.textContent || "";
      }
      return "";
    }

    // Get all body children with their structure
    const bodyChildren = Array.from(document.body?.children || []).map(
      (child, index) => {
        const tagName = child.tagName.toLowerCase();
        const hasShadow = child.shadowRoot !== null;
        const shadowText = hasShadow ? getShadowDOMText(child) : "";
        const regularText =
          (child as HTMLElement).innerText || child.textContent || "";

        return {
          index,
          tagName,
          className: child.className || "",
          id: child.id || "",
          hasShadowDOM: hasShadow,
          textLength: regularText.length,
          shadowTextLength: shadowText.length,
          textPreview: regularText.substring(0, 300),
          shadowTextPreview: shadowText.substring(0, 300),
          childrenCount: child.children.length,
          innerHTMLPreview: child.innerHTML.substring(0, 500),
        };
      }
    );

    const debugInfo = {
      title: document.title,
      url: window.location.href,
      bodyTextLength: document.body?.innerText?.length || 0,
      bodyTextPreview: document.body?.innerText?.substring(0, 1000) || "",
      bodyHTML: document.body?.innerHTML || "",
      bodyChildrenCount: document.body?.children.length || 0,
      bodyChildren: bodyChildren,
      mainElements: {
        main:
          document.querySelector("main")?.innerText?.substring(0, 500) || null,
        article:
          document.querySelector("article")?.innerText?.substring(0, 500) ||
          null,
        shredditApp: document.querySelector("shreddit-app")
          ? {
              hasShadow:
                document.querySelector("shreddit-app")?.shadowRoot !== null,
              shadowText: getShadowDOMText(
                document.querySelector("shreddit-app")!
              ),
              innerText:
                (
                  document.querySelector("shreddit-app") as HTMLElement
                )?.innerText?.substring(0, 500) || "",
            }
          : null,
        posts: Array.from(
          document.querySelectorAll(
            "[class*='post'], [class*='Post'], [data-testid*='post']"
          )
        )
          .slice(0, 5)
          .map((el) => ({
            tagName: el.tagName,
            className: el.className,
            textPreview: (el as HTMLElement).innerText?.substring(0, 300) || "",
            hasShadow: el.shadowRoot !== null,
          })),
      },
    };
    return debugInfo;
  });

  console.log("[aom-utils] DOM Debug Info:", JSON.stringify(domDebug, null, 2));

  // Enhanced extraction: Get text content, headers, and structured content
  const aom = (await page.evaluate((): Record<string, unknown> => {
    /**
     * Extract text from Shadow DOM recursively
     */
    function extractFromShadowDOM(element: Element): string {
      let text = "";
      // Check if element has shadow root
      if (element.shadowRoot) {
        const shadowText = extractTextContent(
          element.shadowRoot as unknown as Element
        );
        if (shadowText) {
          text += shadowText + " ";
        }
        // Also process children in shadow DOM
        for (const child of Array.from(element.shadowRoot.children)) {
          text += extractFromShadowDOM(child) + " ";
        }
      }
      return text.trim();
    }

    function extractTextContent(element: Element): string {
      // First, try to extract from Shadow DOM if present
      let text = extractFromShadowDOM(element);

      // Get all text nodes recursively, excluding script/style content
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          // Skip text nodes inside script, style, or other non-content elements
          let parent = node.parentElement;
          while (parent) {
            const tagName = parent.tagName.toLowerCase();
            if (
              ["script", "style", "noscript", "meta", "link"].includes(tagName)
            ) {
              return NodeFilter.FILTER_REJECT;
            }
            parent = parent.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let node;
      while ((node = walker.nextNode())) {
        const textContent = node.textContent?.trim();
        if (textContent && textContent.length > 0) {
          text += textContent + " ";
        }
      }

      return text.trim();
    }

    /**
     * Find elements in Shadow DOM
     */
    function findInShadowDOM(root: Element, selector: string): Element | null {
      // Check shadow root
      if (root.shadowRoot) {
        const found = root.shadowRoot.querySelector(selector);
        if (found) {
          return found;
        }
        // Recursively check children
        for (const child of Array.from(root.shadowRoot.children)) {
          const found = findInShadowDOM(child, selector);
          if (found) {
            return found;
          }
        }
      }
      return null;
    }

    function findMainContent(): Element | null {
      // For Reddit, look for actual post/comment content
      // Reddit uses various selectors for comments and posts
      const commentSelectors = [
        "[data-testid*='comment']",
        "[class*='Comment']",
        "[class*='comment']",
        "shreddit-comment",
        "[id*='comment']",
      ];

      const postSelectors = [
        "[data-testid*='post']",
        "[class*='Post']",
        "[class*='post']",
        "shreddit-post",
        "[id*='post']",
      ];

      // Try to find comment content first (most specific)
      for (const selector of commentSelectors) {
        try {
          const element = document.querySelector(selector);
          if (element) {
            const text =
              (element as HTMLElement).innerText || element.textContent || "";
            if (text.length > 100) {
              return element;
            }
          }
        } catch {
          // Invalid selector, continue
        }
      }

      // Try to find post content
      for (const selector of postSelectors) {
        try {
          const element = document.querySelector(selector);
          if (element) {
            const text =
              (element as HTMLElement).innerText || element.textContent || "";
            if (text.length > 100) {
              return element;
            }
          }
        } catch {
          // Invalid selector, continue
        }
      }

      // For Reddit, look for shreddit-app and extract from it
      const shredditApp = document.querySelector("shreddit-app");
      if (shredditApp) {
        // Try to find main content inside shreddit-app or its shadow DOM
        const mainInShreddit =
          shredditApp.querySelector("main") ||
          shredditApp.querySelector("[role='main']") ||
          findInShadowDOM(shredditApp, "main") ||
          findInShadowDOM(shredditApp, "[role='main']");
        if (mainInShreddit) {
          return mainInShreddit;
        }

        // Look for any element with substantial text content inside shreddit-app
        // that's not navigation
        const allElements = shredditApp.querySelectorAll("*");
        for (const el of Array.from(allElements)) {
          const text = (el as HTMLElement).innerText || el.textContent || "";
          const isNav =
            text.includes("Skip to main content") ||
            text.includes("Get App") ||
            text.includes("Log In") ||
            text.includes("Expand user menu") ||
            text.includes("Open menu") ||
            text.length < 50;

          if (!isNav && text.length > 200) {
            return el;
          }
        }

        // If no main found, use shreddit-app itself if it has any content
        // Lower threshold - extract whatever is available
        const shredditText =
          (shredditApp as HTMLElement).innerText ||
          shredditApp.textContent ||
          "";
        if (shredditText.length > 100) {
          return shredditApp;
        }
      }

      // Remove navigation, header, footer, and sidebar elements first
      const elementsToRemove = [
        "nav",
        "header",
        "footer",
        "[role='navigation']",
        "[role='banner']",
        "[role='contentinfo']",
        "[role='complementary']",
        "[class*='nav']",
        "[class*='header']",
        "[class*='footer']",
        "[class*='sidebar']",
        "[class*='menu']",
        "[class*='ad']",
        "[id*='nav']",
        "[id*='header']",
        "[id*='footer']",
        "[id*='sidebar']",
        "a[href='#main-content']", // Skip to main content link
        "#shreddit-skip-link",
      ];

      elementsToRemove.forEach((selector) => {
        try {
          document.querySelectorAll(selector).forEach((el) => {
            // Don't remove if it's inside main content
            if (
              !el.closest(
                "main, article, [role='main'], [role='article'], shreddit-app"
              )
            ) {
              el.remove();
            }
          });
        } catch {
          // Invalid selector, continue
        }
      });

      // Try to find main content area using common selectors
      // Prioritize article/post containers
      const mainSelectors = [
        "article",
        "[role='article']",
        "[data-testid*='post']",
        "[class*='Post']",
        "[class*='post']",
        "[class*='post-container']",
        "main",
        "[role='main']",
        "[class*='content']",
        "[id*='content']",
        "[class*='main']",
        "[class*='feed']",
        "[class*='listing']",
      ];

      for (const selector of mainSelectors) {
        try {
          const element = document.querySelector(selector);
          if (element) {
            // Verify it has substantial content
            const text =
              (element as HTMLElement).innerText || element.textContent || "";
            if (text.length > 100) {
              return element;
            }
          }
        } catch {
          // Invalid selector, continue
        }
      }

      // Fallback: find body but exclude removed elements
      return document.body;
    }

    function buildAOMNode(
      element: Element,
      includeText = true
    ): Record<string, unknown> {
      const tagName = element.tagName.toLowerCase();
      const node: Record<string, unknown> = {
        role: element.getAttribute("role") || tagName,
      };

      // Get name from various sources
      const ariaLabel = element.getAttribute("aria-label");
      const alt = element.getAttribute("alt");
      const title = element.getAttribute("title");
      const textContent = includeText ? extractTextContent(element) : "";

      // For headings, use their text content as name
      if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName)) {
        const headingText = (element as HTMLElement).innerText?.trim();
        node.name = headingText || ariaLabel || undefined;
        node.value = headingText || undefined;
      } else {
        // Prioritize aria-label, then alt, then title, then text content (if short)
        node.name =
          ariaLabel ||
          alt ||
          title ||
          (textContent.length > 0 && textContent.length < 200
            ? textContent
            : undefined);
      }

      // For elements with substantial text content, include it in value
      if (includeText && textContent.length > 0) {
        // Only include text if it's meaningful (not just whitespace/navigation)
        // Skip if it's just repeated navigation text
        const isNavigationText =
          textContent.includes("Open menu") ||
          textContent.includes("Log In") ||
          textContent.includes("Get App") ||
          textContent.includes("Expand user menu") ||
          textContent.length < 20;

        if (!isNavigationText && textContent.length > 20) {
          // Limit very long content to prevent XML bloat
          node.value =
            textContent.length > 5000
              ? textContent.substring(0, 5000) + "..."
              : textContent;
        }
      }

      // Get other attributes
      if (element.getAttribute("aria-description")) {
        node.description = element.getAttribute("aria-description");
      }

      // Check ARIA states
      if (element.hasAttribute("aria-checked")) {
        node.checked = element.getAttribute("aria-checked") === "true";
      }
      if (element.hasAttribute("aria-selected")) {
        node.selected = element.getAttribute("aria-selected") === "true";
      }
      if (element.hasAttribute("aria-expanded")) {
        node.expanded = element.getAttribute("aria-expanded") === "true";
      }
      if (element.hasAttribute("aria-disabled")) {
        node.disabled = element.getAttribute("aria-disabled") === "true";
      }
      if (element.hasAttribute("aria-readonly")) {
        node.readonly = element.getAttribute("aria-readonly") === "true";
      }
      if (element.hasAttribute("aria-required")) {
        node.required = element.getAttribute("aria-required") === "true";
      }
      if (element.hasAttribute("aria-invalid")) {
        node.invalid = element.getAttribute("aria-invalid") === "true";
      }

      // Recursively process children (including Shadow DOM)
      const children: Record<string, unknown>[] = [];

      // Process regular children
      for (const child of Array.from(element.children)) {
        // Skip script, style, and other non-content elements
        const childTagName = child.tagName.toLowerCase();
        if (
          ![
            "script",
            "style",
            "noscript",
            "meta",
            "link",
            "svg",
            "path",
            "g",
          ].includes(childTagName)
        ) {
          const childNode = buildAOMNode(child, includeText);
          // Only include child if it has meaningful content
          const hasContent =
            childNode.name ||
            childNode.value ||
            (Array.isArray(childNode.children) &&
              childNode.children.length > 0);
          if (hasContent) {
            children.push(childNode);
          }
        }
      }

      // Process Shadow DOM children if present
      if (element.shadowRoot) {
        for (const child of Array.from(element.shadowRoot.children)) {
          const childNode = buildAOMNode(child, includeText);
          const hasContent =
            childNode.name ||
            childNode.value ||
            (Array.isArray(childNode.children) &&
              childNode.children.length > 0);
          if (hasContent) {
            children.push(childNode);
          }
        }
      }

      if (children.length > 0) {
        node.children = children;
      }

      return node;
    }

    // Try to find main content area first, fallback to body
    const mainContent = findMainContent();
    let rootElement = mainContent || document.body || document.documentElement;

    // If we found shreddit-app but it has minimal content, try to extract
    // any non-navigation text from the entire page
    if (rootElement === document.querySelector("shreddit-app")) {
      const allText = document.body?.textContent || "";
      const nonNavLines = allText
        .split("\n")
        .filter(
          (line) =>
            line.trim().length > 20 &&
            !line.includes("Skip to main content") &&
            !line.includes("Get App") &&
            !line.includes("Log In") &&
            !line.includes("Expand user menu") &&
            !line.includes("Open menu") &&
            !line.includes("Open navigation") &&
            !line.includes("Go to Reddit Home")
        );

      // If we found substantial non-navigation content, use body
      if (nonNavLines.length > 0 && nonNavLines.join(" ").length > 200) {
        rootElement = document.body;
      }
    }

    // Build AOM tree with text content included
    return buildAOMNode(rootElement, true) as Record<string, unknown>;
  })) as Record<string, unknown>;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<aom>\n${aomToXml(
    aom,
    1
  )}\n</aom>`;
  return xml;
}

