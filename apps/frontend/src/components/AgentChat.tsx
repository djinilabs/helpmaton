import { useChat } from "@ai-sdk/react";
import { ChartBarIcon, TrashIcon } from "@heroicons/react/24/outline";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FC } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useAgentOptional } from "../hooks/useAgents";
import { getAccessToken } from "../utils/api";
import { getDefaultAvatar } from "../utils/avatarUtils";
import { getTokenUsageColor, getCostColor } from "../utils/colorUtils";
import { formatCurrency } from "../utils/currency";
import { getMessageCost } from "../utils/messageCost";

interface AgentChatProps {
  workspaceId: string;
  agentId: string;
  api?: string; // Optional custom API endpoint URL
  onClear?: () => void; // Callback when conversation is cleared
  tools?: Record<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool functions can have any signature
    (...args: any[]) => Promise<any>
  >; // Optional client-side tool functions
  agent?: { name?: string; avatar?: string }; // Optional agent data (if provided, useAgent hook is not required)
  isWidget?: boolean; // If true, hide test message and use widget-appropriate styling
}

/**
 * Generate a UUID v4 (fallback for older browsers)
 */
function generateUUID(): string {
  // Use crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback: generate UUID v4 manually
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const AgentChat: FC<AgentChatProps> = ({
  workspaceId,
  agentId,
  api,
  onClear,
  tools,
  agent: agentProp,
  isWidget = false,
}) => {
  // Use agent prop if provided, otherwise fetch from API
  // When agentProp is provided (e.g., in widget context), skip the query to avoid auth errors
  // Always call useAgentOptional to satisfy rules of hooks
  // When agentProp is provided, the query is disabled (skip=true), preventing API calls
  // When agentProp is not provided, the query runs (skip=false) for normal app usage
  // Note: We lose suspense behavior in normal app usage, but the query will still work
  const { data: agentFromHook } = useAgentOptional(
    workspaceId,
    agentId,
    !!agentProp // Skip query if agentProp is provided (widget context)
  );
  const agent = agentProp || agentFromHook;
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  // State to track API errors that might not be caught by useChat
  const [apiError, setApiError] = useState<Error | null>(null);

  // Generate and memoize conversation ID for this chat instance
  const conversationId = useMemo(() => generateUUID(), []);

  // Determine the API endpoint URL
  // If api prop is provided (Function URL), use it; otherwise fall back to API Gateway
  const apiUrl = useMemo(() => {
    if (api) {
      console.log("[AgentChat] Using provided API URL:", api);
      return api;
    }

    // Fallback to API Gateway URL
    const gatewayUrl = `/api/workspaces/${workspaceId}/agents/${agentId}/test`;
    console.log("[AgentChat] Using API Gateway URL:", gatewayUrl);
    return gatewayUrl;
  }, [api, workspaceId, agentId]);

  // Create a custom fetch function that adds the X-Conversation-Id header
  // and Authorization header for cross-origin Function URL requests
  const fetchWithConversationId = useMemo(() => {
    return async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      // Use the global fetch (which includes Authorization header for same-origin requests)
      const globalFetch = typeof window !== "undefined" ? window.fetch : fetch;

      // Parse URL to determine if it's cross-origin (Function URL)
      const urlString =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : typeof input === "object" && "url" in input
          ? input.url
          : String(input);

      let requestUrl: URL;
      let isCrossOrigin = false;
      if (typeof window !== "undefined") {
        try {
          requestUrl = new URL(urlString, window.location.origin);
          isCrossOrigin = requestUrl.origin !== window.location.origin;
        } catch {
          // If URL parsing fails, assume same-origin
        }
      }

      // Add X-Conversation-Id header to the request
      const headers = new Headers(init?.headers);
      headers.set("X-Conversation-Id", conversationId);

      // For cross-origin requests (Function URLs), explicitly add Authorization header
      // The global fetch override only adds it for same-origin requests
      if (isCrossOrigin && typeof window !== "undefined") {
        const accessToken = getAccessToken();
        if (accessToken) {
          headers.set("Authorization", `Bearer ${accessToken}`);
        }
      }

      try {
        const response = await globalFetch(input, {
          ...init,
          headers,
        });

        // Check for error responses (non-2xx status codes)
        if (!response.ok) {
          let errorMessage = `Request failed with status ${response.status}`;
          
          // Try to parse error message from JSON response
          try {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
              // Clone the response to read it without consuming the original
              const clonedResponse = response.clone();
              const errorData = await clonedResponse.json();
              if (errorData.error) {
                errorMessage = typeof errorData.error === "string" 
                  ? errorData.error 
                  : errorData.error.message || errorMessage;
              } else if (errorData.message) {
                errorMessage = errorData.message;
              }
            } else {
              // Try to get text response
              const clonedResponse = response.clone();
              const text = await clonedResponse.text();
              if (text) {
                // Try to parse as JSON if it looks like JSON
                try {
                  const parsed = JSON.parse(text);
                  if (parsed.error) {
                    errorMessage = typeof parsed.error === "string"
                      ? parsed.error
                      : parsed.error.message || errorMessage;
                  } else if (parsed.message) {
                    errorMessage = parsed.message;
                  }
                } catch {
                  // Not JSON, use text as error message if it's not too long
                  if (text.length < 500) {
                    errorMessage = text;
                  }
                }
              }
            }
          } catch (parseError) {
            // If we can't parse the error, use the default message
            console.error("[AgentChat] Error parsing error response:", parseError);
          }

          // Set the error state so it can be displayed in the UI
          setApiError(new Error(errorMessage));
        } else {
          // Clear error on successful response
          setApiError(null);
        }

        return response;
      } catch (fetchError) {
        // Network errors or other fetch failures
        const errorMessage = fetchError instanceof Error 
          ? fetchError.message 
          : "Failed to send request";
        setApiError(new Error(errorMessage));
        throw fetchError;
      }
    };
  }, [conversationId]);

  // Determine credentials based on whether we're using a Function URL
  // Lambda Function URLs don't use cookies, so omit credentials
  // API Gateway uses cookies, so include credentials
  const useCredentials = useMemo(() => {
    // If api prop is provided and it's a full URL (starts with http), it's a Function URL
    if (api && api.startsWith("http")) {
      return "omit";
    }
    // Otherwise, it's API Gateway (relative URL or undefined)
    return "include";
  }, [api]);

  const { messages, sendMessage, status, error, addToolOutput, setMessages } =
    useChat({
      transport: new DefaultChatTransport({
        api: apiUrl,
        credentials: useCredentials,
        // Use custom fetch that includes X-Conversation-Id header
        fetch: fetchWithConversationId,
      }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onToolCall: async ({ toolCall }) => {
        console.log("[AgentChat] Tool call:", toolCall);

        // If tools are provided, try to execute the tool
        if (tools && toolCall.toolName in tools) {
          try {
            const toolFunction = tools[toolCall.toolName];
            // Extract args from toolCall - AI SDK uses different property names
            // Check for 'args', 'input', or access via index signature
            const toolCallAny = toolCall as unknown as {
              toolName: string;
              toolCallId: string;
              args?: Record<string, unknown>;
              input?: Record<string, unknown>;
              [key: string]: unknown;
            };
            const args = (toolCallAny.args ||
              toolCallAny.input ||
              {}) as Record<string, unknown>;
            // Pass the entire args object as a single argument
            // This is the standard pattern for AI SDK tool handlers
            // Tool functions should destructure what they need: async ({ param1, param2 }) => {...}
            const result = await toolFunction(args);

            // Return successful result
            // AI SDK expects 'output' property, not 'result'
            addToolOutput({
              tool: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              state: "output-available",
              output:
                typeof result === "string" ? result : JSON.stringify(result),
            });
          } catch (error) {
            // Return error result
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            addToolOutput({
              tool: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              state: "output-error",
              errorText: `Error executing tool: ${errorMessage}`,
            });
          }
        } else {
          // No tools provided or tool not found - return error
          addToolOutput({
            tool: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText: `Tool '${toolCall.toolName}' is not defined on the client`,
          });
        }
      },
      onError: (error) => {
        console.error("Chat error:", error);
        // Also set the error state so it's displayed
        setApiError(error instanceof Error ? error : new Error(String(error)));
      },
    });

  const isLoading = status === "submitted" || status === "streaming";

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      // Reset height to auto to get the correct scrollHeight
      textareaRef.current.style.height = "auto";
      // Set height based on scrollHeight, with min and max constraints
      const maxHeight = 200; // Maximum height in pixels (about 8-10 lines)
      const minHeight = 56; // Minimum height (matches padding + one line)
      const newHeight = Math.min(
        Math.max(textareaRef.current.scrollHeight, minHeight),
        maxHeight
      );
      textareaRef.current.style.height = `${newHeight}px`;
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setInput(e.target.value);
    // Adjust height after state update
    setTimeout(adjustTextareaHeight, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If Enter is pressed without Shift modifier, submit the form
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    // If Enter is pressed with Shift, allow default behavior (new line)
  };

  const handleSubmit = (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;
    // Clear any previous errors when sending a new message
    setApiError(null);
    sendMessage({ text: input });
    setInput("");
    // Reset textarea height after clearing input
    setTimeout(adjustTextareaHeight, 0);
  };

  const handleClearConversation = () => {
    setMessages([]);
    setApiError(null); // Clear API errors when clearing conversation
    // Notify parent to remount component, which will clear errors
    onClear?.();
  };

  // Auto-scroll to bottom when messages or loading state changes
  useEffect(() => {
    if (messagesContainerRef.current) {
      // Use setTimeout to ensure DOM has updated after message rendering
      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop =
            messagesContainerRef.current.scrollHeight;
        }
      }, 0);
    }
  }, [messages, isLoading]);

  // Auto-focus textarea when component mounts (when Test Agent section is expanded)
  useEffect(() => {
    // Small delay to ensure textarea is fully rendered
    const timeoutId = setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        adjustTextareaHeight();
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, []);

  // Adjust textarea height when input changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [input]);

  return (
    <div className={`flex ${isWidget ? "h-full" : "h-[600px]"} flex-col rounded-2xl border-2 border-neutral-300 bg-white shadow-large dark:border-neutral-700 dark:bg-neutral-900`}>
      {!isWidget && (
        <div className="rounded-t-2xl border-b-2 border-neutral-300 bg-neutral-100 p-5 dark:border-neutral-700 dark:bg-neutral-800">
          <div className="flex items-center justify-between gap-4">
            <p className="text-base font-bold text-neutral-800 dark:text-neutral-200">
              Test your agent by having a conversation. This chat interface lets
              you interact with the agent in real-time to verify its behavior and
              responses before deploying it.
            </p>
            {messages.length > 0 && (
              <button
                onClick={handleClearConversation}
                disabled={isLoading}
                className="flex shrink-0 items-center gap-2 rounded-lg border-2 border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                title="Clear conversation"
              >
                <TrashIcon className="size-4" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            )}
          </div>
        </div>
      )}
      {isWidget && messages.length > 0 && (
        <div className="rounded-t-2xl border-b-2 border-neutral-300 bg-neutral-100 p-3 dark:border-neutral-700 dark:bg-neutral-800">
          <div className="flex items-center justify-end">
            <button
              onClick={handleClearConversation}
              disabled={isLoading}
              className="flex shrink-0 items-center gap-2 rounded-lg border-2 border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              title="Clear conversation"
            >
              <TrashIcon className="size-4" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          </div>
        </div>
      )}
      {/* Messages Container */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto bg-white p-4 dark:bg-neutral-900"
      >
        {(error || apiError) && (
          <div className="mb-4 rounded-xl border-2 border-error-300 bg-error-100 p-5 dark:border-error-800 dark:bg-error-900">
            <div className="text-base font-bold text-error-900 dark:text-error-50">
              Error
            </div>
            <div className="mt-2 text-sm font-medium text-error-800 dark:text-error-100">
              {(error || apiError)?.message || "An error occurred"}
            </div>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="py-10 text-center text-base font-bold text-neutral-600 dark:text-neutral-300">
            No messages yet. Start a conversation.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Render all messages and parts in order */}
            {messages.map((message) => {
              // Check if this is a knowledge injection message
              const isKnowledgeInjection =
                message.role === "user" &&
                typeof message === "object" &&
                message !== null &&
                "knowledgeInjection" in message &&
                (message as { knowledgeInjection?: boolean }).knowledgeInjection === true;

              // Get snippet count for knowledge injection messages
              const snippetCount =
                isKnowledgeInjection &&
                typeof message === "object" &&
                message !== null &&
                "knowledgeSnippets" in message &&
                Array.isArray((message as { knowledgeSnippets?: unknown }).knowledgeSnippets)
                  ? ((message as { knowledgeSnippets: unknown[] }).knowledgeSnippets).length
                  : 0;

              const getRoleLabel = () => {
                switch (message.role) {
                  case "user":
                    return "You";
                  case "assistant":
                    return "Agent";
                  case "system":
                    return "System";
                  default:
                    return message.role;
                }
              };

              const getRoleStyling = () => {
                switch (message.role) {
                  case "user":
                    return "bg-gradient-primary text-white ml-auto shadow-colored";
                  case "system":
                    return "bg-neutral-200 text-neutral-800 italic border-2 border-neutral-400 font-bold dark:bg-neutral-700 dark:text-neutral-200 dark:border-neutral-600";
                  case "assistant":
                  default:
                    return "bg-neutral-100 text-neutral-900 border-2 border-neutral-300 dark:bg-neutral-800 dark:text-neutral-50 dark:border-neutral-700";
                }
              };

              // Special rendering for knowledge injection messages
              if (isKnowledgeInjection) {
                // Type guard for knowledge injection message
                const knowledgeMessage = message as {
                  role: "user";
                  content?: string | Array<{ type: string; text?: string }>;
                  knowledgeInjection?: boolean;
                  knowledgeSnippets?: Array<{
                    snippet: string;
                    documentName: string;
                    documentId: string;
                    folderPath: string;
                    similarity: number;
                  }>;
                };

                const snippets = knowledgeMessage.knowledgeSnippets || [];

                return (
                  <div key={message.id} className="max-w-[80%] overflow-x-auto">
                    <details className="rounded-xl border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950">
                      <summary className="cursor-pointer p-4">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">📚</span>
                          <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                            Knowledge from workspace documents
                            {snippetCount > 0 && ` (${snippetCount} snippet${snippetCount !== 1 ? "s" : ""})`}
                          </span>
                        </div>
                      </summary>
                      <div className="border-t border-purple-200 p-4 dark:border-purple-800">
                        <div className="space-y-3">
                          {snippets.length > 0 ? (
                            snippets.map((snippet, snippetIndex) => {
                              const similarityPercent = (
                                snippet.similarity * 100
                              ).toFixed(1);
                              return (
                                <details
                                  key={snippetIndex}
                                  className="rounded-lg border border-purple-300 bg-purple-100 dark:border-purple-700 dark:bg-purple-900"
                                >
                                  <summary className="cursor-pointer p-3">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1">
                                        <div className="text-xs font-semibold text-purple-800 dark:text-purple-200">
                                          {snippet.documentName}
                                          {snippet.folderPath && (
                                            <span className="ml-2 font-normal text-purple-600 dark:text-purple-400">
                                              ({snippet.folderPath})
                                            </span>
                                          )}
                                        </div>
                                        <div className="mt-1 text-xs text-purple-700 dark:text-purple-300">
                                          Similarity: {similarityPercent}%
                                        </div>
                                      </div>
                                      <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                                        #{snippetIndex + 1}
                                      </span>
                                    </div>
                                  </summary>
                                  <div className="border-t border-purple-300 p-3 dark:border-purple-700">
                                    <div className="text-sm text-purple-900 dark:text-purple-100">
                                      <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                          code: (props) => {
                                            const { className, children, ...rest } = props;
                                            const isInline =
                                              !className ||
                                              !className.includes("language-");
                                            if (isInline) {
                                              return (
                                                <code
                                                  className="rounded-lg border-2 border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-xs font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                                                  {...rest}
                                                >
                                                  {children}
                                                </code>
                                              );
                                            }
                                            return (
                                              <code
                                                className="block overflow-x-auto rounded-xl border-2 border-neutral-300 bg-neutral-100 p-5 font-mono text-sm font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                                                {...rest}
                                              >
                                                {children}
                                              </code>
                                            );
                                          },
                                          p: ({ children }) => (
                                            <p className="mb-2 last:mb-0">{children}</p>
                                          ),
                                        }}
                                      >
                                        {snippet.snippet}
                                      </ReactMarkdown>
                                    </div>
                                  </div>
                                </details>
                              );
                            })
                          ) : (
                            <div className="text-sm text-purple-700 dark:text-purple-300">
                              No snippets available
                            </div>
                          )}
                        </div>
                      </div>
                    </details>
                  </div>
                );
              }

              const renderPart = (part: unknown, partIndex: number) => {
                if (
                  !part ||
                  typeof part !== "object" ||
                  !("type" in part) ||
                  typeof part.type !== "string"
                ) {
                  return null;
                }

                const partType = part.type;

                // Text part
                if (partType === "text" && "text" in part) {
                  const textPart = part as { type: "text"; text: string };
                  return (
                    <div
                      key={`${message.id}-part-${partIndex}`}
                      className="text-sm"
                    >
                      {message.role === "user" ? (
                        <div className="whitespace-pre-wrap break-words">
                          {textPart.text}
                        </div>
                      ) : (
                        textPart.text.trim() && (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              code: (props) => {
                                const { className, children, ...rest } = props;
                                const isInline =
                                  !className ||
                                  !className.includes("language-");
                                if (isInline) {
                                  return (
                                    <code
                                      className="rounded-lg border-2 border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-xs font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                                      {...rest}
                                    >
                                      {children}
                                    </code>
                                  );
                                }
                                return (
                                  <code
                                    className="block overflow-x-auto rounded-xl border-2 border-neutral-300 bg-neutral-100 p-5 font-mono text-sm font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                                    {...rest}
                                  >
                                    {children}
                                  </code>
                                );
                              },
                              p: ({ children }) => (
                                <p className="mb-2 last:mb-0">{children}</p>
                              ),
                            }}
                          >
                            {textPart.text}
                          </ReactMarkdown>
                        )
                      )}
                    </div>
                  );
                }

                // Reasoning part
                if (partType === "reasoning" && "text" in part) {
                  const reasoningPart = part as {
                    type: "reasoning";
                    text: string;
                  };
                  return (
                    <div
                      key={`${message.id}-part-${partIndex}`}
                      className="max-w-[80%] overflow-x-auto rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950"
                    >
                      <div className="mb-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                        🧠 Reasoning
                      </div>
                      <div className="whitespace-pre-wrap break-words overflow-x-auto text-sm text-indigo-900 dark:text-indigo-100">
                        {reasoningPart.text}
                      </div>
                    </div>
                  );
                }

                // Tool calls - dynamic-tool
                if (
                  partType === "dynamic-tool" &&
                  "toolName" in part &&
                  "toolCallId" in part
                ) {
                  const toolPart = part as {
                    type: "dynamic-tool";
                    toolName: string;
                    toolCallId: string;
                    input?: unknown;
                    output?: unknown;
                    errorText?: string;
                    state?: string;
                  };
                  const toolInput = toolPart.input || {};
                  const hasOutput =
                    "output" in toolPart && toolPart.output !== undefined;
                  const hasError =
                    "errorText" in toolPart && toolPart.errorText;

                  return (
                    <div
                      key={`${message.id}-part-${partIndex}`}
                      className="max-w-[80%] overflow-x-auto rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950"
                    >
                      <div className="mb-2 text-xs font-medium text-blue-700 dark:text-blue-300">
                        🔧 Tool Call: {toolPart.toolName}
                      </div>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded bg-blue-100 px-2 py-1 font-mono text-xs font-semibold text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                          {toolPart.toolName}
                        </span>
                        {toolPart.state && (
                          <span className="text-xs text-blue-600 dark:text-blue-400">
                            ({toolPart.state})
                          </span>
                        )}
                      </div>
                      <details className="text-xs">
                        <summary className="cursor-pointer font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
                          View{" "}
                          {hasOutput
                            ? "output"
                            : hasError
                            ? "error"
                            : "arguments"}
                        </summary>
                        <div className="mt-2 space-y-2">
                          <div>
                            <div className="mb-1 font-medium text-blue-700 dark:text-blue-300">
                              Arguments:
                            </div>
                            <pre className="overflow-x-auto rounded bg-blue-100 p-2 text-xs dark:bg-blue-900 dark:text-blue-50">
                              {JSON.stringify(toolInput, null, 2)}
                            </pre>
                          </div>
                          {hasOutput && (
                            <div>
                              <div className="mb-1 font-medium text-green-700 dark:text-green-300">
                                Output:
                              </div>
                              {typeof toolPart.output === "string" ? (
                                <div className="rounded bg-green-100 p-2 text-xs dark:bg-green-900 dark:text-green-50">
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      code: (props) => {
                                        const { className, children, ...rest } =
                                          props;
                                        const isInline =
                                          !className ||
                                          !className.includes("language-");
                                        if (isInline) {
                                          return (
                                            <code
                                              className="rounded-lg border-2 border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-xs font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                                              {...rest}
                                            >
                                              {children}
                                            </code>
                                          );
                                        }
                                        return (
                                          <code
                                            className="block overflow-x-auto rounded-xl border-2 border-neutral-300 bg-neutral-100 p-5 font-mono text-sm font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                                            {...rest}
                                          >
                                            {children}
                                          </code>
                                        );
                                      },
                                      p: ({ children }) => (
                                        <p className="mb-2 last:mb-0">
                                          {children}
                                        </p>
                                      ),
                                    }}
                                  >
                                    {toolPart.output}
                                  </ReactMarkdown>
                                </div>
                              ) : (
                                <pre className="overflow-x-auto rounded bg-green-100 p-2 text-xs dark:bg-green-900 dark:text-green-50">
                                  {JSON.stringify(toolPart.output, null, 2)}
                                </pre>
                              )}
                            </div>
                          )}
                          {hasError && (
                            <div>
                              <div className="mb-1 font-medium text-red-700 dark:text-red-300">
                                Error:
                              </div>
                              <div className="rounded bg-red-100 p-2 text-xs text-red-800 dark:bg-red-900 dark:text-red-200">
                                {toolPart.errorText}
                              </div>
                            </div>
                          )}
                        </div>
                      </details>
                    </div>
                  );
                }

                // Tool calls - tool-${name}
                if (
                  typeof partType === "string" &&
                  partType.startsWith("tool-") &&
                  "toolCallId" in part
                ) {
                  const toolName = partType.substring(5);
                  const toolPart = part as {
                    type: string;
                    toolCallId: string;
                    input?: unknown;
                    output?: unknown;
                    errorText?: string;
                    state?: string;
                  };
                  const toolInput = toolPart.input || {};
                  const hasOutput =
                    "output" in toolPart && toolPart.output !== undefined;
                  const hasError =
                    "errorText" in toolPart && toolPart.errorText;

                  return (
                    <div
                      key={`${message.id}-part-${partIndex}`}
                      className="max-w-[80%] overflow-x-auto rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950"
                    >
                      <div className="mb-2 text-xs font-medium text-blue-700 dark:text-blue-300">
                        🔧 Tool Call: {toolName}
                      </div>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded bg-blue-100 px-2 py-1 font-mono text-xs font-semibold text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                          {toolName}
                        </span>
                        {toolPart.state && (
                          <span className="text-xs text-blue-600 dark:text-blue-400">
                            ({toolPart.state})
                          </span>
                        )}
                      </div>
                      <details className="text-xs">
                        <summary className="cursor-pointer font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
                          View{" "}
                          {hasOutput
                            ? "output"
                            : hasError
                            ? "error"
                            : "arguments"}
                        </summary>
                        <div className="mt-2 space-y-2">
                          <div>
                            <div className="mb-1 font-medium text-blue-700 dark:text-blue-300">
                              Arguments:
                            </div>
                            <pre className="overflow-x-auto rounded bg-blue-100 p-2 text-xs dark:bg-blue-900 dark:text-blue-50">
                              {JSON.stringify(toolInput, null, 2)}
                            </pre>
                          </div>
                          {hasOutput && (
                            <div>
                              <div className="mb-1 font-medium text-green-700 dark:text-green-300">
                                Output:
                              </div>
                              {typeof toolPart.output === "string" ? (
                                <div className="rounded bg-green-100 p-2 text-xs dark:bg-green-900 dark:text-green-50">
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      code: (props) => {
                                        const { className, children, ...rest } =
                                          props;
                                        const isInline =
                                          !className ||
                                          !className.includes("language-");
                                        if (isInline) {
                                          return (
                                            <code
                                              className="rounded-lg border-2 border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-xs font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                                              {...rest}
                                            >
                                              {children}
                                            </code>
                                          );
                                        }
                                        return (
                                          <code
                                            className="block overflow-x-auto rounded-xl border-2 border-neutral-300 bg-neutral-100 p-5 font-mono text-sm font-bold dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
                                            {...rest}
                                          >
                                            {children}
                                          </code>
                                        );
                                      },
                                      p: ({ children }) => (
                                        <p className="mb-2 last:mb-0">
                                          {children}
                                        </p>
                                      ),
                                    }}
                                  >
                                    {toolPart.output}
                                  </ReactMarkdown>
                                </div>
                              ) : (
                                <pre className="overflow-x-auto rounded bg-green-100 p-2 text-xs dark:bg-green-900 dark:text-green-50">
                                  {JSON.stringify(toolPart.output, null, 2)}
                                </pre>
                              )}
                            </div>
                          )}
                          {hasError && (
                            <div>
                              <div className="mb-1 font-medium text-red-700 dark:text-red-300">
                                Error:
                              </div>
                              <div className="rounded bg-red-100 p-2 text-xs text-red-800 dark:bg-red-900 dark:text-red-200">
                                {toolPart.errorText}
                              </div>
                            </div>
                          )}
                        </div>
                      </details>
                    </div>
                  );
                }

                // Source URL part
                if (
                  partType === "source-url" &&
                  "url" in part &&
                  "sourceId" in part
                ) {
                  const sourcePart = part as {
                    type: "source-url";
                    sourceId: string;
                    url: string;
                    title?: string;
                  };
                  return (
                    <div
                      key={`${message.id}-part-${partIndex}`}
                      className="max-w-[80%] overflow-x-auto rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
                    >
                      <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                        📎 Source
                      </div>
                      <a
                        href={sourcePart.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-sm text-amber-900 underline hover:text-amber-700 dark:text-amber-100 dark:hover:text-amber-300"
                      >
                        {sourcePart.title || sourcePart.url}
                      </a>
                    </div>
                  );
                }

                // Source document part
                if (
                  partType === "source-document" &&
                  "sourceId" in part &&
                  "title" in part
                ) {
                  const docPart = part as {
                    type: "source-document";
                    sourceId: string;
                    mediaType: string;
                    title: string;
                    filename?: string;
                  };
                  return (
                    <div
                      key={`${message.id}-part-${partIndex}`}
                      className="max-w-[80%] overflow-x-auto rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
                    >
                      <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                        📄 Document Source
                      </div>
                      <div className="text-sm font-medium text-amber-900 dark:text-amber-100">
                        {docPart.title}
                      </div>
                      {docPart.filename && (
                        <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                          {docPart.filename}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        {docPart.mediaType}
                      </div>
                    </div>
                  );
                }

                // File part
                if (
                  partType === "file" &&
                  "url" in part &&
                  "mediaType" in part
                ) {
                  const filePart = part as {
                    type: "file";
                    url: string;
                    mediaType: string;
                    filename?: string;
                  };
                  return (
                    <div
                      key={`${message.id}-part-${partIndex}`}
                      className="max-w-[80%] overflow-x-auto rounded-xl border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950"
                    >
                      <div className="mb-1 text-xs font-medium text-purple-700 dark:text-purple-300">
                        📎 File
                      </div>
                      <div className="text-sm font-medium text-purple-900 dark:text-purple-100">
                        {filePart.filename || "Untitled file"}
                      </div>
                      <div className="mt-1 text-xs text-purple-600 dark:text-purple-400">
                        {filePart.mediaType}
                      </div>
                      <a
                        href={filePart.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-xs text-purple-700 underline hover:text-purple-900 dark:text-purple-300 dark:hover:text-purple-200"
                      >
                        View/Download
                      </a>
                    </div>
                  );
                }

                // Data part - data-${name}
                if (
                  typeof partType === "string" &&
                  partType.startsWith("data-") &&
                  "data" in part
                ) {
                  const dataName = partType.substring(5);
                  const dataPart = part as {
                    type: string;
                    data: unknown;
                    id?: string;
                  };
                  return (
                    <div
                      key={`${message.id}-part-${partIndex}`}
                      className="max-w-[80%] overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"
                    >
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                        <ChartBarIcon className="size-3" />
                        Data: {dataName}
                      </div>
                      <details className="text-xs">
                        <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
                          View data
                        </summary>
                        <pre className="mt-2 overflow-x-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-900 dark:text-slate-50">
                          {JSON.stringify(dataPart.data, null, 2)}
                        </pre>
                      </details>
                    </div>
                  );
                }

                // Step start part
                if (partType === "step-start") {
                  return (
                    <div
                      key={`${message.id}-part-${partIndex}`}
                      className="my-2 flex max-w-[80%] items-center gap-2"
                    >
                      <div className="flex-1 border-t border-neutral-300 dark:border-neutral-600"></div>
                      <div className="px-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                        Step
                      </div>
                      <div className="flex-1 border-t border-neutral-300 dark:border-neutral-600"></div>
                    </div>
                  );
                }

                // Unknown part type - render as fallback
                return (
                  <div
                    key={`${message.id}-part-${partIndex}`}
                    className="max-w-[80%] overflow-x-auto rounded-xl border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950"
                  >
                    <div className="mb-1 text-xs font-medium text-yellow-700 dark:text-yellow-300">
                      Unknown part type: {partType}
                    </div>
                    <pre className="overflow-x-auto text-xs text-yellow-900 dark:text-yellow-100">
                      {JSON.stringify(part, null, 2)}
                    </pre>
                  </div>
                );
              };

              // Check if message has tokenUsage (can exist on any message type)
              const tokenUsage =
                "tokenUsage" in message &&
                message.tokenUsage &&
                typeof message.tokenUsage === "object" &&
                "totalTokens" in message.tokenUsage
                  ? (message.tokenUsage as {
                      promptTokens?: number;
                      completionTokens?: number;
                      totalTokens?: number;
                      reasoningTokens?: number;
                      cachedPromptTokens?: number;
                    })
                  : null;

              // Check if message has modelName and provider (for assistant messages)
              const modelName =
                message.role === "assistant" &&
                "modelName" in message &&
                typeof message.modelName === "string"
                  ? message.modelName
                  : null;
              const provider =
                message.role === "assistant" &&
                "provider" in message &&
                typeof message.provider === "string"
                  ? message.provider
                  : null;

              // Use getMessageCost() helper to get best available cost
              const messageCost = getMessageCost(message);
              const costUsd = messageCost?.costUsd;
              const isFinal = messageCost?.isFinal;

              return (
                <div key={message.id} className="space-y-2">
                  {/* Render all parts in order */}
                  {Array.isArray(message.parts) && message.parts.length > 0 ? (
                    message.parts.map((part, partIndex) => {
                      // For text parts, wrap in message container with role styling
                      if (
                        typeof part === "object" &&
                        part !== null &&
                        "type" in part &&
                        part.type === "text"
                      ) {
                        return (
                          <div
                            key={`${message.id}-container-${partIndex}`}
                            className={`rounded-xl p-4 ${getRoleStyling()} max-w-[80%] overflow-x-auto`}
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {message.role === "assistant" &&
                                  agent?.avatar && (
                                    <img
                                      src={agent.avatar || getDefaultAvatar()}
                                      alt="Agent avatar"
                                      className="size-6 rounded object-contain"
                                    />
                                  )}
                                <div className="text-xs font-medium opacity-80">
                                  {getRoleLabel()}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {modelName && provider && (
                                  <div className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 opacity-70">
                                    {provider}/{modelName}
                                  </div>
                                )}
                                {tokenUsage && (
                                  <div className="flex flex-wrap items-center gap-1">
                                    {typeof tokenUsage.promptTokens ===
                                      "number" && (
                                      <span
                                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                          tokenUsage.promptTokens
                                        )}`}
                                      >
                                        P:{" "}
                                        {tokenUsage.promptTokens.toLocaleString()}
                                      </span>
                                    )}
                                    {typeof tokenUsage.completionTokens ===
                                      "number" && (
                                      <span
                                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                          tokenUsage.completionTokens
                                        )}`}
                                      >
                                        C:{" "}
                                        {tokenUsage.completionTokens.toLocaleString()}
                                      </span>
                                    )}
                                    {typeof tokenUsage.reasoningTokens ===
                                      "number" &&
                                      tokenUsage.reasoningTokens > 0 && (
                                        <span
                                          className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                            tokenUsage.reasoningTokens
                                          )}`}
                                        >
                                          R:{" "}
                                          {tokenUsage.reasoningTokens.toLocaleString()}
                                        </span>
                                      )}
                                    {typeof tokenUsage.cachedPromptTokens ===
                                      "number" &&
                                      tokenUsage.cachedPromptTokens > 0 && (
                                        <span
                                          className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                            tokenUsage.cachedPromptTokens
                                          )}`}
                                        >
                                          Cache:{" "}
                                          {tokenUsage.cachedPromptTokens.toLocaleString()}
                                        </span>
                                      )}
                                    {typeof tokenUsage.totalTokens ===
                                      "number" && (
                                      <span
                                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                          tokenUsage.totalTokens
                                        )}`}
                                      >
                                        Total:{" "}
                                        {tokenUsage.totalTokens.toLocaleString()}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {costUsd !== undefined && (
                                  <span
                                    className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getCostColor(
                                      costUsd
                                    )}`}
                                  >
                                    {formatCurrency(costUsd, "usd", 10)}
                                    {isFinal === true && " ✓"}
                                    {isFinal === false && " (provisional)"}
                                  </span>
                                )}
                              </div>
                            </div>
                            {renderPart(part, partIndex)}
                          </div>
                        );
                      }
                      // For other parts, render directly
                      return renderPart(part, partIndex);
                    })
                  ) : (
                    // Fallback: render message container even if no parts
                    <div
                      className={`rounded-xl p-5 ${getRoleStyling()} max-w-[80%] overflow-x-auto`}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {message.role === "assistant" && agent?.avatar && (
                            <img
                              src={agent.avatar || getDefaultAvatar()}
                              alt="Agent avatar"
                              className="size-6 rounded object-contain"
                            />
                          )}
                          <div className="text-sm font-bold opacity-90">
                            {getRoleLabel()}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {modelName && provider && (
                            <div className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 opacity-70">
                              {provider}/{modelName}
                            </div>
                          )}
                          {tokenUsage && (
                            <div className="flex flex-wrap items-center gap-1">
                              {typeof tokenUsage.promptTokens === "number" && (
                                <span
                                  className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                    tokenUsage.promptTokens
                                  )}`}
                                >
                                  P: {tokenUsage.promptTokens.toLocaleString()}
                                </span>
                              )}
                              {typeof tokenUsage.completionTokens ===
                                "number" && (
                                <span
                                  className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                    tokenUsage.completionTokens
                                  )}`}
                                >
                                  C:{" "}
                                  {tokenUsage.completionTokens.toLocaleString()}
                                </span>
                              )}
                              {typeof tokenUsage.reasoningTokens === "number" &&
                                tokenUsage.reasoningTokens > 0 && (
                                  <span
                                    className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                      tokenUsage.reasoningTokens
                                    )}`}
                                  >
                                    R:{" "}
                                    {tokenUsage.reasoningTokens.toLocaleString()}
                                  </span>
                                )}
                              {typeof tokenUsage.cachedPromptTokens ===
                                "number" &&
                                tokenUsage.cachedPromptTokens > 0 && (
                                  <span
                                    className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                      tokenUsage.cachedPromptTokens
                                    )}`}
                                  >
                                    Cache:{" "}
                                    {tokenUsage.cachedPromptTokens.toLocaleString()}
                                  </span>
                                )}
                              {typeof tokenUsage.totalTokens === "number" && (
                                <span
                                  className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                    tokenUsage.totalTokens
                                  )}`}
                                >
                                  Total:{" "}
                                  {tokenUsage.totalTokens.toLocaleString()}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-base font-medium italic text-neutral-600">
                        (Empty message)
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {isLoading && (
              <div className="max-w-[80%] overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-neutral-900">
                <div className="mb-2 flex items-center gap-2">
                  {agent?.avatar && (
                    <img
                      src={agent.avatar || getDefaultAvatar()}
                      alt="Agent avatar"
                      className="size-6 rounded object-contain"
                    />
                  )}
                  <div className="text-xs font-medium text-neutral-600">
                    Agent
                  </div>
                </div>
                <div className="text-sm text-neutral-600">Thinking...</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Form */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-4 rounded-b-2xl border-t-2 border-neutral-300 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          rows={1}
          className="flex-1 resize-none overflow-hidden rounded-xl border-2 border-neutral-300 bg-white p-4 text-base font-medium text-neutral-900 transition-all duration-200 focus:border-primary-600 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
          style={{ minHeight: "56px", maxHeight: "200px" }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="transform rounded-xl bg-gradient-primary px-8 py-4 font-bold text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-colored active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
        >
          Send
        </button>
      </form>
    </div>
  );
};
