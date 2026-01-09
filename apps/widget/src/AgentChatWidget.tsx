import React from "react";
import { createRoot, type Root } from "react-dom/client";
import retargetEvents from "react-shadow-dom-retarget-events";
import { WidgetContainer } from "./widget-container";
import type { WidgetConfig } from "./types";

// Inject Tailwind CSS into shadow root
// For now, we'll use a minimal CSS approach or extract from main app
// TODO: Extract Tailwind CSS from main app build or bundle separately
const injectStyles = (shadowRoot: ShadowRoot): void => {
  const style = document.createElement("style");
  // Minimal styles - in production, inject full Tailwind CSS
  style.textContent = `
    /* Widget container styles */
    .agent-chat-widget {
      position: fixed;
      z-index: 9999;
      font-family: system-ui, -apple-system, sans-serif;
    }
    /* Position styles will be applied via inline styles */
  `;
  shadowRoot.appendChild(style);
};

export class AgentChatWidget extends HTMLElement {
  private reactRoot: Root | null = null;
  private config: WidgetConfig | null = null;
  private baseUrl: string;
  declare shadowRoot: ShadowRoot; // Declare shadowRoot (it's defined in HTMLElement)

  constructor() {
    super();
    // Create shadow DOM
    this.shadowRoot = this.attachShadow({ mode: "open" });
    
    // Determine base URL
    // Use data-base-url attribute if provided, otherwise use current origin or default
    const dataBaseUrl = this.getAttribute("data-base-url");
    this.baseUrl =
      dataBaseUrl ||
      (typeof window !== "undefined" && window.location.origin
        ? window.location.origin
        : "https://app.helpmaton.com");

    // Inject styles
    injectStyles(this.shadowRoot);

    // Create container for React
    const container = document.createElement("div");
    container.className = "agent-chat-widget";
    this.shadowRoot.appendChild(container);

    // Retarget events for React
    retargetEvents(this.shadowRoot);
  }

  connectedCallback() {
    // Initialize React root when element is connected
    if (!this.reactRoot && this.config) {
      const container = this.shadowRoot.querySelector(".agent-chat-widget");
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
    
    // Apply position styles
    const container = this.shadowRoot.querySelector(".agent-chat-widget");
    if (container) {
      const position = config.position || "bottom-right";
      const styles: Record<string, string> = {
        position: "fixed",
        zIndex: "9999",
      };

      switch (position) {
        case "bottom-right":
          styles.bottom = "20px";
          styles.right = "20px";
          break;
        case "bottom-left":
          styles.bottom = "20px";
          styles.left = "20px";
          break;
        case "top-right":
          styles.top = "20px";
          styles.right = "20px";
          break;
        case "top-left":
          styles.top = "20px";
          styles.left = "20px";
          break;
      }

      Object.assign((container as HTMLElement).style, styles);
    }

    // Render if already connected
    if (this.isConnected && !this.reactRoot) {
      const container = this.shadowRoot.querySelector(".agent-chat-widget");
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
