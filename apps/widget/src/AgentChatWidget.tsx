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
    /* Make the custom element expand to fill its container */
    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 100%;
    }
    /* Widget container styles */
    .agent-chat-widget {
      width: 100%;
      height: 100%;
      min-height: 100%;
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
    
    // Set default base URL (will be updated in connectedCallback if attribute is set)
    this.baseUrl =
      typeof window !== "undefined" && window.location.origin
        ? window.location.origin
        : "https://app.helpmaton.com";

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
    // Determine base URL from attribute (now that element is connected)
    const dataBaseUrl = this.getAttribute("data-base-url");
    if (dataBaseUrl) {
      this.baseUrl = dataBaseUrl;
    }
    
    // Make the custom element expand to fill its container
    // Do this in connectedCallback to avoid constructor issues
    this.style.display = "block";
    this.style.width = "100%";
    this.style.height = "100%";
    this.style.minHeight = "100%";
    
    // Apply container styles when connected
    this.applyContainerStyles();
    
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

    // Apply container-level styles
    this.applyContainerStyles();

    // Render if already connected
    if (this.isConnected && !this.reactRoot) {
      const shadow = this._shadowRoot || this.shadowRoot;
      const container = shadow.querySelector(".agent-chat-widget");
      if (container) {
        this.reactRoot = createRoot(container);
        this.render();
      }
    } else if (this.isConnected && this.reactRoot) {
      // Re-render if already rendered to apply new config
      this.render();
    }
  }

  private applyContainerStyles() {
    if (!this.config) return;

    const shadow = this._shadowRoot || this.shadowRoot;
    if (!shadow) return;

    const container = shadow.querySelector(".agent-chat-widget") as HTMLElement;
    
    if (container) {
      // Apply border radius
      if (this.config.borderRadius) {
        container.style.borderRadius = this.config.borderRadius;
      }

      // Apply outer border (only if enabled)
      if (this.config.outerBorderEnabled !== false) {
        if (this.config.borderColor) {
          container.style.borderColor = this.config.borderColor;
          container.style.borderWidth = "1px";
          container.style.borderStyle = "solid";
        }
      } else {
        // Explicitly remove border if disabled
        container.style.border = "none";
      }

      // Apply background color
      if (this.config.backgroundColor) {
        container.style.backgroundColor = this.config.backgroundColor;
      }
    }

    // Inject custom CSS for color customization
    this.injectCustomColors(shadow);
  }

  private injectCustomColors(shadow: ShadowRoot) {
    if (!this.config) return;

    // Remove existing custom color style if present
    const existingStyle = shadow.getElementById("widget-custom-colors");
    if (existingStyle) {
      existingStyle.remove();
    }

    // Build CSS rules using the customization colors
    const cssRules: string[] = [];

    // Set CSS variables on :host so they're available to all children
    const hostRules: string[] = [];
    if (this.config.primaryColor) {
      hostRules.push(`--widget-primary-color: ${this.config.primaryColor}`);
    }
    if (this.config.backgroundColor) {
      hostRules.push(`--widget-background-color: ${this.config.backgroundColor}`);
    }
    if (this.config.textColor) {
      hostRules.push(`--widget-text-color: ${this.config.textColor}`);
    }
    if (this.config.borderColor) {
      hostRules.push(`--widget-border-color: ${this.config.borderColor}`);
    }

    if (hostRules.length > 0) {
      cssRules.push(`:host { ${hostRules.join("; ")} }`);
    }

    // Override button colors with primary color
    if (this.config.primaryColor) {
      const darkerPrimary = this.adjustColorBrightness(this.config.primaryColor, -15);
      const evenDarkerPrimary = this.adjustColorBrightness(this.config.primaryColor, -25);
      
      // Extract RGB values for shadow (remove alpha for shadow)
      const primaryRgb = this.extractRgb(this.config.primaryColor);
      
      cssRules.push(`
        .bg-gradient-primary,
        button.bg-gradient-primary,
        button[class*="bg-gradient-primary"],
        [class*="bg-gradient-primary"] {
          background: ${this.config.primaryColor} !important;
          background-image: linear-gradient(to right, ${this.config.primaryColor}, ${darkerPrimary}) !important;
        }
        .bg-gradient-primary:hover,
        button.bg-gradient-primary:hover {
          background: ${darkerPrimary} !important;
          background-image: linear-gradient(to right, ${darkerPrimary}, ${evenDarkerPrimary}) !important;
        }
        /* Override shadow-colored to use primary color */
        .shadow-colored,
        [class*="shadow-colored"] {
          box-shadow: 0 8px 24px rgba(${primaryRgb}, 0.25), 0 4px 8px rgba(${primaryRgb}, 0.2) !important;
        }
        .shadow-colored:hover {
          box-shadow: 0 12px 32px rgba(${primaryRgb}, 0.3), 0 6px 12px rgba(${primaryRgb}, 0.25) !important;
        }
        /* Override focus ring colors to use primary color */
        .focus\\:ring-primary-500:focus,
        .focus\\:ring-primary-400:focus,
        [class*="focus:ring-primary"]:focus {
          --tw-ring-color: ${this.config.primaryColor} !important;
          ring-color: ${this.config.primaryColor} !important;
        }
        .focus\\:border-primary-600:focus,
        .focus\\:border-primary-500:focus,
        [class*="focus:border-primary"]:focus {
          border-color: ${this.config.primaryColor} !important;
        }
      `);
    }

    // Override text colors - target common text elements
    if (this.config.textColor) {
      cssRules.push(`
        .agent-chat-widget p,
        .agent-chat-widget span:not([class*="text-white"]):not([class*="text-primary"]),
        .agent-chat-widget div:not([class*="text-white"]):not([class*="text-primary"]),
        .agent-chat-widget .text-neutral-900,
        .agent-chat-widget .text-neutral-800,
        .agent-chat-widget .text-neutral-700,
        .agent-chat-widget .text-neutral-600,
        .agent-chat-widget .dark\\:text-neutral-50,
        .agent-chat-widget .dark\\:text-neutral-200,
        .agent-chat-widget .dark\\:text-neutral-300,
        .agent-chat-widget textarea,
        .agent-chat-widget input:not([type="button"]):not([type="submit"]) {
          color: ${this.config.textColor} !important;
        }
      `);
    }

    // Override background colors - target main container and form areas
    if (this.config.backgroundColor) {
      cssRules.push(`
        .agent-chat-widget > div,
        .agent-chat-widget .bg-white,
        .agent-chat-widget .dark\\:bg-neutral-900,
        .agent-chat-widget .bg-neutral-50,
        .agent-chat-widget .bg-neutral-100,
        .agent-chat-widget .bg-neutral-800,
        .agent-chat-widget form,
        .agent-chat-widget textarea,
        .agent-chat-widget input,
        /* Assistant message bubbles */
        .agent-chat-widget [class*="bg-neutral-100"],
        .agent-chat-widget [class*="bg-neutral-800"],
        .agent-chat-widget [class*="dark:bg-neutral-800"] {
          background-color: ${this.config.backgroundColor} !important;
        }
      `);
    }

    // Override internal border colors and thickness if specified
    if (this.config.internalBorderColor || this.config.internalBorderThickness) {
      const borderColor = this.config.internalBorderColor || this.config.borderColor || "#e5e7eb";
      const borderThickness = this.config.internalBorderThickness || "2px";
      cssRules.push(`
        .agent-chat-widget .border-neutral-300,
        .agent-chat-widget .border-neutral-700,
        .agent-chat-widget .dark\\:border-neutral-700,
        .agent-chat-widget .border-2,
        .agent-chat-widget .border-neutral-400,
        .agent-chat-widget textarea,
        .agent-chat-widget input,
        .agent-chat-widget form,
        /* Override focus border colors */
        .agent-chat-widget textarea:focus,
        .agent-chat-widget input:focus {
          border-color: ${borderColor} !important;
          border-width: ${borderThickness} !important;
        }
        /* Override focus ring to use internal border color */
        .agent-chat-widget textarea:focus,
        .agent-chat-widget input:focus {
          --tw-ring-color: ${borderColor} !important;
          ring-color: ${borderColor} !important;
        }
      `);
    } else if (this.config.borderColor) {
      // Fallback to outer border color for internal borders if no internal color specified
      cssRules.push(`
        .agent-chat-widget .border-neutral-300,
        .agent-chat-widget .border-neutral-700,
        .agent-chat-widget .dark\\:border-neutral-700,
        .agent-chat-widget .border-2,
        .agent-chat-widget textarea,
        .agent-chat-widget input,
        .agent-chat-widget textarea:focus,
        .agent-chat-widget input:focus {
          border-color: ${this.config.borderColor} !important;
        }
        .agent-chat-widget textarea:focus,
        .agent-chat-widget input:focus {
          --tw-ring-color: ${this.config.borderColor} !important;
          ring-color: ${this.config.borderColor} !important;
        }
      `);
    }

    if (cssRules.length > 0) {
      const style = document.createElement("style");
      style.id = "widget-custom-colors";
      style.textContent = cssRules.join("\n");
      shadow.appendChild(style);
    }
  }

  private adjustColorBrightness(color: string, percent: number): string {
    // Adjust color brightness by percentage (-100 to 100)
    // Handle both hex and rgba formats
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    
    if (rgbaMatch) {
      // RGBA format
      const r = parseInt(rgbaMatch[1]);
      const g = parseInt(rgbaMatch[2]);
      const b = parseInt(rgbaMatch[3]);
      const a = rgbaMatch[4] ? parseFloat(rgbaMatch[4]) : 1;
      
      const factor = 1 + percent / 100;
      const newR = Math.max(0, Math.min(255, Math.round(r * factor)));
      const newG = Math.max(0, Math.min(255, Math.round(g * factor)));
      const newB = Math.max(0, Math.min(255, Math.round(b * factor)));
      
      return `rgba(${newR}, ${newG}, ${newB}, ${a})`;
    } else {
      // Hex format
      const hex = color.replace("#", "");
      const num = parseInt(hex, 16);
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      
      const factor = 1 + percent / 100;
      const newR = Math.max(0, Math.min(255, Math.round(r * factor)));
      const newG = Math.max(0, Math.min(255, Math.round(g * factor)));
      const newB = Math.max(0, Math.min(255, Math.round(b * factor)));
      
      return `#${((1 << 24) + (newR << 16) + (newG << 8) + newB).toString(16).slice(1)}`;
    }
  }

  private extractRgb(color: string): string {
    // Extract RGB values from hex or rgba format for use in rgba() shadows
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbaMatch) {
      return `${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}`;
    }
    
    // Hex format
    const hex = color.replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  }

  private render() {
    if (!this.reactRoot || !this.config) {
      return;
    }

    // Apply container styles before rendering
    this.applyContainerStyles();

    this.reactRoot.render(
      <WidgetContainer config={this.config} baseUrl={this.baseUrl} />
    );
  }
}

// Register the custom element
if (typeof window !== "undefined" && !customElements.get("agent-chat-widget")) {
  customElements.define("agent-chat-widget", AgentChatWidget);
}
