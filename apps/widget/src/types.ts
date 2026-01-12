export interface WidgetConfig {
  apiKey: string;
  workspaceId: string;
  agentId: string;
  tools?: Record<string, (...args: any[]) => Promise<any>>;
  theme?: "light" | "dark" | "auto";
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  borderRadius?: string;
  outerBorderEnabled?: boolean;
  internalBorderThickness?: string;
  internalBorderColor?: string;
}

export interface AgentWidgetInitOptions extends WidgetConfig {
  // Base URL for the API (defaults to current origin or https://app.helpmaton.com)
  baseUrl?: string;
  // Container ID where the widget should be placed (required)
  containerId: string;
  // Customization options are inherited from WidgetConfig
}
