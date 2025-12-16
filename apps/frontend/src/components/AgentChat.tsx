import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FC } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AgentChatProps {
  workspaceId: string;
  agentId: string;
  api?: string; // Optional custom API endpoint URL
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
}) => {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");

  // Generate and memoize conversation ID for this chat instance
  const conversationId = useMemo(() => generateUUID(), []);

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

  const { messages, sendMessage, status, error, addToolOutput } = useChat({
    transport: new DefaultChatTransport({
      api: api || `/api/workspaces/${workspaceId}/agents/${agentId}/test`,
      credentials: api ? "omit" : "include", // Lambda Function URLs don't use cookies
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

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setInput(e.target.value);
  };

  const handleSubmit = (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput("");
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

  return (
    <div className="border-2 border-neutral-300 rounded-2xl flex flex-col h-[600px] bg-white shadow-large">
      <div className="border-b-2 border-neutral-300 p-5 bg-neutral-100 rounded-t-2xl">
        <p className="text-base font-bold text-neutral-800">
          Test your agent by having a conversation. This chat interface lets you
          interact with the agent in real-time to verify its behavior and
          responses before deploying it.
        </p>
      </div>
      {/* Messages Container */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 bg-white"
      >
        {error && (
          <div className="border-2 border-error-300 bg-error-100 rounded-xl p-5 mb-4">
            <div className="text-base font-bold text-error-900">Error</div>
            <div className="text-sm font-medium text-error-800 mt-2">
              {error.message}
            </div>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="text-base font-bold text-neutral-600 text-center py-10">
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
                    return "bg-neutral-200 text-neutral-800 italic border-2 border-neutral-400 font-bold";
                  case "assistant":
                  default:
                    return "bg-neutral-100 text-neutral-900 border-2 border-neutral-300";
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
                                      className="border-2 border-neutral-300 bg-neutral-100 px-2 py-1 rounded-lg font-mono text-xs font-bold"
                                      {...rest}
                                    >
                                      {children}
                                    </code>
                                  );
                                }
                                return (
                                  <code
                                    className="block border-2 border-neutral-300 bg-neutral-100 rounded-xl p-5 font-mono text-sm font-bold overflow-x-auto"
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
                      className="rounded-xl p-4 bg-indigo-50 border border-indigo-200 max-w-[80%]"
                    >
                      <div className="text-xs font-medium mb-2 text-indigo-700">
                        🧠 Reasoning
                      </div>
                      <div className="text-sm text-indigo-900 whitespace-pre-wrap">
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
                      className="rounded-xl p-4 bg-blue-50 border border-blue-200 max-w-[80%]"
                    >
                      <div className="text-xs font-medium mb-2 text-blue-700">
                        🔧 Tool Call: {toolPart.toolName}
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-mono text-blue-600 bg-blue-100 px-2 py-1 rounded font-semibold">
                          {toolPart.toolName}
                        </span>
                        {toolPart.state && (
                          <span className="text-xs text-blue-600">
                            ({toolPart.state})
                          </span>
                        )}
                      </div>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium">
                          View{" "}
                          {hasOutput
                            ? "output"
                            : hasError
                            ? "error"
                            : "arguments"}
                        </summary>
                        <div className="mt-2 space-y-2">
                          <div>
                            <div className="font-medium text-blue-700 mb-1">
                              Arguments:
                            </div>
                            <pre className="p-2 bg-blue-100 rounded text-xs overflow-x-auto">
                              {JSON.stringify(toolInput, null, 2)}
                            </pre>
                          </div>
                          {hasOutput && (
                            <div>
                              <div className="font-medium text-green-700 mb-1">
                                Output:
                              </div>
                              <pre className="p-2 bg-green-100 rounded text-xs overflow-x-auto">
                                {JSON.stringify(toolPart.output, null, 2)}
                              </pre>
                            </div>
                          )}
                          {hasError && (
                            <div>
                              <div className="font-medium text-red-700 mb-1">
                                Error:
                              </div>
                              <div className="p-2 bg-red-100 rounded text-xs text-red-800">
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
                      className="rounded-xl p-4 bg-blue-50 border border-blue-200 max-w-[80%]"
                    >
                      <div className="text-xs font-medium mb-2 text-blue-700">
                        🔧 Tool Call: {toolName}
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-mono text-blue-600 bg-blue-100 px-2 py-1 rounded font-semibold">
                          {toolName}
                        </span>
                        {toolPart.state && (
                          <span className="text-xs text-blue-600">
                            ({toolPart.state})
                          </span>
                        )}
                      </div>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium">
                          View{" "}
                          {hasOutput
                            ? "output"
                            : hasError
                            ? "error"
                            : "arguments"}
                        </summary>
                        <div className="mt-2 space-y-2">
                          <div>
                            <div className="font-medium text-blue-700 mb-1">
                              Arguments:
                            </div>
                            <pre className="p-2 bg-blue-100 rounded text-xs overflow-x-auto">
                              {JSON.stringify(toolInput, null, 2)}
                            </pre>
                          </div>
                          {hasOutput && (
                            <div>
                              <div className="font-medium text-green-700 mb-1">
                                Output:
                              </div>
                              <pre className="p-2 bg-green-100 rounded text-xs overflow-x-auto">
                                {JSON.stringify(toolPart.output, null, 2)}
                              </pre>
                            </div>
                          )}
                          {hasError && (
                            <div>
                              <div className="font-medium text-red-700 mb-1">
                                Error:
                              </div>
                              <div className="p-2 bg-red-100 rounded text-xs text-red-800">
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
                      className="rounded-xl p-3 bg-amber-50 border border-amber-200 max-w-[80%]"
                    >
                      <div className="text-xs font-medium mb-1 text-amber-700">
                        📎 Source
                      </div>
                      <a
                        href={sourcePart.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-amber-900 hover:text-amber-700 underline break-all"
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
                      className="rounded-xl p-3 bg-amber-50 border border-amber-200 max-w-[80%]"
                    >
                      <div className="text-xs font-medium mb-1 text-amber-700">
                        📄 Document Source
                      </div>
                      <div className="text-sm text-amber-900 font-medium">
                        {docPart.title}
                      </div>
                      {docPart.filename && (
                        <div className="text-xs text-amber-700 mt-1">
                          {docPart.filename}
                        </div>
                      )}
                      <div className="text-xs text-amber-600 mt-1">
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
                      className="rounded-xl p-3 bg-purple-50 border border-purple-200 max-w-[80%]"
                    >
                      <div className="text-xs font-medium mb-1 text-purple-700">
                        📎 File
                      </div>
                      <div className="text-sm text-purple-900 font-medium">
                        {filePart.filename || "Untitled file"}
                      </div>
                      <div className="text-xs text-purple-600 mt-1">
                        {filePart.mediaType}
                      </div>
                      <a
                        href={filePart.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-purple-700 hover:text-purple-900 underline mt-2 inline-block"
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
                      className="rounded-xl p-3 bg-slate-50 border border-slate-200 max-w-[80%]"
                    >
                      <div className="text-xs font-medium mb-2 text-slate-700">
                        📊 Data: {dataName}
                      </div>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-slate-600 hover:text-slate-700 font-medium">
                          View data
                        </summary>
                        <pre className="mt-2 p-2 bg-slate-100 rounded text-xs overflow-x-auto">
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
                      className="flex items-center gap-2 my-2 max-w-[80%]"
                    >
                      <div className="flex-1 border-t border-neutral-300"></div>
                      <div className="text-xs text-neutral-500 font-medium px-2">
                        Step
                      </div>
                      <div className="flex-1 border-t border-neutral-300"></div>
                    </div>
                  );
                }

                // Unknown part type - render as fallback
                return (
                  <div
                    key={`${message.id}-part-${partIndex}`}
                    className="rounded-xl p-3 bg-yellow-50 border border-yellow-200 max-w-[80%]"
                  >
                    <div className="text-xs font-medium mb-1 text-yellow-700">
                      Unknown part type: {partType}
                    </div>
                    <pre className="text-xs text-yellow-900 overflow-x-auto">
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

              const formatTokenUsage = (usage: {
                promptTokens?: number;
                completionTokens?: number;
                totalTokens?: number;
                reasoningTokens?: number;
                cachedPromptTokens?: number;
              }): string => {
                const parts: string[] = [];
                if (typeof usage.promptTokens === "number") {
                  parts.push(`P: ${usage.promptTokens.toLocaleString()}`);
                }
                if (typeof usage.completionTokens === "number") {
                  parts.push(`C: ${usage.completionTokens.toLocaleString()}`);
                }
                if (
                  typeof usage.reasoningTokens === "number" &&
                  usage.reasoningTokens > 0
                ) {
                  parts.push(`R: ${usage.reasoningTokens.toLocaleString()}`);
                }
                if (
                  typeof usage.cachedPromptTokens === "number" &&
                  usage.cachedPromptTokens > 0
                ) {
                  parts.push(
                    `Cache: ${usage.cachedPromptTokens.toLocaleString()}`
                  );
                }
                const total =
                  typeof usage.totalTokens === "number"
                    ? usage.totalTokens.toLocaleString()
                    : "0";
                return parts.length > 0
                  ? `${total} (${parts.join(", ")})`
                  : total;
              };

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
                            <div className="flex justify-between items-center mb-2">
                              <div className="text-xs font-medium opacity-80">
                                {getRoleLabel()}
                              </div>
                              {tokenUsage && (
                                <div className="text-xs font-mono opacity-70 bg-black bg-opacity-10 px-2 py-1 rounded">
                                  {formatTokenUsage(tokenUsage)}
                                </div>
                              )}
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
                      <div className="flex justify-between items-center mb-3">
                        <div className="text-sm font-bold opacity-90">
                          {getRoleLabel()}
                        </div>
                        {tokenUsage && (
                          <div className="text-xs font-mono opacity-70 bg-black bg-opacity-10 px-2 py-1 rounded">
                            {formatTokenUsage(tokenUsage)}
                          </div>
                        )}
                      </div>
                      <div className="text-base text-neutral-600 italic font-medium">
                        (Empty message)
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {isLoading && (
              <div className="border border-neutral-200 rounded-xl p-4 bg-neutral-50 text-neutral-900 max-w-[80%]">
                <div className="text-xs font-medium mb-2 text-neutral-600">
                  Agent
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
        className="border-t-2 border-neutral-300 p-5 bg-white flex gap-4 rounded-b-2xl"
      >
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="Type your message..."
          disabled={isLoading}
          className="flex-1 border-2 border-neutral-300 rounded-xl p-4 bg-white text-neutral-900 text-base font-medium focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-gradient-primary px-8 py-4 text-white font-bold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none transition-all duration-200 transform hover:scale-[1.03] active:scale-[0.97]"
        >
          Send
        </button>
      </form>
    </div>
  );
};
