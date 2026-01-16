import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { getDefaultAvatar } from "../utils/avatarUtils";
import { getTokenUsageColor, getCostColor } from "../utils/colorUtils";
import { formatCurrency } from "../utils/currency";
import { getMessageCost } from "../utils/messageCost";

import { markdownComponents } from "./ChatMarkdownComponents";
import { getRoleLabel, getRoleStyling } from "./ChatMessageHelpers";
import {
  DataPart,
  FilePart,
  ReasoningPart,
  SourceDocumentPart,
  SourceUrlPart,
  StepStartPart,
  TextPart,
  ToolPart,
  UnknownPart,
} from "./ChatMessagePart";

export interface ChatMessageProps {
  message: {
    id: string;
    role: string;
    parts?: unknown[];
    [key: string]: unknown;
  };
  agent?: { name?: string; avatar?: string };
  isWidget?: boolean;
  isStreaming?: boolean; // If true, always re-render to show streaming updates
}

/**
 * Memoized component for rendering a single chat message.
 * Only re-renders when the message content actually changes.
 */
export const ChatMessage = memo<ChatMessageProps>(
  ({ message, agent, isWidget = false }) => {
    // Check if this is a knowledge injection message
    const isKnowledgeInjection = useMemo(
      () =>
        message.role === "user" &&
        typeof message === "object" &&
        message !== null &&
        "knowledgeInjection" in message &&
        (message as { knowledgeInjection?: boolean }).knowledgeInjection ===
          true,
      [message]
    );

    // Get snippet count for knowledge injection messages
    const snippetCount = useMemo(() => {
      if (!isKnowledgeInjection) return 0;
      if (
        typeof message === "object" &&
        message !== null &&
        "knowledgeSnippets" in message &&
        Array.isArray(
          (message as { knowledgeSnippets?: unknown }).knowledgeSnippets
        )
      ) {
        return (
          (message as { knowledgeSnippets?: unknown[] }).knowledgeSnippets || []
        ).length;
      }
      return 0;
    }, [isKnowledgeInjection, message]);

    // Memoize token usage extraction
    const tokenUsage = useMemo(() => {
      if (
        "tokenUsage" in message &&
        message.tokenUsage &&
        typeof message.tokenUsage === "object" &&
        "totalTokens" in message.tokenUsage
      ) {
        return message.tokenUsage as {
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
          reasoningTokens?: number;
          cachedPromptTokens?: number;
        };
      }
      return null;
    }, [message]);

    // Memoize model name and provider
    const modelName = useMemo(() => {
      if (
        message.role === "assistant" &&
        "modelName" in message &&
        typeof message.modelName === "string"
      ) {
        return message.modelName;
      }
      return null;
    }, [message]);

    const provider = useMemo(() => {
      if (
        message.role === "assistant" &&
        "provider" in message &&
        typeof message.provider === "string"
      ) {
        return message.provider;
      }
      return null;
    }, [message]);

    // Memoize cost calculation
    const messageCost = useMemo(() => getMessageCost(message), [message]);
    const costUsd = messageCost?.costUsd;
    const isFinal = messageCost?.isFinal;

    const roleLabel = getRoleLabel(message.role);
    const roleStyling = getRoleStyling(message.role);

    // Render part function - now using memoized components
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
          <TextPart
            key={`${message.id}-text-${partIndex}`}
            text={textPart.text}
            isUser={message.role === "user"}
          />
        );
      }

      // Reasoning part
      if (partType === "reasoning" && "text" in part) {
        const reasoningPart = part as { type: "reasoning"; text: string };
        return (
          <ReasoningPart
            key={`${message.id}-reasoning-${partIndex}`}
            text={reasoningPart.text}
            isWidget={isWidget}
          />
        );
      }

      // File part
      if (
        (partType === "file" || partType === "image") &&
        ("file" in part || "image" in part || "data" in part)
      ) {
        let fileUrl: string | null = null;
        if ("file" in part && typeof part.file === "string") {
          fileUrl = part.file;
        } else if ("image" in part && typeof part.image === "string") {
          fileUrl = part.image;
        } else if ("data" in part && typeof part.data === "string") {
          fileUrl = part.data;
        }

        if (!fileUrl || typeof fileUrl !== "string") {
          return null;
        }

        let mediaType: string | undefined;
        if ("mediaType" in part && typeof part.mediaType === "string") {
          mediaType = part.mediaType;
        } else if ("mimeType" in part && typeof part.mimeType === "string") {
          mediaType = part.mimeType;
        }

        return (
          <FilePart
            key={`${message.id}-file-${partIndex}`}
            fileUrl={fileUrl}
            mediaType={mediaType}
            partIndex={partIndex}
            messageId={message.id}
          />
        );
      }

      // Tool calls - tool-call (backend format)
      if (
        partType === "tool-call" &&
        "toolName" in part &&
        "toolCallId" in part
      ) {
        const toolPart = part as {
          type: "tool-call";
          toolName: string;
          toolCallId: string;
          args?: unknown;
          input?: unknown;
        };
        return (
          <ToolPart
            key={`${message.id}-tool-${partIndex}`}
            toolName={toolPart.toolName}
            toolCallId={toolPart.toolCallId}
            input={toolPart.args || toolPart.input || {}}
            partIndex={partIndex}
            messageId={message.id}
          />
        );
      }

      // Tool results - tool-result (backend format)
      if (
        partType === "tool-result" &&
        "toolCallId" in part &&
        "toolName" in part
      ) {
        const toolResultPart = part as {
          type: "tool-result";
          toolCallId: string;
          toolName: string;
          result?: unknown;
        };
        return (
          <ToolPart
            key={`${message.id}-tool-result-${partIndex}`}
            toolName={toolResultPart.toolName}
            toolCallId={toolResultPart.toolCallId}
            input={{}}
            output={toolResultPart.result}
            partIndex={partIndex}
            messageId={message.id}
          />
        );
      }

      // Tool calls - dynamic-tool (AI SDK format)
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
        return (
          <ToolPart
            key={`${message.id}-tool-${partIndex}`}
            toolName={toolPart.toolName}
            toolCallId={toolPart.toolCallId}
            input={toolPart.input || {}}
            output={toolPart.output}
            errorText={toolPart.errorText}
            state={toolPart.state}
            partIndex={partIndex}
            messageId={message.id}
          />
        );
      }

      // Tool calls - tool-${name} (AI SDK format)
      if (
        typeof partType === "string" &&
        partType.startsWith("tool-") &&
        partType !== "tool-call" &&
        partType !== "tool-result" &&
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
        return (
          <ToolPart
            key={`${message.id}-tool-${partIndex}`}
            toolName={toolName}
            toolCallId={toolPart.toolCallId}
            input={toolPart.input || {}}
            output={toolPart.output}
            errorText={toolPart.errorText}
            state={toolPart.state}
            partIndex={partIndex}
            messageId={message.id}
          />
        );
      }

      // Source URL part
      if (partType === "source-url" && "url" in part && "sourceId" in part) {
        const sourcePart = part as {
          type: "source-url";
          sourceId: string;
          url: string;
          title?: string;
        };
        return (
          <SourceUrlPart
            key={`${message.id}-source-url-${partIndex}`}
            sourceId={sourcePart.sourceId}
            url={sourcePart.url}
            title={sourcePart.title}
            partIndex={partIndex}
            messageId={message.id}
          />
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
          <SourceDocumentPart
            key={`${message.id}-source-doc-${partIndex}`}
            sourceId={docPart.sourceId}
            mediaType={docPart.mediaType}
            title={docPart.title}
            filename={docPart.filename}
            partIndex={partIndex}
            messageId={message.id}
          />
        );
      }

      // File part (alternative format)
      if (partType === "file" && "url" in part && "mediaType" in part) {
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
          <DataPart
            key={`${message.id}-data-${partIndex}`}
            dataName={dataName}
            data={dataPart.data}
            id={dataPart.id}
            partIndex={partIndex}
            messageId={message.id}
          />
        );
      }

      // Step start part
      if (partType === "step-start") {
        return (
          <StepStartPart
            key={`${message.id}-step-${partIndex}`}
            partIndex={partIndex}
            messageId={message.id}
          />
        );
      }

      // Unknown part type
      return (
        <UnknownPart
          key={`${message.id}-unknown-${partIndex}`}
          partType={partType}
          part={part}
          partIndex={partIndex}
          messageId={message.id}
        />
      );
    };

    // Special rendering for knowledge injection messages
    if (isKnowledgeInjection) {
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
        <div className="max-w-[80%] overflow-x-auto">
          <details className="rounded-xl border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950">
            <summary className="cursor-pointer p-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📚</span>
                <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                  Knowledge from workspace documents
                  {snippetCount > 0 &&
                    ` (${snippetCount} snippet${
                      snippetCount !== 1 ? "s" : ""
                    })`}
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
                              components={markdownComponents}
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

    // Regular message rendering
    // Normalize message content: useChat can return either 'content' (string) or 'parts' (array)
    // During streaming, messages may have empty parts initially, then parts get added incrementally
    let parts: unknown[] = [];

    if (Array.isArray(message.parts)) {
      // AI SDK format: parts array
      // Filter out null/undefined parts but keep empty arrays to show message structure
      parts = message.parts
        .filter((part) => part !== null && part !== undefined)
        .map((part) => {
          // Handle string parts (AI SDK sometimes returns strings directly)
          if (typeof part === "string") {
            return { type: "text", text: part };
          }
          // Handle part objects
          if (typeof part === "object" && part !== null) {
            // If it already has a type, use as is
            if ("type" in part && typeof part.type === "string") {
              return part;
            }
            // If it has text but no type, assume it's a text part
            if ("text" in part && typeof part.text === "string") {
              return { type: "text", text: part.text };
            }
          }
          // Return as-is for other formats
          return part;
        });
    } else if ("content" in message) {
      // Convert content to parts array
      const content = message.content;
      if (typeof content === "string") {
        // String content - convert to text part if not empty
        if (content.trim()) {
          parts = [{ type: "text", text: content }];
        }
      } else if (Array.isArray(content)) {
        // Content is an array - normalize each item
        parts = content.map((item) => {
          if (typeof item === "string") {
            // String item - convert to text part
            return { type: "text", text: item };
          } else if (
            typeof item === "object" &&
            item !== null &&
            "type" in item
          ) {
            // Already a part object - use as is
            return item;
          }
          // Unknown format - try to convert
          return item;
        });
      }
    }

    if (parts.length === 0) {
      // Fallback: render message container even if no parts
      return (
        <div className="space-y-2">
          <div
            className={`rounded-xl p-5 ${roleStyling} max-w-[80%] overflow-x-auto`}
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
                <div className="text-sm font-bold opacity-90">{roleLabel}</div>
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
        </div>
      );
    }

    // Determine if we should show metadata (only for first part or if there's only one part)
    const shouldShowMetadata = parts.length > 0;
    const isFirstPart = (index: number) => index === 0;

    return (
      <div className="space-y-2">
        {parts.map((part, partIndex) => {
          const isFirst = isFirstPart(partIndex);
          const partType =
            typeof part === "object" &&
            part !== null &&
            "type" in part &&
            typeof part.type === "string"
              ? part.type
              : "unknown";

          // Render the part
          const renderedPart = renderPart(part, partIndex);

          // If part renders to null, skip it (but still show metadata if it's the first part)
          if (!renderedPart) {
            // If this is the first part and we have other parts, we'll show metadata with the next part
            // If this is the only part or all parts are null, the empty message fallback will handle it
            return null;
          }

          // For text parts, wrap in message container with role styling
          if (partType === "text") {
            return (
              <div
                key={`${message.id}-container-${partIndex}`}
                className={`rounded-xl p-4 ${roleStyling} max-w-[80%] overflow-x-auto`}
              >
                {isFirst && shouldShowMetadata && (
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {message.role === "assistant" && agent?.avatar && (
                        <img
                          src={agent.avatar || getDefaultAvatar()}
                          alt="Agent avatar"
                          className="size-6 rounded object-contain"
                        />
                      )}
                      <div className="text-xs font-medium opacity-80">
                        {roleLabel}
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
                )}
                {renderedPart}
              </div>
            );
          }

          // For non-text parts (reasoning, tool calls, etc.), wrap in container if first part
          if (isFirst) {
            return (
              <div
                key={`${message.id}-container-${partIndex}`}
                className="space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {message.role === "assistant" && agent?.avatar && (
                      <img
                        src={agent.avatar || getDefaultAvatar()}
                        alt="Agent avatar"
                        className="size-6 rounded object-contain"
                      />
                    )}
                    <div className="text-xs font-medium opacity-80">
                      {roleLabel}
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
                {renderedPart}
              </div>
            );
          }

          // For subsequent parts, render directly
          return renderedPart;
        })}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // During streaming, always re-render to show updates
    if (prevProps.isStreaming || nextProps.isStreaming) {
      return false; // Re-render
    }

    // If message ID changed, it's a different message - re-render
    if (prevProps.message.id !== nextProps.message.id) {
      return false; // Re-render
    }

    // If agent or widget props changed, re-render
    if (prevProps.agent?.avatar !== nextProps.agent?.avatar) {
      return false; // Re-render
    }
    if (prevProps.isWidget !== nextProps.isWidget) {
      return false; // Re-render
    }

    // For non-streaming messages, do a content-based comparison
    // Normalize parts for comparison
    const getNormalizedParts = (msg: ChatMessageProps["message"]) => {
      if (Array.isArray(msg.parts)) {
        return msg.parts.filter((p) => p != null);
      }
      if ("content" in msg) {
        const content = msg.content;
        if (typeof content === "string") {
          return content.trim() ? [{ type: "text", text: content }] : [];
        }
        if (Array.isArray(content)) {
          return content.filter((c) => c != null);
        }
      }
      return [];
    };

    const prevParts = getNormalizedParts(prevProps.message);
    const nextParts = getNormalizedParts(nextProps.message);

    // If parts length changed, re-render
    if (prevParts.length !== nextParts.length) {
      return false; // Re-render
    }

    // Compare parts using JSON serialization for deep equality
    // This catches content changes even if object references are the same
    const prevPartsStr = JSON.stringify(prevParts);
    const nextPartsStr = JSON.stringify(nextParts);
    if (prevPartsStr !== nextPartsStr) {
      return false; // Re-render - content changed
    }

    // Compare other message properties (tokenUsage, modelName, etc.)
    const prevStr = JSON.stringify({
      tokenUsage: prevProps.message.tokenUsage,
      modelName: prevProps.message.modelName,
      provider: prevProps.message.provider,
    });
    const nextStr = JSON.stringify({
      tokenUsage: nextProps.message.tokenUsage,
      modelName: nextProps.message.modelName,
      provider: nextProps.message.provider,
    });
    if (prevStr !== nextStr) {
      return false; // Re-render - metadata changed
    }

    // Everything is the same, skip re-render
    return true;
  }
);
ChatMessage.displayName = "ChatMessage";
