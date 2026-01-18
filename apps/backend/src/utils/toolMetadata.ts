/**
 * Tool Metadata Library
 * 
 * This library provides a single source of truth for tool definitions,
 * ensuring that the UI and backend stay in sync when displaying available tools.
 */

export interface ToolParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ToolMetadata {
  name: string;
  description: string;
  category: string;
  alwaysAvailable: boolean;
  condition?: string;
  parameters: ToolParameter[];
}

export interface McpServerInfo {
  id: string;
  name: string;
  serviceType?: string;
  authType: string;
  oauthConnected?: boolean;
}

export interface ToolListOptions {
  agent: {
    enableSearchDocuments?: boolean;
    enableMemorySearch?: boolean;
    notificationChannelId?: string;
    enableSendEmail?: boolean;
    searchWebProvider?: "tavily" | "jina" | null;
    fetchWebProvider?: "tavily" | "jina" | "scrape" | null;
    enableExaSearch?: boolean;
    delegatableAgentIds?: string[];
    enabledMcpServerIds?: string[];
    clientTools?: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>;
  };
  workspaceId: string;
  enabledMcpServers?: McpServerInfo[];
  emailConnection?: boolean;
}

export interface GroupedToolMetadata {
  category: string;
  tools: ToolMetadata[];
}

/**
 * Get metadata for all standard (non-MCP) tools
 */
function getStandardToolMetadata(
  options: ToolListOptions
): ToolMetadata[] {
  const { agent, emailConnection } = options;
  const tools: ToolMetadata[] = [];

  // Core Tools
  tools.push({
    name: "get_datetime",
    description:
      "Get the current date and time. Returns the current date and time in ISO 8601 format.",
    category: "Core Tools",
    alwaysAvailable: true,
    parameters: [],
  });

  // Document Tools
  if (agent.enableSearchDocuments) {
    tools.push({
      name: "search_documents",
      description:
        "Search workspace documents using semantic vector search. Returns the most relevant document snippets based on the query.",
      category: "Document Tools",
      alwaysAvailable: false,
      condition: "Available (document search enabled)",
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
    });
  } else {
    tools.push({
      name: "search_documents",
      description:
        "Search workspace documents using semantic vector search. Returns the most relevant document snippets based on the query.",
      category: "Document Tools",
      alwaysAvailable: false,
      condition: "Not available (document search not enabled)",
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
    });
  }

  if (agent.enableMemorySearch) {
    tools.push({
      name: "search_memory",
      description:
        "Search the agent's factual memory across different time periods. Returns the most recent events prefixed by the date when they happened. Use this to recall past conversations, facts, and important information.",
      category: "Document Tools",
      alwaysAvailable: false,
      condition: "Available (memory search enabled)",
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
    });
  } else {
    tools.push({
      name: "search_memory",
      description:
        "Search the agent's factual memory across different time periods. Returns the most recent events prefixed by the date when they happened. Use this to recall past conversations, facts, and important information.",
      category: "Document Tools",
      alwaysAvailable: false,
      condition: "Not available (memory search not enabled)",
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
    });
  }

  // Communication Tools
  if (agent.notificationChannelId) {
    tools.push({
      name: "send_notification",
      description:
        "Send a notification through the configured notification channel (Discord, Slack, etc.).",
      category: "Communication Tools",
      alwaysAvailable: false,
      condition: "Available (notification channel configured)",
      parameters: [
        {
          name: "content",
          type: "string",
          required: true,
          description:
            "The notification message text to send. Must be a non-empty string.",
        },
      ],
    });
  } else {
    tools.push({
      name: "send_notification",
      description:
        "Send a notification through the configured notification channel (Discord, Slack, etc.).",
      category: "Communication Tools",
      alwaysAvailable: false,
      condition: "Not available (no notification channel configured)",
      parameters: [
        {
          name: "content",
          type: "string",
          required: true,
          description:
            "The notification message text to send. Must be a non-empty string.",
        },
      ],
    });
  }

  const hasSendEmail =
    agent.enableSendEmail === true && emailConnection === true;
  if (hasSendEmail) {
    tools.push({
      name: "send_email",
      description:
        "Send an email using the workspace email connection (Gmail, Outlook, or SMTP).",
      category: "Communication Tools",
      alwaysAvailable: false,
      condition:
        "Available (email tool enabled and email connection configured)",
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
          description:
            "The plain text email body. Must be a non-empty string.",
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
    });
  } else {
    let condition = "Not available (email tool not enabled)";
    if (agent.enableSendEmail === true && !emailConnection) {
      condition =
        "Not available (email tool enabled but no email connection configured)";
    } else if (!agent.enableSendEmail && emailConnection) {
      condition = "Not available (email tool not enabled)";
    } else {
      condition =
        "Not available (email tool not enabled and no email connection configured)";
    }
    tools.push({
      name: "send_email",
      description:
        "Send an email using the workspace email connection (Gmail, Outlook, or SMTP).",
      category: "Communication Tools",
      alwaysAvailable: false,
      condition,
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
          description:
            "The plain text email body. Must be a non-empty string.",
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
    });
  }

  // Delegation Tools
  const hasDelegation =
    agent.delegatableAgentIds && agent.delegatableAgentIds.length > 0;
  if (hasDelegation) {
    tools.push({
      name: "list_agents",
      description:
        "List all agents that this agent can delegate to. Returns agent names, IDs, descriptions, capabilities, and model information. Use this to discover which agents are available and what they can do.",
      category: "Delegation Tools",
      alwaysAvailable: false,
      condition: "Available (delegation configured)",
      parameters: [],
    });

    tools.push({
      name: "call_agent",
      description:
        "Delegate a task to another agent synchronously. The target agent will process the request and return a response immediately. You can identify the target agent by agentId/agent_id or by query (semantic description like 'agent that can search documents'). Use this when you need an immediate response.",
      category: "Delegation Tools",
      alwaysAvailable: false,
      condition: "Available (delegation configured)",
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
    });

    tools.push({
      name: "call_agent_async",
      description:
        "Delegate a task to another agent asynchronously with status tracking. Returns immediately with a taskId that you can use to check status or retrieve results later. Use this when you don't need an immediate response. You can identify the target agent by agentId/agent_id or by query (semantic description).",
      category: "Delegation Tools",
      alwaysAvailable: false,
      condition: "Available (delegation configured)",
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
    });

    tools.push({
      name: "check_delegation_status",
      description:
        "Check the status of an async delegation task. Returns the current status (pending, running, completed, failed, cancelled) and the result if completed, or error message if failed.",
      category: "Delegation Tools",
      alwaysAvailable: false,
      condition: "Available (delegation configured)",
      parameters: [
        {
          name: "taskId",
          type: "string",
          required: true,
          description: "The task ID returned by call_agent_async.",
        },
      ],
    });

    tools.push({
      name: "cancel_delegation",
      description:
        "Request cancellation of a pending or running async delegation task. Tasks that are already completed or failed cannot be cancelled. Cancelling a running task only marks it as cancelled and does not interrupt work that is already being processed.",
      category: "Delegation Tools",
      alwaysAvailable: false,
      condition: "Available (delegation configured)",
      parameters: [
        {
          name: "taskId",
          type: "string",
          required: true,
          description: "The task ID returned by call_agent_async.",
        },
      ],
    });
  } else {
    tools.push({
      name: "list_agents",
      description:
        "List all agents that this agent can delegate to. Returns agent names, IDs, descriptions, capabilities, and model information. Use this to discover which agents are available and what they can do.",
      category: "Delegation Tools",
      alwaysAvailable: false,
      condition: "Not available (no delegatable agents configured)",
      parameters: [],
    });

    tools.push({
      name: "call_agent",
      description:
        "Delegate a task to another agent synchronously. The target agent will process the request and return a response immediately. You can identify the target agent by agentId/agent_id or by query (semantic description like 'agent that can search documents'). Use this when you need an immediate response.",
      category: "Delegation Tools",
      alwaysAvailable: false,
      condition: "Not available (no delegatable agents configured)",
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
    });

    tools.push({
      name: "call_agent_async",
      description:
        "Delegate a task to another agent asynchronously with status tracking. Returns immediately with a taskId that you can use to check status or retrieve results later. Use this when you don't need an immediate response. You can identify the target agent by agentId/agent_id or by query (semantic description).",
      category: "Delegation Tools",
      alwaysAvailable: false,
      condition: "Not available (no delegatable agents configured)",
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
    });

    tools.push({
      name: "check_delegation_status",
      description:
        "Check the status of an async delegation task. Returns the current status (pending, running, completed, failed, cancelled) and the result if completed, or error message if failed.",
      category: "Delegation Tools",
      alwaysAvailable: false,
      condition: "Not available (no delegatable agents configured)",
      parameters: [
        {
          name: "taskId",
          type: "string",
          required: true,
          description: "The task ID returned by call_agent_async.",
        },
      ],
    });

    tools.push({
      name: "cancel_delegation",
      description:
        "Request cancellation of a pending or running async delegation task. Tasks that are already completed or failed cannot be cancelled. Cancelling a running task only marks it as cancelled and does not interrupt work that is already being processed.",
      category: "Delegation Tools",
      alwaysAvailable: false,
      condition: "Not available (no delegatable agents configured)",
      parameters: [
        {
          name: "taskId",
          type: "string",
          required: true,
          description: "The task ID returned by call_agent_async.",
        },
      ],
    });
  }

  // Web Tools
  const hasSearchWeb =
    agent.searchWebProvider === "tavily" ||
    agent.searchWebProvider === "jina";
  const searchWebProvider = agent.searchWebProvider;
  if (hasSearchWeb) {
    const providerName = searchWebProvider === "tavily" ? "Tavily" : "Jina";
    const description =
      searchWebProvider === "tavily"
        ? "Search the web for current information, news, articles, and other web content using Tavily search API. Use this when you need up-to-date information that isn't in your training data or when you need to find specific websites or resources. Cost: $0.008 per call (first 10 calls/day free for paid tiers)."
        : "Search the web for current information, news, articles, and other web content using Jina Search API. Use this when you need up-to-date information that isn't in your training data or when you need to find specific websites or resources. Free to use (no credits charged). Rate limits may apply.";

    tools.push({
      name: "search_web",
      description,
      category: "Web Tools",
      alwaysAvailable: false,
      condition: `Available (${providerName} provider enabled)`,
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
    });
  } else {
    tools.push({
      name: "search_web",
      description:
        "Search the web for current information, news, articles, and other web content. This tool can use either Tavily search API (costs credits) or Jina Search API (free). Use this when you need up-to-date information that isn't in your training data or when you need to find specific websites or resources.",
      category: "Web Tools",
      alwaysAvailable: false,
      condition: "Not available (web search not enabled)",
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
    });
  }

  const hasFetchWeb =
    agent.fetchWebProvider === "tavily" ||
    agent.fetchWebProvider === "jina";
  const fetchWebProvider = agent.fetchWebProvider;
  if (hasFetchWeb) {
    const providerName = fetchWebProvider === "tavily" ? "Tavily" : "Jina";
    const description =
      fetchWebProvider === "tavily"
        ? "Extract and summarize content from a web page URL using Tavily extract API. This tool allows you to get the main content, title, and metadata from any web page. Use this when you need to read and understand the content of a specific webpage. Cost: $0.008 per call (first 10 calls/day free for paid tiers)."
        : "Extract and summarize content from a web page URL using Jina Reader API. This tool allows you to get the main content and title from any web page. Use this when you need to read and understand the content of a specific webpage. Free to use (no credits charged). Rate limits: may apply.";

    tools.push({
      name: "fetch_url",
      description,
      category: "Web Tools",
      alwaysAvailable: false,
      condition: `Available (${providerName} provider enabled)`,
      parameters: [
        {
          name: "url",
          type: "string (URL)",
          required: true,
          description:
            "The URL to extract content from. This MUST be a valid URL starting with http:// or https://. Example: 'https://example.com/article'",
        },
      ],
    });
  } else {
    tools.push({
      name: "fetch_url",
      description:
        "Extract and summarize content from a web page URL. This tool can use either Tavily extract API (costs credits) or Jina Reader API (free). Use this when you need to read and understand the content of a specific webpage.",
      category: "Web Tools",
      alwaysAvailable: false,
      condition: "Not available (web fetch not enabled)",
      parameters: [
        {
          name: "url",
          type: "string (URL)",
          required: true,
          description:
            "The URL to extract content from. This MUST be a valid URL starting with http:// or https://. Example: 'https://example.com/article'",
        },
      ],
    });
  }

  if (agent.enableExaSearch) {
    tools.push({
      name: "search",
      description:
        "Search the web using Exa.ai with category-specific search. This tool allows you to search for specific types of content (companies, research papers, news, PDFs, GitHub repos, tweets, personal sites, people, or financial reports). Use this when you need to find specialized content that matches a specific category. Charges based on usage (cost varies by number of results).",
      category: "Web Tools",
      alwaysAvailable: false,
      condition: "Available (Exa search enabled)",
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
    });
  } else {
    tools.push({
      name: "search",
      description:
        "Search the web using Exa.ai with category-specific search. This tool allows you to search for specific types of content (companies, research papers, news, PDFs, GitHub repos, tweets, personal sites, people, or financial reports). Use this when you need to find specialized content that matches a specific category. Charges based on usage (cost varies by number of results).",
      category: "Web Tools",
      alwaysAvailable: false,
      condition: "Not available (Exa search not enabled)",
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
    });
  }

  return tools;
}

/**
 * Get metadata for MCP server tools based on service type
 */
function getMcpServerToolMetadata(
  serviceType: string,
  serverName: string,
  suffix: string,
  oauthConnected: boolean
): ToolMetadata[] {
  const tools: ToolMetadata[] = [];

  if (serviceType === "google-drive") {
    const condition = oauthConnected
      ? `Available (Google Drive "${serverName}" connected)`
      : `Not available (Google Drive "${serverName}" not connected)`;

    tools.push({
      name: `google_drive_list${suffix}`,
      description:
        "List files in Google Drive. Returns a list of files with their metadata (id, name, mimeType, size, etc.). Supports pagination with pageToken.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `google_drive_read${suffix}`,
      description:
        "Read the content of a file from Google Drive. Supports text files, Google Docs (exports as plain text), Google Sheets (exports as CSV), and Google Slides (exports as plain text).",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `google_drive_search${suffix}`,
      description:
        "Search for files in Google Drive by name or content. Returns a list of matching files with their metadata.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });
  } else if (serviceType === "gmail") {
    const condition = oauthConnected
      ? `Available (Gmail "${serverName}" connected)`
      : `Not available (Gmail "${serverName}" not connected)`;

    tools.push({
      name: `gmail_list${suffix}`,
      description:
        "List emails in Gmail. Returns a list of messages with their metadata (id, threadId, from, subject, date, snippet). Supports pagination with pageToken and optional search query.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `gmail_search${suffix}`,
      description:
        "Search for emails in Gmail using Gmail search syntax. Returns a list of matching messages with their metadata. Examples: 'from:example@gmail.com', 'subject:meeting', 'is:unread', 'has:attachment'.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `gmail_read${suffix}`,
      description:
        "Read the full content of an email from Gmail. Returns the complete email with headers, body (text and HTML), and attachment information.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "messageId",
          type: "string",
          required: true,
          description: "The Gmail message ID to read",
        },
      ],
    });
  } else if (serviceType === "google-calendar") {
    const condition = oauthConnected
      ? `Available (Google Calendar "${serverName}" connected)`
      : `Not available (Google Calendar "${serverName}" not connected)`;

    tools.push({
      name: `google_calendar_list${suffix}`,
      description:
        "List events from Google Calendar. Returns a list of events with their metadata (id, summary, start, end, etc.). Supports pagination with pageToken and optional time range filtering.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `google_calendar_read${suffix}`,
      description:
        "Read the full details of an event from Google Calendar. Returns the complete event with all metadata including summary, description, start/end times, attendees, location, etc.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `google_calendar_search${suffix}`,
      description:
        "Search for events in Google Calendar by query string. Returns a list of matching events with their metadata. The query searches in event summary, description, and location fields.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `google_calendar_create${suffix}`,
      description:
        "Create a new event in Google Calendar. Returns the created event with all metadata including the event ID.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `google_calendar_update${suffix}`,
      description:
        "Update an existing event in Google Calendar. Returns the updated event with all metadata. Only provide fields that should be updated.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `google_calendar_delete${suffix}`,
      description:
        "Delete an event from Google Calendar. Returns a success message if the event was deleted.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });
  } else if (serviceType === "notion") {
    const condition = oauthConnected
      ? `Available (Notion "${serverName}" connected)`
      : `Not available (Notion "${serverName}" not connected)`;

    tools.push({
      name: `notion_read${suffix}`,
      description:
        "Read a Notion page by its ID. Returns the full page content including properties, metadata, and URL.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "pageId",
          type: "string",
          required: true,
          description: "The Notion page ID to read",
        },
      ],
    });

    tools.push({
      name: `notion_search${suffix}`,
      description:
        "Search for pages, databases, and data sources in Notion. Returns a list of matching results with their metadata. Empty query returns all accessible pages/databases.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `notion_create${suffix}`,
      description:
        "Create a new page in Notion. Supports simplified parameters: use 'name' for the page title and 'content' (string) for text content. The page will be created at workspace level by default. For advanced use, you can specify 'parent' (page, database, data source, or workspace), 'properties' (full Notion properties object), and 'children' (array of block objects).",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `notion_update${suffix}`,
      description:
        "Update a Notion page's properties. Only provide the properties that should be updated.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `notion_query_database${suffix}`,
      description:
        "Query a Notion database to retrieve pages that match the specified filters and sorts.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `notion_create_database_page${suffix}`,
      description:
        "Create a new page in a Notion database. Properties must match the database schema.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `notion_update_database_page${suffix}`,
      description:
        "Update a page in a Notion database. Only provide the properties that should be updated.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });

    tools.push({
      name: `notion_append_blocks${suffix}`,
      description:
        "Append content blocks (paragraphs, headings, lists, etc.) to an existing Notion page. Use this to add text, headings, lists, and other content to a page after it's been created.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
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
    });
  } else if (serviceType === "github") {
    const condition = oauthConnected
      ? `Available (GitHub "${serverName}" connected)`
      : `Not available (GitHub "${serverName}" not connected)`;

    tools.push({
      name: `github_list_repos${suffix}`,
      description:
        "List repositories accessible to the authenticated user. Returns a list of repositories with their metadata (name, description, language, stars, etc.). Supports filtering and pagination.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "type",
          type: "string (enum)",
          required: false,
          description:
            "Filter by repository type: 'all' (default), 'owner', or 'member'",
        },
        {
          name: "sort",
          type: "string (enum)",
          required: false,
          description:
            "Sort repositories by: 'created', 'updated', 'pushed', or 'full_name'",
        },
        {
          name: "direction",
          type: "string (enum)",
          required: false,
          description: "Sort direction: 'asc' or 'desc'",
        },
        {
          name: "per_page",
          type: "number",
          required: false,
          description: "Number of results per page (1-100, default: 30)",
        },
        {
          name: "page",
          type: "number",
          required: false,
          description: "Page number (default: 1)",
        },
      ],
    });

    tools.push({
      name: `github_get_repo${suffix}`,
      description:
        "Get detailed information about a specific repository. Returns repository metadata including description, language, stars, forks, and more.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "owner",
          type: "string",
          required: true,
          description: "Repository owner (username or organization)",
        },
        {
          name: "repo",
          type: "string",
          required: true,
          description: "Repository name",
        },
      ],
    });

    tools.push({
      name: `github_list_issues${suffix}`,
      description:
        "List issues in a repository. Returns a list of issues with their metadata (title, state, labels, etc.). Supports filtering by state and pagination.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "owner",
          type: "string",
          required: true,
          description: "Repository owner (username or organization)",
        },
        {
          name: "repo",
          type: "string",
          required: true,
          description: "Repository name",
        },
        {
          name: "state",
          type: "string (enum)",
          required: false,
          description:
            "Filter by issue state: 'open', 'closed', or 'all' (default: 'open')",
        },
        {
          name: "sort",
          type: "string (enum)",
          required: false,
          description: "Sort issues by: 'created', 'updated', or 'comments'",
        },
        {
          name: "direction",
          type: "string (enum)",
          required: false,
          description: "Sort direction: 'asc' or 'desc'",
        },
        {
          name: "per_page",
          type: "number",
          required: false,
          description: "Number of results per page (1-100, default: 30)",
        },
        {
          name: "page",
          type: "number",
          required: false,
          description: "Page number (default: 1)",
        },
      ],
    });

    tools.push({
      name: `github_get_issue${suffix}`,
      description:
        "Get detailed information about a specific issue. Returns issue metadata including title, body, state, labels, comments count, and more.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "owner",
          type: "string",
          required: true,
          description: "Repository owner (username or organization)",
        },
        {
          name: "repo",
          type: "string",
          required: true,
          description: "Repository name",
        },
        {
          name: "issueNumber",
          type: "number",
          required: true,
          description: "Issue number",
        },
      ],
    });

    tools.push({
      name: `github_list_prs${suffix}`,
      description:
        "List pull requests in a repository. Returns a list of pull requests with their metadata (title, state, merge status, etc.). Supports filtering by state and pagination.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "owner",
          type: "string",
          required: true,
          description: "Repository owner (username or organization)",
        },
        {
          name: "repo",
          type: "string",
          required: true,
          description: "Repository name",
        },
        {
          name: "state",
          type: "string (enum)",
          required: false,
          description:
            "Filter by PR state: 'open', 'closed', or 'all' (default: 'open')",
        },
        {
          name: "sort",
          type: "string (enum)",
          required: false,
          description: "Sort PRs by: 'created', 'updated', or 'popularity'",
        },
        {
          name: "direction",
          type: "string (enum)",
          required: false,
          description: "Sort direction: 'asc' or 'desc'",
        },
        {
          name: "per_page",
          type: "number",
          required: false,
          description: "Number of results per page (1-100, default: 30)",
        },
        {
          name: "page",
          type: "number",
          required: false,
          description: "Page number (default: 1)",
        },
      ],
    });

    tools.push({
      name: `github_get_pr${suffix}`,
      description:
        "Get detailed information about a specific pull request. Returns PR metadata including title, body, state, merge status, additions, deletions, and more.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "owner",
          type: "string",
          required: true,
          description: "Repository owner (username or organization)",
        },
        {
          name: "repo",
          type: "string",
          required: true,
          description: "Repository name",
        },
        {
          name: "prNumber",
          type: "number",
          required: true,
          description: "Pull request number",
        },
      ],
    });

    tools.push({
      name: `github_read_file${suffix}`,
      description:
        "Read the contents of a file from a repository. Returns the file content, metadata, and URL. Supports reading from specific branches or commits.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "owner",
          type: "string",
          required: true,
          description: "Repository owner (username or organization)",
        },
        {
          name: "repo",
          type: "string",
          required: true,
          description: "Repository name",
        },
        {
          name: "path",
          type: "string",
          required: true,
          description:
            "File path in the repository (e.g., 'src/index.ts' or 'README.md')",
        },
        {
          name: "ref",
          type: "string",
          required: false,
          description:
            "Branch, tag, or commit SHA (default: repository's default branch)",
        },
      ],
    });

    tools.push({
      name: `github_list_commits${suffix}`,
      description:
        "List commits in a repository. Returns a list of commits with their metadata (message, author, date, etc.). Supports filtering by author, path, date range, and pagination.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "owner",
          type: "string",
          required: true,
          description: "Repository owner (username or organization)",
        },
        {
          name: "repo",
          type: "string",
          required: true,
          description: "Repository name",
        },
        {
          name: "sha",
          type: "string",
          required: false,
          description: "SHA or branch to start listing commits from",
        },
        {
          name: "path",
          type: "string",
          required: false,
          description: "Only commits containing this file path will be returned",
        },
        {
          name: "author",
          type: "string",
          required: false,
          description:
            "GitHub login or email address by which to filter by commit author",
        },
        {
          name: "since",
          type: "string",
          required: false,
          description:
            "Only show commits after this date (ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ)",
        },
        {
          name: "until",
          type: "string",
          required: false,
          description:
            "Only show commits before this date (ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ)",
        },
        {
          name: "per_page",
          type: "number",
          required: false,
          description: "Number of results per page (1-100, default: 30)",
        },
        {
          name: "page",
          type: "number",
          required: false,
          description: "Page number (default: 1)",
        },
      ],
    });

    tools.push({
      name: `github_get_commit${suffix}`,
      description:
        "Get detailed information about a specific commit. Returns commit metadata including message, author, date, stats (additions, deletions), and changed files.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "owner",
          type: "string",
          required: true,
          description: "Repository owner (username or organization)",
        },
        {
          name: "repo",
          type: "string",
          required: true,
          description: "Repository name",
        },
        {
          name: "sha",
          type: "string",
          required: true,
          description: "Commit SHA",
        },
      ],
    });
  } else if (serviceType === "linear") {
    const condition = oauthConnected
      ? `Available (Linear "${serverName}" connected)`
      : `Not available (Linear "${serverName}" not connected)`;

    tools.push({
      name: `linear_list_teams${suffix}`,
      description:
        "List Linear teams available to the connected account. Returns team IDs, names, and keys.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [],
    });

    tools.push({
      name: `linear_list_projects${suffix}`,
      description:
        "List Linear projects. Returns project metadata and pagination info.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "first",
          type: "number",
          required: false,
          description: "Number of results to return (default: 50, max: 100)",
        },
        {
          name: "after",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
      ],
    });

    tools.push({
      name: `linear_list_issues${suffix}`,
      description:
        "List Linear issues with optional filters for team, project, assignee, and state.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "teamId",
          type: "string",
          required: false,
          description: "Filter issues by team ID",
        },
        {
          name: "projectId",
          type: "string",
          required: false,
          description: "Filter issues by project ID",
        },
        {
          name: "assigneeId",
          type: "string",
          required: false,
          description: "Filter issues by assignee ID",
        },
        {
          name: "state",
          type: "string",
          required: false,
          description: "Filter issues by state name",
        },
        {
          name: "first",
          type: "number",
          required: false,
          description: "Number of results to return (default: 50, max: 100)",
        },
        {
          name: "after",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
      ],
    });

    tools.push({
      name: `linear_get_issue${suffix}`,
      description:
        "Get detailed information about a Linear issue by its ID.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "issueId",
          type: "string",
          required: true,
          description: "Linear issue ID to retrieve",
        },
      ],
    });

    tools.push({
      name: `linear_search_issues${suffix}`,
      description:
        "Search Linear issues by query text with optional filters.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "query",
          type: "string",
          required: true,
          description: "Search query text",
        },
        {
          name: "teamId",
          type: "string",
          required: false,
          description: "Filter issues by team ID",
        },
        {
          name: "projectId",
          type: "string",
          required: false,
          description: "Filter issues by project ID",
        },
        {
          name: "assigneeId",
          type: "string",
          required: false,
          description: "Filter issues by assignee ID",
        },
        {
          name: "state",
          type: "string",
          required: false,
          description: "Filter issues by state name",
        },
        {
          name: "first",
          type: "number",
          required: false,
          description: "Number of results to return (default: 50, max: 100)",
        },
        {
          name: "after",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
      ],
    });
  } else if (serviceType === "hubspot") {
    const condition = oauthConnected
      ? `Available (HubSpot "${serverName}" connected)`
      : `Not available (HubSpot "${serverName}" not connected)`;

    tools.push({
      name: `hubspot_list_contacts${suffix}`,
      description:
        "List HubSpot contacts with optional pagination and selected properties.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of results to return (default: 100, max: 100)",
        },
        {
          name: "after",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
        {
          name: "properties",
          type: "string[]",
          required: false,
          description: "Optional list of properties to include",
        },
        {
          name: "archived",
          type: "boolean",
          required: false,
          description: "Whether to return archived records",
        },
      ],
    });

    tools.push({
      name: `hubspot_get_contact${suffix}`,
      description: "Get a HubSpot contact by ID.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "contactId",
          type: "string",
          required: true,
          description: "Contact ID to retrieve",
        },
        {
          name: "properties",
          type: "string[]",
          required: false,
          description: "Optional list of properties to include",
        },
        {
          name: "archived",
          type: "boolean",
          required: false,
          description: "Whether to return archived records",
        },
      ],
    });

    tools.push({
      name: `hubspot_search_contacts${suffix}`,
      description: "Search HubSpot contacts by query text.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "query",
          type: "string",
          required: true,
          description: "Search query text",
        },
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of results to return (default: 100, max: 100)",
        },
        {
          name: "after",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
        {
          name: "properties",
          type: "string[]",
          required: false,
          description: "Optional list of properties to include",
        },
        {
          name: "archived",
          type: "boolean",
          required: false,
          description: "Whether to return archived records",
        },
      ],
    });

    tools.push({
      name: `hubspot_list_companies${suffix}`,
      description:
        "List HubSpot companies with optional pagination and selected properties.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of results to return (default: 100, max: 100)",
        },
        {
          name: "after",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
        {
          name: "properties",
          type: "string[]",
          required: false,
          description: "Optional list of properties to include",
        },
        {
          name: "archived",
          type: "boolean",
          required: false,
          description: "Whether to return archived records",
        },
      ],
    });

    tools.push({
      name: `hubspot_get_company${suffix}`,
      description: "Get a HubSpot company by ID.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "companyId",
          type: "string",
          required: true,
          description: "Company ID to retrieve",
        },
        {
          name: "properties",
          type: "string[]",
          required: false,
          description: "Optional list of properties to include",
        },
        {
          name: "archived",
          type: "boolean",
          required: false,
          description: "Whether to return archived records",
        },
      ],
    });

    tools.push({
      name: `hubspot_search_companies${suffix}`,
      description: "Search HubSpot companies by query text.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "query",
          type: "string",
          required: true,
          description: "Search query text",
        },
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of results to return (default: 100, max: 100)",
        },
        {
          name: "after",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
        {
          name: "properties",
          type: "string[]",
          required: false,
          description: "Optional list of properties to include",
        },
        {
          name: "archived",
          type: "boolean",
          required: false,
          description: "Whether to return archived records",
        },
      ],
    });

    tools.push({
      name: `hubspot_list_deals${suffix}`,
      description:
        "List HubSpot deals with optional pagination and selected properties.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of results to return (default: 100, max: 100)",
        },
        {
          name: "after",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
        {
          name: "properties",
          type: "string[]",
          required: false,
          description: "Optional list of properties to include",
        },
        {
          name: "archived",
          type: "boolean",
          required: false,
          description: "Whether to return archived records",
        },
      ],
    });

    tools.push({
      name: `hubspot_get_deal${suffix}`,
      description: "Get a HubSpot deal by ID.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "dealId",
          type: "string",
          required: true,
          description: "Deal ID to retrieve",
        },
        {
          name: "properties",
          type: "string[]",
          required: false,
          description: "Optional list of properties to include",
        },
        {
          name: "archived",
          type: "boolean",
          required: false,
          description: "Whether to return archived records",
        },
      ],
    });

    tools.push({
      name: `hubspot_search_deals${suffix}`,
      description: "Search HubSpot deals by query text.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "query",
          type: "string",
          required: true,
          description: "Search query text",
        },
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of results to return (default: 100, max: 100)",
        },
        {
          name: "after",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
        {
          name: "properties",
          type: "string[]",
          required: false,
          description: "Optional list of properties to include",
        },
        {
          name: "archived",
          type: "boolean",
          required: false,
          description: "Whether to return archived records",
        },
      ],
    });

    tools.push({
      name: `hubspot_list_owners${suffix}`,
      description: "List HubSpot owners with optional pagination.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of results to return (default: 100, max: 100)",
        },
        {
          name: "after",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
        {
          name: "email",
          type: "string",
          required: false,
          description: "Optional email to filter owners",
        },
      ],
    });

    tools.push({
      name: `hubspot_get_owner${suffix}`,
      description: "Get a HubSpot owner by ID.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "ownerId",
          type: "string",
          required: true,
          description: "Owner ID to retrieve",
        },
      ],
    });

    tools.push({
      name: `hubspot_search_owners${suffix}`,
      description: "Search HubSpot owners by email.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "email",
          type: "string",
          required: true,
          description: "Owner email to search for",
        },
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of results to return (default: 100, max: 100)",
        },
        {
          name: "after",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
      ],
    });
  } else if (serviceType === "slack") {
    const condition = oauthConnected
      ? `Available (Slack "${serverName}" connected)`
      : `Not available (Slack "${serverName}" not connected)`;

    tools.push({
      name: `slack_list_channels${suffix}`,
      description:
        "List public and private Slack channels with IDs and metadata. Use this to find the channel ID for follow-up actions.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of channels to return (default: 100, max: 1000)",
        },
        {
          name: "cursor",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
      ],
    });

    tools.push({
      name: `slack_get_channel_history${suffix}`,
      description:
        "Read the most recent messages from a Slack channel. Returns a plain-text summary of messages.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "channel_id",
          type: "string",
          required: true,
          description: "Slack channel ID (e.g., C12345)",
        },
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of messages to return (default: 100, max: 1000)",
        },
        {
          name: "cursor",
          type: "string",
          required: false,
          description: "Pagination cursor for the next page",
        },
      ],
    });

    tools.push({
      name: `slack_post_message${suffix}`,
      description: "Post a message to a Slack channel.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "channel_id",
          type: "string",
          required: true,
          description: "Slack channel ID (e.g., C12345)",
        },
        {
          name: "text",
          type: "string",
          required: true,
          description: "Message text to post",
        },
      ],
    });
  } else if (serviceType === "stripe") {
    const condition = oauthConnected
      ? `Available (Stripe "${serverName}" connected)`
      : `Not available (Stripe "${serverName}" not connected)`;

    tools.push({
      name: `stripe_search_charges${suffix}`,
      description:
        "Search Stripe charges using Stripe's query language. Provide a search query and/or email.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "query",
          type: "string",
          required: false,
          description:
            "Optional Stripe search query (e.g., \"email:'bob@example.com' AND status:'succeeded'\")",
        },
        {
          name: "email",
          type: "string",
          required: false,
          description: "Optional email address to filter charges",
        },
      ],
    });

    tools.push({
      name: `stripe_get_metrics${suffix}`,
      description:
        "Retrieve Stripe balance and refunds for a required date range.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "startDate",
          type: "string|number",
          required: true,
          description:
            "Start date (ISO 8601 string or Unix timestamp in seconds)",
        },
        {
          name: "endDate",
          type: "string|number",
          required: true,
          description:
            "End date (ISO 8601 string or Unix timestamp in seconds)",
        },
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Maximum number of refunds to return (default: 20, max: 100)",
        },
      ],
    });
  } else if (serviceType === "salesforce") {
    const condition = oauthConnected
      ? `Available (Salesforce "${serverName}" connected)`
      : `Not available (Salesforce "${serverName}" not connected)`;

    tools.push({
      name: `salesforce_list_objects${suffix}`,
      description:
        "Lists standard and custom objects in Salesforce to understand available data.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [],
    });

    tools.push({
      name: `salesforce_describe_object${suffix}`,
      description:
        "Returns fields and relationships for a Salesforce object (e.g., 'Opportunity'). Use this before querying.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "objectName",
          type: "string",
          required: true,
          description: "Salesforce object name (e.g., Account, Opportunity)",
        },
      ],
    });

    tools.push({
      name: `salesforce_query${suffix}`,
      description:
        "Executes a SOQL query to find records. Supports filtering, sorting, and joins.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "query",
          type: "string",
          required: true,
          description:
            "SOQL query string (e.g., SELECT Name, Amount FROM Opportunity WHERE Amount > 10000)",
        },
      ],
    });
  } else if (serviceType === "posthog") {
    const condition = `Available (PostHog "${serverName}" enabled)`;

    tools.push({
      name: `posthog_list_projects${suffix}`,
      description:
        "List PostHog projects accessible to the API key. Returns project metadata including id and name.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [],
    });

    tools.push({
      name: `posthog_get_project${suffix}`,
      description: "Get details for a specific PostHog project by ID.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "projectId",
          type: "string",
          required: true,
          description: "PostHog project ID",
        },
      ],
    });

    tools.push({
      name: `posthog_list_events${suffix}`,
      description:
        "List events from a PostHog project with optional filters and pagination.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "projectId",
          type: "string",
          required: true,
          description: "PostHog project ID",
        },
        {
          name: "after",
          type: "string",
          required: false,
          description: "Only return events after this ISO timestamp",
        },
        {
          name: "before",
          type: "string",
          required: false,
          description: "Only return events before this ISO timestamp",
        },
        {
          name: "event",
          type: "string",
          required: false,
          description: "Filter by event name",
        },
        {
          name: "distinctId",
          type: "string",
          required: false,
          description: "Filter by distinct_id",
        },
        {
          name: "personId",
          type: "number",
          required: false,
          description: "Filter by person id",
        },
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of results to return",
        },
        {
          name: "offset",
          type: "number",
          required: false,
          description: "Number of results to skip",
        },
      ],
    });

    tools.push({
      name: `posthog_list_feature_flags${suffix}`,
      description:
        "List feature flags for a PostHog project with optional search and pagination.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "projectId",
          type: "string",
          required: true,
          description: "PostHog project ID",
        },
        {
          name: "search",
          type: "string",
          required: false,
          description: "Search by flag key or name",
        },
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of results to return",
        },
        {
          name: "offset",
          type: "number",
          required: false,
          description: "Number of results to skip",
        },
      ],
    });

    tools.push({
      name: `posthog_get_feature_flag${suffix}`,
      description: "Get a specific PostHog feature flag by ID.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "projectId",
          type: "string",
          required: true,
          description: "PostHog project ID",
        },
        {
          name: "featureFlagId",
          type: "string",
          required: true,
          description: "Feature flag ID",
        },
      ],
    });

    tools.push({
      name: `posthog_list_insights${suffix}`,
      description:
        "List insights for a PostHog project with optional filters and pagination.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "projectId",
          type: "string",
          required: true,
          description: "PostHog project ID",
        },
        {
          name: "saved",
          type: "boolean",
          required: false,
          description: "Filter by saved insights only",
        },
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of results to return",
        },
        {
          name: "offset",
          type: "number",
          required: false,
          description: "Number of results to skip",
        },
      ],
    });

    tools.push({
      name: `posthog_get_insight${suffix}`,
      description: "Get details for a specific PostHog insight by ID.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "projectId",
          type: "string",
          required: true,
          description: "PostHog project ID",
        },
        {
          name: "insightId",
          type: "string",
          required: true,
          description: "Insight ID",
        },
      ],
    });

    tools.push({
      name: `posthog_list_persons${suffix}`,
      description:
        "List persons in a PostHog project with optional filters and pagination.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "projectId",
          type: "string",
          required: true,
          description: "PostHog project ID",
        },
        {
          name: "search",
          type: "string",
          required: false,
          description: "Search by person name or email",
        },
        {
          name: "distinctId",
          type: "string",
          required: false,
          description: "Filter by distinct_id",
        },
        {
          name: "limit",
          type: "number",
          required: false,
          description: "Number of results to return",
        },
        {
          name: "offset",
          type: "number",
          required: false,
          description: "Number of results to skip",
        },
      ],
    });

    tools.push({
      name: `posthog_get_person${suffix}`,
      description: "Get details for a specific PostHog person by ID.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "projectId",
          type: "string",
          required: true,
          description: "PostHog project ID",
        },
        {
          name: "personId",
          type: "string",
          required: true,
          description: "Person ID",
        },
      ],
    });

    tools.push({
      name: `posthog_get${suffix}`,
      description:
        "Fetch any read-only PostHog endpoint via GET. Use this for endpoints not covered by other PostHog tools.",
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "path",
          type: "string",
          required: true,
          description: 'PostHog API path (must start with "/api/")',
        },
        {
          name: "params",
          type: "object",
          required: false,
          description: "Optional query parameters for the request",
        },
      ],
    });
  } else {
    // Generic MCP server tool
    const condition = `Available (MCP server "${serverName}" enabled)`;
    tools.push({
      name: `mcp_${serverName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}${suffix}`,
      description: `Call the MCP server "${serverName}". Provide the MCP method name and optional parameters.`,
      category: "MCP Server Tools",
      alwaysAvailable: false,
      condition,
      parameters: [
        {
          name: "method",
          type: "string",
          required: true,
          description: "The MCP method to call.",
        },
        {
          name: "params",
          type: "object",
          required: false,
          description: "Optional parameters for the MCP method.",
        },
      ],
    });
  }

  return tools;
}

/**
 * Sanitize server name for use in tool names
 */
function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
}

/**
 * Generate tool list from agent configuration
 */
export function generateToolList(
  options: ToolListOptions
): GroupedToolMetadata[] {
  const tools: ToolMetadata[] = [];

  // Add standard tools
  tools.push(...getStandardToolMetadata(options));

  // Add MCP server tools
  if (options.enabledMcpServers && options.enabledMcpServers.length > 0) {
    const oauthServiceTypes = [
      "google-drive",
      "gmail",
      "google-calendar",
      "notion",
      "github",
      "linear",
      "hubspot",
      "slack",
      "stripe",
      "salesforce",
    ];

    // Group servers by serviceType for conflict detection
    const serversByServiceType = new Map<
      string,
      Array<McpServerInfo>
    >();

    for (const server of options.enabledMcpServers) {
      let groupKey: string;
      if (
        server.serviceType &&
        ((server.authType === "oauth" &&
          oauthServiceTypes.includes(server.serviceType)) ||
          server.serviceType === "posthog")
      ) {
        groupKey = server.serviceType;
      } else {
        groupKey = "__generic__";
      }

      if (!serversByServiceType.has(groupKey)) {
        serversByServiceType.set(groupKey, []);
      }
      serversByServiceType.get(groupKey)!.push(server);
    }

    // Generate tools for each server
    for (const server of options.enabledMcpServers) {
      let groupKey: string;
      if (
        server.serviceType &&
        ((server.authType === "oauth" &&
          oauthServiceTypes.includes(server.serviceType)) ||
          server.serviceType === "posthog")
      ) {
        groupKey = server.serviceType;
      } else {
        groupKey = "__generic__";
      }

      const sameTypeServers = serversByServiceType.get(groupKey) || [];
      const hasConflict = sameTypeServers.length > 1;
      const serverNameSanitized = sanitizeServerName(server.name);
      const suffix = hasConflict ? `_${serverNameSanitized}` : "";

      if (server.serviceType === "posthog") {
        const serviceTools = getMcpServerToolMetadata(
          server.serviceType,
          server.name,
          suffix,
          true
        );
        tools.push(...serviceTools);
      } else if (
        server.authType === "oauth" &&
        server.serviceType &&
        oauthServiceTypes.includes(server.serviceType)
      ) {
        // Only add service-specific tools if OAuth is connected
        if (server.oauthConnected === true) {
          const serviceTools = getMcpServerToolMetadata(
            server.serviceType,
            server.name,
            suffix,
            true
          );
          tools.push(...serviceTools);
        }
        // Skip OAuth servers that are not connected
      } else {
        // Add generic MCP tool
        const genericTools = getMcpServerToolMetadata(
          "generic",
          server.name,
          suffix,
          true
        );
        tools.push(...genericTools);
      }
    }
  }

  // Add client tools
  if (options.agent.clientTools && options.agent.clientTools.length > 0) {
    for (const clientTool of options.agent.clientTools) {
      // Extract parameters from JSON Schema
      const parameters: ToolParameter[] = [];
      const schema = clientTool.parameters as {
        properties?: Record<string, unknown>;
        required?: string[];
      };

      if (schema.properties) {
        for (const [paramName, paramDef] of Object.entries(
          schema.properties
        )) {
          const param = paramDef as {
            type?: string;
            description?: string;
            enum?: unknown[];
          };
          const isRequired =
            schema.required?.includes(paramName) ?? false;
          parameters.push({
            name: paramName,
            type: param.type || "unknown",
            required: isRequired,
            description: param.description || "No description",
          });
        }
      }

      tools.push({
        name: clientTool.name,
        description: clientTool.description,
        category: "Client Tools",
        alwaysAvailable: true,
        parameters,
      });
    }
  }

  // Group tools by category
  const grouped = new Map<string, ToolMetadata[]>();
  for (const tool of tools) {
    if (!grouped.has(tool.category)) {
      grouped.set(tool.category, []);
    }
    grouped.get(tool.category)!.push(tool);
  }

  // Convert to array and sort by category name
  const result: GroupedToolMetadata[] = Array.from(grouped.entries())
    .map(([category, categoryTools]) => ({
      category,
      tools: categoryTools.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  return result;
}
