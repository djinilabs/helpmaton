export interface SpendingLimit {
  timeFrame: "daily" | "weekly" | "monthly";
  amount: number; // nano-dollars (integer)
}

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  permissionLevel: number | null;
  creditBalance?: number; // nano-dollars (integer)
  currency?: Currency;
  spendingLimits?: SpendingLimit[];
  apiKeys?: {
    openrouter?: boolean;
  };
  createdAt: string;
  updatedAt?: string;
}

export interface Member {
  userId: string;
  userRef: string;
  email?: string;
  permissionLevel: number;
  createdAt: string;
  updatedAt?: string;
}

export interface WorkspaceInvite {
  inviteId: string;
  email: string;
  permissionLevel: number;
  expiresAt: string;
}

export interface WorkspaceInviteDetails {
  workspaceId: string;
  workspaceName: string;
  email: string;
  permissionLevel: number;
  inviterEmail?: string;
  expiresAt: string;
}

export interface WorkspaceInviteListItem {
  inviteId: string;
  email: string;
  permissionLevel: number;
  expiresAt: string;
  createdAt: string;
}

export interface CreateWorkspaceInput {
  name: string;
  description?: string;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  spendingLimits?: SpendingLimit[];
}

export interface ClientTool {
  name: string; // Tool name and function name (must be valid JavaScript identifier)
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export type SummarizationPromptGrain =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export interface SummarizationPrompts {
  daily?: string;
  weekly?: string;
  monthly?: string;
  quarterly?: string;
  yearly?: string;
}

export interface SummarizationPromptsInput {
  daily?: string | null;
  weekly?: string | null;
  monthly?: string | null;
  quarterly?: string | null;
  yearly?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  systemPrompt: string;
  summarizationPrompts?: SummarizationPrompts;
  memoryExtractionEnabled?: boolean;
  memoryExtractionModel?: string;
  memoryExtractionPrompt?: string;
  notificationChannelId?: string;
  delegatableAgentIds?: string[];
  enabledMcpServerIds?: string[];
  enabledMcpServerToolNames?: Record<string, string[]>;
  enableMemorySearch?: boolean;
  enableSearchDocuments?: boolean;
  enableKnowledgeInjection?: boolean;
  enableKnowledgeInjectionFromMemories?: boolean;
  enableKnowledgeInjectionFromDocuments?: boolean;
  knowledgeInjectionSnippetCount?: number;
  knowledgeInjectionMinSimilarity?: number;
  knowledgeInjectionEntityExtractorModel?: string;
  enableKnowledgeReranking?: boolean;
  knowledgeRerankingModel?: string;
  enableSendEmail?: boolean;
  enableTavilySearch?: boolean;
  searchWebProvider?: "tavily" | "jina" | null;
  fetchWebProvider?: "tavily" | "jina" | "scrape" | null;
  enableExaSearch?: boolean;
  enableImageGeneration?: boolean;
  imageGenerationModel?: string;
  clientTools?: ClientTool[];
  spendingLimits?: SpendingLimit[];
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  maxToolRoundtrips?: number;
  provider?: string;
  modelName?: string;
  avatar?: string;
  widgetConfig?: {
    enabled: boolean;
    allowedOrigins?: string[];
    theme?: "light" | "dark" | "auto";
    position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  };
  createdAt: string;
  updatedAt?: string;
}

export interface CreateAgentInput {
  name: string;
  systemPrompt: string;
  notificationChannelId?: string | null;
  modelName?: string | null;
  clientTools?: ClientTool[];
  enableImageGeneration?: boolean;
  imageGenerationModel?: string | null;
  avatar?: string | null;
  summarizationPrompts?: SummarizationPromptsInput;
  memoryExtractionEnabled?: boolean;
  memoryExtractionModel?: string | null;
  memoryExtractionPrompt?: string | null;
}

export interface UpdateAgentInput {
  name?: string;
  systemPrompt?: string;
  notificationChannelId?: string | null;
  delegatableAgentIds?: string[];
  enabledMcpServerIds?: string[];
  enabledMcpServerToolNames?: Record<string, string[]>;
  enableMemorySearch?: boolean;
  enableSearchDocuments?: boolean;
  enableKnowledgeInjection?: boolean;
  enableKnowledgeInjectionFromMemories?: boolean;
  enableKnowledgeInjectionFromDocuments?: boolean;
  knowledgeInjectionSnippetCount?: number;
  knowledgeInjectionMinSimilarity?: number;
  knowledgeInjectionEntityExtractorModel?: string | null;
  enableKnowledgeReranking?: boolean;
  knowledgeRerankingModel?: string | null;
  enableSendEmail?: boolean;
  enableTavilySearch?: boolean;
  searchWebProvider?: "tavily" | "jina" | null;
  fetchWebProvider?: "tavily" | "jina" | "scrape" | null;
  enableExaSearch?: boolean;
  enableImageGeneration?: boolean;
  imageGenerationModel?: string | null;
  clientTools?: ClientTool[];
  summarizationPrompts?: SummarizationPromptsInput;
  memoryExtractionEnabled?: boolean;
  memoryExtractionModel?: string | null;
  memoryExtractionPrompt?: string | null;
  spendingLimits?: SpendingLimit[];
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxOutputTokens?: number | null;
  stopSequences?: string[] | null;
  maxToolRoundtrips?: number | null;
  provider?: string;
  modelName?: string | null;
  avatar?: string | null;
  widgetConfig?: {
    enabled: boolean;
    allowedOrigins?: string[];
    theme?: "light" | "dark" | "auto";
    position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  } | null;
}

export interface AgentKey {
  id: string;
  key?: string; // Only present when key is first created
  name?: string;
  provider?: string;
  type?: "webhook" | "widget";
  createdAt: string;
}

export interface CreateAgentKeyInput {
  name?: string;
  type?: "webhook" | "widget";
}

export interface Document {
  id: string;
  name: string;
  filename: string;
  folderPath: string;
  contentType: string;
  size: number;
  createdAt: string;
  updatedAt?: string;
}

export interface DocumentWithContent extends Document {
  content: string;
}

export interface DocumentSearchResult {
  snippet: string;
  documentName: string;
  documentId: string;
  folderPath: string;
  similarity: number;
}

export interface CreateDocumentInput {
  name: string;
  content: string;
}

export interface UpdateDocumentInput {
  content?: string;
  name?: string;
  folderPath?: string;
}

export interface Channel {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateChannelInput {
  type: "discord" | "slack";
  name: string;
  config:
    | {
        botToken: string;
        discordChannelId: string;
      }
    | {
        webhookUrl: string;
      };
}

/**
 * Input for updating a channel.
 * Note: The channel type cannot be changed during updates.
 * The config should match the existing channel type (Discord channels use botToken/discordChannelId,
 * Slack channels use webhookUrl).
 */
export interface UpdateChannelInput {
  name?: string;
  config?:
    | {
        botToken?: string;
        discordChannelId?: string;
      }
    | {
        webhookUrl?: string;
      };
}

// Token storage keys
const ACCESS_TOKEN_KEY = "helpmaton_access_token";
const REFRESH_TOKEN_KEY = "helpmaton_refresh_token";

// Store the original fetch function before we override it
// In browser context, we'll override window.fetch, so we need to capture it early
// In non-browser context (SSR), this module shouldn't be imported
const originalFetch =
  typeof window !== "undefined" && window.fetch
    ? window.fetch.bind(window)
    : fetch;

/**
 * Get stored access token
 */
export function getAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

/**
 * Get stored refresh token
 */
function getRefreshToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const token = localStorage.getItem(REFRESH_TOKEN_KEY);
  // Trim whitespace in case it was accidentally stored with whitespace
  return token ? token.trim() : null;
}

/**
 * Store tokens
 */
export function setTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

/**
 * Clear stored tokens
 */
export function clearTokens(): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

// Mutex to prevent concurrent token refresh requests
let refreshTokenPromise: Promise<string | null> | null = null;

/**
 * Refresh the access token using the refresh token
 * Uses a mutex to prevent concurrent refresh requests (race condition prevention)
 */
async function refreshAccessToken(): Promise<string | null> {
  // If a refresh is already in progress, wait for it
  if (refreshTokenPromise) {
    return refreshTokenPromise;
  }

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  // Create the refresh promise and store it
  refreshTokenPromise = (async () => {
    try {
      // Debug logging
      console.log("[api] Refreshing token:", {
        refreshTokenType: typeof refreshToken,
        refreshTokenLength: refreshToken ? refreshToken.length : null,
        refreshTokenStartsWith: refreshToken
          ? refreshToken.startsWith("hmat_refresh_")
          : false,
        refreshTokenPreview: refreshToken
          ? `${refreshToken.substring(0, 20)}...${refreshToken.substring(
              refreshToken.length - 10,
            )}`
          : null,
      });

      // Use the original fetch to avoid recursion
      const response = await originalFetch("/api/user/refresh-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (data.accessToken && data.refreshToken) {
        setTokens(data.accessToken, data.refreshToken);
        return data.accessToken;
      }

      return null;
    } catch (error) {
      console.error("[api] Error refreshing token:", error);
      return null;
    } finally {
      // Clear the promise so future requests can refresh again
      refreshTokenPromise = null;
    }
  })();

  return refreshTokenPromise;
}

async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  // For FormData, don't set Content-Type - let the browser set it with boundary
  const isFormData = options.body instanceof FormData;
  const headers: HeadersInit = isFormData
    ? { ...options.headers }
    : {
        "Content-Type": "application/json",
        ...options.headers,
      };

  // Use the global fetch (which automatically adds Authorization header and handles token refresh)
  // The global fetch override handles all authentication, so we just need to pass through
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    // Network error (no internet, server down, etc.)
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error(
        "Network error: Unable to connect to the server. Please check your internet connection.",
      );
    }
    throw error;
  }

  // Note: Token refresh is handled automatically by the global fetch override
  // If we get a 401 here, it means refresh already failed and user was redirected

  if (!response.ok) {
    let errorMessage = response.statusText;

    try {
      const error = await response.json();
      // Prioritize message over error - message contains specific details, error is just the status name
      errorMessage = error.message || error.error || errorMessage;
    } catch {
      // If response is not JSON, use status text
    }

    // Provide user-friendly error messages for common status codes
    // Only override if we don't have a specific message from the server
    if (!errorMessage || errorMessage === response.statusText) {
      if (response.status === 401) {
        errorMessage = "Unauthorized: Please sign in again.";
      } else if (response.status === 403) {
        errorMessage =
          "Forbidden: You don't have permission to perform this action.";
      } else if (response.status === 404) {
        errorMessage = "Not found: The requested resource could not be found.";
      } else if (response.status === 500) {
        errorMessage =
          "Server error: Something went wrong on the server. Please try again later.";
      }
    }

    throw new Error(errorMessage);
  }

  return response;
}

/**
 * Initialize global fetch override to automatically add Authorization header
 * and handle token refresh. This prevents race conditions and ensures all
 * fetch calls (including DefaultChatTransport) include the token.
 */
export function setupGlobalFetchOverride(): void {
  if (typeof window === "undefined") {
    return; // Only run in browser
  }

  // Override global fetch
  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    // Convert input to URL string
    const urlString =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    // Parse URL to check origin (for security - only send tokens to same origin)
    let requestUrl: URL;
    try {
      // If it's a relative URL, resolve it against current origin
      requestUrl = new URL(urlString, window.location.origin);
    } catch {
      // If URL parsing fails, use original fetch without modifications
      return originalFetch(input, init);
    }

    // Only add Authorization header for same-origin requests
    const isSameOrigin = requestUrl.origin === window.location.origin;

    // Skip token handling for token refresh endpoint, user routes, and cross-origin requests
    const skipAuth =
      !isSameOrigin ||
      urlString.includes("/api/user/refresh-token") ||
      urlString.includes("/api/user/generate-tokens") ||
      urlString.includes("/api/auth");

    // For FormData, don't set Content-Type - let the browser set it with boundary
    const isFormData = init?.body instanceof FormData;

    // Convert existing headers to a plain object to avoid duplication
    const existingHeaders: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          existingHeaders[key.toLowerCase()] = value;
        });
      } else if (Array.isArray(init.headers)) {
        // Array of [key, value] pairs
        for (const [key, value] of init.headers) {
          existingHeaders[key.toLowerCase()] = value;
        }
      } else {
        // Plain object
        for (const [key, value] of Object.entries(init.headers)) {
          existingHeaders[key.toLowerCase()] = String(value);
        }
      }
    }

    // Build headers object - only set Content-Type if not already present and not FormData
    const headers: Record<string, string> = { ...existingHeaders };
    if (!isFormData && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }

    // Add Bearer token if available, same origin, and not skipping auth
    if (!skipAuth) {
      const accessToken = getAccessToken();
      if (accessToken) {
        (headers as Record<string, string>).Authorization =
          `Bearer ${accessToken}`;
      }
    }

    // Make the request - preserve all original options including credentials
    let response: Response;
    try {
      response = await originalFetch(input, {
        ...init,
        headers,
        // Preserve credentials option from original request
        credentials: init?.credentials,
      });
    } catch (error) {
      // Network error (no internet, server down, etc.)
      if (error instanceof TypeError && error.message === "Failed to fetch") {
        throw new Error(
          "Network error: Unable to connect to the server. Please check your internet connection.",
        );
      }
      throw error;
    }

    // Handle 401 Unauthorized or 403 Forbidden (from Deny policy) - try to refresh token
    // (only for same-origin API routes)
    // 403 from API Gateway authorizer Deny policies should trigger token refresh
    if (
      (response.status === 401 || response.status === 403) &&
      !skipAuth &&
      isSameOrigin &&
      (urlString.startsWith("/api/") ||
        requestUrl.pathname.startsWith("/api/")) &&
      !urlString.includes("/api/user/refresh-token") &&
      !urlString.includes("/api/user/generate-tokens")
    ) {
      const accessToken = getAccessToken();
      if (accessToken) {
        const newAccessToken = await refreshAccessToken();
        if (newAccessToken) {
          // Retry the original request with new token
          (headers as Record<string, string>).Authorization =
            `Bearer ${newAccessToken}`;
          response = await originalFetch(input, {
            ...init,
            headers,
            // Preserve credentials option from original request
            credentials: init?.credentials,
          });
        } else {
          // Refresh failed - clear tokens and reload page at current path
          clearTokens();
          if (typeof window !== "undefined") {
            window.location.reload();
          }
          throw new Error("Session expired. Please sign in again.");
        }
      }
    }

    // Handle 402 Payment Required - show appropriate error message based on endpoint type
    if (response.status === 402) {
      // Determine endpoint type: test (API Gateway) or streaming (Function URL)
      // Test endpoint: relative URL starting with /api/ (same origin)
      // Streaming endpoint: full HTTP URL (cross-origin Lambda Function URL)
      const isTestEndpoint =
        urlString.endsWith("/test") || requestUrl.pathname.endsWith("/test");

      if (isTestEndpoint) {
        // Test endpoint: message about workspace credits
        throw new Error("Not enough workspace credits");
      } else {
        // Streaming endpoint: generic administrator message
        throw new Error(
          "There was an error. Please contact your administrator.",
        );
      }
    }

    return response;
  };
}

// Export apiFetch for use in components that need custom fetch functions
export { apiFetch };

export async function listWorkspaces(): Promise<{ workspaces: Workspace[] }> {
  const response = await apiFetch("/api/workspaces");
  return response.json();
}

export async function getWorkspace(id: string): Promise<Workspace> {
  const response = await apiFetch(`/api/workspaces/${id}`);
  return response.json();
}

export async function createWorkspace(
  input: CreateWorkspaceInput,
): Promise<Workspace> {
  const response = await apiFetch("/api/workspaces", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.json();
}

export async function updateWorkspace(
  id: string,
  input: UpdateWorkspaceInput,
): Promise<Workspace> {
  const response = await apiFetch(`/api/workspaces/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return response.json();
}

export async function deleteWorkspace(id: string): Promise<void> {
  await apiFetch(`/api/workspaces/${id}`, {
    method: "DELETE",
  });
}

/**
 * Workspace export type - matches the backend schema structure
 */
export interface WorkspaceExport {
  id: string;
  name: string;
  description?: string;
  currency?: "usd";
  spendingLimits?: Array<{
    timeFrame: "daily" | "weekly" | "monthly";
    amount: number;
  }>;
  agents?: Array<{
    id: string;
    name: string;
    systemPrompt: string;
    notificationChannelId?: string;
    delegatableAgentIds?: string[];
    enabledMcpServerIds?: string[];
    enableMemorySearch?: boolean;
    enableSearchDocuments?: boolean;
    enableKnowledgeInjection?: boolean;
    knowledgeInjectionSnippetCount?: number;
    knowledgeInjectionMinSimilarity?: number;
    enableKnowledgeReranking?: boolean;
    knowledgeRerankingModel?: string;
    enableSendEmail?: boolean;
    enableTavilySearch?: boolean;
    searchWebProvider?: "tavily" | "jina" | null;
    fetchWebProvider?: "tavily" | "jina" | "scrape" | null;
    enableExaSearch?: boolean;
    clientTools?: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>;
    spendingLimits?: Array<{
      timeFrame: "daily" | "weekly" | "monthly";
      amount: number;
    }>;
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    maxToolRoundtrips?: number;
    provider?: string;
    modelName?: string;
    avatar?: string;
    keys?: Array<{
      id: string;
      name?: string;
      type?: "webhook" | "widget";
      provider?: "google";
    }>;
    evalJudges?: Array<{
      id: string;
      name: string;
      enabled?: boolean;
      provider?: "openrouter";
      modelName: string;
      evalPrompt: string;
    }>;
    streamServer?: {
      secret: string;
      allowedOrigins: string[];
    };
  }>;
  outputChannels?: Array<{
    id: string;
    channelId: string;
    type: string;
    name: string;
    config: Record<string, unknown>;
  }>;
  emailConnections?: Array<{
    id: string;
    type: string;
    name: string;
    config: Record<string, unknown>;
  }>;
  mcpServers?: Array<{
    id: string;
    name: string;
    url: string;
    authType: string;
    serviceType?: string;
    config?: Record<string, unknown>;
  }>;
  botIntegrations?: Array<{
    id: string;
    agentId: string;
    type: string;
    config: Record<string, unknown>;
  }>;
}

/**
 * Export a workspace configuration as a downloadable JSON file
 */
export async function exportWorkspace(workspaceId: string): Promise<void> {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/export`);

  // Get filename from Content-Disposition header or use default
  const contentDisposition = response.headers.get("Content-Disposition");
  let filename = `workspace-export-${workspaceId}.json`;
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
    if (filenameMatch) {
      filename = filenameMatch[1];
    }
  }

  // Create blob from response
  const blob = await response.blob();

  // Create temporary URL and trigger download
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/**
 * Import a workspace from an exported configuration JSON
 */
export async function importWorkspace(
  exportData: WorkspaceExport,
): Promise<Workspace> {
  const response = await apiFetch("/api/workspaces/import", {
    method: "POST",
    body: JSON.stringify(exportData),
  });
  return response.json();
}

export async function setWorkspaceApiKey(
  workspaceId: string,
  key: string | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _provider: string = "openrouter",
): Promise<void> {
  await apiFetch(`/api/workspaces/${workspaceId}/api-key`, {
    method: "PUT",
    body: JSON.stringify({ key, provider: "openrouter" }),
  });
}

export async function getWorkspaceApiKeyStatus(
  workspaceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _provider: string = "openrouter",
): Promise<{ hasKey: boolean }> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/api-key?provider=openrouter`,
  );
  return response.json();
}

export async function getWorkspaceApiKeys(
  workspaceId: string,
): Promise<{ keys: Array<{ provider: string; hasKey: boolean }> }> {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/api-keys`);
  return response.json();
}

export async function deleteWorkspaceApiKey(
  workspaceId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _provider: string = "openrouter",
): Promise<void> {
  await apiFetch(`/api/workspaces/${workspaceId}/api-key?provider=openrouter`, {
    method: "DELETE",
  });
}

export interface TrialStatus {
  isInTrialPeriod: boolean;
  daysRemaining: number;
  hasRequestedCredits: boolean;
  creditsApproved: boolean;
  initialCreditAmount: number; // nano-dollars (integer)
  currentUsage: number;
}

export async function requestTrialCredits(
  workspaceId: string,
  captchaToken: string,
  reason: string,
): Promise<void> {
  await apiFetch(`/api/workspaces/${workspaceId}/trial-credit-request`, {
    method: "POST",
    body: JSON.stringify({ captchaToken, reason }),
  });
}

export async function getTrialStatus(
  workspaceId: string,
): Promise<TrialStatus> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/trial-status`,
  );
  return response.json();
}

export async function listAgents(
  workspaceId: string,
): Promise<{ agents: Agent[] }> {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/agents`);
  return response.json();
}

export async function getAgent(
  workspaceId: string,
  agentId: string,
): Promise<Agent> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}`,
  );
  return response.json();
}

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

export interface GroupedToolMetadata {
  category: string;
  tools: ToolMetadata[];
}

export async function getAgentTools(
  workspaceId: string,
  agentId: string,
): Promise<GroupedToolMetadata[]> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/tools`,
  );
  return response.json();
}

export async function createAgent(
  workspaceId: string,
  input: CreateAgentInput,
): Promise<Agent> {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/agents`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.json();
}

export async function generatePrompt(
  workspaceId: string,
  input: { goal: string; agentId?: string },
): Promise<{ prompt: string }> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/generate-prompt`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function updateAgent(
  workspaceId: string,
  agentId: string,
  input: UpdateAgentInput,
): Promise<Agent> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function deleteAgent(
  workspaceId: string,
  agentId: string,
): Promise<void> {
  await apiFetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
    method: "DELETE",
  });
}

export async function getAgentKeys(
  workspaceId: string,
  agentId: string,
): Promise<{ keys: AgentKey[] }> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/keys`,
  );
  return response.json();
}

export async function createAgentKey(
  workspaceId: string,
  agentId: string,
  input: CreateAgentKeyInput,
): Promise<AgentKey> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/keys`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function deleteAgentKey(
  workspaceId: string,
  agentId: string,
  keyId: string,
): Promise<void> {
  await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/keys/${keyId}`,
    {
      method: "DELETE",
    },
  );
}

export interface ConversationError {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
  statusCode?: number;
  provider?: string;
  modelName?: string;
  endpoint?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface Delegation {
  callingAgentId: string;
  targetAgentId: string;
  targetConversationId?: string;
  taskId?: string;
  timestamp: string;
  status: "completed" | "failed" | "cancelled";
}

export interface Conversation {
  id: string;
  conversationType: "test" | "webhook" | "stream" | "scheduled";
  startedAt: string;
  lastMessageAt: string;
  messageCount: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  costUsd?: number;
  rerankingCostUsd?: number;
  hasError?: boolean;
  error?: ConversationError | null;
  totalGenerationTimeMs?: number;
}

export interface ConversationDetail extends Conversation {
  messages: unknown[];
  awsRequestIds?: string[];
  delegations?: Delegation[];
}

export interface ListConversationsResponse {
  conversations: Conversation[];
  nextCursor?: string;
}

export async function listAgentConversations(
  workspaceId: string,
  agentId: string,
  limit?: number,
  cursor?: string,
): Promise<ListConversationsResponse> {
  const params = new URLSearchParams();
  if (limit !== undefined) {
    params.append("limit", limit.toString());
  }
  if (cursor) {
    params.append("cursor", cursor);
  }
  const queryString = params.toString();
  const url = `/api/workspaces/${workspaceId}/agents/${agentId}/conversations${
    queryString ? `?${queryString}` : ""
  }`;
  const response = await apiFetch(url);
  return response.json();
}

export interface Transaction {
  id: string;
  workspaceId: string;
  agentId: string | null;
  conversationId: string | null;
  source: "embedding-generation" | "text-generation" | "tool-execution";
  supplier: "openrouter" | "tavily";
  model: string | null;
  tool_call: string | null;
  description: string;
  amountNanoUsd: number;
  workspaceCreditsBeforeNanoUsd: number;
  workspaceCreditsAfterNanoUsd: number;
  createdAt: string;
}

export interface ListTransactionsResponse {
  transactions: Transaction[];
  nextCursor?: string;
}

export async function listWorkspaceTransactions(
  workspaceId: string,
  limit?: number,
  cursor?: string,
): Promise<ListTransactionsResponse> {
  const params = new URLSearchParams();
  if (limit !== undefined) {
    params.append("limit", limit.toString());
  }
  if (cursor) {
    params.append("cursor", cursor);
  }
  const queryString = params.toString();
  const url = `/api/workspaces/${workspaceId}/transactions${
    queryString ? `?${queryString}` : ""
  }`;
  const response = await apiFetch(url);
  return response.json();
}

export async function listAgentTransactions(
  workspaceId: string,
  agentId: string,
  limit?: number,
  cursor?: string,
): Promise<ListTransactionsResponse> {
  const params = new URLSearchParams();
  if (limit !== undefined) {
    params.append("limit", limit.toString());
  }
  if (cursor) {
    params.append("cursor", cursor);
  }
  const queryString = params.toString();
  const url = `/api/workspaces/${workspaceId}/agents/${agentId}/transactions${
    queryString ? `?${queryString}` : ""
  }`;
  const response = await apiFetch(url);
  return response.json();
}

export async function getAgentConversation(
  workspaceId: string,
  agentId: string,
  conversationId: string,
): Promise<ConversationDetail> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/conversations/${conversationId}`,
  );
  return response.json();
}

export async function listDocuments(
  workspaceId: string,
  folderPath?: string,
): Promise<{ documents: Document[] }> {
  const url =
    folderPath !== undefined
      ? `/api/workspaces/${workspaceId}/documents?folder=${encodeURIComponent(
          folderPath,
        )}`
      : `/api/workspaces/${workspaceId}/documents`;
  const response = await apiFetch(url);
  return response.json();
}

export async function listFolders(
  workspaceId: string,
): Promise<{ folders: string[] }> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/documents/folders`,
  );
  return response.json();
}

export async function uploadDocument(
  workspaceId: string,
  file: File | CreateDocumentInput,
  folderPath?: string,
): Promise<Document> {
  const formData = new FormData();

  if (file instanceof File) {
    formData.append("files", file);
  } else {
    const textDocuments = JSON.stringify([file]);
    formData.append("textDocuments", textDocuments);
  }

  if (folderPath !== undefined) {
    formData.append("folderPath", folderPath);
  }

  const response = await apiFetch(`/api/workspaces/${workspaceId}/documents`, {
    method: "POST",
    body: formData,
  });

  const result = await response.json();
  return result.documents[0];
}

export async function uploadDocuments(
  workspaceId: string,
  files: File[],
  folderPath?: string,
): Promise<Document[]> {
  const formData = new FormData();

  files.forEach((file) => {
    formData.append("files", file);
  });

  if (folderPath !== undefined) {
    formData.append("folderPath", folderPath);
  }

  const response = await apiFetch(`/api/workspaces/${workspaceId}/documents`, {
    method: "POST",
    body: formData,
  });

  const result = await response.json();
  return result.documents;
}

export async function getDocument(
  workspaceId: string,
  documentId: string,
): Promise<DocumentWithContent> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/documents/${documentId}`,
  );
  return response.json();
}

export async function updateDocument(
  workspaceId: string,
  documentId: string,
  input: UpdateDocumentInput,
): Promise<Document> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/documents/${documentId}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function renameDocument(
  workspaceId: string,
  documentId: string,
  name: string,
): Promise<Document> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/documents/${documentId}/rename`,
    {
      method: "PATCH",
      body: JSON.stringify({ name }),
    },
  );
  return response.json();
}

export async function deleteDocument(
  workspaceId: string,
  documentId: string,
): Promise<void> {
  await apiFetch(`/api/workspaces/${workspaceId}/documents/${documentId}`, {
    method: "DELETE",
  });
}

export async function searchDocuments(
  workspaceId: string,
  query: string,
  limit?: number,
): Promise<{ results: DocumentSearchResult[] }> {
  const params = new URLSearchParams();
  params.append("q", query);
  if (limit !== undefined) {
    params.append("limit", limit.toString());
  }
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/documents/search?${params.toString()}`,
  );
  return response.json();
}

export async function listChannels(
  workspaceId: string,
): Promise<{ channels: Channel[] }> {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/channels`);
  return response.json();
}

export async function getChannel(
  workspaceId: string,
  channelId: string,
): Promise<Channel> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/channels/${channelId}`,
  );
  return response.json();
}

export async function createChannel(
  workspaceId: string,
  input: CreateChannelInput,
): Promise<Channel> {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/channels`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.json();
}

export async function updateChannel(
  workspaceId: string,
  channelId: string,
  input: UpdateChannelInput,
): Promise<Channel> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/channels/${channelId}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function deleteChannel(
  workspaceId: string,
  channelId: string,
): Promise<void> {
  await apiFetch(`/api/workspaces/${workspaceId}/channels/${channelId}`, {
    method: "DELETE",
  });
}

export async function testChannel(
  workspaceId: string,
  channelId: string,
): Promise<{ success: boolean; message: string }> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/channels/${channelId}/test`,
    {
      method: "POST",
    },
  );
  return response.json();
}

export interface EmailConnection {
  name: string;
  type: "gmail" | "outlook" | "smtp";
  createdAt: string;
  updatedAt?: string;
}

export interface CreateEmailConnectionInput {
  type: "gmail" | "outlook" | "smtp";
  name: string;
  config: Record<string, unknown>;
}

export interface UpdateEmailConnectionInput {
  name?: string;
  config?: Record<string, unknown>;
}

export async function getEmailConnection(
  workspaceId: string,
): Promise<EmailConnection | null> {
  try {
    const response = await apiFetch(
      `/api/workspaces/${workspaceId}/email-connection`,
    );

    return response.json();
  } catch (error) {
    // If 404, return null (no connection exists)
    if (
      error instanceof Error &&
      (error.message.includes("404") ||
        error.message.includes("not found") ||
        error.message.includes("Not found"))
    ) {
      return null;
    }
    throw error;
  }
}

export async function createOrUpdateEmailConnection(
  workspaceId: string,
  input: CreateEmailConnectionInput,
): Promise<EmailConnection> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/email-connection`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function updateEmailConnection(
  workspaceId: string,
  input: UpdateEmailConnectionInput,
): Promise<EmailConnection> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/email-connection`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function deleteEmailConnection(
  workspaceId: string,
): Promise<void> {
  await apiFetch(`/api/workspaces/${workspaceId}/email-connection`, {
    method: "DELETE",
  });
}

export async function testEmailConnection(
  workspaceId: string,
): Promise<{ success: boolean; message: string }> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/email-connection/test`,
    {
      method: "POST",
    },
  );
  return response.json();
}

export interface McpServer {
  id: string;
  name: string;
  url?: string;
  authType: "none" | "header" | "basic" | "oauth";
  serviceType?:
    | "external"
    | "google-drive"
    | "gmail"
    | "google-calendar"
    | "notion"
    | "github"
    | "linear"
    | "hubspot"
    | "shopify"
    | "slack"
    | "stripe"
    | "salesforce"
    | "intercom"
    | "todoist"
    | "zendesk"
    | "posthog";
  oauthConnected?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateMcpServerInput {
  name: string;
  url?: string;
  authType: "none" | "header" | "basic" | "oauth";
  serviceType?:
    | "external"
    | "google-drive"
    | "gmail"
    | "google-calendar"
    | "notion"
    | "github"
    | "linear"
    | "hubspot"
    | "shopify"
    | "slack"
    | "stripe"
    | "salesforce"
    | "intercom"
    | "todoist"
    | "zendesk"
    | "posthog";
  config?: {
    apiKey?: string;
    headerValue?: string;
    username?: string;
    password?: string;
    subdomain?: string;
    clientId?: string;
    clientSecret?: string;
    shopDomain?: string;
  };
}

export interface UpdateMcpServerInput {
  name?: string;
  url?: string;
  authType?: "none" | "header" | "basic" | "oauth";
  serviceType?:
    | "external"
    | "google-drive"
    | "gmail"
    | "google-calendar"
    | "notion"
    | "github"
    | "linear"
    | "hubspot"
    | "shopify"
    | "slack"
    | "stripe"
    | "salesforce"
    | "intercom"
    | "todoist"
    | "zendesk"
    | "posthog";
  config?: {
    apiKey?: string;
    headerValue?: string;
    username?: string;
    password?: string;
    subdomain?: string;
    clientId?: string;
    clientSecret?: string;
    shopDomain?: string;
  };
}

export async function listMcpServers(
  workspaceId: string,
): Promise<{ servers: McpServer[] }> {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/mcp-servers`);
  return response.json();
}

export async function getMcpServer(
  workspaceId: string,
  serverId: string,
): Promise<McpServer> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/mcp-servers/${serverId}`,
  );
  return response.json();
}

export async function getMcpServerTools(
  workspaceId: string,
  serverId: string,
): Promise<GroupedToolMetadata[]> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/mcp-servers/${serverId}/tools`,
  );
  return response.json();
}

export async function createMcpServer(
  workspaceId: string,
  input: CreateMcpServerInput,
): Promise<McpServer> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/mcp-servers`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function updateMcpServer(
  workspaceId: string,
  serverId: string,
  input: UpdateMcpServerInput,
): Promise<McpServer> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/mcp-servers/${serverId}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function deleteMcpServer(
  workspaceId: string,
  serverId: string,
): Promise<void> {
  await apiFetch(`/api/workspaces/${workspaceId}/mcp-servers/${serverId}`, {
    method: "DELETE",
  });
}

export interface McpOAuthStatus {
  connected: boolean;
  email: string | null;
}

export async function getMcpOAuthStatus(
  workspaceId: string,
  serverId: string,
): Promise<McpOAuthStatus> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth/status`,
  );
  return response.json();
}

export async function initiateMcpOAuthFlow(
  workspaceId: string,
  serverId: string,
): Promise<{ authUrl: string }> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth/authorize`,
  );
  return response.json();
}

export async function disconnectMcpOAuth(
  workspaceId: string,
  serverId: string,
): Promise<void> {
  await apiFetch(
    `/api/workspaces/${workspaceId}/mcp-servers/${serverId}/oauth/disconnect`,
    {
      method: "POST",
    },
  );
}

export async function initiateOAuthFlow(
  workspaceId: string,
  provider: "gmail" | "outlook",
): Promise<{ authUrl: string }> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/email/oauth/${provider}/authorize`,
  );
  return response.json();
}

export type Currency = "usd";

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number; // nano-dollars (integer)
  rerankingCostUsd?: number; // nano-dollars (integer)
  evalCostUsd?: number; // nano-dollars (integer)
  conversationCount: number;
  messagesIn: number;
  messagesOut: number;
  totalMessages: number;
  byModel: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  }>;
  byProvider: Array<{
    provider: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  }>;
  byByok: {
    byok: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cost: number;
    };
    platform: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cost: number;
    };
  };
  toolExpenses?: Array<{
    toolCall: string;
    supplier: string;
    cost: number; // nano-dollars (integer)
    callCount: number;
  }>;
}

export interface WorkspaceUsageResponse {
  workspaceId: string;
  currency: Currency;
  startDate: string;
  endDate: string;
  stats: UsageStats;
}

export interface DailyUsageData {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number; // nano-dollars (integer)
  rerankingCostUsd?: number; // nano-dollars (integer)
  evalCostUsd?: number; // nano-dollars (integer)
  conversationCount: number;
  messagesIn: number;
  messagesOut: number;
  totalMessages: number;
}

export interface WorkspaceDailyUsageResponse {
  workspaceId: string;
  currency: Currency;
  startDate: string;
  endDate: string;
  daily: DailyUsageData[];
}

export interface AgentUsageResponse {
  workspaceId: string;
  agentId: string;
  currency: Currency;
  startDate: string;
  endDate: string;
  stats: UsageStats;
}

export interface AgentDailyUsageResponse {
  workspaceId: string;
  agentId: string;
  currency: Currency;
  startDate: string;
  endDate: string;
  daily: DailyUsageData[];
}

export interface UserUsageResponse {
  userId: string;
  currency: Currency;
  startDate: string;
  endDate: string;
  workspaceCount: number;
  stats: UsageStats;
}

export interface UserDailyUsageResponse {
  userId: string;
  currency: Currency;
  startDate: string;
  endDate: string;
  daily: DailyUsageData[];
}

export interface UsageOptions {
  startDate?: string;
  endDate?: string;
}

export async function getWorkspaceUsage(
  workspaceId: string,
  options: UsageOptions = {},
): Promise<WorkspaceUsageResponse> {
  const params = new URLSearchParams();
  if (options.startDate) {
    params.append("startDate", options.startDate);
  }
  if (options.endDate) {
    params.append("endDate", options.endDate);
  }
  const queryString = params.toString();
  const url = `/api/workspaces/${workspaceId}/usage${
    queryString ? `?${queryString}` : ""
  }`;
  const response = await apiFetch(url);
  return response.json();
}

export async function getWorkspaceDailyUsage(
  workspaceId: string,
  options: UsageOptions = {},
): Promise<WorkspaceDailyUsageResponse> {
  const params = new URLSearchParams();
  if (options.startDate) {
    params.append("startDate", options.startDate);
  }
  if (options.endDate) {
    params.append("endDate", options.endDate);
  }
  const queryString = params.toString();
  const url = `/api/workspaces/${workspaceId}/usage/daily${
    queryString ? `?${queryString}` : ""
  }`;
  const response = await apiFetch(url);
  return response.json();
}

export async function getAgentUsage(
  workspaceId: string,
  agentId: string,
  options: UsageOptions = {},
): Promise<AgentUsageResponse> {
  const params = new URLSearchParams();
  if (options.startDate) {
    params.append("startDate", options.startDate);
  }
  if (options.endDate) {
    params.append("endDate", options.endDate);
  }
  const queryString = params.toString();
  const url = `/api/workspaces/${workspaceId}/agents/${agentId}/usage${
    queryString ? `?${queryString}` : ""
  }`;
  const response = await apiFetch(url);
  return response.json();
}

export async function getAgentDailyUsage(
  workspaceId: string,
  agentId: string,
  options: UsageOptions = {},
): Promise<AgentDailyUsageResponse> {
  const params = new URLSearchParams();
  if (options.startDate) {
    params.append("startDate", options.startDate);
  }
  if (options.endDate) {
    params.append("endDate", options.endDate);
  }
  const queryString = params.toString();
  const url = `/api/workspaces/${workspaceId}/agents/${agentId}/usage/daily${
    queryString ? `?${queryString}` : ""
  }`;
  const response = await apiFetch(url);
  return response.json();
}

// Memory API

export type TemporalGrain =
  | "working"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export interface AgentMemoryOptions {
  grain?: TemporalGrain;
  queryText?: string;
  minimumDaysAgo?: number;
  maximumDaysAgo?: number;
  maxResults?: number;
  previewLength?: number;
}

export interface AgentMemoryResult {
  id: string;
  content: string;
  date: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  isTruncated?: boolean;
}

export interface AgentMemoryResponse {
  workspaceId: string;
  agentId: string;
  records: AgentMemoryResult[];
}

export async function getAgentMemory(
  workspaceId: string,
  agentId: string,
  options: AgentMemoryOptions = {},
): Promise<AgentMemoryResponse> {
  const params = new URLSearchParams();
  if (options.grain) {
    params.append("grain", options.grain);
  }
  if (options.queryText && options.queryText.trim().length > 0) {
    params.append("queryText", options.queryText.trim());
  }
  if (options.minimumDaysAgo !== undefined) {
    params.append("minimumDaysAgo", options.minimumDaysAgo.toString());
  }
  if (options.maximumDaysAgo !== undefined) {
    params.append("maximumDaysAgo", options.maximumDaysAgo.toString());
  }
  if (options.maxResults !== undefined) {
    params.append("maxResults", options.maxResults.toString());
  }
  if (options.previewLength !== undefined) {
    params.append("previewLength", options.previewLength.toString());
  }
  const queryString = params.toString();
  const url = `/api/workspaces/${workspaceId}/agents/${agentId}/memory${
    queryString ? `?${queryString}` : ""
  }`;
  const response = await apiFetch(url);
  return response.json();
}

export interface KnowledgeGraphFact {
  id: string;
  source_id: string;
  target_id: string;
  label: string;
  properties?: Record<string, unknown> | null;
}

export interface AgentKnowledgeGraphOptions {
  queryText?: string;
  maxResults?: number;
}

export interface AgentKnowledgeGraphResponse {
  workspaceId: string;
  agentId: string;
  facts: KnowledgeGraphFact[];
}

export async function getAgentKnowledgeGraph(
  workspaceId: string,
  agentId: string,
  options: AgentKnowledgeGraphOptions = {},
): Promise<AgentKnowledgeGraphResponse> {
  const params = new URLSearchParams();
  if (options.queryText && options.queryText.trim().length > 0) {
    params.append("queryText", options.queryText.trim());
  }
  if (options.maxResults !== undefined) {
    params.append("maxResults", options.maxResults.toString());
  }
  const queryString = params.toString();
  const url = `/api/workspaces/${workspaceId}/agents/${agentId}/knowledge-graph${
    queryString ? `?${queryString}` : ""
  }`;
  const response = await apiFetch(url);
  return response.json();
}

export interface AgentMemoryRecordResponse {
  workspaceId: string;
  agentId: string;
  record: AgentMemoryResult;
}

export async function getAgentMemoryRecord(
  workspaceId: string,
  agentId: string,
  recordId: string,
  grain: TemporalGrain = "working",
): Promise<AgentMemoryRecordResponse> {
  const params = new URLSearchParams();
  if (grain) {
    params.append("grain", grain);
  }
  const queryString = params.toString();
  const url = `/api/workspaces/${workspaceId}/agents/${agentId}/memory/${recordId}${
    queryString ? `?${queryString}` : ""
  }`;
  const response = await apiFetch(url);
  return response.json();
}

export interface AvailableModels {
  google?: {
    models: string[];
    defaultModel: string;
    imageModels?: string[];
  };
  openrouter: {
    models: string[];
    defaultModel: string;
    imageModels?: string[];
    capabilities?: Record<string, ModelCapabilities>;
  };
}

export interface ModelCapabilities {
  input_modalities?: string[];
  output_modalities?: string[];
  supported_parameters?: string[];
  text_generation?: boolean;
  image_generation?: boolean;
  rerank?: boolean;
  tool_calling?: boolean;
  structured_output?: boolean;
  image?: boolean;
}

export async function getAvailableModels(): Promise<AvailableModels> {
  const response = await apiFetch("/api/models");
  return response.json();
}

export interface PricingTier {
  threshold?: number;
  input: number;
  output: number;
  reasoning?: number;
  cachedInput?: number;
  request?: number;
}

export interface ModelPricing {
  input?: number;
  output?: number;
  reasoning?: number;
  cachedInput?: number;
  request?: number;
  tiers?: PricingTier[];
}

export interface ModelPricingResponse {
  openrouter: Record<string, ModelPricing>;
}

export async function getModelPricing(): Promise<ModelPricingResponse> {
  const response = await apiFetch("/api/pricing");
  return response.json();
}

export async function getUserUsage(
  options: UsageOptions = {},
): Promise<UserUsageResponse> {
  const params = new URLSearchParams();
  if (options.startDate) {
    params.append("startDate", options.startDate);
  }
  if (options.endDate) {
    params.append("endDate", options.endDate);
  }
  const queryString = params.toString();
  const url = `/api/usage${queryString ? `?${queryString}` : ""}`;
  const response = await apiFetch(url);
  return response.json();
}

export async function getUserDailyUsage(
  options: UsageOptions = {},
): Promise<UserDailyUsageResponse> {
  const params = new URLSearchParams();
  if (options.startDate) {
    params.append("startDate", options.startDate);
  }
  if (options.endDate) {
    params.append("endDate", options.endDate);
  }
  const queryString = params.toString();
  const url = `/api/usage/daily${queryString ? `?${queryString}` : ""}`;
  const response = await apiFetch(url);
  return response.json();
}

// Spending Limits API

export async function addWorkspaceSpendingLimit(
  workspaceId: string,
  limit: SpendingLimit,
): Promise<Workspace> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/spending-limits`,
    {
      method: "POST",
      body: JSON.stringify(limit),
    },
  );
  return response.json();
}

export async function updateWorkspaceSpendingLimit(
  workspaceId: string,
  timeFrame: "daily" | "weekly" | "monthly",
  amount: number,
): Promise<Workspace> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/spending-limits/${timeFrame}`,
    {
      method: "PUT",
      body: JSON.stringify({ amount }),
    },
  );
  return response.json();
}

export async function removeWorkspaceSpendingLimit(
  workspaceId: string,
  timeFrame: "daily" | "weekly" | "monthly",
): Promise<Workspace> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/spending-limits/${timeFrame}`,
    {
      method: "DELETE",
    },
  );
  return response.json();
}

export async function addAgentSpendingLimit(
  workspaceId: string,
  agentId: string,
  limit: SpendingLimit,
): Promise<Agent> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/spending-limits`,
    {
      method: "POST",
      body: JSON.stringify(limit),
    },
  );
  return response.json();
}

export async function updateAgentSpendingLimit(
  workspaceId: string,
  agentId: string,
  timeFrame: "daily" | "weekly" | "monthly",
  amount: number,
): Promise<Agent> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/spending-limits/${timeFrame}`,
    {
      method: "PUT",
      body: JSON.stringify({ amount }),
    },
  );
  return response.json();
}

export async function removeAgentSpendingLimit(
  workspaceId: string,
  agentId: string,
  timeFrame: "daily" | "weekly" | "monthly",
): Promise<Agent> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/spending-limits/${timeFrame}`,
    {
      method: "DELETE",
    },
  );
  return response.json();
}

// Subscription Management API

export interface SubscriptionManager {
  userId: string;
  email: string | null;
}

export interface Subscription {
  subscriptionId: string;
  plan: "free" | "starter" | "pro";
  expiresAt: string | null;
  createdAt: string;
  // Lemon Squeezy fields
  status?:
    | "active"
    | "past_due"
    | "unpaid"
    | "cancelled"
    | "expired"
    | "on_trial";
  renewsAt?: string | null;
  endsAt?: string | null;
  gracePeriodEndsAt?: string | null;
  lemonSqueezySubscriptionId?: string;
  managers: SubscriptionManager[];
  limits: {
    maxWorkspaces: number;
    maxDocuments: number;
    maxDocumentSizeBytes: number;
    maxAgents: number;
    maxUsers: number;
    maxManagers?: number;
    maxDailyRequests?: number;
    maxAgentKeys: number;
    maxChannels: number;
    maxMcpServers: number;
  };
  usage: {
    workspaces: number;
    documents: number;
    documentSizeBytes: number;
    agents: number;
    users: number;
    agentKeys: number;
    channels: number;
    mcpServers: number;
  };
}

export interface UserByEmail {
  userId: string;
  email: string;
}

export async function getSubscription(): Promise<Subscription> {
  console.log("[api.getSubscription] Fetching subscription from API");
  const response = await apiFetch("/api/subscription");
  const data = await response.json();
  console.log("[api.getSubscription] Subscription data received:", {
    plan: data.plan,
    status: data.status,
    subscriptionId: data.subscriptionId,
    renewsAt: data.renewsAt,
    expiresAt: data.expiresAt,
  });
  return data;
}

export async function getUserByEmail(email: string): Promise<UserByEmail> {
  const encodedEmail = encodeURIComponent(email);
  const response = await apiFetch(`/api/users/by-email/${encodedEmail}`);
  return response.json();
}

export async function addSubscriptionManager(userId: string): Promise<void> {
  await apiFetch(`/api/subscription/managers/${userId}`, {
    method: "POST",
  });
}

export async function removeSubscriptionManager(userId: string): Promise<void> {
  await apiFetch(`/api/subscription/managers/${userId}`, {
    method: "DELETE",
  });
}

export async function createSubscriptionCheckout(
  plan: "starter" | "pro",
): Promise<{
  checkoutUrl?: string;
  success?: boolean;
  message?: string;
  reactivated?: boolean;
}> {
  const response = await apiFetch("/api/subscription/checkout", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
  return response.json();
}

export async function cancelSubscription(): Promise<void> {
  await apiFetch("/api/subscription/cancel", {
    method: "POST",
  });
}

export async function changeSubscriptionPlan(
  plan: "starter" | "pro",
): Promise<{ success: boolean; message: string }> {
  const response = await apiFetch("/api/subscription/change-plan", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
  return response.json();
}

export async function getSubscriptionPortalUrl(): Promise<{
  portalUrl: string;
}> {
  const response = await apiFetch("/api/subscription/portal");
  return response.json();
}

export async function syncSubscription(): Promise<{
  message: string;
  synced: boolean;
}> {
  console.log("[api.syncSubscription] Calling sync API");
  const response = await apiFetch("/api/subscription/sync", {
    method: "POST",
  });
  const data = await response.json();
  console.log("[api.syncSubscription] Sync response:", data);
  return data;
}

export async function purchaseCredits(
  workspaceId: string,
  amount: number,
): Promise<{ checkoutUrl: string }> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/credits/purchase`,
    {
      method: "POST",
      body: JSON.stringify({ amount }),
    },
  );
  return response.json();
}

// Workspace member management
export async function getWorkspaceMembers(
  workspaceId: string,
): Promise<{ members: Member[] }> {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/members`);
  return response.json();
}

export async function inviteWorkspaceMember(
  workspaceId: string,
  email: string,
  permissionLevel: number,
): Promise<WorkspaceInvite> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/members/invite`,
    {
      method: "POST",
      body: JSON.stringify({ email, permissionLevel }),
    },
  );
  return response.json();
}

export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<void> {
  await apiFetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
    method: "DELETE",
  });
}

// Workspace invite management
export async function getWorkspaceInvite(
  workspaceId: string,
  token: string,
): Promise<WorkspaceInviteDetails> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/invites/${token}`,
  );
  return response.json();
}

export async function acceptWorkspaceInvite(
  workspaceId: string,
  token: string,
): Promise<{
  success: boolean;
  workspaceId: string;
  permissionLevel: number;
  callbackUrl?: string;
}> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/invites/${token}/accept`,
    {
      method: "POST",
    },
  );
  return response.json();
}

export async function getWorkspaceInvites(
  workspaceId: string,
): Promise<{ invites: WorkspaceInviteListItem[] }> {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/invites`);
  return response.json();
}

export interface WorkspaceUserLimit {
  currentUserCount: number;
  maxUsers: number;
  plan: string;
  canInvite: boolean;
}

export async function getWorkspaceUserLimit(
  workspaceId: string,
): Promise<WorkspaceUserLimit> {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/user-limit`);
  return response.json();
}

export async function cancelWorkspaceInvite(
  workspaceId: string,
  inviteId: string,
): Promise<void> {
  await apiFetch(`/api/workspaces/${workspaceId}/invites/${inviteId}`, {
    method: "DELETE",
  });
}

// Stream Server Management API

export interface StreamServerConfig {
  secret: string;
  allowedOrigins: string[];
}

export interface CreateStreamServerInput {
  allowedOrigins: string[];
}

export interface UpdateStreamServerInput {
  allowedOrigins: string[];
}

export interface CreateStreamServerResponse {
  secret: string;
  allowedOrigins: string[];
}

export async function getStreamUrl(): Promise<{ url: string } | null> {
  const response = await apiFetch(`/api/stream-url`, {
    method: "GET",
  });

  if (!response.ok) {
    // For 404 errors (not found), return null instead of throwing
    // This happens when the Lambda Function URL is not deployed yet (e.g., local development)
    if (response.status === 404) {
      return null;
    }

    let errorMessage = response.statusText;
    try {
      const error = await response.json();
      errorMessage = error.message || error.error || errorMessage;
    } catch {
      // If response is not JSON, use status text
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

export async function getStreamServer(
  workspaceId: string,
  agentId: string,
): Promise<StreamServerConfig | null> {
  try {
    const response = await apiFetch(
      `/api/workspaces/${workspaceId}/agents/${agentId}/stream-servers`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    return response.json();
  } catch (error) {
    // If 404, return null (no stream server configured)
    if (
      error instanceof Error &&
      (error.message.includes("404") ||
        error.message.includes("not found") ||
        error.message.includes("Not found"))
    ) {
      return null;
    }
    throw error;
  }
}

export async function createStreamServer(
  workspaceId: string,
  agentId: string,
  input: CreateStreamServerInput,
): Promise<CreateStreamServerResponse> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/stream-servers`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function updateStreamServer(
  workspaceId: string,
  agentId: string,
  input: UpdateStreamServerInput,
): Promise<StreamServerConfig> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/stream-servers`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function deleteStreamServer(
  workspaceId: string,
  agentId: string,
): Promise<void> {
  await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/stream-servers`,
    {
      method: "DELETE",
    },
  );
}

// Bot Integration Management API

export interface BotIntegration {
  id: string;
  platform: "slack" | "discord";
  name: string;
  agentId: string;
  webhookUrl: string;
  status: "active" | "inactive" | "error";
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt?: string;
  discordCommand?: {
    commandName: string;
    commandId: string;
  };
}

export interface CreateIntegrationInput {
  platform: "slack" | "discord";
  name: string;
  agentId: string;
  config: {
    // Slack
    botToken?: string;
    signingSecret?: string;
    teamId?: string;
    teamName?: string;
    messageHistoryCount?: number;
    // Discord
    publicKey?: string;
    applicationId?: string;
  };
}

export interface UpdateIntegrationInput {
  name?: string;
  status?: "active" | "inactive" | "error";
  config?: Partial<CreateIntegrationInput["config"]>;
}

export interface SlackManifestResponse {
  manifest: unknown;
  webhookUrl: string;
  instructions: string[];
}

export async function listIntegrations(
  workspaceId: string,
): Promise<BotIntegration[]> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/integrations`,
  );
  return response.json();
}

export async function getIntegration(
  workspaceId: string,
  integrationId: string,
): Promise<BotIntegration> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/integrations/${integrationId}`,
  );
  return response.json();
}

export async function createIntegration(
  workspaceId: string,
  input: CreateIntegrationInput,
): Promise<BotIntegration> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/integrations`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function updateIntegration(
  workspaceId: string,
  integrationId: string,
  input: UpdateIntegrationInput,
): Promise<BotIntegration> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/integrations/${integrationId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function deleteIntegration(
  workspaceId: string,
  integrationId: string,
): Promise<void> {
  await apiFetch(
    `/api/workspaces/${workspaceId}/integrations/${integrationId}`,
    {
      method: "DELETE",
    },
  );
}

export async function registerDiscordCommand(
  workspaceId: string,
  integrationId: string,
  commandName: string,
): Promise<BotIntegration> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/integrations/${integrationId}/discord-command`,
    {
      method: "POST",
      body: JSON.stringify({ commandName }),
    },
  );
  return response.json();
}

export async function generateSlackManifest(
  workspaceId: string,
  agentId: string,
  agentName?: string,
): Promise<SlackManifestResponse> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/integrations/slack/manifest`,
    {
      method: "POST",
      body: JSON.stringify({ agentId, agentName }),
    },
  );
  return response.json();
}

// User API Keys API

export interface UserApiKey {
  id: string;
  name: string | null;
  keyPrefix: string;
  maskedKey: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreateUserApiKeyInput {
  name?: string;
}

export interface CreateUserApiKeyResponse {
  id: string;
  key: string; // Only shown once
  name: string | null;
  keyPrefix: string;
  createdAt: string;
}

export async function listUserApiKeys(): Promise<UserApiKey[]> {
  const response = await apiFetch("/api/user/api-keys");
  return response.json();
}

export async function createUserApiKey(
  input: CreateUserApiKeyInput,
): Promise<CreateUserApiKeyResponse> {
  const response = await apiFetch("/api/user/api-keys", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.json();
}

export async function deleteUserApiKey(keyId: string): Promise<void> {
  await apiFetch(`/api/user/api-keys/${keyId}`, {
    method: "DELETE",
  });
}

// Evaluation Judge Management API

export interface EvalJudge {
  id: string;
  name: string;
  enabled: boolean;
  samplingProbability: number;
  provider: "openrouter"; // Only openrouter is supported for eval judges
  modelName: string;
  evalPrompt: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateEvalJudgeInput {
  name: string;
  enabled?: boolean;
  samplingProbability?: number;
  provider?: "openrouter"; // Only openrouter is supported for eval judges
  modelName: string;
  evalPrompt: string;
}

export interface UpdateEvalJudgeInput {
  name?: string;
  enabled?: boolean;
  samplingProbability?: number;
  provider?: "openrouter"; // Only openrouter is supported for eval judges
  modelName?: string;
  evalPrompt?: string;
}

// Agent Schedule Management API

export interface AgentSchedule {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateAgentScheduleInput {
  name: string;
  cronExpression: string;
  prompt: string;
  enabled?: boolean;
}

export interface UpdateAgentScheduleInput {
  name?: string;
  cronExpression?: string;
  prompt?: string;
  enabled?: boolean;
}

export interface EvalResult {
  conversationId: string;
  judgeId: string;
  judgeName: string;
  status: "completed" | "failed";
  summary: string;
  scoreGoalCompletion: number | null;
  scoreToolEfficiency: number | null;
  scoreFaithfulness: number | null;
  criticalFailureDetected: boolean;
  reasoningTrace: string;
  errorMessage?: string;
  errorDetails?: string;
  costUsd: number | null;
  evaluatedAt: string;
}

export interface EvalResultsResponse {
  totalEvaluations: number;
  averageScores: {
    goalCompletion: number;
    toolEfficiency: number;
    faithfulness: number;
  };
  criticalFailures: number;
  results: EvalResult[];
  nextCursor?: string;
}

export interface GetAgentEvalResultsParams {
  startDate?: string;
  endDate?: string;
  judgeId?: string;
  limit?: number;
  cursor?: string;
}

export async function listEvalJudges(
  workspaceId: string,
  agentId: string,
): Promise<EvalJudge[]> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/eval-judges`,
  );
  return response.json();
}

export async function getEvalJudge(
  workspaceId: string,
  agentId: string,
  judgeId: string,
): Promise<EvalJudge> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/eval-judges/${judgeId}`,
  );
  return response.json();
}

export async function createEvalJudge(
  workspaceId: string,
  agentId: string,
  input: CreateEvalJudgeInput,
): Promise<EvalJudge> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/eval-judges`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function updateEvalJudge(
  workspaceId: string,
  agentId: string,
  judgeId: string,
  input: UpdateEvalJudgeInput,
): Promise<EvalJudge> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/eval-judges/${judgeId}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function deleteEvalJudge(
  workspaceId: string,
  agentId: string,
  judgeId: string,
): Promise<void> {
  await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/eval-judges/${judgeId}`,
    {
      method: "DELETE",
    },
  );
}

export async function listAgentSchedules(
  workspaceId: string,
  agentId: string,
): Promise<AgentSchedule[]> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/schedules`,
  );
  return response.json();
}

export async function getAgentSchedule(
  workspaceId: string,
  agentId: string,
  scheduleId: string,
): Promise<AgentSchedule> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/schedules/${scheduleId}`,
  );
  return response.json();
}

export async function createAgentSchedule(
  workspaceId: string,
  agentId: string,
  input: CreateAgentScheduleInput,
): Promise<AgentSchedule> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/schedules`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function updateAgentSchedule(
  workspaceId: string,
  agentId: string,
  scheduleId: string,
  input: UpdateAgentScheduleInput,
): Promise<AgentSchedule> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/schedules/${scheduleId}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

export async function deleteAgentSchedule(
  workspaceId: string,
  agentId: string,
  scheduleId: string,
): Promise<void> {
  await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/schedules/${scheduleId}`,
    {
      method: "DELETE",
    },
  );
}

export async function getAgentEvalResults(
  workspaceId: string,
  agentId: string,
  params?: GetAgentEvalResultsParams,
): Promise<EvalResultsResponse> {
  const queryParams = new URLSearchParams();
  if (params?.startDate) {
    queryParams.append("startDate", params.startDate);
  }
  if (params?.endDate) {
    queryParams.append("endDate", params.endDate);
  }
  if (params?.judgeId) {
    queryParams.append("judgeId", params.judgeId);
  }
  if (params?.limit) {
    queryParams.append("limit", params.limit.toString());
  }
  if (params?.cursor) {
    queryParams.append("cursor", params.cursor);
  }
  const queryString = queryParams.toString();
  const url = `/api/workspaces/${workspaceId}/agents/${agentId}/eval-results${
    queryString ? `?${queryString}` : ""
  }`;
  const response = await apiFetch(url);
  return response.json();
}

export async function getConversationEvalResults(
  workspaceId: string,
  agentId: string,
  conversationId: string,
): Promise<EvalResult[]> {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/conversations/${conversationId}/eval-results`,
  );
  return response.json();
}
