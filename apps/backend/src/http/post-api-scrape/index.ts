import { createHash } from "crypto";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { badRequest, boomify, internal, unauthorized } from "@hapi/boom";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - @sparticuz/chromium is installed in container image
// Lazy-load chromium to avoid import errors in test environments
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chromium: any = null;
function getChromium(): any {
  if (!chromium) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      chromium = require("@sparticuz/chromium");
    } catch (error) {
      // In test environments, @sparticuz/chromium might not be available
      // This is fine - the code will use local Chrome paths instead
      console.warn(
        "[scrape] @sparticuz/chromium not available, will use local Chrome paths:",
        error instanceof Error ? error.message : String(error)
      );
      // Return null to indicate module is not available
      return null;
    }
  }
  return chromium;
}
import serverlessExpress from "@vendia/serverless-express";
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import express from "express";
import { jwtDecrypt } from "jose";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-extra is installed in container image
import type { Browser, Page } from "puppeteer-core";
import puppeteer from "puppeteer-extra";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-extra-plugin-recaptcha is installed in container image
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-extra-plugin-stealth is installed in container image
import StealthPlugin from "puppeteer-extra-plugin-stealth";

import { database } from "../../tables";
import { InsufficientCreditsError } from "../../utils/creditErrors";
import {
  refundReservation,
  reserveCredits,
  type CreditReservation,
} from "../../utils/creditManagement";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { ensureError, flushSentry, Sentry } from "../../utils/sentry";
import { getContextFromRequestId } from "../../utils/workspaceCreditContext";
import { expressErrorHandler } from "../utils/errorHandler";

/**
 * Type definition for Puppeteer HTTPRequest
 * This matches the interface used by puppeteer-core
 */
interface HTTPRequest {
  resourceType(): string;
  url(): string;
  abort(): void;
  continue(): void;
}

/**
 * Type definition for Puppeteer accessibility snapshot (SerializedAXNode)
 * This matches the structure returned by page.accessibility.snapshot()
 * Used for type documentation - converted to Record<string, unknown> for processing
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface SerializedAXNode {
  role?: string;
  name?: string;
  value?: string | number;
  description?: string;
  keyshortcuts?: string;
  roledescription?: string;
  valuetext?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  checked?: boolean | "mixed";
  pressed?: boolean | "mixed";
  level?: number;
  valuemin?: number;
  valuemax?: number;
  autocomplete?: string;
  haspopup?: string;
  invalid?: string;
  orientation?: string;
  children?: SerializedAXNode[];
  [key: string]: unknown;
}

// Known tracker domains to block
const TRACKER_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "facebook.net",
  "facebook.com",
  "doubleclick.net",
  "adservice.google",
  "googlesyndication.com",
  "amazon-adsystem.com",
  "ads-twitter.com",
  "analytics.twitter.com",
  "scorecardresearch.com",
  "quantserve.com",
  "outbrain.com",
  "taboola.com",
  "bing.com",
  "bingads.microsoft.com",
  "ads.yahoo.com",
  "advertising.com",
  "adnxs.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "criteo.com",
  "media.net",
  "adsrvr.org",
  "adtechus.com",
  "adform.net",
  "adroll.com",
  "moatads.com",
  "chartbeat.com",
  "parsely.com",
  "newrelic.com",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "hotjar.com",
  "fullstory.com",
  "mouseflow.com",
  "crazyegg.com",
  "optimizely.com",
  "vwo.com",
  "abtasty.com",
  "convert.com",
  "unbounce.com",
  "intercom.io",
  "zendesk.com",
  "drift.com",
  "olark.com",
  "livechatinc.com",
  "uservoice.com",
  "helpscout.com",
  "freshdesk.com",
  "zoho.com",
  "salesforce.com",
  "marketo.com",
  "hubspot.com",
  "pardot.com",
  "eloqua.com",
  "act-on.com",
  "constantcontact.com",
  "mailchimp.com",
  "sendgrid.com",
  "mandrill.com",
  "postmarkapp.com",
  "sparkpost.com",
  "mailgun.com",
  "sendinblue.com",
  "getresponse.com",
  "aweber.com",
  "icontact.com",
  "verticalresponse.com",
  "benchmarkemail.com",
  "campaignmonitor.com",
  "drip.com",
  "klaviyo.com",
  "omnisend.com",
  "autopilot.com",
  "customer.io",
  "braze.com",
  "urbanairship.com",
  "onesignal.com",
  "pushcrew.com",
  "pushwoosh.com",
  "pushbullet.com",
  "pusher.com",
  "pubnub.com",
  "ably.com",
  "stream.io",
  "getstream.io",
  "layer.com",
  "twilio.com",
  "nexmo.com",
  "plivo.com",
  "bandwidth.com",
  "sinch.com",
  "messagebird.com",
  "vonage.com",
  "ringcentral.com",
  "8x8.com",
  "zoom.us",
  "gotomeeting.com",
  "webex.com",
  "bluejeans.com",
  "jitsi.org",
  "whereby.com",
  "appear.in",
  "talky.io",
  "tokbox.com",
  "agora.io",
  "daily.co",
  "mux.com",
  "cloudflare.com",
  "fastly.com",
  "keycdn.com",
  "bunnycdn.com",
  "stackpath.com",
  "maxcdn.com",
  "cdnjs.com",
  "jsdelivr.com",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "ajax.googleapis.com",
  "ajax.aspnetcdn.com",
  "cdn.sstatic.net",
  "sstatic.net",
  "cdn.mathjax.org",
  "cdn.rawgit.com",
  "cdn.ckeditor.com",
  "cdn.tiny.cloud",
  "cdn.quilljs.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
];

/**
 * Parse proxy URL to extract server, username, and password
 */
export function parseProxyUrl(proxyUrl: string): {
  server: string;
  username?: string;
  password?: string;
} {
  try {
    const url = new URL(proxyUrl);
    return {
      server: `${url.protocol}//${url.host}`,
      username: url.username || undefined,
      password: url.password || undefined,
    };
  } catch {
    throw badRequest(`Invalid proxy URL format: ${proxyUrl}`);
  }
}

/**
 * Get random proxy URL from environment variable
 */
export function getRandomProxyUrl(): string {
  const proxyUrlsEnv = process.env.DECODO_PROXY_URLS;
  if (!proxyUrlsEnv) {
    throw internal("DECODO_PROXY_URLS environment variable is not set");
  }

  let proxyUrls: string[];
  try {
    proxyUrls = JSON.parse(proxyUrlsEnv);
  } catch {
    throw internal("DECODO_PROXY_URLS must be a valid JSON array of strings");
  }

  if (!Array.isArray(proxyUrls) || proxyUrls.length === 0) {
    throw internal("DECODO_PROXY_URLS must be a non-empty array");
  }

  if (!proxyUrls.every((url) => typeof url === "string")) {
    throw internal("All items in DECODO_PROXY_URLS must be strings");
  }

  // Randomly select one proxy URL
  const randomIndex = Math.floor(Math.random() * proxyUrls.length);
  return proxyUrls[randomIndex]!;
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
 * Helper function to wait for a specified number of milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract AOM from page with enhanced content extraction
 * Focuses on extracting actual text content, headers, and readable content
 * Handles JavaScript-heavy sites like Reddit that load content dynamically
 */
async function extractAOM(page: Page): Promise<string> {
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
        console.warn("[scrape] Content wait timeout, proceeding anyway");
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

  console.log("[scrape] DOM Debug Info:", JSON.stringify(domDebug, null, 2));

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

/**
 * Get JWT secret key from environment
 * Derives a 256-bit key from AUTH_SECRET using SHA-256 for A256GCM encryption
 */
function getJwtSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required");
  }
  // Derive a 256-bit key from the secret using SHA-256
  // A256GCM requires exactly 32 bytes (256 bits)
  const keyMaterial = Buffer.from(secret, "utf-8");
  const derivedKey = createHash("sha256").update(keyMaterial).digest();
  return new Uint8Array(derivedKey);
}

/**
 * Extract and validate encrypted JWT from Authorization header
 * Returns workspaceId, agentId, and conversationId from the token payload
 */
async function extractWorkspaceContextFromToken(req: express.Request): Promise<{
  workspaceId: string;
  agentId: string;
  conversationId: string;
}> {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== "string") {
    throw unauthorized("Authorization header with Bearer token is required");
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw unauthorized(
      "Invalid Authorization header format. Expected: Bearer <token>"
    );
  }

  const encryptedToken = match[1];
  const secret = getJwtSecret();

  try {
    const { payload } = await jwtDecrypt(encryptedToken, secret, {
      issuer: "helpmaton",
      audience: "helpmaton-api",
    });

    // Extract required fields from payload
    const workspaceId = payload.workspaceId;
    const agentId = payload.agentId;
    const conversationId = payload.conversationId;

    if (
      typeof workspaceId !== "string" ||
      typeof agentId !== "string" ||
      typeof conversationId !== "string"
    ) {
      throw unauthorized(
        "Token payload must contain workspaceId, agentId, and conversationId as strings"
      );
    }

    return { workspaceId, agentId, conversationId };
  } catch (error) {
    console.error("[scrape] Error decrypting JWT token:", error);
    if (error && typeof error === "object" && "isBoom" in error) {
      throw error;
    }
    throw unauthorized("Invalid or expired encrypted token");
  }
}

/**
 * Check if page contains a CAPTCHA or human verification challenge
 * Detects common CAPTCHA indicators including text patterns and DOM elements
 */
async function detectCaptcha(page: Page): Promise<boolean> {
  try {
    // Check for common CAPTCHA indicators
    const captchaIndicators = await page.evaluate(() => {
      const bodyText = document.body?.innerText?.toLowerCase() || "";
      const title = document.title?.toLowerCase() || "";

      // Common CAPTCHA phrases
      const phrases = [
        "prove you're human",
        "verify you're human",
        "are you a robot",
        "captcha",
        "challenge",
        "cloudflare",
        "access denied",
        "checking your browser",
        "please wait",
        "just a moment",
        "verify you are not a robot",
        "security check",
      ];

      // Check body text and title
      const hasPhrase = phrases.some(
        (phrase) => bodyText.includes(phrase) || title.includes(phrase)
      );

      // Check for common CAPTCHA iframe/container selectors
      const hasCaptchaElement = !!(
        document.querySelector("[data-sitekey]") || // reCAPTCHA
        document.querySelector("[site-key]") || // Reddit reputation-recaptcha
        document.querySelector("reputation-recaptcha") || // Reddit's custom reCAPTCHA element
        document.querySelector(".cf-browser-verification") || // Cloudflare
        document.querySelector("#challenge-form") || // Cloudflare
        document.querySelector('[class*="captcha"]') ||
        document.querySelector('[id*="captcha"]') ||
        document.querySelector('[class*="challenge"]') ||
        document.querySelector('[id*="challenge"]') ||
        document.querySelector('iframe[src*="recaptcha"]') ||
        document.querySelector('iframe[src*="hcaptcha"]') ||
        document.querySelector('iframe[src*="cloudflare"]')
      );

      return hasPhrase || hasCaptchaElement;
    });

    return captchaIndicators;
  } catch {
    // If evaluation fails, assume no CAPTCHA (better to try than fail)
    return false;
  }
}

/**
 * Setup resource blocking on page
 * Note: Event listener is automatically cleaned up when page is closed
 */
async function setupResourceBlocking(page: Page): Promise<void> {
  await page.setRequestInterception(true);

  const requestHandler = (request: HTTPRequest) => {
    const resourceType = request.resourceType();
    const url = request.url();

    // Block images, CSS, fonts, media
    if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
      request.abort();
      return;
    }

    // Block subframes (iframes)
    if (resourceType === "subframe") {
      request.abort();
      return;
    }

    // Block tracker domains
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      if (TRACKER_DOMAINS.some((tracker) => hostname.includes(tracker))) {
        request.abort();
        return;
      }
    } catch {
      // Invalid URL, allow it through
    }

    request.continue();
  };

  page.on("request", requestHandler);
}

/**
 * Configure Puppeteer with stealth and reCAPTCHA plugins
 * Stealth plugin makes the browser appear more human-like
 * reCAPTCHA plugin uses 2Captcha as the provider for solving CAPTCHAs
 */
function configurePuppeteer(): void {
  // Create stealth plugin instance and explicitly enable all evasions
  const stealthPlugin = StealthPlugin();

  // By default, all evasions are enabled, but we verify and log them
  // Get all available evasions and ensure they're all enabled
  const availableEvasions = stealthPlugin.availableEvasions;
  const enabledEvasions = stealthPlugin.enabledEvasions;

  // Log enabled evasions for debugging
  console.log(
    `[scrape] Stealth plugin configured with ${enabledEvasions.size} of ${availableEvasions.size} evasions enabled:`,
    Array.from(enabledEvasions).join(", ")
  );

  // If not all evasions are enabled by default, explicitly enable them
  if (enabledEvasions.size < availableEvasions.size) {
    console.warn(
      `[scrape] Not all evasions enabled by default. Enabling all ${availableEvasions.size} evasions...`
    );
    // Create new plugin instance with all evasions explicitly enabled
    const allEvasionsPlugin = StealthPlugin({
      enabledEvasions: availableEvasions,
    });
    puppeteer.use(allEvasionsPlugin);
    console.log(
      `[scrape] All ${allEvasionsPlugin.enabledEvasions.size} evasions now enabled`
    );
  } else {
    puppeteer.use(stealthPlugin);
  }

  const twoCaptchaApiKey = process.env.TWOCAPTCHA_API_KEY;

  if (twoCaptchaApiKey) {
    // Enable debug logging for puppeteer-extra plugins
    // This will log when CAPTCHAs are detected and solved
    if (!process.env.DEBUG) {
      process.env.DEBUG = "puppeteer-extra,puppeteer-extra-plugin:*";
    } else if (!process.env.DEBUG.includes("puppeteer-extra")) {
      process.env.DEBUG = `${process.env.DEBUG},puppeteer-extra,puppeteer-extra-plugin:*`;
    }

    // Configure reCAPTCHA plugin with 2Captcha
    puppeteer.use(
      RecaptchaPlugin({
        provider: {
          id: "2captcha",
          token: twoCaptchaApiKey,
        },
        visualFeedback: true, // Show a notification when solving a CAPTCHA
      })
    );
    console.log(
      "[scrape] Puppeteer configured with 2Captcha reCAPTCHA solver (API key: " +
        (twoCaptchaApiKey.substring(0, 8) + "...") +
        ")"
    );
  } else {
    console.warn(
      "[scrape] TWOCAPTCHA_API_KEY not set - CAPTCHA solving will not be available"
    );
  }
}

// Configure Puppeteer on module load
configurePuppeteer();

/**
 * Create Express app for scrape endpoint
 */
function createApp(): express.Application {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());

  app.post("/api/scrape", async (req, res, next) => {
    let browser: Browser | null = null;
    let reservation: CreditReservation | null = null;
    let context: ReturnType<typeof getContextFromRequestId> = undefined;

    try {
      // Extract and validate encrypted JWT token
      const { workspaceId, agentId, conversationId } =
        await extractWorkspaceContextFromToken(req);

      // Get AWS request ID for context lookup
      const awsRequestIdRaw =
        req.headers["x-amzn-requestid"] ||
        req.headers["X-Amzn-Requestid"] ||
        req.headers["x-request-id"] ||
        req.headers["X-Request-Id"] ||
        req.apiGateway?.event?.requestContext?.requestId;
      const awsRequestId = Array.isArray(awsRequestIdRaw)
        ? awsRequestIdRaw[0]
        : awsRequestIdRaw;

      // Get context for workspace credit transactions
      // The context is already augmented by handlingErrors wrapper with addWorkspaceCreditTransaction capability
      context = getContextFromRequestId(awsRequestId);
      if (!context) {
        throw new Error(
          "Context not available for workspace credit transactions. Ensure the handler is wrapped with handlingErrors."
        );
      }

      // Verify context has the addWorkspaceCreditTransaction method (type guard)
      if (typeof context.addWorkspaceCreditTransaction !== "function") {
        throw new Error(
          "Context is not properly augmented with workspace credit transaction capability"
        );
      }

      const { url } = req.body;

      if (!url || typeof url !== "string") {
        throw badRequest("url is required and must be a string");
      }

      // Validate URL length (max 2048 characters to prevent abuse)
      if (url.length > 2048) {
        throw badRequest("url must be 2048 characters or less");
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        throw badRequest("url must be a valid URL");
      }

      // Reserve credits upfront (0.005 USD = 5000 millionths)
      // This validates workspace has sufficient credits and reserves them
      const scrapeCostMillionthUsd = 5000; // 0.005 USD
      const db = await database();
      reservation = await reserveCredits(
        db,
        workspaceId,
        scrapeCostMillionthUsd,
        3, // maxRetries
        false, // usesByok
        context,
        "scrape", // provider (scraping tool)
        "scrape", // modelName (using tool name as model)
        agentId,
        conversationId
      );

      console.log("[scrape] Reserved credits:", {
        workspaceId,
        reservationId: reservation.reservationId,
        reservedAmount: reservation.reservedAmount,
      });

      // Get random proxy URL
      const proxyUrl = getRandomProxyUrl();
      const { server, username, password } = parseProxyUrl(proxyUrl);

      console.log(
        `[scrape] Using proxy: ${server} (username: ${
          username ? "***" : "none"
        })`
      );

      // Launch browser with proxy
      // getChromeExecutablePath() automatically detects environment and finds Chrome
      // Ensure /tmp exists for @sparticuz/chromium extraction (it's writable in Lambda)
      if (process.env.LAMBDA_TASK_ROOT) {
        try {
          mkdirSync("/tmp", { recursive: true });
          console.log(
            "[scrape] Ensured /tmp directory exists for Chromium extraction"
          );
        } catch (mkdirError) {
          console.warn("[scrape] Failed to create /tmp directory:", mkdirError);
        }
      }

      // Use @sparticuz/chromium's recommended args if in Lambda, otherwise use custom args
      const isLambda = !!process.env.LAMBDA_TASK_ROOT;

      if (isLambda) {
        const chromiumModule = getChromium();
        if (chromiumModule) {
          // Optional: Disable graphics mode for better performance in Lambda
          chromiumModule.setGraphicsMode = false;

          // Use @sparticuz/chromium's recommended configuration
          // Add proxy and site isolation args to chromium's default args
          const chromiumArgs = [
            ...chromiumModule.args,
            `--proxy-server=${server}`,
            // Disable site isolation to allow access to cross-origin iframes (needed for reCAPTCHA detection)
            "--disable-features=IsolateOrigins,site-per-process,SitePerProcess",
            "--flag-switches-begin",
            "--disable-site-isolation-trials",
            "--flag-switches-end",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
          ];

          console.log("[scrape] Chromium args:", chromiumArgs);

          const executablePath =
            process.env.PUPPETEER_EXECUTABLE_PATH || "/opt/chrome/chromium";

          browser = await puppeteer.launch({
            args: chromiumArgs,
            defaultViewport: chromiumModule.defaultViewport,
            executablePath,
          });
        } else {
          console.log("[scrape] Falling back to custom args");
          // Fallback if chromium module not available
          browser = await puppeteer.launch({
            headless: true,
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-dev-shm-usage",
              "--disable-accelerated-2d-canvas",
              "--no-first-run",
              "--no-zygote",
              "--single-process",
              "--disable-gpu",
              `--proxy-server=${server}`,
              "--disable-features=IsolateOrigins,site-per-process,SitePerProcess",
              "--flag-switches-begin",
              "--disable-site-isolation-trials",
              "--flag-switches-end",
            ],
            defaultViewport: { width: 1920, height: 1080 },
          });
        }
      } else {
        console.log("[scrape] Local development - using custom args");
        // Local development - use custom args
        browser = await puppeteer.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--single-process",
            "--disable-gpu",
            `--proxy-server=${server}`,
            // Stealth options to reduce CAPTCHA triggers
            "--disable-blink-features=AutomationControlled", // Hide automation
            // Disable site isolation to allow access to cross-origin iframes (needed for reCAPTCHA detection)
            "--disable-features=IsolateOrigins,site-per-process,SitePerProcess",
            "--flag-switches-begin",
            "--disable-site-isolation-trials",
            "--flag-switches-end",
          ],
          defaultViewport: { width: 1920, height: 1080 },
        });
      }

      if (!browser) {
        throw internal("Failed to launch browser");
      }

      const page = await browser.newPage();

      // Set realistic user agent and viewport to appear more human-like
      // Viewport is already set via chromium.defaultViewport in Lambda, but set it for local dev
      if (!process.env.LAMBDA_TASK_ROOT) {
        await page.setViewport({ width: 1920, height: 1080 });
      }

      // Authenticate with proxy if credentials provided
      if (username && password) {
        await page.authenticate({ username, password });
      }

      // Setup resource blocking to optimize performance and privacy
      await setupResourceBlocking(page);

      // Navigate to URL and wait for client-side content
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 300000, // 5 minutes timeout
      });

      // Wait for content to load BEFORE checking for CAPTCHAs or extracting AOM
      // This is critical for JavaScript-heavy sites like Reddit that load content asynchronously
      console.log("[scrape] Waiting for content to load...");

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
              const hasCommentContent =
                document.querySelector("[data-testid*='comment']") !== null ||
                document.querySelector("[class*='Comment']") !== null ||
                document.querySelector("[class*='comment']") !== null ||
                document.querySelector("shreddit-comment") !== null ||
                document.querySelector(
                  "faceplate-tracker[source='comments']"
                ) !== null;

              const hasPostContent =
                document.querySelector("[data-testid*='post']") !== null ||
                document.querySelector("[class*='Post']") !== null ||
                document.querySelector("[class*='post']") !== null ||
                document.querySelector("shreddit-post") !== null;

              // For Reddit, look for specific content patterns
              const hasRedditStructure =
                document.querySelector("shreddit-app") !== null &&
                (hasCommentContent || hasPostContent || hasSubstantialContent);

              return hasSubstantialContent || hasRedditStructure;
            },
            { timeout: 20000 }
          )
          .catch(() => {
            console.warn("[scrape] Content wait timeout, proceeding anyway");
          });
      } catch {
        // Continue if waiting fails
      }

      // Additional wait for JavaScript-heavy sites like Reddit
      // Reddit loads content in multiple phases via async requests
      await delay(5000);

      // Scroll page multiple times to trigger lazy-loaded content
      console.log("[scrape] Scrolling to trigger lazy-loaded content...");
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

      // Wait for async CAPTCHA elements to load (e.g., Reddit's reputation-recaptcha)
      // These are often loaded asynchronously via web components
      try {
        await page
          .waitForFunction(
            () => {
              // Check if reCAPTCHA iframes have loaded
              const recaptchaIframes = document.querySelectorAll(
                'iframe[src*="recaptcha"], iframe[src*="google.com/recaptcha"]'
              );
              // Check if custom CAPTCHA elements have initialized
              const customCaptchaElements = document.querySelectorAll(
                "reputation-recaptcha, [site-key], [data-sitekey]"
              );
              // Wait for at least one CAPTCHA-related element to be present
              // or wait a bit longer for async loaders
              return (
                recaptchaIframes.length > 0 || customCaptchaElements.length > 0
              );
            },
            { timeout: 10000 }
          )
          .catch(() => {
            console.log(
              "[scrape] No CAPTCHA iframes detected within timeout, proceeding..."
            );
          });
      } catch {
        // Continue if waiting fails
      }

      // Additional wait for async loaders to initialize (Reddit uses async loaders)
      await delay(2000);

      // Always attempt to solve CAPTCHAs if API key is available
      // The plugin can detect CAPTCHAs that our detection function might miss
      const twoCaptchaApiKey = process.env.TWOCAPTCHA_API_KEY;

      if (twoCaptchaApiKey) {
        // Check for CAPTCHA after navigation
        const hasCaptcha = await detectCaptcha(page);

        if (hasCaptcha) {
          console.log(
            "[scrape] CAPTCHA detected via detection function, attempting to solve..."
          );
        } else {
          console.log(
            "[scrape] No CAPTCHA detected via detection function, but attempting solveRecaptchas() anyway (plugin may detect it)..."
          );
        }

        try {
          // First, check if there are any reCAPTCHA iframes visible
          const captchaInfo = await page.evaluate(() => {
            const iframes = Array.from(document.querySelectorAll("iframe")).map(
              (iframe) => ({
                src: iframe.src || iframe.getAttribute("src") || "",
                id: iframe.id || "",
                className: iframe.className || "",
              })
            );
            const recaptchaIframes = iframes.filter(
              (iframe) =>
                iframe.src.includes("recaptcha") ||
                iframe.src.includes("google.com/recaptcha")
            );
            const customElements = Array.from(
              document.querySelectorAll(
                "reputation-recaptcha, [site-key], [data-sitekey]"
              )
            ).map((el) => ({
              tagName: el.tagName,
              siteKey:
                el.getAttribute("site-key") ||
                el.getAttribute("data-sitekey") ||
                "",
            }));
            return {
              totalIframes: iframes.length,
              recaptchaIframes: recaptchaIframes.length,
              recaptchaIframeSrcs: recaptchaIframes.map((f) => f.src),
              customElements: customElements.length,
              customElementInfo: customElements,
            };
          });
          console.log("[scrape] CAPTCHA detection info:", captchaInfo);

          // Explicitly call solveRecaptchas() to trigger solving with logging
          // This method is provided by puppeteer-extra-plugin-recaptcha
          console.log("[scrape] Calling solveRecaptchas() on main frame...");
          const mainFrameResult = await (
            page as unknown as {
              solveRecaptchas: () => Promise<{
                captchas: unknown[];
                solutions: unknown[];
                solved: unknown[];
                error?: string;
              }>;
            }
          ).solveRecaptchas();

          console.log("[scrape] Main frame solveRecaptchas() result:", {
            captchasFound: mainFrameResult.captchas.length,
            solutionsReceived: mainFrameResult.solutions.length,
            solved: mainFrameResult.solved.length,
            error: mainFrameResult.error,
          });

          // Also check child frames (CAPTCHAs are often in iframes)
          // This is critical for reCAPTCHA detection as they're usually in iframes
          const childFrames = page.mainFrame().childFrames();
          console.log(
            `[scrape] Checking ${childFrames.length} child frames for CAPTCHAs...`
          );

          let totalCaptchasInFrames = 0;
          for (let i = 0; i < childFrames.length; i++) {
            const frame = childFrames[i];
            try {
              const frameUrl = frame.url();
              console.log(
                `[scrape] Calling solveRecaptchas() on child frame ${
                  i + 1
                } (URL: ${frameUrl.substring(0, 100)})...`
              );
              const frameResult = await (
                frame as unknown as {
                  solveRecaptchas: () => Promise<{
                    captchas: unknown[];
                    solutions: unknown[];
                    solved: unknown[];
                    error?: string;
                  }>;
                }
              ).solveRecaptchas();

              console.log(
                `[scrape] Child frame ${i + 1} solveRecaptchas() result:`,
                {
                  captchasFound: frameResult.captchas.length,
                  solutionsReceived: frameResult.solutions.length,
                  solved: frameResult.solved.length,
                  error: frameResult.error,
                }
              );
              totalCaptchasInFrames += frameResult.captchas.length;
            } catch (frameError) {
              console.warn(
                `[scrape] Error solving CAPTCHA in child frame ${i + 1}:`,
                frameError
              );
            }
          }

          // If any CAPTCHAs were found by the plugin, wait for solving to complete
          // Only trust the plugin's detection, not our own detection function
          const totalCaptchasFound =
            mainFrameResult.captchas.length + totalCaptchasInFrames;

          if (totalCaptchasFound > 0) {
            // Wait for solving to complete (plugin typically takes 10-30 seconds)
            console.log(
              `[scrape] ${totalCaptchasFound} CAPTCHA(s) found by plugin, waiting up to 35 seconds for solving to complete...`
            );
            await delay(35000);

            // Re-check for CAPTCHA after solving attempt
            const stillHasCaptcha = await detectCaptcha(page);
            if (stillHasCaptcha) {
              console.warn(
                "[scrape] CAPTCHA solving failed or CAPTCHA still present after timeout"
              );
              throw badRequest(
                "The requested URL requires human verification (CAPTCHA). " +
                  "Automatic CAPTCHA solving timed out or failed. Please try again or use an alternative data source."
              );
            } else {
              console.log(
                "[scrape] CAPTCHA solved successfully - no longer detected on page"
              );
            }
          } else {
            console.log(
              "[scrape] No CAPTCHAs found by plugin, proceeding with scraping"
            );
          }
        } catch (error) {
          console.error("[scrape] Error during CAPTCHA solving:", error);
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          throw badRequest(
            `The requested URL requires human verification (CAPTCHA). ` +
              `Automatic CAPTCHA solving encountered an error: ${errorMessage}. Please try again or use an alternative data source.`
          );
        }
      } else {
        // No API key, just check and warn
        const hasCaptcha = await detectCaptcha(page);
        if (hasCaptcha) {
          throw badRequest(
            "The requested URL requires human verification (CAPTCHA). " +
              "This page cannot be scraped automatically. Please try a different URL or use an alternative data source."
          );
        } else {
          console.log("[scrape] No CAPTCHA detected on page");
        }
      }

      // Take a screenshot for debugging right before AOM extraction
      // Content has already been loaded and scrolled before CAPTCHA detection
      try {
        const screenshotPath = join(tmpdir(), `scrape-debug-${Date.now()}.png`);

        // Get page dimensions to ensure we capture everything
        const pageDimensions = await page.evaluate(() => {
          return {
            width: Math.max(
              document.body.scrollWidth,
              document.body.offsetWidth,
              document.documentElement.clientWidth,
              document.documentElement.scrollWidth,
              document.documentElement.offsetWidth
            ),
            height: Math.max(
              document.body.scrollHeight,
              document.body.offsetHeight,
              document.documentElement.clientHeight,
              document.documentElement.scrollHeight,
              document.documentElement.offsetHeight
            ),
          };
        });

        console.log(
          `[scrape] Page dimensions: ${pageDimensions.width}x${pageDimensions.height}`
        );

        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
          captureBeyondViewport: true,
        });
        console.log(`[scrape] Debug screenshot saved to: ${screenshotPath}`);
      } catch (screenshotError) {
        console.warn(
          "[scrape] Failed to take debug screenshot:",
          screenshotError
        );
      }

      // Extract AOM
      const aomXml = await extractAOM(page);

      // Credits were already reserved upfront, so no additional transaction needed
      // The reservation will be kept (not refunded) since the request succeeded
      console.log("[scrape] Request succeeded, keeping credit reservation:", {
        workspaceId,
        reservationId: reservation?.reservationId,
      });

      // Return XML response
      res.setHeader("Content-Type", "application/xml");
      res.status(200).send(aomXml);
    } catch (err) {
      // Handle InsufficientCreditsError - convert to Boom error with proper status code
      if (err instanceof InsufficientCreditsError) {
        // Don't refund credits for insufficient credits error - no reservation was created
        const boomed = boomify(err, { statusCode: err.statusCode });
        console.error("[scrape] Insufficient credits error:", {
          workspaceId: err.workspaceId,
          required: err.required,
          available: err.available,
          currency: err.currency,
        });
        // Pass the Boom error to the error handler
        next(boomed);
        return;
      }

      // Refund reserved credits if request failed
      if (
        reservation &&
        reservation.reservationId !== "byok" &&
        reservation.reservationId !== "deduction-disabled" &&
        context
      ) {
        try {
          const db = await database();
          await refundReservation(db, reservation.reservationId, context);
          console.log("[scrape] Refunded credits due to error:", {
            reservationId: reservation.reservationId,
          });
        } catch (refundError) {
          console.error("[scrape] Error refunding credits:", refundError);
          // Don't throw - we still want to report the original error
        }
      }

      // Report server errors to Sentry before passing to error handler
      const boomed = boomify(ensureError(err));
      if (boomed.isServer) {
        console.error("[scrape] Server error:", boomed);
        Sentry.captureException(ensureError(err), {
          tags: {
            handler: "scrape-endpoint",
            method: req.method,
            path: req.path,
            statusCode: boomed.output.statusCode,
          },
          contexts: {
            request: {
              method: req.method,
              url: req.url,
              path: req.path,
            },
          },
        });
      }
      next(boomed);
    } finally {
      // Cleanup browser
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error("[scrape] Error closing browser:", closeError);
          // Report browser cleanup errors to Sentry
          Sentry.captureException(ensureError(closeError), {
            tags: {
              handler: "scrape-endpoint",
              operation: "browser-cleanup",
            },
          });
        }
      }

      // Flush Sentry events before request completes (critical for Lambda)
      try {
        await flushSentry();
      } catch (flushError) {
        console.error("[scrape] Error flushing Sentry:", flushError);
      }
    }
  });

  app.use(expressErrorHandler);

  return app;
}

let cachedHandler: APIGatewayProxyHandlerV2 | undefined;

const createHandler = async (): Promise<APIGatewayProxyHandlerV2> => {
  if (cachedHandler) {
    return cachedHandler;
  }

  try {
    const app = createApp();
    const handler = handlingErrors(
      serverlessExpress({
        app,
        respondWithErrors: true,
      })
    );
    cachedHandler = handler;
    return handler;
  } catch (error) {
    console.error("[scrape] Error creating app:", error);
    if (error instanceof Error) {
      console.error("[scrape] Error stack:", error.stack);
    }
    throw error;
  }
};

export const handler = adaptHttpHandler(
  async (...args: Parameters<APIGatewayProxyHandlerV2>) => {
    try {
      // createHandler() already wraps with handlingErrors, so we don't need to wrap again
      const h: APIGatewayProxyHandlerV2 = await createHandler();
      return (await h(...args)) as APIGatewayProxyResultV2;
    } catch (error) {
      console.error("[scrape] Error in handler:", error);
      if (error instanceof Error) {
        console.error("[scrape] Error stack:", error.stack);
      }
      throw error;
    }
  }
);
