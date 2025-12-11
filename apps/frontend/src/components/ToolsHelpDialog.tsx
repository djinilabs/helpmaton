import { type FC } from "react";

import { useEmailConnection } from "../hooks/useEmailConnection";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useMcpServers } from "../hooks/useMcpServers";
import type { Agent } from "../utils/api";

interface ToolsHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  agent?: Agent | null;
}

export const ToolsHelpDialog: FC<ToolsHelpDialogProps> = ({
  isOpen,
  onClose,
  workspaceId,
  agent,
}) => {
  const { data: emailConnection } = useEmailConnection(workspaceId);
  const { data: mcpServersData } = useMcpServers(workspaceId);

  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  const hasNotificationChannel = !!agent?.notificationChannelId;
  const hasEmailConnection = !!emailConnection;
  const hasDelegation =
    agent?.delegatableAgentIds && agent.delegatableAgentIds.length > 0;
  const enabledMcpServerIds = agent?.enabledMcpServerIds || [];
  const enabledMcpServers =
    mcpServersData?.servers.filter((server) =>
      enabledMcpServerIds.includes(server.id)
    ) || [];

  const tools = [
    {
      name: "search_documents",
      description:
        "Search workspace documents using semantic vector search. Returns the most relevant document snippets based on the query.",
      alwaysAvailable: true,
      condition: null,
      parameters: [
        {
          name: "query",
          type: "string",
          required: true,
          description:
            "The search terms to look for in the documents. Extract this directly from the user's request.",
        },
        {
          name: "topN",
          type: "number",
          required: false,
          description: "Number of top results to return (default: 5).",
        },
      ],
    },
    {
      name: "send_notification",
      description:
        "Send a notification through the configured notification channel (Discord, Slack, etc.).",
      alwaysAvailable: false,
      condition: hasNotificationChannel
        ? "Available (notification channel configured)"
        : "Not available (no notification channel configured)",
      parameters: [
        {
          name: "content",
          type: "string",
          required: true,
          description:
            "The notification message text to send. Must be a non-empty string.",
        },
      ],
    },
    {
      name: "send_email",
      description:
        "Send an email using the workspace email connection (Gmail, Outlook, or SMTP).",
      alwaysAvailable: false,
      condition: hasEmailConnection
        ? "Available (email connection configured)"
        : "Not available (no email connection configured)",
      parameters: [
        {
          name: "to",
          type: "string (email)",
          required: true,
          description:
            "The recipient email address. Must be a valid email address.",
        },
        {
          name: "subject",
          type: "string",
          required: true,
          description: "The email subject line. Must be a non-empty string.",
        },
        {
          name: "text",
          type: "string",
          required: true,
          description: "The plain text email body. Must be a non-empty string.",
        },
        {
          name: "html",
          type: "string",
          required: false,
          description:
            "The HTML email body (optional). If provided, this will be used instead of the plain text version.",
        },
        {
          name: "from",
          type: "string (email)",
          required: false,
          description:
            "The sender email address (optional). If not provided, the email connection's default sender will be used.",
        },
      ],
    },
    {
      name: "list_agents",
      description:
        "List all agents that this agent can delegate to. Returns agent names and IDs. You MUST call this tool FIRST before calling call_agent.",
      alwaysAvailable: false,
      condition: hasDelegation
        ? "Available (delegation configured)"
        : "Not available (no delegatable agents configured)",
      parameters: [],
    },
    {
      name: "call_agent",
      description:
        "Delegate a task to another agent by calling it with a message. The target agent will process the request and return a response. You MUST call list_agents FIRST to get the available agent IDs.",
      alwaysAvailable: false,
      condition: hasDelegation
        ? "Available (delegation configured)"
        : "Not available (no delegatable agents configured)",
      parameters: [
        {
          name: "agentId",
          type: "string",
          required: false,
          description:
            "The exact agent ID to delegate to (alternative to agent_id). You MUST call list_agents FIRST to get the available agent IDs.",
        },
        {
          name: "agent_id",
          type: "string",
          required: false,
          description:
            "The exact agent ID to delegate to (alternative to agentId). You MUST call list_agents FIRST to get the available agent IDs.",
        },
        {
          name: "message",
          type: "string",
          required: true,
          description:
            "The message or query to send to the delegated agent. This should be the specific task or question you want the other agent to handle.",
        },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white border border-neutral-200 rounded-2xl shadow-dramatic border-2 border-neutral-300 p-8 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-4xl font-black text-neutral-900">
            Available Tools
          </h2>
          <button
            onClick={onClose}
            className="border border-neutral-300 bg-white px-6 py-2 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 transition-colors"
          >
            Close
          </button>
        </div>

        <div className="mb-6 p-4 border border-yellow-200 rounded-lg bg-yellow-50">
          <p className="text-sm font-semibold text-yellow-800 mb-2">
            ⚠️ Important
          </p>
          <p className="text-sm text-yellow-900">
            Tool availability depends on your agent configuration. Tools marked
            as &quot;Not available&quot; will not be accessible to the agent.
            Configure the required settings in the agent detail page to enable
            them.
          </p>
        </div>

        <div className="space-y-4">
          {tools.map((tool) => (
            <div
              key={tool.name}
              className="border border-neutral-200 rounded-lg p-4 bg-white shadow-soft"
            >
              <div className="flex items-start justify-between mb-2">
                <code className="text-lg font-semibold font-mono border border-neutral-300 rounded bg-neutral-100 px-2 py-1 text-neutral-900">
                  {tool.name}
                </code>
                {tool.alwaysAvailable ? (
                  <span className="text-xs font-medium bg-green-100 border border-green-300 rounded px-2 py-1 text-green-800">
                    Always Available
                  </span>
                ) : (
                  <span
                    className={`text-xs font-medium rounded px-2 py-1 border ${
                      tool.condition?.includes("Available")
                        ? "bg-green-100 border-green-300 text-green-800"
                        : "bg-red-100 border-red-300 text-red-800"
                    }`}
                  >
                    {tool.condition?.includes("Available")
                      ? "Available"
                      : "Not Available"}
                  </span>
                )}
              </div>
              <p className="text-sm text-neutral-700 mb-3">
                {tool.description}
              </p>
              {!tool.alwaysAvailable && (
                <p
                  className={`text-xs font-medium rounded border px-2 py-1 inline-block mb-3 ${
                    tool.condition?.includes("Available")
                      ? "bg-green-50 border-green-200 text-green-800"
                      : "bg-red-50 border-red-200 text-red-800"
                  }`}
                >
                  {tool.condition}
                </p>
              )}
              <div className="mt-3 border border-neutral-200 rounded-lg p-3 bg-neutral-50">
                <p className="text-xs font-semibold text-neutral-900 mb-2">
                  Parameters:
                </p>
                {tool.parameters.length === 0 ? (
                  <p className="text-xs text-neutral-600">
                    No parameters required.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {tool.parameters.map((param, index) => (
                      <div
                        key={index}
                        className="border border-neutral-200 rounded p-2 bg-white"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <code className="text-xs font-medium font-mono border border-neutral-300 rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-900">
                            {param.name}
                          </code>
                          <span className="text-xs font-medium border border-neutral-300 rounded px-1.5 py-0.5 text-neutral-700">
                            {param.type}
                          </span>
                          {param.required ? (
                            <span className="text-xs font-medium bg-red-100 border border-red-300 rounded px-1.5 py-0.5 text-red-800">
                              Required
                            </span>
                          ) : (
                            <span className="text-xs font-medium bg-neutral-100 border border-neutral-300 rounded px-1.5 py-0.5 text-neutral-700">
                              Optional
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-600">
                          {param.description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {enabledMcpServers.length > 0 && (
            <div className="border border-neutral-200 rounded-lg p-4 bg-white shadow-soft">
              <h3 className="text-xl font-semibold text-neutral-900 mb-4">
                MCP Server Tools
              </h3>
              <div className="space-y-3">
                {enabledMcpServers.map((server) => {
                  const toolName = `mcp_${server.id.replace(
                    /[^a-zA-Z0-9]/g,
                    "_"
                  )}`;
                  return (
                    <div
                      key={server.id}
                      className="border border-neutral-200 rounded-lg p-4 bg-white"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <code className="text-lg font-semibold font-mono border border-neutral-300 rounded bg-neutral-100 px-2 py-1 text-neutral-900">
                          {toolName}
                        </code>
                        <span className="text-xs font-medium bg-green-100 border border-green-300 rounded px-2 py-1 text-green-800">
                          Available
                        </span>
                      </div>
                      <p className="text-sm text-neutral-700 mb-3">
                        Call the MCP server &quot;{server.name}&quot;. Provide
                        the MCP method name and optional parameters.
                      </p>
                      <p className="text-xs font-medium bg-green-50 border border-green-200 rounded px-2 py-1 inline-block mb-3 text-green-800">
                        Available (MCP server &quot;{server.name}&quot; enabled)
                      </p>
                      <div className="mt-3 border border-neutral-200 rounded-lg p-3 bg-neutral-50">
                        <p className="text-xs font-semibold text-neutral-900 mb-2">
                          Parameters:
                        </p>
                        <div className="space-y-2">
                          <div className="border border-neutral-200 rounded p-2 bg-white">
                            <div className="flex items-center gap-2 mb-1">
                              <code className="text-xs font-medium font-mono border border-neutral-300 rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-900">
                                method
                              </code>
                              <span className="text-xs font-medium border border-neutral-300 rounded px-1.5 py-0.5 text-neutral-700">
                                string
                              </span>
                              <span className="text-xs font-medium bg-red-100 border border-red-300 rounded px-1.5 py-0.5 text-red-800">
                                Required
                              </span>
                            </div>
                            <p className="text-xs text-neutral-600">
                              The MCP method to call.
                            </p>
                          </div>
                          <div className="border border-neutral-200 rounded p-2 bg-white">
                            <div className="flex items-center gap-2 mb-1">
                              <code className="text-xs font-medium font-mono border border-neutral-300 rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-900">
                                params
                              </code>
                              <span className="text-xs font-medium border border-neutral-300 rounded px-1.5 py-0.5 text-neutral-700">
                                object
                              </span>
                              <span className="text-xs font-medium bg-neutral-100 border border-neutral-300 rounded px-1.5 py-0.5 text-neutral-700">
                                Optional
                              </span>
                            </div>
                            <p className="text-xs text-neutral-600">
                              Optional parameters for the MCP method.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {enabledMcpServerIds.length === 0 && (
            <div className="border border-neutral-200 rounded-lg p-4 bg-neutral-50">
              <p className="text-sm font-semibold text-neutral-900 mb-2">
                MCP Server Tools
              </p>
              <p className="text-xs text-neutral-600">
                No MCP server tools available. Enable MCP servers in the agent
                configuration to make them available as tools.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
