import { useEffect, type FC, type ReactNode } from "react";

import { useTestAgentUrl } from "../hooks/useTestAgentUrl";
import { useToast } from "../hooks/useToast";

import { AgentChat } from "./AgentChat";
import { LoadingScreen } from "./LoadingScreen";

interface AgentChatWithFunctionUrlProps {
  workspaceId: string;
  agentId: string;
  /** When provided (e.g. for workspace agent or config agent), skips fetching agent from API */
  agent?: { name?: string; avatar?: string };
  onClear?: () => void;
  isEmbedded?: boolean;
  /** Optional stream path suffix (default "test"). Use "config/test" for meta-agent config chat. */
  streamPathSuffix?: string;
  /** Optional context-specific header for the chat (e.g. improve/change agent or workspace). */
  headerMessage?: ReactNode;
}

/**
 * Wrapper component that fetches the Function URL before rendering AgentChat.
 * This ensures the URL is available before the chat component initializes,
 * making Function URL usage deterministic.
 */
export const AgentChatWithFunctionUrl: FC<AgentChatWithFunctionUrlProps> = ({
  workspaceId,
  agentId,
  agent,
  onClear,
  isEmbedded = false,
  streamPathSuffix = "test",
  headerMessage,
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

  const buildTestUrl = (rawUrl: string) => {
    const normalized = rawUrl.replace(/\/+$/, "");
    const match = normalized.match(
      /^(https?:\/\/[^/]+)\/api\/(streams|workspaces)\/.*$/
    );
    const baseUrl = match ? match[1] : normalized;
    return `${baseUrl}/api/streams/${workspaceId}/${agentId}/${streamPathSuffix}`;
  };

  // Construct the full Function URL if available; fallback to same-origin path so config/test works when Function URL is missing
  const functionUrl = testAgentUrlData?.url
    ? buildTestUrl(testAgentUrlData.url)
    : undefined;
  const fallbackPath = `/api/streams/${workspaceId}/${agentId}/${streamPathSuffix}`;
  const apiUrl = functionUrl ?? fallbackPath;

  // Show loading while fetching the Function URL
  if (isLoading) {
    return <LoadingScreen />;
  }

  // Render AgentChat with the Function URL if available, otherwise use API Gateway path (same origin)
  return (
    <AgentChat
      workspaceId={workspaceId}
      agentId={agentId}
      agent={agent}
      api={apiUrl}
      onClear={onClear}
      isEmbedded={isEmbedded}
      headerMessage={headerMessage}
    />
  );
};
