import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";

import { getDefaultAvatar } from "../utils/avatarUtils";
import { getTokenUsageColor, getCostColor } from "../utils/colorUtils";
import { formatCurrency } from "../utils/currency";
import { getMessageCost } from "../utils/messageCost";

import { markdownComponents, REMARK_PLUGINS } from "./ChatMarkdownComponents";
import { getRoleLabel, getRoleStyling } from "./ChatMessageHelpers";
import {
  DataPart,
  FilePart,
  ReasoningPart,
  SourceDocumentPart,
  SourceUrlPart,
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

/** Normalize message content to a comparable parts array; used by memo comparator. */
function getNormalizedPartsForCompare(msg: ChatMessageProps["message"]): unknown[] {
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
}

/**
 * Memoized component for rendering a single chat message.
 * Only re-renders when the message content actually changes.
 */
type PartContext = {
  messageId: string;
  role: string;
  isWidget: boolean;
};

const isMessagePart = (part: unknown): part is { type: string } =>
  !!part &&
  typeof part === "object" &&
  "type" in part &&
  typeof part.type === "string";

const renderTextPart = (
  part: { type: string },
  partIndex: number,
  context: PartContext
) => {
  if (part.type !== "text" || !("text" in part)) {
    return undefined;
  }
  const textPart = part as { type: "text"; text: string };
  return (
    <TextPart
      key={`${context.messageId}-text-${partIndex}`}
      text={textPart.text}
      isUser={context.role === "user"}
    />
  );
};

const renderReasoningPart = (
  part: { type: string },
  partIndex: number,
  context: PartContext
) => {
  if (part.type !== "reasoning" || !("text" in part)) {
    return undefined;
  }
  const reasoningPart = part as { type: "reasoning"; text: string };
  return (
    <ReasoningPart
      key={`${context.messageId}-reasoning-${partIndex}`}
      text={reasoningPart.text}
      isWidget={context.isWidget}
    />
  );
};

const renderFilePart = (
  part: { type: string },
  partIndex: number,
  context: PartContext
) => {
  if (
    (part.type !== "file" && part.type !== "image") ||
    !("file" in part || "image" in part || "data" in part || "url" in part)
  ) {
    return undefined;
  }
  let fileUrl: string | null = null;
  if ("url" in part && typeof part.url === "string") {
    fileUrl = part.url;
  } else if ("file" in part && typeof part.file === "string") {
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
      key={`${context.messageId}-file-${partIndex}`}
      fileUrl={fileUrl}
      mediaType={mediaType}
      partIndex={partIndex}
      messageId={context.messageId}
    />
  );
};

const renderToolCallPart = (
  part: { type: string },
  partIndex: number,
  context: PartContext
) => {
  if (
    part.type !== "tool-call" ||
    !("toolName" in part && "toolCallId" in part)
  ) {
    return undefined;
  }
  const toolPart = part as {
    type: "tool-call";
    toolName: string;
    toolCallId: string;
    args?: unknown;
    input?: unknown;
  };
  return (
    <ToolPart
      key={`${context.messageId}-tool-${partIndex}`}
      toolName={toolPart.toolName}
      toolCallId={toolPart.toolCallId}
      input={toolPart.args || toolPart.input || {}}
      partIndex={partIndex}
      messageId={context.messageId}
      isWidget={context.isWidget}
    />
  );
};

const renderToolResultPart = (
  part: { type: string },
  partIndex: number,
  context: PartContext
) => {
  if (
    part.type !== "tool-result" ||
    !("toolCallId" in part && "toolName" in part)
  ) {
    return undefined;
  }
  const toolResultPart = part as {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    result?: unknown;
  };
  return (
    <ToolPart
      key={`${context.messageId}-tool-result-${partIndex}`}
      toolName={toolResultPart.toolName}
      toolCallId={toolResultPart.toolCallId}
      input={{}}
      output={toolResultPart.result}
      partIndex={partIndex}
      messageId={context.messageId}
      isWidget={context.isWidget}
    />
  );
};

const renderDynamicToolPart = (
  part: { type: string },
  partIndex: number,
  context: PartContext
) => {
  if (
    part.type !== "dynamic-tool" ||
    !("toolName" in part && "toolCallId" in part)
  ) {
    return undefined;
  }
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
      key={`${context.messageId}-tool-${partIndex}`}
      toolName={toolPart.toolName}
      toolCallId={toolPart.toolCallId}
      input={toolPart.input || {}}
      output={toolPart.output}
      errorText={toolPart.errorText}
      state={toolPart.state}
      partIndex={partIndex}
      messageId={context.messageId}
      isWidget={context.isWidget}
    />
  );
};

const renderNamedToolPart = (
  part: { type: string },
  partIndex: number,
  context: PartContext
) => {
  if (
    !part.type.startsWith("tool-") ||
    part.type === "tool-call" ||
    part.type === "tool-result" ||
    !("toolCallId" in part)
  ) {
    return undefined;
  }
  const toolName = part.type.substring(5);
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
      key={`${context.messageId}-tool-${partIndex}`}
      toolName={toolName}
      toolCallId={toolPart.toolCallId}
      input={toolPart.input || {}}
      output={toolPart.output}
      errorText={toolPart.errorText}
      state={toolPart.state}
      partIndex={partIndex}
      messageId={context.messageId}
      isWidget={context.isWidget}
    />
  );
};

const renderSourceUrlPart = (
  part: { type: string },
  partIndex: number,
  context: PartContext
) => {
  if (part.type !== "source-url" || !("url" in part && "sourceId" in part)) {
    return undefined;
  }
  const sourcePart = part as {
    type: "source-url";
    sourceId: string;
    url: string;
    title?: string;
  };
  return (
    <SourceUrlPart
      key={`${context.messageId}-source-url-${partIndex}`}
      sourceId={sourcePart.sourceId}
      url={sourcePart.url}
      title={sourcePart.title}
      partIndex={partIndex}
      messageId={context.messageId}
    />
  );
};

const renderSourceDocumentPart = (
  part: { type: string },
  partIndex: number,
  context: PartContext
) => {
  if (
    part.type !== "source-document" ||
    !("sourceId" in part && "title" in part)
  ) {
    return undefined;
  }
  const docPart = part as {
    type: "source-document";
    sourceId: string;
    mediaType: string;
    title: string;
    filename?: string;
  };
  return (
    <SourceDocumentPart
      key={`${context.messageId}-source-doc-${partIndex}`}
      sourceId={docPart.sourceId}
      mediaType={docPart.mediaType}
      title={docPart.title}
      filename={docPart.filename}
      partIndex={partIndex}
      messageId={context.messageId}
    />
  );
};

const renderLegacyFilePart = (
  part: { type: string },
  partIndex: number,
  context: PartContext
) => {
  if (part.type !== "file" || !("url" in part && "mediaType" in part)) {
    return undefined;
  }
  const filePart = part as {
    type: "file";
    url: string;
    mediaType: string;
    filename?: string;
  };
  return (
    <div
      key={`${context.messageId}-part-${partIndex}`}
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
};

const renderDataPart = (
  part: { type: string },
  partIndex: number,
  context: PartContext
) => {
  if (!part.type.startsWith("data-") || !("data" in part)) {
    return undefined;
  }
  const dataName = part.type.substring(5);
  const dataPart = part as {
    type: string;
    data: unknown;
    id?: string;
  };
  return (
    <DataPart
      key={`${context.messageId}-data-${partIndex}`}
      dataName={dataName}
      data={dataPart.data}
      id={dataPart.id}
      partIndex={partIndex}
      messageId={context.messageId}
    />
  );
};

const renderStepStartPart = () => null;

const renderPart = (
  part: unknown,
  partIndex: number,
  context: PartContext
) => {
  if (!isMessagePart(part)) {
    return null;
  }

  const handlers = [
    renderTextPart,
    renderReasoningPart,
    renderFilePart,
    renderToolCallPart,
    renderToolResultPart,
    renderDynamicToolPart,
    renderNamedToolPart,
    renderSourceUrlPart,
    renderSourceDocumentPart,
    renderLegacyFilePart,
    renderDataPart,
  ];

  for (const handler of handlers) {
    const result = handler(part, partIndex, context);
    if (result !== undefined) {
      return result;
    }
  }

  if (part.type === "step-start") {
    return renderStepStartPart();
  }

  return (
    <UnknownPart
      key={`${context.messageId}-unknown-${partIndex}`}
      partType={part.type}
      part={part}
      partIndex={partIndex}
      messageId={context.messageId}
    />
  );
};

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

    const renderMessagePart = (part: unknown, partIndex: number) =>
      renderPart(part, partIndex, {
        messageId: message.id,
        role: message.role,
        isWidget,
      });

    // Special rendering for knowledge injection messages
    if (isKnowledgeInjection) {
      const knowledgeMessage = message as {
        role: "user";
        content?: string | Array<{ type: string; text?: string }>;
        knowledgeInjection?: boolean;
        knowledgeSnippets?: Array<{
          snippet: string;
          similarity: number;
          source?: "document" | "memory" | "graph";
          documentName?: string;
          documentId?: string;
          folderPath?: string;
          timestamp?: string;
          date?: string;
          subject?: string;
          predicate?: string;
          object?: string;
        }>;
      };

      const snippets = knowledgeMessage.knowledgeSnippets || [];
      const hasDocuments = snippets.some(
        (snippet) => (snippet.source ?? "document") === "document"
      );
      const hasMemories = snippets.some(
        (snippet) => snippet.source === "memory"
      );
      const hasGraphFacts = snippets.some(
        (snippet) => snippet.source === "graph"
      );
      const sourceLabels = [
        hasDocuments ? "workspace documents" : null,
        hasMemories ? "agent memories" : null,
        hasGraphFacts ? "agent graph facts" : null,
      ].filter(Boolean) as string[];
      const knowledgeSourceLabel =
        sourceLabels.length > 0
          ? sourceLabels.length === 1
            ? sourceLabels[0]
            : `${sourceLabels.slice(0, -1).join(", ")} and ${
                sourceLabels[sourceLabels.length - 1]
              }`
          : "workspace documents";

      return (
        <div className="max-w-[80%] overflow-x-auto">
          <details className="rounded-xl border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950">
            <summary className="cursor-pointer p-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📚</span>
                <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                  Knowledge from {knowledgeSourceLabel}
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
                    const source = snippet.source ?? "document";
                    const headerLabel =
                      source === "document"
                        ? snippet.documentName || `Document ${snippetIndex + 1}`
                        : source === "memory"
                          ? `Memory (${snippet.date || snippet.timestamp || "Unknown date"})`
                          : snippet.subject && snippet.predicate && snippet.object
                            ? `${snippet.subject} -> ${snippet.predicate} -> ${snippet.object}`
                            : "Graph fact";
                    return (
                      <details
                        key={snippetIndex}
                        className="rounded-lg border border-purple-300 bg-purple-100 dark:border-purple-700 dark:bg-purple-900"
                      >
                        <summary className="cursor-pointer p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="text-xs font-semibold text-purple-800 dark:text-purple-200">
                                {headerLabel}
                                {source === "document" && snippet.folderPath && (
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
                              remarkPlugins={REMARK_PLUGINS}
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
          const renderedPart = renderMessagePart(part, partIndex);

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
    if (prevProps.agent?.name !== nextProps.agent?.name) {
      return false; // Re-render
    }
    if (prevProps.isWidget !== nextProps.isWidget) {
      return false; // Re-render
    }

    // Same message reference and no other prop changes: skip re-render
    if (prevProps.message === nextProps.message) {
      return true;
    }

    // Knowledge injection messages: re-render when injection flag or snippets change
    type KnowledgeMsg = { knowledgeInjection?: boolean; knowledgeSnippets?: unknown[] };
    const prevKm = prevProps.message as KnowledgeMsg;
    const nextKm = nextProps.message as KnowledgeMsg;
    if (prevKm.knowledgeInjection !== nextKm.knowledgeInjection) {
      return false; // Re-render when switching to/from knowledge injection
    }
    if (prevKm.knowledgeInjection && nextKm.knowledgeInjection) {
      const prevSnips = prevKm.knowledgeSnippets;
      const nextSnips = nextKm.knowledgeSnippets;
      if (prevSnips !== nextSnips || (prevSnips?.length ?? 0) !== (nextSnips?.length ?? 0)) {
        return false; // Re-render
      }
    }

    // Lightweight parts comparison (avoid JSON.stringify of full content)
    const prevParts = getNormalizedPartsForCompare(prevProps.message);
    const nextParts = getNormalizedPartsForCompare(nextProps.message);

    if (prevParts.length !== nextParts.length) {
      return false; // Re-render
    }

    // Same parts array reference => content unchanged
    if (prevProps.message.parts === nextProps.message.parts) {
      // Still need to check metadata
    } else {
      // Cheap content fingerprint: compare part types and text lengths
      for (let i = 0; i < prevParts.length; i++) {
        const p = prevParts[i];
        const n = nextParts[i];
        if (p == null || n == null) {
          if (p !== n) return false;
          continue;
        }
        const pType =
          p && typeof p === "object" && "type" in p ? (p as { type: string }).type : "";
        const nType =
          n && typeof n === "object" && "type" in n ? (n as { type: string }).type : "";
        if (pType !== nType) return false;
        if (
          pType === "text" &&
          typeof p === "object" &&
          p !== null &&
          "text" in p &&
          typeof n === "object" &&
          n !== null &&
          "text" in n
        ) {
          const pText = (p as { text: string }).text;
          const nText = (n as { text: string }).text;
          if (pText.length !== nText.length || pText !== nText) return false;
        }
        // For other part types, reference equality is sufficient (tool calls etc. are not mutated in place)
        if (p !== n && pType !== "text") return false;
      }
    }

    // Shallow compare metadata
    const prevMsg = prevProps.message;
    const nextMsg = nextProps.message;
    if (prevMsg.tokenUsage !== nextMsg.tokenUsage) return false;
    if (prevMsg.modelName !== nextMsg.modelName) return false;
    if (prevMsg.provider !== nextMsg.provider) return false;

    return true;
  }
);
ChatMessage.displayName = "ChatMessage";
