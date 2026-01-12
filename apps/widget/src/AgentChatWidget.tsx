import React from "react";
import { createRoot, type Root } from "react-dom/client";
import retargetEvents from "react-shadow-dom-retarget-events";
import { WidgetContainer } from "./widget-container";
import type { WidgetConfig } from "./types";

// Inject Tailwind CSS into shadow root
// Try multiple methods to load CSS: from stylesheet links, from style elements, or extract from document
const injectStyles = async (shadowRoot: ShadowRoot): Promise<void> => {
  // First, add minimal critical styles with fallback background
  const style = document.createElement("style");
  style.textContent = `
    /* Widget container styles */
    .agent-chat-widget {
      width: 100%;
      height: 100%;
      max-width: 100%;
      font-family: system-ui, -apple-system, sans-serif;
      background: white;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    /* Ensure the widget has a background even if Tailwind doesn't load */
    .agent-chat-widget * {
      box-sizing: border-box;
    }
    /* Prevent horizontal overflow */
    .agent-chat-widget > * {
      max-width: 100%;
      overflow-x: hidden;
    }
  `;
  shadowRoot.appendChild(style);
  
  // Method 1: Try to find and load CSS from stylesheet links
  const stylesheetLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  for (const link of stylesheetLinks) {
    const href = link.getAttribute("href");
    if (href && (href.includes("index") || href.includes("assets") || href.endsWith(".css"))) {
      try {
        const url = href.startsWith("http") ? href : new URL(href, window.location.origin).href;
        const response = await fetch(url);
        if (response.ok) {
          const cssText = await response.text();
          // Only use if it looks like Tailwind (contains utility classes or is large enough)
          if (cssText.includes(".flex") || cssText.includes("tailwind") || cssText.includes("@tailwind") || cssText.length > 10000) {
            const fullStyle = document.createElement("style");
            fullStyle.textContent = cssText;
            shadowRoot.appendChild(fullStyle);
            console.log("[Widget] Successfully loaded CSS from:", href);
            return;
          }
        }
      } catch (error) {
        // Continue to next stylesheet
        console.debug("[Widget] Could not load stylesheet:", href, error);
      }
    }
  }
  
  // Method 2: Try to extract CSS from inline style elements (if any)
  const styleElements = Array.from(document.querySelectorAll('style'));
  for (const styleEl of styleElements) {
    const cssText = styleEl.textContent || "";
    if (cssText.length > 1000 && (cssText.includes(".flex") || cssText.includes("@tailwind"))) {
      const fullStyle = document.createElement("style");
      fullStyle.textContent = cssText;
      shadowRoot.appendChild(fullStyle);
      console.log("[Widget] Successfully extracted CSS from inline style element");
      return;
    }
  }
  
  // Method 3: Try to get CSS from document stylesheets (if accessible)
  try {
    const sheets = Array.from(document.styleSheets);
    let allCss = "";
    for (const sheet of sheets) {
      try {
        const rules = Array.from(sheet.cssRules || sheet.rules || []);
        for (const rule of rules) {
          allCss += rule.cssText + "\n";
        }
      } catch (e) {
        // Cross-origin stylesheets will throw, skip them
        continue;
      }
    }
    if (allCss.length > 1000) {
      const fullStyle = document.createElement("style");
      fullStyle.textContent = allCss;
      shadowRoot.appendChild(fullStyle);
      console.log("[Widget] Successfully extracted CSS from document stylesheets");
      return;
    }
  } catch (error) {
    console.debug("[Widget] Could not extract CSS from stylesheets:", error);
  }
  
  console.warn("[Widget] Tailwind CSS not found. Widget may not display correctly. Make sure the frontend is built.");
};

export class AgentChatWidget extends HTMLElement {
  private reactRoot: Root | null = null;
  private config: WidgetConfig | null = null;
  private baseUrl: string;
  private _shadowRoot: ShadowRoot | null = null;
  declare shadowRoot: ShadowRoot; // Declare shadowRoot (it's defined in HTMLElement)

  constructor() {
    super();
    // Create shadow DOM
    // attachShadow returns the ShadowRoot and sets the shadowRoot property
    // Store it in a private property for jsdom compatibility
    const shadow = this.attachShadow({ mode: "open" });
    // In jsdom, shadowRoot might be read-only, so we use the returned value
    this._shadowRoot = shadow;
    
    // Determine base URL
    // Use data-base-url attribute if provided, otherwise use current origin or default
    const dataBaseUrl = this.getAttribute("data-base-url");
    this.baseUrl =
      dataBaseUrl ||
      (typeof window !== "undefined" && window.location.origin
        ? window.location.origin
        : "https://app.helpmaton.com");

    // Inject styles (async, but we don't wait for it)
    injectStyles(shadow).catch((error) => {
      console.error("[Widget] Failed to inject styles:", error);
    });

    // Create container for React
    const container = document.createElement("div");
    container.className = "agent-chat-widget";
    shadow.appendChild(container);

    // Retarget events for React
    retargetEvents(shadow);
  }

  connectedCallback() {
    // Initialize React root when element is connected
    if (!this.reactRoot && this.config) {
      const shadow = this._shadowRoot || this.shadowRoot;
      const container = shadow.querySelector(".agent-chat-widget");
      if (container) {
        this.reactRoot = createRoot(container);
        this.render();
      }
    }
  }

  disconnectedCallback() {
    // Cleanup React root when element is disconnected
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
  }

  init(config: WidgetConfig) {
    this.config = config;

    // Render if already connected
    if (this.isConnected && !this.reactRoot) {
      const shadow = this._shadowRoot || this.shadowRoot;
      const container = shadow.querySelector(".agent-chat-widget");
      if (container) {
        this.reactRoot = createRoot(container);
        this.render();
      }
    }
  }

  private render() {
    if (!this.reactRoot || !this.config) {
      return;
    }

    this.reactRoot.render(
      <WidgetContainer config={this.config} baseUrl={this.baseUrl} />
    );
  }
}

// Register the custom element
if (typeof window !== "undefined" && !customElements.get("agent-chat-widget")) {
  customElements.define("agent-chat-widget", AgentChatWidget);
}
