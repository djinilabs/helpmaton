import type { UIMessage } from "../../utils/messageTypes";

import { extractToolCostFromResult } from "./toolCostExtraction";

type AiSdkMessage = {
  role?: string;
  parts?: unknown;
  content?: unknown;
};

type AiSdkPart = {
  type?: string;
  text?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  args?: unknown;
  input?: unknown;
  output?: unknown;
  result?: unknown;
  image?: unknown;
  file?: unknown;
  data?: unknown;
  url?: unknown;
  mimeType?: unknown;
  mediaType?: unknown;
  filename?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAiSdkMessage(value: unknown): value is AiSdkMessage {
  return isObject(value) && "role" in value;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function extractTextParts(parts: unknown[]): string[] {
  const textParts: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      textParts.push(part);
      continue;
    }
    if (isObject(part) && part.type === "text" && typeof part.text === "string") {
      textParts.push(part.text);
    }
  }
  return textParts;
}

function extractFileUrl(part: AiSdkPart): string | null {
  if (typeof part.url === "string") {
    return part.url;
  }
  if (typeof part.image === "string") {
    return part.image;
  }
  if (typeof part.file === "string") {
    return part.file;
  }
  if (typeof part.data === "string") {
    return part.data;
  }
  return null;
}

function resolveMediaType(part: AiSdkPart): string | undefined {
  if (typeof part.mimeType === "string") {
    return part.mimeType;
  }
  if (typeof part.mediaType === "string") {
    return part.mediaType;
  }
  return undefined;
}

function resolveFilename(part: AiSdkPart): string | undefined {
  return typeof part.filename === "string" ? part.filename : undefined;
}

function buildToolResultContent(part: AiSdkPart): {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
  costUsd?: number;
} | null {
  if (typeof part.toolCallId !== "string" || typeof part.toolName !== "string") {
    return null;
  }

  const rawResult =
    part.output !== undefined ? part.output : part.result !== undefined ? part.result : null;

  let costUsd: number | undefined;
  let processedResult = rawResult;

  if (typeof rawResult === "string") {
    const extractionResult = extractToolCostFromResult(rawResult);
    costUsd = extractionResult.costUsd;
    processedResult = extractionResult.processedResult;
  }

  return {
    type: "tool-result",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    result: processedResult,
    ...(costUsd !== undefined && { costUsd }),
  };
}

function buildUserMessageFromParts(parts: unknown[]): UIMessage {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "file"; file: string; mediaType?: string }
  > = [];

  for (const part of parts) {
    if (typeof part === "string") {
      content.push({ type: "text", text: part });
      continue;
    }

    if (isObject(part) && "type" in part) {
      const typedPart = part as AiSdkPart;
      if (typedPart.type === "text" && typeof typedPart.text === "string") {
        content.push({ type: "text", text: typedPart.text });
        continue;
      }

      if (
        (typedPart.type === "image" || typedPart.type === "file") &&
        ("image" in typedPart || "file" in typedPart || "data" in typedPart)
      ) {
        const fileUrl = extractFileUrl(typedPart);
        if (!fileUrl) {
          continue;
        }
        if (!isHttpUrl(fileUrl)) {
          console.warn(
            "[convertAiSdkUIMessageToUIMessage] Skipping inline file data (base64/data URL)"
          );
          continue;
        }
        content.push({
          type: "file",
          file: fileUrl,
          mediaType: resolveMediaType(typedPart),
          filename: resolveFilename(typedPart),
        });
      }
    }
  }

  if (content.length === 1 && content[0].type === "text") {
    return { role: "user", content: content[0].text };
  }

  return { role: "user", content };
}

function buildAssistantMessageFromParts(parts: unknown[]): UIMessage {
  const content: Array<
    | { type: "text"; text: string }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        args: unknown;
      }
    | {
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        result: unknown;
        costUsd?: number;
      }
    | {
        type: "reasoning";
        text: string;
      }
    | { type: "file"; file: string; mediaType?: string; filename?: string }
  > = [];

  for (const part of parts) {
    if (typeof part === "string") {
      content.push({ type: "text", text: part });
      continue;
    }

    if (isObject(part) && "type" in part) {
      const typedPart = part as AiSdkPart;
      if (typedPart.type === "text" && typeof typedPart.text === "string") {
        content.push({ type: "text", text: typedPart.text });
        continue;
      }
      if (typedPart.type === "reasoning" && typeof typedPart.text === "string") {
        content.push({ type: "reasoning", text: typedPart.text });
        continue;
      }
      if (
        (typedPart.type === "image" || typedPart.type === "file") &&
        ("image" in typedPart || "file" in typedPart || "data" in typedPart || "url" in typedPart)
      ) {
        const fileUrl = extractFileUrl(typedPart);
        if (!fileUrl) {
          continue;
        }
        if (!isHttpUrl(fileUrl)) {
          console.warn(
            "[convertAiSdkUIMessageToUIMessage] Skipping inline file data (base64/data URL)"
          );
          continue;
        }
        content.push({
          type: "file",
          file: fileUrl,
          mediaType: resolveMediaType(typedPart),
          filename: resolveFilename(typedPart),
        });
        continue;
      }
      if (
        typedPart.type === "tool-call" &&
        typeof typedPart.toolCallId === "string" &&
        typeof typedPart.toolName === "string"
      ) {
        content.push({
          type: "tool-call",
          toolCallId: typedPart.toolCallId,
          toolName: typedPart.toolName,
          args:
            typedPart.args !== undefined
              ? typedPart.args
              : typedPart.input !== undefined
              ? typedPart.input
              : {},
        });
        continue;
      }
      if (typedPart.type === "tool-result") {
        const toolResult = buildToolResultContent(typedPart);
        if (toolResult) {
          content.push(toolResult);
        }
      }
    }
  }

  if (content.length === 1 && content[0].type === "text") {
    return { role: "assistant", content: content[0].text };
  }

  return { role: "assistant", content };
}

function buildToolMessageFromParts(parts: unknown[]): UIMessage {
  const content: Array<{
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    result: unknown;
    costUsd?: number;
  }> = [];

  for (const part of parts) {
    if (isObject(part) && "type" in part) {
      const typedPart = part as AiSdkPart;
      if (typedPart.type === "tool-result") {
        const toolResult = buildToolResultContent(typedPart);
        if (toolResult) {
          content.push(toolResult);
        }
      }
    }
  }

  return { role: "tool", content };
}

export function convertAiSdkUIMessageToUIMessage(message: unknown): UIMessage | null {
  if (!isAiSdkMessage(message) || typeof message.role !== "string") {
    return null;
  }

  const role = message.role;

  if (role === "user") {
    if (Array.isArray(message.parts)) {
      return buildUserMessageFromParts(message.parts);
    }
    if ("content" in message) {
      return message as UIMessage;
    }
    return null;
  }

  if (role === "system") {
    if (Array.isArray(message.parts)) {
      return {
        role: "system",
        content: extractTextParts(message.parts).join(""),
      };
    }
    if ("content" in message && typeof message.content === "string") {
      return message as UIMessage;
    }
    return null;
  }

  if (role === "assistant") {
    if (Array.isArray(message.parts)) {
      return buildAssistantMessageFromParts(message.parts);
    }
    if ("content" in message) {
      return message as UIMessage;
    }
    return null;
  }

  if (role === "tool") {
    if (Array.isArray(message.parts)) {
      return buildToolMessageFromParts(message.parts);
    }
    if ("content" in message) {
      return message as UIMessage;
    }
    return null;
  }

  return null;
}
