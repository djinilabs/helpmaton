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

import { useAgent } from "../hooks/useAgents";
import { useTestAgentUrl } from "../hooks/useTestAgentUrl";
import { getDefaultAvatar } from "../utils/avatarUtils";
import { getTokenUsageColor, getCostColor } from "../utils/colorUtils";
import { formatCurrency } from "../utils/currency";
import { getMessageCost } from "../utils/messageCost";

interface AgentChatProps {
  workspaceId: string;
  agentId: string;
  api?: string; // Optional custom API endpoint URL
  onClear?: () => void; // Callback when conversation is cleared
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
}) => {
  const { data: agent } = useAgent(workspaceId, agentId);
  const { data: testAgentUrlData } = useTestAgentUrl();
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  // Generate and memoize conversation ID for this chat instance
  const conversationId = useMemo(() => generateUUID(), []);

  // Determine the API endpoint URL
  // Priority: 1. Custom api prop, 2. Function URL (if available), 3. API Gateway URL
  const apiUrl = useMemo(() => {
    if (api) {
      return api;
    }
    
    // If Function URL is available, use it with the full path
    if (testAgentUrlData?.url) {
      const baseUrl = testAgentUrlData.url.replace(/\/+$/, "");
      return `${baseUrl}/api/workspaces/${workspaceId}/agents/${agentId}/test`;
    }
    
    // Fallback to API Gateway URL
    return `/api/workspaces/${workspaceId}/agents/${agentId}/test`;
  }, [api, testAgentUrlData, workspaceId, agentId]);

  // Create a custom fetch function that adds the X-Conversation-Id header
  const fetchWithConversationId = useMemo(() => {
    return async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      // Use the global fetch (which includes Authorization header)
      const globalFetch = typeof window !== "undefined" ? window.fetch : fetch;

      // Add X-Conversation-Id header to the request
      const headers = new Headers(init?.headers);
      headers.set("X-Conversation-Id", conversationId);

      return globalFetch(input, {
        ...init,
        headers,
      });
    };
  }, [conversationId]);

  const { messages, sendMessage, status, error, addToolOutput, setMessages } =
    useChat({
      transport: new DefaultChatTransport({
        api: apiUrl,
        credentials: api || testAgentUrlData?.url ? "omit" : "include", // Lambda Function URLs don't use cookies
        // Use custom fetch that includes X-Conversation-Id header
        fetch: fetchWithConversationId,
      }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onToolCall: async ({ toolCall }) => {
        console.log("[AgentChat] Tool call:", toolCall);
        // Immediately respond with error for any tool call
        addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          state: "output-error",
          errorText: `Tool '${toolCall.toolName}' is not defined on the client`,
        });
      },
      onError: (error) => {
        console.error("Chat error:", error);
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
    sendMessage({ text: input });
    setInput("");
    // Reset textarea height after clearing input
    setTimeout(adjustTextareaHeight, 0);
  };

  const handleClearConversation = () => {
    setMessages([]);
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
    <div className="flex h-[600px] flex-col rounded-2xl border-2 border-neutral-300 bg-white shadow-large dark:border-neutral-700 dark:bg-neutral-900">
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
      {/* Messages Container */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto bg-white p-4 dark:bg-neutral-900"
      >
        {error && (
          <div className="mb-4 rounded-xl border-2 border-error-300 bg-error-100 p-5 dark:border-error-800 dark:bg-error-900">
            <div className="text-base font-bold text-error-900 dark:text-error-50">
              Error
            </div>
            <div className="mt-2 text-sm font-medium text-error-800 dark:text-error-100">
              {error.message}
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
                        <div className="whitespace-pre-wrap">
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
                      className="max-w-[80%] rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950"
                    >
                      <div className="mb-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                        🧠 Reasoning
                      </div>
                      <div className="whitespace-pre-wrap text-sm text-indigo-900 dark:text-indigo-100">
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
                      className="max-w-[80%] rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950"
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
                      className="max-w-[80%] rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950"
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
                      className="max-w-[80%] rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
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
                      className="max-w-[80%] rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
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
                      className="max-w-[80%] rounded-xl border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950"
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
                      className="max-w-[80%] rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"
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
                    className="max-w-[80%] rounded-xl border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950"
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
                            className={`rounded-xl p-4 ${getRoleStyling()} max-w-[80%]`}
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
                                    {typeof tokenUsage.promptTokens === "number" && (
                                      <span
                                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                          tokenUsage.promptTokens
                                        )}`}
                                      >
                                        P: {tokenUsage.promptTokens.toLocaleString()}
                                      </span>
                                    )}
                                    {typeof tokenUsage.completionTokens === "number" && (
                                      <span
                                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                          tokenUsage.completionTokens
                                        )}`}
                                      >
                                        C: {tokenUsage.completionTokens.toLocaleString()}
                                      </span>
                                    )}
                                    {typeof tokenUsage.reasoningTokens === "number" &&
                                      tokenUsage.reasoningTokens > 0 && (
                                        <span
                                          className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                            tokenUsage.reasoningTokens
                                          )}`}
                                        >
                                          R: {tokenUsage.reasoningTokens.toLocaleString()}
                                        </span>
                                      )}
                                    {typeof tokenUsage.cachedPromptTokens === "number" &&
                                      tokenUsage.cachedPromptTokens > 0 && (
                                        <span
                                          className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                            tokenUsage.cachedPromptTokens
                                          )}`}
                                        >
                                          Cache: {tokenUsage.cachedPromptTokens.toLocaleString()}
                                        </span>
                                      )}
                                    {typeof tokenUsage.totalTokens === "number" && (
                                      <span
                                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                          tokenUsage.totalTokens
                                        )}`}
                                      >
                                        Total: {tokenUsage.totalTokens.toLocaleString()}
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
                      className={`rounded-xl p-5 ${getRoleStyling()} max-w-[80%]`}
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
                              {typeof tokenUsage.completionTokens === "number" && (
                                <span
                                  className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                    tokenUsage.completionTokens
                                  )}`}
                                >
                                  C: {tokenUsage.completionTokens.toLocaleString()}
                                </span>
                              )}
                              {typeof tokenUsage.reasoningTokens === "number" &&
                                tokenUsage.reasoningTokens > 0 && (
                                  <span
                                    className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                      tokenUsage.reasoningTokens
                                    )}`}
                                  >
                                    R: {tokenUsage.reasoningTokens.toLocaleString()}
                                  </span>
                                )}
                              {typeof tokenUsage.cachedPromptTokens === "number" &&
                                tokenUsage.cachedPromptTokens > 0 && (
                                  <span
                                    className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                      tokenUsage.cachedPromptTokens
                                    )}`}
                                  >
                                    Cache: {tokenUsage.cachedPromptTokens.toLocaleString()}
                                  </span>
                                )}
                              {typeof tokenUsage.totalTokens === "number" && (
                                <span
                                  className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getTokenUsageColor(
                                    tokenUsage.totalTokens
                                  )}`}
                                >
                                  Total: {tokenUsage.totalTokens.toLocaleString()}
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
              <div className="max-w-[80%] rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-neutral-900">
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
