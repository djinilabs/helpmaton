import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FC } from "react";
// Import from frontend using path alias (configured in vite.config.ts)
import type { AgentChatProps } from "@/components/AgentChat";
import { AgentChat } from "@/components/AgentChat";
import type { WidgetConfig } from "./types";

// Create a QueryClient instance for the widget
// This is separate from the main app's QueryClient since the widget runs in isolation
const widgetQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors (client errors)
        if (
          error instanceof Error &&
          ["401", "403", "404", "410"].some((code) =>
            error.message.includes(code)
          )
        ) {
          return false;
        }
        // Retry once for other errors
        return failureCount < 1;
      },
      refetchOnWindowFocus: false, // Widget doesn't need to refetch on focus
      throwOnError: false, // Don't throw errors in widget context
    },
  },
});

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
    isWidget: true, // Mark as widget to hide test message and adjust styling
    agent: {
      // Minimal agent object - only fields used by AgentChat component
      // This prevents the useAgent hook from executing and failing due to lack of auth
      name: undefined, // Will use default if needed
      avatar: undefined, // Will use default avatar
    },
  };

  return (
    <QueryClientProvider client={widgetQueryClient}>
      <AgentChat {...agentChatProps} />
    </QueryClientProvider>
  );
};
