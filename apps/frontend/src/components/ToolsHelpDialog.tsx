import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useEffect, type FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
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
  const { registerDialog, unregisterDialog } = useDialogTracking();

  useEscapeKey(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  if (!isOpen) return null;

  const hasNotificationChannel = !!agent?.notificationChannelId;
  const hasEmailConnection = !!emailConnection;
  const hasDelegation =
    agent?.delegatableAgentIds && agent.delegatableAgentIds.length > 0;
  const hasMemorySearch = agent?.enableMemorySearch === true;
  const hasSearchDocuments = agent?.enableSearchDocuments === true;
  const hasSendEmail = agent?.enableSendEmail === true && hasEmailConnection;
  const hasSearchWeb =
    agent?.searchWebProvider === "tavily" ||
    agent?.searchWebProvider === "jina";
  const searchWebProvider = agent?.searchWebProvider;
  const hasFetchWeb =
    agent?.fetchWebProvider === "tavily" || agent?.fetchWebProvider === "jina";
  const fetchWebProvider = agent?.fetchWebProvider;
  const hasExaSearch = agent?.enableExaSearch === true;
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
      alwaysAvailable: false,
      condition: hasSearchDocuments
        ? "Available (document search enabled)"
        : "Not available (document search not enabled)",
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
      name: "search_memory",
      description:
        "Search the agent's factual memory across different time periods. Returns the most recent events prefixed by the date when they happened. Use this to recall past conversations, facts, and important information.",
      alwaysAvailable: false,
      condition: hasMemorySearch
        ? "Available (memory search enabled)"
        : "Not available (memory search not enabled)",
      parameters: [
        {
          name: "grain",
          type: "string (enum)",
          required: true,
          description:
            "The time grain to search: 'working' for most recent events, 'daily' for day summaries, 'weekly' for week summaries, 'monthly', 'quarterly', or 'yearly'.",
        },
        {
          name: "minimumDaysAgo",
          type: "number",
          required: false,
          description:
            "Minimum number of days ago to search from (0 = today). Defaults to 0.",
        },
        {
          name: "maximumDaysAgo",
          type: "number",
          required: false,
          description:
            "Maximum number of days ago to search from. Defaults to 365 (1 year).",
        },
        {
          name: "maxResults",
          type: "number",
          required: false,
          description:
            "Maximum number of results to return. Defaults to 10, maximum is 100.",
        },
        {
          name: "queryText",
          type: "string",
          required: false,
          description:
            "Optional text query for semantic search. If provided, will search for similar content. If not provided, returns most recent events.",
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
      condition: hasSendEmail
        ? "Available (email tool enabled and email connection configured)"
        : agent?.enableSendEmail === true && !hasEmailConnection
        ? "Not available (email tool enabled but no email connection configured)"
        : !agent?.enableSendEmail
        ? "Not available (email tool not enabled)"
        : "Not available (email tool not enabled and no email connection configured)",
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
        "List all agents that this agent can delegate to. Returns agent names, IDs, descriptions, capabilities, and model information. Use this to discover which agents are available and what they can do.",
      alwaysAvailable: false,
      condition: hasDelegation
        ? "Available (delegation configured)"
        : "Not available (no delegatable agents configured)",
      parameters: [],
    },
    {
      name: "call_agent",
      description:
        "Delegate a task to another agent synchronously. The target agent will process the request and return a response immediately. You can identify the target agent by agentId/agent_id or by query (semantic description like 'agent that can search documents'). Use this when you need an immediate response.",
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
            "The exact agent ID to delegate to (alternative to agent_id). Get this from list_agents or use the query parameter instead.",
        },
        {
          name: "agent_id",
          type: "string",
          required: false,
          description:
            "The exact agent ID to delegate to (alternative to agentId). Get this from list_agents or use the query parameter instead.",
        },
        {
          name: "query",
          type: "string",
          required: false,
          description:
            "Semantic query to find an agent (e.g., 'find an agent that can search documents'). The system will automatically match your query to the best agent. Mutually exclusive with agentId/agent_id.",
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
    {
      name: "call_agent_async",
      description:
        "Delegate a task to another agent asynchronously with status tracking. Returns immediately with a taskId that you can use to check status or retrieve results later. Use this when you don't need an immediate response. You can identify the target agent by agentId/agent_id or by query (semantic description).",
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
            "The exact agent ID to delegate to (alternative to agent_id). Get this from list_agents or use the query parameter instead.",
        },
        {
          name: "agent_id",
          type: "string",
          required: false,
          description:
            "The exact agent ID to delegate to (alternative to agentId). Get this from list_agents or use the query parameter instead.",
        },
        {
          name: "query",
          type: "string",
          required: false,
          description:
            "Semantic query to find an agent (e.g., 'find an agent that can search documents'). The system will automatically match your query to the best agent. Mutually exclusive with agentId/agent_id.",
        },
        {
          name: "message",
          type: "string",
          required: true,
          description:
            "The message or query to send to the delegated agent. This will be processed asynchronously.",
        },
      ],
    },
    {
      name: "check_delegation_status",
      description:
        "Check the status of an async delegation task. Returns the current status (pending, running, completed, failed, cancelled) and the result if completed, or error message if failed.",
      alwaysAvailable: false,
      condition: hasDelegation
        ? "Available (delegation configured)"
        : "Not available (no delegatable agents configured)",
      parameters: [
        {
          name: "taskId",
          type: "string",
          required: true,
          description: "The task ID returned by call_agent_async.",
        },
      ],
    },
    {
      name: "cancel_delegation",
      description:
        "Request cancellation of a pending or running async delegation task. Tasks that are already completed or failed cannot be cancelled. Cancelling a running task only marks it as cancelled and does not interrupt work that is already being processed.",
      alwaysAvailable: false,
      condition: hasDelegation
        ? "Available (delegation configured)"
        : "Not available (no delegatable agents configured)",
      parameters: [
        {
          name: "taskId",
          type: "string",
          required: true,
          description: "The task ID returned by call_agent_async.",
        },
      ],
    },
    {
      name: "search_web",
      description:
        searchWebProvider === "tavily"
          ? "Search the web for current information, news, articles, and other web content using Tavily search API. Use this when you need up-to-date information that isn't in your training data or when you need to find specific websites or resources. Cost: $0.008 per call (first 10 calls/day free for paid tiers)."
          : searchWebProvider === "jina"
          ? "Search the web for current information, news, articles, and other web content using Jina Search API. Use this when you need up-to-date information that isn't in your training data or when you need to find specific websites or resources. Free to use (no credits charged). Rate limits may apply."
          : "Search the web for current information, news, articles, and other web content. This tool can use either Tavily search API (costs credits) or Jina Search API (free). Use this when you need up-to-date information that isn't in your training data or when you need to find specific websites or resources.",
      alwaysAvailable: false,
      condition: hasSearchWeb
        ? `Available (${
            searchWebProvider === "tavily" ? "Tavily" : "Jina"
          } provider enabled)`
        : "Not available (web search not enabled)",
      parameters: [
        {
          name: "query",
          type: "string",
          required: true,
          description:
            "The search query. This MUST be a non-empty string containing what you want to search for. Example: 'latest news about AI' or 'Python tutorial for beginners'",
        },
        {
          name: "max_results",
          type: "number",
          required: false,
          description:
            "Maximum number of search results to return (1-10, default: 5). Use a smaller number for focused searches, larger for comprehensive research.",
        },
      ],
    },
    {
      name: "fetch_url",
      description:
        fetchWebProvider === "tavily"
          ? "Extract and summarize content from a web page URL using Tavily extract API. This tool allows you to get the main content, title, and metadata from any web page. Use this when you need to read and understand the content of a specific webpage. Cost: $0.008 per call (first 10 calls/day free for paid tiers)."
          : fetchWebProvider === "jina"
          ? "Extract and summarize content from a web page URL using Jina Reader API. This tool allows you to get the main content and title from any web page. Use this when you need to read and understand the content of a specific webpage. Free to use (no credits charged). Rate limits: may apply."
          : "Extract and summarize content from a web page URL. This tool can use either Tavily extract API (costs credits) or Jina Reader API (free). Use this when you need to read and understand the content of a specific webpage.",
      alwaysAvailable: false,
      condition: hasFetchWeb
        ? `Available (${
            fetchWebProvider === "tavily" ? "Tavily" : "Jina"
          } provider enabled)`
        : "Not available (web fetch not enabled)",
      parameters: [
        {
          name: "url",
          type: "string (URL)",
          required: true,
          description:
            "The URL to extract content from. This MUST be a valid URL starting with http:// or https://. Example: 'https://example.com/article'",
        },
      ],
    },
    {
      name: "search",
      description:
        "Search the web using Exa.ai with category-specific search. This tool allows you to search for specific types of content (companies, research papers, news, PDFs, GitHub repos, tweets, personal sites, people, or financial reports). Use this when you need to find specialized content that matches a specific category. Charges based on usage (cost varies by number of results).",
      alwaysAvailable: false,
      condition: hasExaSearch
        ? "Available (Exa search enabled)"
        : "Not available (Exa search not enabled)",
      parameters: [
        {
          name: "category",
          type: "string (enum)",
          required: true,
          description:
            "The search category. Must be one of: 'company', 'research paper', 'news', 'pdf', 'github', 'tweet', 'personal site', 'people', 'financial report'. This determines the type of content to search for.",
        },
        {
          name: "query",
          type: "string",
          required: true,
          description:
            "The search query. This MUST be a non-empty string containing what you want to search for. Example: 'latest AI research' or 'Apple Inc financial reports'",
        },
        {
          name: "num_results",
          type: "number",
          required: false,
          description:
            "Number of search results to return (1-100, default: 10). Use a smaller number for focused searches, larger for comprehensive research.",
        },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-4xl font-black text-neutral-900 dark:text-neutral-50">
            Available Tools
          </h2>
          <button
            onClick={onClose}
            className="rounded-xl border border-neutral-300 bg-white px-6 py-2 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            Close
          </button>
        </div>

        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-yellow-800 dark:text-yellow-200">
            <ExclamationTriangleIcon className="size-4" />
            Important
          </p>
          <p className="text-sm text-yellow-900 dark:text-yellow-100">
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
              className="rounded-lg border border-neutral-200 bg-white p-4 shadow-soft dark:border-neutral-700 dark:bg-neutral-900"
            >
              <div className="mb-2 flex items-start justify-between">
                <code className="rounded border border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-lg font-semibold text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                  {tool.name}
                </code>
                {tool.alwaysAvailable ? (
                  <span className="rounded border border-green-300 bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:border-green-700 dark:bg-green-900 dark:text-green-200">
                    Always Available
                  </span>
                ) : (
                  <span
                    className={`rounded border px-2 py-1 text-xs font-medium ${
                      tool.condition?.includes("Available")
                        ? "border-green-300 bg-green-100 text-green-800 dark:border-green-700 dark:bg-green-900 dark:text-green-200"
                        : "border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200"
                    }`}
                  >
                    {tool.condition?.includes("Available")
                      ? "Available"
                      : "Not Available"}
                  </span>
                )}
              </div>
              <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">
                {tool.description}
              </p>
              {!tool.alwaysAvailable && (
                <p
                  className={`mb-3 inline-block rounded border px-2 py-1 text-xs font-medium ${
                    tool.condition?.includes("Available")
                      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
                      : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                  }`}
                >
                  {tool.condition}
                </p>
              )}
              <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800">
                <p className="mb-2 text-xs font-semibold text-neutral-900 dark:text-neutral-50">
                  Parameters:
                </p>
                {tool.parameters.length === 0 ? (
                  <p className="text-xs text-neutral-600 dark:text-neutral-300">
                    No parameters required.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {tool.parameters.map((param, index) => (
                      <div
                        key={index}
                        className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900"
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <code className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs font-medium text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                            {param.name}
                          </code>
                          <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                            {param.type}
                          </span>
                          {param.required ? (
                            <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200">
                              Required
                            </span>
                          ) : (
                            <span className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                              Optional
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-600 dark:text-neutral-300">
                          {param.description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {enabledMcpServers.length > 0 && (() => {
            // Group servers by serviceType for conflict detection
            const serversByServiceType = new Map<
              string,
              Array<typeof enabledMcpServers[0]>
            >();

            for (const server of enabledMcpServers) {
              // Determine grouping key
              let groupKey: string;
              if (
                server.authType === "oauth" &&
                server.serviceType &&
                ["google-drive", "gmail", "google-calendar", "notion"].includes(
                  server.serviceType
                ) &&
                server.oauthConnected
              ) {
                // OAuth servers with specific serviceTypes
                groupKey = server.serviceType;
              } else {
                // Generic MCP servers (all grouped together)
                groupKey = "__generic__";
              }

              if (!serversByServiceType.has(groupKey)) {
                serversByServiceType.set(groupKey, []);
              }
              serversByServiceType.get(groupKey)!.push(server);
            }

            // Helper function to get tool name suffix
            const getToolNameSuffix = (server: typeof enabledMcpServers[0]) => {
              let groupKey: string;
              if (
                server.authType === "oauth" &&
                server.serviceType &&
                ["google-drive", "gmail", "google-calendar", "notion"].includes(
                  server.serviceType
                ) &&
                server.oauthConnected
              ) {
                groupKey = server.serviceType;
              } else {
                groupKey = "__generic__";
              }

              const sameTypeServers = serversByServiceType.get(groupKey) || [];
              const hasConflict = sameTypeServers.length > 1;
              const serverNameSanitized = server.name
                .replace(/[^a-zA-Z0-9]/g, "_")
                .toLowerCase();
              return hasConflict ? `_${serverNameSanitized}` : "";
            };

            return (
              <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
                <h3 className="mb-4 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
                  🔌 MCP Server Tools
                </h3>
                <div className="space-y-3">
                  {enabledMcpServers.map((server) => {
                    const suffix = getToolNameSuffix(server);
                    const isGoogleDrive =
                      server.authType === "oauth" &&
                      server.serviceType === "google-drive" &&
                      server.oauthConnected;
                    const isGmail =
                      server.authType === "oauth" &&
                      server.serviceType === "gmail" &&
                      server.oauthConnected;
                    const isGoogleCalendar =
                      server.authType === "oauth" &&
                      server.serviceType === "google-calendar" &&
                      server.oauthConnected;
                    const isNotion =
                      server.authType === "oauth" &&
                      server.serviceType === "notion" &&
                      server.oauthConnected;

                  if (isGoogleDrive) {
                    // Show specific Google Drive tools
                    const googleDriveTools = [
                      {
                        name: `google_drive_list${suffix}`,
                        description:
                          "List files in Google Drive. Returns a list of files with their metadata (id, name, mimeType, size, etc.). Supports pagination with pageToken.",
                        parameters: [
                          {
                            name: "query",
                            type: "string",
                            required: false,
                            description:
                              'Optional query string to filter files (e.g., \'mimeType="application/pdf"\')',
                          },
                          {
                            name: "pageToken",
                            type: "string",
                            required: false,
                            description:
                              "Optional page token for pagination (from previous list response)",
                          },
                        ],
                      },
                      {
                        name: `google_drive_read${suffix}`,
                        description:
                          "Read the content of a file from Google Drive. Supports text files, Google Docs (exports as plain text), Google Sheets (exports as CSV), and Google Slides (exports as plain text).",
                        parameters: [
                          {
                            name: "fileId",
                            type: "string",
                            required: true,
                            description: "The Google Drive file ID to read",
                          },
                          {
                            name: "mimeType",
                            type: "string",
                            required: false,
                            description:
                              "Optional MIME type for export. Defaults: text/plain for Google Docs and Slides, text/csv for Google Sheets. For other files, uses the file's MIME type.",
                          },
                        ],
                      },
                      {
                        name: `google_drive_search${suffix}`,
                        description:
                          "Search for files in Google Drive by name or content. Returns a list of matching files with their metadata.",
                        parameters: [
                          {
                            name: "query",
                            type: "string",
                            required: true,
                            description:
                              "REQUIRED: Search query string to find files by name or content. Example: 'budget report' or 'meeting notes'",
                          },
                          {
                            name: "pageToken",
                            type: "string",
                            required: false,
                            description:
                              "Optional page token for pagination (from previous search response)",
                          },
                        ],
                      },
                    ];

                    return (
                      <div key={server.id} className="space-y-3">
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
                          <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                            📁 Google Drive: {server.name}
                          </p>
                          <p className="mt-1 text-xs text-blue-800 dark:text-blue-200">
                            {server.oauthConnected
                              ? "Connected"
                              : "Not connected - connect to enable tools"}
                          </p>
                        </div>
                        {server.oauthConnected &&
                          googleDriveTools.map((tool) => (
                            <div
                              key={tool.name}
                              className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
                            >
                              <div className="mb-2 flex items-start justify-between">
                                <code className="rounded border border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-lg font-semibold text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                                  {tool.name}
                                </code>
                                <span className="rounded border border-green-300 bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:border-green-700 dark:bg-green-900 dark:text-green-200">
                                  Available
                                </span>
                              </div>
                              <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">
                                {tool.description}
                              </p>
                              <p className="mb-3 inline-block rounded border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                                Available (Google Drive &quot;{server.name}&quot;
                                connected)
                              </p>
                              <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800">
                                <p className="mb-2 text-xs font-semibold text-neutral-900 dark:text-neutral-50">
                                  Parameters:
                                </p>
                                <div className="space-y-2">
                                  {tool.parameters.map((param, index) => (
                                    <div
                                      key={index}
                                      className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900"
                                    >
                                      <div className="mb-1 flex items-center gap-2">
                                        <code className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs font-medium text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                                          {param.name}
                                        </code>
                                        <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                                          {param.type}
                                        </span>
                                        {param.required ? (
                                          <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200">
                                            Required
                                          </span>
                                        ) : (
                                          <span className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                                            Optional
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-neutral-600 dark:text-neutral-300">
                                        {param.description}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    );
                  }

                  if (isGmail) {
                    // Show specific Gmail tools
                    const gmailTools = [
                      {
                        name: `gmail_list${suffix}`,
                        description:
                          "List emails in Gmail. Returns a list of messages with their metadata (id, threadId, from, subject, date, snippet). Supports pagination with pageToken and optional search query.",
                        parameters: [
                          {
                            name: "query",
                            type: "string",
                            required: false,
                            description:
                              "Optional Gmail search query to filter messages (e.g., 'from:example@gmail.com', 'subject:meeting', 'is:unread')",
                          },
                          {
                            name: "pageToken",
                            type: "string",
                            required: false,
                            description:
                              "Optional page token for pagination (from previous list response)",
                          },
                        ],
                      },
                      {
                        name: `gmail_search${suffix}`,
                        description:
                          "Search for emails in Gmail using Gmail search syntax. Returns a list of matching messages with their metadata. Examples: 'from:example@gmail.com', 'subject:meeting', 'is:unread', 'has:attachment'.",
                        parameters: [
                          {
                            name: "query",
                            type: "string",
                            required: true,
                            description:
                              "REQUIRED: Gmail search query string. Examples: 'from:example@gmail.com', 'subject:meeting', 'is:unread', 'has:attachment', 'after:2024/1/1'",
                          },
                          {
                            name: "pageToken",
                            type: "string",
                            required: false,
                            description:
                              "Optional page token for pagination (from previous search response)",
                          },
                        ],
                      },
                      {
                        name: `gmail_read${suffix}`,
                        description:
                          "Read the full content of an email from Gmail. Returns the complete email with headers, body (text and HTML), and attachment information.",
                        parameters: [
                          {
                            name: "messageId",
                            type: "string",
                            required: true,
                            description: "The Gmail message ID to read",
                          },
                        ],
                      },
                    ];

                    return (
                      <div key={server.id} className="space-y-3">
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
                          <p className="text-sm font-semibold text-red-900 dark:text-red-100">
                            📧 Gmail: {server.name}
                          </p>
                          <p className="mt-1 text-xs text-red-800 dark:text-red-200">
                            {server.oauthConnected
                              ? "Connected"
                              : "Not connected - connect to enable tools"}
                          </p>
                        </div>
                        {server.oauthConnected &&
                          gmailTools.map((tool) => (
                            <div
                              key={tool.name}
                              className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
                            >
                              <div className="mb-2 flex items-start justify-between">
                                <code className="rounded border border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-lg font-semibold text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                                  {tool.name}
                                </code>
                                <span className="rounded border border-green-300 bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:border-green-700 dark:bg-green-900 dark:text-green-200">
                                  Available
                                </span>
                              </div>
                              <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">
                                {tool.description}
                              </p>
                              <p className="mb-3 inline-block rounded border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                                Available (Gmail &quot;{server.name}&quot;
                                connected)
                              </p>
                              <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800">
                                <p className="mb-2 text-xs font-semibold text-neutral-900 dark:text-neutral-50">
                                  Parameters:
                                </p>
                                <div className="space-y-2">
                                  {tool.parameters.map((param, index) => (
                                    <div
                                      key={index}
                                      className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900"
                                    >
                                      <div className="mb-1 flex items-center gap-2">
                                        <code className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs font-medium text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                                          {param.name}
                                        </code>
                                        <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                                          {param.type}
                                        </span>
                                        {param.required ? (
                                          <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200">
                                            Required
                                          </span>
                                        ) : (
                                          <span className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                                            Optional
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-neutral-600 dark:text-neutral-300">
                                        {param.description}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    );
                  }

                  if (isGoogleCalendar) {
                    // Show specific Google Calendar tools
                    const googleCalendarTools = [
                      {
                        name: `google_calendar_list${suffix}`,
                        description:
                          "List events from Google Calendar. Returns a list of events with their metadata (id, summary, start, end, etc.). Supports pagination with pageToken and optional time range filtering.",
                        parameters: [
                          {
                            name: "calendarId",
                            type: "string",
                            required: false,
                            description:
                              "Calendar ID (default: 'primary' for user's primary calendar)",
                          },
                          {
                            name: "timeMin",
                            type: "string",
                            required: false,
                            description:
                              "Lower bound (exclusive) for an event's start time in RFC3339 format (e.g., '2024-01-01T00:00:00Z')",
                          },
                          {
                            name: "timeMax",
                            type: "string",
                            required: false,
                            description:
                              "Upper bound (exclusive) for an event's end time in RFC3339 format (e.g., '2024-12-31T23:59:59Z')",
                          },
                          {
                            name: "maxResults",
                            type: "number",
                            required: false,
                            description:
                              "Maximum number of events to return (default: 100, max: 2500)",
                          },
                          {
                            name: "pageToken",
                            type: "string",
                            required: false,
                            description:
                              "Token specifying which result page to return (from previous list response)",
                          },
                        ],
                      },
                      {
                        name: `google_calendar_read${suffix}`,
                        description:
                          "Read the full details of an event from Google Calendar. Returns the complete event with all metadata including summary, description, start/end times, attendees, location, etc.",
                        parameters: [
                          {
                            name: "eventId",
                            type: "string",
                            required: true,
                            description: "The Google Calendar event ID to read",
                          },
                          {
                            name: "calendarId",
                            type: "string",
                            required: false,
                            description:
                              "Calendar ID (default: 'primary' for user's primary calendar)",
                          },
                        ],
                      },
                      {
                        name: `google_calendar_search${suffix}`,
                        description:
                          "Search for events in Google Calendar by query string. Returns a list of matching events with their metadata. The query searches in event summary, description, and location fields.",
                        parameters: [
                          {
                            name: "query",
                            type: "string",
                            required: true,
                            description:
                              "REQUIRED: Search query string to find events by summary, description, or location. Example: 'meeting' or 'project review'",
                          },
                          {
                            name: "calendarId",
                            type: "string",
                            required: false,
                            description:
                              "Calendar ID (default: 'primary' for user's primary calendar)",
                          },
                          {
                            name: "timeMin",
                            type: "string",
                            required: false,
                            description:
                              "Lower bound (exclusive) for an event's start time in RFC3339 format",
                          },
                          {
                            name: "timeMax",
                            type: "string",
                            required: false,
                            description:
                              "Upper bound (exclusive) for an event's end time in RFC3339 format",
                          },
                        ],
                      },
                      {
                        name: `google_calendar_create${suffix}`,
                        description:
                          "Create a new event in Google Calendar. Returns the created event with all metadata including the event ID.",
                        parameters: [
                          {
                            name: "summary",
                            type: "string",
                            required: true,
                            description: "REQUIRED: Event title/summary",
                          },
                          {
                            name: "description",
                            type: "string",
                            required: false,
                            description: "Event description",
                          },
                          {
                            name: "location",
                            type: "string",
                            required: false,
                            description: "Event location",
                          },
                          {
                            name: "start",
                            type: "object",
                            required: true,
                            description:
                              "REQUIRED: Event start time (dateTime in RFC3339 format or date in YYYY-MM-DD for all-day events)",
                          },
                          {
                            name: "end",
                            type: "object",
                            required: true,
                            description:
                              "REQUIRED: Event end time (dateTime in RFC3339 format or date in YYYY-MM-DD for all-day events)",
                          },
                          {
                            name: "attendees",
                            type: "array",
                            required: false,
                            description: "List of event attendees (email addresses)",
                          },
                        ],
                      },
                      {
                        name: `google_calendar_update${suffix}`,
                        description:
                          "Update an existing event in Google Calendar. Returns the updated event with all metadata. Only provide fields that should be updated.",
                        parameters: [
                          {
                            name: "eventId",
                            type: "string",
                            required: true,
                            description:
                              "REQUIRED: The Google Calendar event ID to update",
                          },
                          {
                            name: "summary",
                            type: "string",
                            required: false,
                            description: "Event title/summary",
                          },
                          {
                            name: "description",
                            type: "string",
                            required: false,
                            description: "Event description",
                          },
                          {
                            name: "location",
                            type: "string",
                            required: false,
                            description: "Event location",
                          },
                          {
                            name: "start",
                            type: "object",
                            required: false,
                            description: "Event start time",
                          },
                          {
                            name: "end",
                            type: "object",
                            required: false,
                            description: "Event end time",
                          },
                        ],
                      },
                      {
                        name: `google_calendar_delete${suffix}`,
                        description:
                          "Delete an event from Google Calendar. Returns a success message if the event was deleted.",
                        parameters: [
                          {
                            name: "eventId",
                            type: "string",
                            required: true,
                            description:
                              "REQUIRED: The Google Calendar event ID to delete",
                          },
                          {
                            name: "calendarId",
                            type: "string",
                            required: false,
                            description:
                              "Calendar ID (default: 'primary' for user's primary calendar)",
                          },
                        ],
                      },
                    ];

                    return (
                      <div key={server.id} className="space-y-3">
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
                          <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                            📅 Google Calendar: {server.name}
                          </p>
                          <p className="mt-1 text-xs text-blue-800 dark:text-blue-200">
                            {server.oauthConnected
                              ? "Connected"
                              : "Not connected - connect to enable tools"}
                          </p>
                        </div>
                        {server.oauthConnected &&
                          googleCalendarTools.map((tool) => (
                            <div
                              key={tool.name}
                              className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
                            >
                              <div className="mb-2 flex items-start justify-between">
                                <code className="rounded border border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-lg font-semibold text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                                  {tool.name}
                                </code>
                                <span className="rounded border border-green-300 bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:border-green-700 dark:bg-green-900 dark:text-green-200">
                                  Available
                                </span>
                              </div>
                              <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">
                                {tool.description}
                              </p>
                              <p className="mb-3 inline-block rounded border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                                Available (Google Calendar &quot;{server.name}&quot;
                                connected)
                              </p>
                              <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800">
                                <p className="mb-2 text-xs font-semibold text-neutral-900 dark:text-neutral-50">
                                  Parameters:
                                </p>
                                <div className="space-y-2">
                                  {tool.parameters.map((param, index) => (
                                    <div
                                      key={index}
                                      className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900"
                                    >
                                      <div className="mb-1 flex items-center gap-2">
                                        <code className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs font-medium text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                                          {param.name}
                                        </code>
                                        <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                                          {param.type}
                                        </span>
                                        {param.required ? (
                                          <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200">
                                            Required
                                          </span>
                                        ) : (
                                          <span className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                                            Optional
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-neutral-600 dark:text-neutral-300">
                                        {param.description}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    );
                  }

                  if (isNotion) {
                    // Show specific Notion tools
                    const notionTools = [
                      {
                        name: `notion_read${suffix}`,
                        description:
                          "Read a Notion page by its ID. Returns the full page content including properties, metadata, and URL.",
                        parameters: [
                          {
                            name: "pageId",
                            type: "string",
                            required: true,
                            description: "The Notion page ID to read",
                          },
                        ],
                      },
                      {
                        name: `notion_search${suffix}`,
                        description:
                          "Search for pages, databases, and data sources in Notion. Returns a list of matching results with their metadata. Empty query returns all accessible pages/databases.",
                        parameters: [
                          {
                            name: "query",
                            type: "string",
                            required: false,
                            description:
                              "Search query string (optional, empty query returns all accessible pages/databases)",
                          },
                          {
                            name: "filter",
                            type: "object",
                            required: false,
                            description:
                              "Filter results by object type (page, database, or data_source)",
                          },
                          {
                            name: "sort",
                            type: "object",
                            required: false,
                            description:
                              "Sort results by last edited time (ascending or descending)",
                          },
                          {
                            name: "startCursor",
                            type: "string",
                            required: false,
                            description:
                              "Pagination cursor from previous search response",
                          },
                          {
                            name: "pageSize",
                            type: "number",
                            required: false,
                            description:
                              "Maximum number of results to return (default: 100, max: 100)",
                          },
                        ],
                      },
                      {
                        name: `notion_create${suffix}`,
                        description:
                          "Create a new page in Notion. Supports simplified parameters: use 'name' for the page title and 'content' (string) for text content. The page will be created at workspace level by default. For advanced use, you can specify 'parent' (page, database, data source, or workspace), 'properties' (full Notion properties object), and 'children' (array of block objects).",
                        parameters: [
                          {
                            name: "name",
                            type: "string",
                            required: false,
                            description:
                              "Optional: Page title/name. If provided, will be used as the page title. If 'properties' is also provided, 'name' will be ignored.",
                          },
                          {
                            name: "content",
                            type: "string",
                            required: false,
                            description:
                              "Optional: Simple text content for the page. If provided, will be converted to paragraph blocks (split by newlines). If 'children' is also provided, 'content' will be ignored.",
                          },
                          {
                            name: "parent",
                            type: "object",
                            required: false,
                            description:
                              "Optional: Parent reference. If not provided, defaults to workspace level. Format: For 'workspace': { type: 'workspace', workspace: true }. For 'page_id': { type: 'page_id', page_id: 'page-uuid' }. For 'database_id': { type: 'database_id', database_id: 'database-uuid' }. For 'data_source_id': { type: 'data_source_id', data_source_id: 'datasource-uuid' }. For 'block_id': { type: 'block_id', block_id: 'block-uuid' }.",
                          },
                          {
                            name: "properties",
                            type: "object",
                            required: false,
                            description:
                              "Optional: Page properties object. If not provided but 'name' is provided, will create a title property. For database/data source pages, properties must match the schema.",
                          },
                          {
                            name: "children",
                            type: "array",
                            required: false,
                            description:
                              "Optional array of block objects to add as content to the page. Each block should have 'object': 'block', 'type' (e.g., 'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'code'), and type-specific properties. For paragraphs, use 'paragraph' type with 'text' array containing text objects with 'type': 'text' and 'text': { 'content': 'your text' }.",
                          },
                        ],
                      },
                      {
                        name: `notion_update${suffix}`,
                        description:
                          "Update a Notion page's properties. Only provide the properties that should be updated.",
                        parameters: [
                          {
                            name: "pageId",
                            type: "string",
                            required: true,
                            description: "REQUIRED: The Notion page ID to update",
                          },
                          {
                            name: "properties",
                            type: "object",
                            required: false,
                            description:
                              "Properties to update (optional, only include fields to change)",
                          },
                          {
                            name: "archived",
                            type: "boolean",
                            required: false,
                            description: "Set to true to archive the page",
                          },
                        ],
                      },
                      {
                        name: `notion_query_database${suffix}`,
                        description:
                          "Query a Notion database to retrieve pages that match the specified filters and sorts.",
                        parameters: [
                          {
                            name: "databaseId",
                            type: "string",
                            required: true,
                            description: "REQUIRED: The Notion database ID to query",
                          },
                          {
                            name: "filter",
                            type: "object",
                            required: false,
                            description: "Filter object to match pages (optional)",
                          },
                          {
                            name: "sorts",
                            type: "array",
                            required: false,
                            description: "Array of sort objects (optional)",
                          },
                          {
                            name: "startCursor",
                            type: "string",
                            required: false,
                            description:
                              "Pagination cursor from previous query response",
                          },
                          {
                            name: "pageSize",
                            type: "number",
                            required: false,
                            description:
                              "Maximum number of results to return (default: 100, max: 100)",
                          },
                        ],
                      },
                      {
                        name: `notion_create_database_page${suffix}`,
                        description:
                          "Create a new page in a Notion database. Properties must match the database schema.",
                        parameters: [
                          {
                            name: "databaseId",
                            type: "string",
                            required: true,
                            description: "REQUIRED: The Notion database ID",
                          },
                          {
                            name: "properties",
                            type: "object",
                            required: true,
                            description:
                              "REQUIRED: Page properties object that matches the database schema",
                          },
                        ],
                      },
                      {
                        name: `notion_update_database_page${suffix}`,
                        description:
                          "Update a page in a Notion database. Only provide the properties that should be updated.",
                        parameters: [
                          {
                            name: "pageId",
                            type: "string",
                            required: true,
                            description: "REQUIRED: The Notion page ID to update",
                          },
                          {
                            name: "properties",
                            type: "object",
                            required: true,
                            description:
                              "Properties to update (must match database schema)",
                          },
                        ],
                      },
                      {
                        name: `notion_append_blocks${suffix}`,
                        description:
                          "Append content blocks (paragraphs, headings, lists, etc.) to an existing Notion page. Use this to add text, headings, lists, and other content to a page after it's been created.",
                        parameters: [
                          {
                            name: "pageId",
                            type: "string",
                            required: true,
                            description: "REQUIRED: The Notion page ID to append blocks to",
                          },
                          {
                            name: "children",
                            type: "array",
                            required: true,
                            description:
                              "REQUIRED: Array of block objects to append. Each block should have 'object': 'block', 'type' (e.g., 'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'code'), and type-specific properties. For paragraphs, use 'paragraph' type with 'text' array containing text objects with 'type': 'text' and 'text': { 'content': 'your text' }.",
                          },
                          {
                            name: "after",
                            type: "string",
                            required: false,
                            description:
                              "Optional block ID to insert blocks after. If not provided, blocks are appended at the end.",
                          },
                        ],
                      },
                    ];

                    return (
                      <div key={server.id} className="space-y-3">
                        <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950">
                          <p className="text-sm font-semibold text-purple-900 dark:text-purple-100">
                            📝 Notion: {server.name}
                          </p>
                          <p className="mt-1 text-xs text-purple-800 dark:text-purple-200">
                            {server.oauthConnected
                              ? "Connected"
                              : "Not connected - connect to enable tools"}
                          </p>
                        </div>
                        {server.oauthConnected &&
                          notionTools.map((tool) => (
                            <div
                              key={tool.name}
                              className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
                            >
                              <div className="mb-2 flex items-start justify-between">
                                <code className="rounded border border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-lg font-semibold text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                                  {tool.name}
                                </code>
                                <span className="rounded border border-green-300 bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:border-green-700 dark:bg-green-900 dark:text-green-200">
                                  Available
                                </span>
                              </div>
                              <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">
                                {tool.description}
                              </p>
                              <p className="mb-3 inline-block rounded border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                                Available (Notion &quot;{server.name}&quot;
                                connected)
                              </p>
                              <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800">
                                <p className="mb-2 text-xs font-semibold text-neutral-900 dark:text-neutral-50">
                                  Parameters:
                                </p>
                                <div className="space-y-2">
                                  {tool.parameters.map((param, index) => (
                                    <div
                                      key={index}
                                      className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900"
                                    >
                                      <div className="mb-1 flex items-center gap-2">
                                        <code className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs font-medium text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                                          {param.name}
                                        </code>
                                        <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                                          {param.type}
                                        </span>
                                        {param.required ? (
                                          <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200">
                                            Required
                                          </span>
                                        ) : (
                                          <span className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                                            Optional
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-neutral-600 dark:text-neutral-300">
                                        {param.description}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    );
                  }

                  // Generic MCP server tool
                  const serverNameSanitized = server.name
                    .replace(/[^a-zA-Z0-9]/g, "_")
                    .toLowerCase();
                  const toolName = `mcp_${serverNameSanitized}`;
                  return (
                    <div
                      key={server.id}
                      className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <div className="mb-2 flex items-start justify-between">
                        <code className="rounded border border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-lg font-semibold text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                          {toolName}
                        </code>
                        <span className="rounded border border-green-300 bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:border-green-700 dark:bg-green-900 dark:text-green-200">
                          Available
                        </span>
                      </div>
                      <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">
                        Call the MCP server &quot;{server.name}&quot;. Provide
                        the MCP method name and optional parameters.
                      </p>
                      <p className="mb-3 inline-block rounded border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                        Available (MCP server &quot;{server.name}&quot; enabled)
                      </p>
                      <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800">
                        <p className="mb-2 text-xs font-semibold text-neutral-900 dark:text-neutral-50">
                          Parameters:
                        </p>
                        <div className="space-y-2">
                          <div className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
                            <div className="mb-1 flex items-center gap-2">
                              <code className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs font-medium text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                                method
                              </code>
                              <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                                string
                              </span>
                              <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200">
                                Required
                              </span>
                            </div>
                            <p className="text-xs text-neutral-600 dark:text-neutral-300">
                              The MCP method to call.
                            </p>
                          </div>
                          <div className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
                            <div className="mb-1 flex items-center gap-2">
                              <code className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs font-medium text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                                params
                              </code>
                              <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                                object
                              </span>
                              <span className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                                Optional
                              </span>
                            </div>
                            <p className="text-xs text-neutral-600 dark:text-neutral-300">
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
            );
          })()}

          {enabledMcpServerIds.length === 0 && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
              <p className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                🔌 MCP Server Tools
              </p>
              <p className="text-xs text-neutral-600 dark:text-neutral-300">
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
