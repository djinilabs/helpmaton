import { useEffect, type FC } from "react";

import { useTestAgentUrl } from "../hooks/useTestAgentUrl";
import { useToast } from "../hooks/useToast";

import { AgentChat } from "./AgentChat";
import { LoadingScreen } from "./LoadingScreen";

interface AgentChatWithFunctionUrlProps {
  workspaceId: string;
  agentId: string;
  onClear?: () => void;
}

/**
 * Wrapper component that fetches the Function URL before rendering AgentChat.
 * This ensures the URL is available before the chat component initializes,
 * making Function URL usage deterministic.
 */
export const AgentChatWithFunctionUrl: FC<AgentChatWithFunctionUrlProps> = ({
  workspaceId,
  agentId,
  onClear,
}) => {
  const toast = useToast();
  const { data: testAgentUrlData, isLoading, error } = useTestAgentUrl();

  // Display error toast when stream URL fetch fails (non-404 errors)
  useEffect(() => {
    if (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to fetch streaming function URL";
      toast.error(
        `Unable to connect to streaming service: ${errorMessage}. Falling back to API Gateway.`
      );
    }
  }, [error, toast]);

  // Construct the full Function URL if available
  const functionUrl = testAgentUrlData?.url
    ? `${testAgentUrlData.url.replace(/\/+$/, "")}/api/workspaces/${workspaceId}/agents/${agentId}/test`
    : undefined;

  // Show loading while fetching the Function URL
  if (isLoading) {
    return <LoadingScreen />;
  }

  // Render AgentChat with the Function URL if available, otherwise it will use API Gateway
  return (
    <AgentChat
      workspaceId={workspaceId}
      agentId={agentId}
      api={functionUrl}
      onClear={onClear}
    />
  );
};

