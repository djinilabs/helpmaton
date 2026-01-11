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
  // Pass a minimal agent object to prevent useAgent hook from making authenticated API calls
  // The widget context doesn't have authentication, so we avoid the API call entirely
  const agentChatProps: AgentChatProps = {
    workspaceId: config.workspaceId,
    agentId: config.agentId,
    api: apiUrl,
    tools: config.tools,
    agent: {
      // Minimal agent object - only fields used by AgentChat component
      // This prevents the useAgent hook from executing and failing due to lack of auth
      name: undefined, // Will use default if needed
      avatar: undefined, // Will use default avatar
    },
  };

  return <AgentChat {...agentChatProps} />;
};
