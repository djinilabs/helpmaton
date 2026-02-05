import { useChat } from "@ai-sdk/react";
import { PaperClipIcon, TrashIcon } from "@heroicons/react/24/outline";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FC } from "react";

import { useAgentOptional } from "../hooks/useAgents";
import { apiFetch, getAccessToken } from "../utils/api";
import { getDefaultAvatar } from "../utils/avatarUtils";
import { lastAssistantMessageHasText } from "../utils/chatMessageParts";

import { ChatMessage, type ChatMessageProps } from "./ChatMessage";

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
  enableFileUpload?: boolean; // If false, hide upload button and file input
  isEmbedded?: boolean; // If true, render without the outer frame
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
  enableFileUpload = true,
  isEmbedded = false,
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  // State to track API errors that might not be caught by useChat
  const [apiError, setApiError] = useState<Error | null>(null);
  // State to track pending file uploads
  const [pendingFiles, setPendingFiles] = useState<
    Array<{
      file: File;
      preview?: string; // base64 data URL for images
      uploadUrl?: string; // S3 URL after upload
      uploading: boolean;
      error?: string;
    }>
  >([]);

  // Cleanup blob URLs when component unmounts
  // Store pendingFiles in a ref so cleanup can access current value on unmount
  const pendingFilesRef = useRef(pendingFiles);
  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  useEffect(() => {
    return () => {
      // Cleanup all preview URLs on unmount
      pendingFilesRef.current.forEach((fileData) => {
        if (fileData.preview) {
          URL.revokeObjectURL(fileData.preview);
        }
      });
    };
  }, []); // Only run on unmount

  // Clear file-related API error when there are no files with errors
  useEffect(() => {
    if (apiError && pendingFiles.every((f) => !f.error)) {
      setApiError(null);
    }
  }, [apiError, pendingFiles]);

  useEffect(() => {
    if (enableFileUpload) {
      return;
    }
    setPendingFiles((prevPendingFiles) => {
      prevPendingFiles.forEach((fileData) => {
        if (fileData.preview) {
          URL.revokeObjectURL(fileData.preview);
        }
      });
      if (prevPendingFiles.length === 0) {
        return prevPendingFiles;
      }
      return [];
    });
  }, [enableFileUpload]);

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
    const gatewayUrl = `/api/streams/${workspaceId}/${agentId}/test`;
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
                errorMessage =
                  typeof errorData.error === "string"
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
                    errorMessage =
                      typeof parsed.error === "string"
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
            console.error(
              "[AgentChat] Error parsing error response:",
              parseError
            );
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
        const errorMessage =
          fetchError instanceof Error
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

  // Memoize textarea height adjustment function
  const adjustTextareaHeight = useCallback(() => {
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
  }, []);

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
  const lastAssistantMessageHasTextPart = useMemo(
    () => lastAssistantMessageHasText(messages),
    [messages]
  );
  const showTypingIndicator = isLoading && !lastAssistantMessageHasTextPart;

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

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Process each selected file
    const newFiles = Array.from(files).map((file) => {
      // Create preview for images
      let preview: string | undefined;
      if (file.type.startsWith("image/")) {
        preview = URL.createObjectURL(file);
      }

      return {
        file,
        preview,
        uploading: false,
      };
    });

    setPendingFiles((prev) => [...prev, ...newFiles]);

    // Upload files to S3 in parallel for better UX
    await Promise.all(newFiles.map((fileData) => uploadFileToS3(fileData)));

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Upload file to S3 using presigned URL
  const uploadFileToS3 = async (fileData: {
    file: File;
    preview?: string;
    uploadUrl?: string;
    uploading: boolean;
    error?: string;
  }) => {
    const { file } = fileData;

    // Update state to show uploading
    setPendingFiles((prev) =>
      prev.map((f) =>
        f.file === file ? { ...f, uploading: true, error: undefined } : f
      )
    );

    try {
      // Get file extension - use lastIndexOf to handle files with multiple dots (e.g., "archive.tar.gz")
      const lastDotIndex = file.name.lastIndexOf(".");
      const fileExtension =
        lastDotIndex > 0 && lastDotIndex < file.name.length - 1
          ? file.name.substring(lastDotIndex + 1)
          : undefined;

      // Request presigned URL from backend
      // Always use same origin for API requests (Vite proxy handles routing in local dev)
      // Use apiFetch which automatically handles Authorization header via global fetch override
      const accessToken = getAccessToken();
      if (!accessToken) {
        throw new Error("Access token is required for file upload");
      }

      // apiFetch automatically throws on non-ok responses, so we can directly parse JSON
      const presignedResponse = await apiFetch(
        `/api/workspaces/${workspaceId}/agents/${agentId}/conversations/${conversationId}/files/upload-url`,
        {
          method: "POST",
          body: JSON.stringify({
            contentType: file.type,
            fileExtension,
          }),
        }
      );

      const presignedData = await presignedResponse.json();
      const { uploadUrl, fields, finalUrl } = presignedData;

      // Upload file directly to S3 using presigned POST URL
      const formData = new FormData();
      // Add all fields from presigned URL
      Object.entries(fields).forEach(([key, value]) => {
        formData.append(key, value as string);
      });
      // Add file last (must be last field)
      formData.append("file", file);

      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload file to S3");
      }

      // Update state with final URL
      setPendingFiles((prev) =>
        prev.map((f) =>
          f.file === file ? { ...f, uploadUrl: finalUrl, uploading: false } : f
        )
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to upload file";
      setPendingFiles((prev) =>
        prev.map((f) =>
          f.file === file ? { ...f, uploading: false, error: errorMessage } : f
        )
      );
      setApiError(new Error(`File upload failed: ${errorMessage}`));
    }
  };

  const handleSubmit = (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if ((!input.trim() && pendingFiles.length === 0) || isLoading) return;

    // Check if all files are uploaded
    const filesNotUploaded = pendingFiles.filter(
      (f) => !f.uploadUrl && !f.error
    );
    if (filesNotUploaded.length > 0) {
      setApiError(new Error("Please wait for all files to finish uploading"));
      return;
    }

    // Check if any files failed to upload
    const filesWithErrors = pendingFiles.filter((f) => f.error);
    if (filesWithErrors.length > 0) {
      setApiError(
        new Error(
          "Some files failed to upload. Please remove the failed files and try again."
        )
      );
      return;
    }

    // Clear any previous errors when sending a new message
    setApiError(null);

    // Build message content array for AI SDK
    // AI SDK expects parts array with text and file parts
    const parts: Array<
      | { type: "text"; text: string }
      | { type: "file"; data: string; mimeType: string }
      | { type: "image"; image: string; mimeType?: string }
    > = [];

    // Add text content if present
    if (input.trim()) {
      parts.push({ type: "text", text: input.trim() });
    }

    // Add file content
    for (const fileData of pendingFiles) {
      if (fileData.uploadUrl) {
        const isImage = fileData.file.type.startsWith("image/");
        if (isImage) {
          parts.push({
            type: "image",
            image: fileData.uploadUrl,
            mimeType: fileData.file.type,
          });
        } else {
          parts.push({
            type: "file",
            data: fileData.uploadUrl,
            mimeType: fileData.file.type,
          });
        }
      }
    }

    // Send message with parts array (AI SDK format)
    if (parts.length === 1 && parts[0].type === "text") {
      sendMessage({ text: parts[0].text });
    } else {
      // For multi-part messages, send with parts
      // Use type assertion since AI SDK types are complex and we're using S3 URLs
      sendMessage({
        parts,
      } as Parameters<typeof sendMessage>[0] & { parts: typeof parts });
    }

    setInput("");
    // Cleanup blob URLs before clearing pending files
    pendingFiles.forEach((fileData) => {
      if (fileData.preview) {
        URL.revokeObjectURL(fileData.preview);
      }
    });
    setPendingFiles([]);
    // Reset textarea height after clearing input
    setTimeout(adjustTextareaHeight, 0);
  };

  const handleClearConversation = () => {
    setMessages([]);
    setApiError(null); // Clear API errors when clearing conversation
    // Notify parent to remount component, which will clear errors
    onClear?.();
  };

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, status]);

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
  }, [adjustTextareaHeight]);

  // Adjust textarea height when input changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  return (
    <div
      className={`flex ${
        isWidget ? "h-full" : "h-[600px]"
      } flex-col${isEmbedded ? "" : " rounded-2xl border-2 border-neutral-300 bg-white shadow-large dark:border-neutral-700 dark:bg-neutral-900"}`}
    >
      {!isWidget && (
        <div
          className={`border-b-2 border-neutral-300 dark:border-neutral-700${
            isEmbedded
              ? " bg-transparent p-3"
              : " rounded-t-2xl bg-neutral-100 p-5 dark:bg-neutral-800"
          }`}
        >
          <div className="flex items-center justify-between gap-4">
            <p className="text-base font-bold text-neutral-800 dark:text-neutral-200">
              Test your agent by having a conversation. This chat interface lets
              you interact with the agent in real-time to verify its behavior
              and responses before deploying it.
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
        <div
          className={`border-b-2 border-neutral-300 p-3 dark:border-neutral-700${
            isEmbedded ? " bg-transparent" : " rounded-t-2xl bg-neutral-100 dark:bg-neutral-800"
          }`}
        >
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
        className={`flex-1 overflow-y-auto bg-white dark:bg-neutral-900 ${isEmbedded ? "p-2" : "p-4"}`}
      >
        {(error || apiError) && (
          <div
            className={`mb-4 rounded-xl border-2 border-error-300 bg-error-100 dark:border-error-800 dark:bg-error-900 ${isEmbedded ? "p-3" : "p-5"}`}
          >
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
            {/* Render all messages using optimized ChatMessage component */}
            {messages.map((message, index) => {
              // The last message is streaming if status is "streaming" or "submitted"
              // and it's an assistant message
              const isLastMessage = index === messages.length - 1;
              const isStreamingMessage =
                isLastMessage &&
                (status === "streaming" || status === "submitted") &&
                message.role === "assistant";
              return (
                <ChatMessage
                  key={message.id}
                  message={message as unknown as ChatMessageProps["message"]}
                  agent={agent}
                  isWidget={isWidget}
                  isStreaming={isStreamingMessage}
                />
              );
            })}
          </div>
        )}
        {showTypingIndicator && (
          <div className="mt-4 flex items-center gap-2">
            <img
              src={agent?.avatar || getDefaultAvatar()}
              alt="Agent avatar"
              className="size-6 rounded object-contain"
            />
            <svg
              className="h-4 w-8 text-neutral-500 dark:text-neutral-300"
              viewBox="0 0 24 8"
              fill="currentColor"
              aria-label="Agent is typing"
              role="img"
            >
              <circle cx="4" cy="4" r="2">
                <animate
                  attributeName="cy"
                  values="4;2;4"
                  dur="0.8s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle cx="12" cy="4" r="2">
                <animate
                  attributeName="cy"
                  values="4;2;4"
                  dur="0.8s"
                  begin="0.15s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle cx="20" cy="4" r="2">
                <animate
                  attributeName="cy"
                  values="4;2;4"
                  dur="0.8s"
                  begin="0.3s"
                  repeatCount="indefinite"
                />
              </circle>
            </svg>
          </div>
        )}
      </div>

      {/* Pending Files Preview */}
      {enableFileUpload && pendingFiles.length > 0 && (
        <div
          className={`border-t-2 border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 ${isEmbedded ? "p-2" : "p-3"}`}
        >
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((fileData, index) => (
              <div
                key={index}
                className="relative flex items-center gap-2 rounded-lg border-2 border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900"
              >
                {fileData.preview ? (
                  <img
                    src={fileData.preview}
                    alt={fileData.file.name}
                    className="size-12 rounded object-cover"
                  />
                ) : (
                  <PaperClipIcon className="size-6 text-neutral-600 dark:text-neutral-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                    {fileData.file.name}
                  </div>
                  <div className="text-xs text-neutral-600 dark:text-neutral-400">
                    {fileData.uploading
                      ? "Uploading..."
                      : fileData.error
                      ? "Error"
                      : fileData.uploadUrl
                      ? "Ready"
                      : "Pending"}
                  </div>
                </div>
                {fileData.error && (
                  <button
                    type="button"
                    onClick={() => {
                      // Cleanup blob URL before removing file
                      if (fileData.preview) {
                        URL.revokeObjectURL(fileData.preview);
                      }
                      setPendingFiles((prev) =>
                        prev.filter((f) => f.file !== fileData.file)
                      );
                    }}
                    className="text-error-600 hover:text-error-700 dark:text-error-400 dark:hover:text-error-300"
                    title="Remove file"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                )}
                {!fileData.uploading && !fileData.error && (
                  <button
                    type="button"
                    onClick={() => {
                      // Cleanup blob URL before removing file
                      if (fileData.preview) {
                        URL.revokeObjectURL(fileData.preview);
                      }
                      setPendingFiles((prev) =>
                        prev.filter((f) => f.file !== fileData.file)
                      );
                    }}
                    className="text-neutral-600 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
                    title="Remove file"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input Form */}
      <form
        onSubmit={handleSubmit}
        className={`flex gap-4 border-t-2 border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900 ${isEmbedded ? "p-2 sm:p-3" : "rounded-b-2xl p-5"}`}
      >
        {enableFileUpload && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              accept="*/*"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="flex shrink-0 items-center justify-center rounded-xl border-2 border-neutral-300 bg-white p-4 text-neutral-700 transition-all duration-200 hover:bg-neutral-50 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              title="Attach file"
            >
              <PaperClipIcon className="size-5" />
            </button>
          </>
        )}
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
          disabled={
            isLoading ||
            (!input.trim() && pendingFiles.length === 0) ||
            pendingFiles.some((f) => f.uploading || f.error)
          }
          className="transform rounded-xl bg-gradient-primary px-8 py-4 font-bold text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-colored active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
        >
          <span className="flex items-center gap-2">
            {isLoading && (
              <span className="size-4 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
            )}
            <span>{isLoading ? "Sending..." : "Send"}</span>
          </span>
        </button>
      </form>
    </div>
  );
};
