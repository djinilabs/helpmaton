import "./AgentChatWidget"; // Import to register the custom element
import type { AgentWidgetInitOptions } from "./types";

// Global widget instance
let widgetInstance: HTMLElement | null = null;

/**
 * Initialize the Helpmaton agent widget
 * @param options - Widget configuration
 */
export function init(options: AgentWidgetInitOptions): void {
  // Validate required options
  if (!options.apiKey || !options.workspaceId || !options.agentId) {
    throw new Error(
      "AgentWidget.init requires apiKey, workspaceId, and agentId"
    );
  }

  if (!options.containerId) {
    throw new Error("AgentWidget.init requires containerId");
  }

  // Find the container element
  const container = document.getElementById(options.containerId);
  if (!container) {
    throw new Error(
      `Container with id "${options.containerId}" not found. Please create a container element with this ID.`
    );
  }

  // Remove existing widget if present
  if (widgetInstance) {
    widgetInstance.remove();
    widgetInstance = null;
  }

  // Create widget element
  const widgetElement = document.createElement("agent-chat-widget");
  
  // Set base URL if provided
  if (options.baseUrl) {
    widgetElement.setAttribute("data-base-url", options.baseUrl);
  }

  // Append to container (not body)
  container.appendChild(widgetElement);

  // Initialize widget
  // Wait for custom element to be defined if needed
  if (customElements.get("agent-chat-widget")) {
    (widgetElement as any).init({
      apiKey: options.apiKey,
      workspaceId: options.workspaceId,
      agentId: options.agentId,
      tools: options.tools,
      theme: options.theme,
    });
  } else {
    // If custom element not yet defined, wait for it
    customElements.whenDefined("agent-chat-widget").then(() => {
      (widgetElement as any).init({
        apiKey: options.apiKey,
        workspaceId: options.workspaceId,
        agentId: options.agentId,
        tools: options.tools,
        theme: options.theme,
      });
    });
  }

  widgetInstance = widgetElement;
}

// Export init function globally
if (typeof window !== "undefined") {
  (window as any).AgentWidget = { init };
}

// Also export as default for ES modules
export default { init };
