import { FC } from "react";
// Import from frontend using path alias (configured in vite.config.ts)
import type { AgentChatProps } from "@/components/AgentChat";
import { AgentChat } from "@/components/AgentChat";
import type { WidgetConfig } from "./types";

interface WidgetContainerProps {
  config: WidgetConfig;
  baseUrl: string;
}

export const WidgetContainer: FC<WidgetContainerProps> = ({
  config,
  baseUrl,
}) => {
  // Construct the widget API endpoint URL
  const apiUrl = `${baseUrl}/api/widget/${config.workspaceId}/${config.agentId}/${config.apiKey}`;

  // Pass tools to AgentChat for execution
  const agentChatProps: AgentChatProps = {
    workspaceId: config.workspaceId,
    agentId: config.agentId,
    api: apiUrl,
    tools: config.tools,
  };

  return <AgentChat {...agentChatProps} />;
};
