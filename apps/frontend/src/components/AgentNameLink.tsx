import { type FC } from "react";
import { Link } from "react-router-dom";

import { useAgentOptional } from "../hooks/useAgents";

interface AgentNameLinkProps {
  workspaceId: string;
  agentId: string;
  className?: string;
}

/**
 * Component that displays an agent name with shortened ID in parenthesis.
 * Falls back to just the ID if the agent can't be loaded.
 */
export const AgentNameLink: FC<AgentNameLinkProps> = ({
  workspaceId,
  agentId,
  className = "font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300",
}) => {
  const { data: agent } = useAgentOptional(workspaceId, agentId, false);

  const shortId = agentId.substring(0, 8);
  const displayText = agent?.name
    ? `${agent.name} (${shortId}...)`
    : agentId;

  return (
    <Link
      to={`/workspaces/${workspaceId}/agents/${agentId}`}
      className={className}
    >
      {displayText}
    </Link>
  );
};
