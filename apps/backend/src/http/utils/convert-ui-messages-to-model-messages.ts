import type {
  ModelMessage,
  UserModelMessage,
  SystemModelMessage,
  ToolCallPart,
  ToolResultPart,
  ToolModelMessage,
  ImagePart,
  FilePart,
} from "ai";

import type { UIMessage } from "../../utils/messageTypes";

const isHttpUrl = (value: string): boolean =>
  value.startsWith("http://") || value.startsWith("https://");

const isDataUrl = (value: string): boolean =>
  value.startsWith("data:") || value.startsWith("data;");

const toTextPart = (textParts: string[]): { type: "text"; text: string } | null => {
  const combinedText = textParts.join("").trim();
  if (!combinedText) return null;
  return { type: "text", text: combinedText };
};

const parseImagePart = (part: {
  image: string;
  mediaType?: unknown;
}): ImagePart => {
  const imageUrl = part.image;
  const mediaType =
    part.mediaType && typeof part.mediaType === "string" ? part.mediaType : undefined;

  if (isDataUrl(imageUrl)) {
    throw new Error(
      "Inline image data (base64/data URLs) is not allowed. Images must be uploaded to S3 first."
    );
  }
  if (!isHttpUrl(imageUrl)) {
    throw new Error("Image URL must be a valid HTTP/HTTPS URL");
  }

  return {
    type: "image",
    image: imageUrl,
    ...(mediaType && { mediaType }),
  } as ImagePart;
};

const parseFilePart = (part: {
  file: unknown;
  mediaType?: unknown;
}): ImagePart | FilePart => {
  if (typeof part.file !== "string") {
    throw new Error("File content must be a URL string, not inline data");
  }

  const fileUrl = part.file;
  const mediaType =
    part.mediaType && typeof part.mediaType === "string" ? part.mediaType : undefined;

  if (isDataUrl(fileUrl)) {
    throw new Error(
      "Inline file data (base64/data URLs) is not allowed. Files must be uploaded to S3 first."
    );
  }

  if (!isHttpUrl(fileUrl)) {
    throw new Error("File URL must be a valid HTTP/HTTPS URL");
  }

  const isImage =
    mediaType?.startsWith("image/") ||
    !!fileUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);

  if (isImage) {
    return {
      type: "image",
      image: fileUrl,
      ...(mediaType && { mediaType }),
    } as ImagePart;
  }

  return {
    type: "file",
    data: fileUrl,
    mimeType: mediaType || "application/octet-stream",
  } as unknown as FilePart;
};

/**
 * Pushes tool results as a separate message with role "tool".
 * The AI SDK's convertToLanguageModelPrompt only clears pending tool-call IDs when
 * it sees a message with role "tool" (see case 'tool' in the validation loop).
 * Putting results inside the assistant message caused AI_MissingToolResultsError.
 * @see aiSdkToolMessageFormat.test.ts (validates our output against the SDK)
 */
const pushToolResultsMessage = (
  modelMessages: ModelMessage[],
  toolResults: ToolResultPart[]
): void => {
  if (toolResults.length === 0) return;
  const toolMessage: ToolModelMessage = { role: "tool", content: toolResults };
  modelMessages.push(toolMessage);
};

/**
 * Creates a ToolResultPart from UI message data
 * Handles conversion of result/output fields and ensures proper typing
 * Formats output as LanguageModelV2ToolResultOutput discriminated union:
 * - { type: 'text', value: string } for text outputs
 * - { type: 'json', value: JSONValue } for JSON outputs
 */
export function createToolResultPart(
  toolCallId: string,
  toolName: string,
  rawValue: unknown
): ToolResultPart {
  let outputValue: ToolResultPart["output"];

  if (rawValue === null || rawValue === undefined) {
    outputValue = { type: "text", value: "" };
  } else if (typeof rawValue === "string") {
    outputValue = { type: "text", value: rawValue };
  } else if (typeof rawValue === "object") {
    outputValue = {
      type: "json",
      value: rawValue as unknown as Extract<
        ToolResultPart["output"],
        { type: "json" }
      >["value"],
    };
  } else {
    outputValue = { type: "text", value: String(rawValue) };
  }

  return {
    type: "tool-result",
    toolCallId,
    toolName,
    output: outputValue,
  };
}

const buildUserMessage = (message: UIMessage): UserModelMessage | null => {
  if (typeof message.content === "string") {
    if (!message.content.trim()) return null;
    return { role: "user", content: message.content };
  }

  if (!Array.isArray(message.content)) return null;

  const textParts: string[] = [];
  const imageParts: ImagePart[] = [];
  const fileParts: FilePart[] = [];

  for (const part of message.content) {
    if (typeof part === "string") {
      textParts.push(part);
      continue;
    }
    if (!part || typeof part !== "object" || !("type" in part)) {
      continue;
    }

    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      textParts.push(part.text);
      continue;
    }

    if ("image" in part && typeof part.image === "string") {
      const imagePart = parseImagePart({
        image: part.image,
        mediaType: "mediaType" in part ? part.mediaType : undefined,
      });
      imageParts.push(imagePart);
      continue;
    }

    if (part.type === "file" && "file" in part) {
      const filePart = parseFilePart({
        file: part.file,
        mediaType: "mediaType" in part ? part.mediaType : undefined,
      });
      if (filePart.type === "image") {
        imageParts.push(filePart);
      } else {
        fileParts.push(filePart);
      }
    }
  }

  const contentParts: Array<{ type: "text"; text: string } | ImagePart | FilePart> =
    [];
  const combinedTextPart = toTextPart(textParts);
  if (combinedTextPart) {
    contentParts.push(combinedTextPart);
  }
  contentParts.push(...imageParts);
  contentParts.push(...fileParts);

  if (imageParts.length > 0 || fileParts.length > 0) {
    console.log(
      "[convertUIMessagesToModelMessages] User message with files/images:",
      {
        imageCount: imageParts.length,
        fileCount: fileParts.length,
        hasText: combinedTextPart !== null,
        totalParts: contentParts.length,
        imageUrls: imageParts.map((part) => part.image),
        fileUrls: fileParts.map((part) => (part as { data?: unknown }).data),
      }
    );
  }

  if (contentParts.length === 0) {
    return null;
  }

  if (
    contentParts.length === 1 &&
    contentParts[0] &&
    contentParts[0].type === "text"
  ) {
    return { role: "user", content: contentParts[0].text };
  }

  return { role: "user", content: contentParts };
};

const buildSystemMessage = (message: UIMessage): SystemModelMessage | null => {
  const content = typeof message.content === "string" ? message.content : "";
  if (!content.trim()) return null;
  return { role: "system", content };
};

const buildAssistantMessages = (
  message: UIMessage,
  modelMessages: ModelMessage[]
): void => {
  if (typeof message.content === "string") {
    if (!message.content.trim()) return;
    modelMessages.push({ role: "assistant", content: message.content });
    return;
  }

  if (!Array.isArray(message.content)) return;

  const textParts: string[] = [];
  const toolCalls: ToolCallPart[] = [];
  const toolResults: ToolResultPart[] = [];

  for (const item of message.content) {
    if (typeof item === "string") {
      textParts.push(item);
      continue;
    }
    if (!item || typeof item !== "object" || !("type" in item)) {
      continue;
    }

    if (
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
    ) {
      textParts.push(item.text);
      continue;
    }

    if (
      item.type === "tool-call" &&
      "toolCallId" in item &&
      "toolName" in item &&
      typeof item.toolCallId === "string" &&
      typeof item.toolName === "string"
    ) {
      const inputValue =
        "args" in item && item.args !== undefined
          ? item.args
          : "input" in item && item.input !== undefined
          ? item.input
          : {};
      toolCalls.push({
        type: "tool-call",
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        input: inputValue,
      });
      continue;
    }

    if (
      item.type === "tool-result" &&
      "toolCallId" in item &&
      "toolName" in item &&
      typeof item.toolCallId === "string" &&
      typeof item.toolName === "string"
    ) {
      const rawValue =
        "result" in item && item.result !== undefined
          ? item.result
          : "output" in item && item.output !== undefined
          ? item.output
          : "";
      toolResults.push(
        createToolResultPart(item.toolCallId, item.toolName, rawValue)
      );
      continue;
    }

    if (item.type === "delegation") {
      continue;
    }
  }

  if (toolCalls.length > 0) {
    modelMessages.push({ role: "assistant", content: toolCalls });
  }

  const combinedTextPart = toTextPart(textParts);
  if (combinedTextPart) {
    modelMessages.push({ role: "assistant", content: combinedTextPart.text });
  }

  pushToolResultsMessage(modelMessages, toolResults);
};

const buildToolMessage = (message: UIMessage, modelMessages: ModelMessage[]): void => {
  const toolResults: ToolResultPart[] = [];

  if (Array.isArray(message.content)) {
    for (const item of message.content) {
      if (!item || typeof item !== "object" || !("type" in item)) {
        continue;
      }
      if (
        item.type === "tool-result" &&
        "toolCallId" in item &&
        "toolName" in item &&
        typeof item.toolCallId === "string" &&
        typeof item.toolName === "string"
      ) {
        const rawValue =
          "result" in item && item.result !== undefined
            ? item.result
            : "output" in item && item.output !== undefined
            ? item.output
            : "";
        toolResults.push(
          createToolResultPart(item.toolCallId, item.toolName, rawValue)
        );
      } else if ("type" in item && item.type === "delegation") {
        continue;
      }
    }
  } else if (typeof message.content === "string") {
    console.warn(
      "[convertUIMessagesToModelMessages] Tool message with string content, skipping"
    );
  }

  if (toolResults.length > 0) {
    const toolMessage: ToolModelMessage = { role: "tool", content: toolResults };
    modelMessages.push(toolMessage);
  }
};

/**
 * Converts UI messages to model messages format for AI SDK
 * Handles text extraction, tool calls, and tool results
 */
export function convertUIMessagesToModelMessages(
  messages: UIMessage[]
): ModelMessage[] {
  const modelMessages: ModelMessage[] = [];

  for (const message of messages) {
    if (!message || typeof message !== "object" || !("role" in message)) {
      console.warn(
        "[convertUIMessagesToModelMessages] Skipping invalid message:",
        message
      );
      continue;
    }

    const role = message.role as string;
    switch (role) {
      case "user": {
        const userMessage = buildUserMessage(message);
        if (userMessage) {
          modelMessages.push(userMessage);
        }
        break;
      }
      case "system": {
        const systemMessage = buildSystemMessage(message);
        if (systemMessage) {
          modelMessages.push(systemMessage);
        }
        break;
      }
      case "assistant": {
        buildAssistantMessages(message, modelMessages);
        break;
      }
      case "tool": {
        buildToolMessage(message, modelMessages);
        break;
      }
      default: {
        console.warn(
          "[convertUIMessagesToModelMessages] Unknown message role:",
          role
        );
      }
    }
  }

  return modelMessages;
}
