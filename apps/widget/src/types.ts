export interface WidgetConfig {
  apiKey: string;
  workspaceId: string;
  agentId: string;
  tools?: Record<string, (...args: any[]) => Promise<any>>;
  theme?: "light" | "dark" | "auto";
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
}

export interface AgentWidgetInitOptions extends WidgetConfig {
  // Base URL for the API (defaults to current origin or https://app.helpmaton.com)
  baseUrl?: string;
}
