import type {
  ModelMessage,
  UserModelMessage,
  AssistantModelMessage,
  SystemModelMessage,
  ToolCallPart,
  ToolResultPart,
  ImagePart,
  FilePart,
} from "ai";

import type { UIMessage } from "../../utils/messageTypes";

import { extractToolCostFromResult } from "./toolCostExtraction";

/**
 * Converts plain text to a UIMessage format
 * Used by webhook handler to convert plain text body to the same format as test handler
 */
export function convertTextToUIMessage(text: string): UIMessage {
  return {
    role: "user",
    content: text,
  };
}

/**
 * Converts ai-sdk UIMessage format (with 'parts' property) to our UIMessage format (with 'content' property)
 * Messages from useChat are in ai-sdk format with 'parts' array instead of 'content'
 */
export function convertAiSdkUIMessageToUIMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ai-sdk UIMessage type is complex
  message: any
): UIMessage | null {
  if (!message || typeof message !== "object" || !("role" in message)) {
    return null;
  }

  const role = message.role;

  // Handle user messages
  if (role === "user") {
    // Check if it's ai-sdk format (has 'parts')
    if ("parts" in message && Array.isArray(message.parts)) {
      // Extract text, images, and files from parts array
      const content: Array<
        | { type: "text"; text: string }
        | { type: "file"; file: string; mediaType?: string }
      > = [];

      for (const part of message.parts) {
        if (typeof part === "string") {
          content.push({ type: "text", text: part });
        } else if (part && typeof part === "object" && "type" in part) {
          if (
            part.type === "text" &&
            "text" in part &&
            typeof part.text === "string"
          ) {
            content.push({ type: "text", text: part.text });
          } else if (
            (part.type === "image" || part.type === "file") &&
            ("image" in part || "file" in part || "data" in part)
          ) {
            // Handle image/file parts from AI SDK
            // AI SDK uses 'image' for ImagePart and 'data' for FilePart
            const fileUrl =
              "image" in part && typeof part.image === "string"
                ? part.image
                : "file" in part && typeof part.file === "string"
                ? part.file
                : "data" in part && typeof part.data === "string"
                ? part.data
                : null;

            if (fileUrl) {
              // Validate it's a URL, not base64/data URL
              if (
                fileUrl.startsWith("http://") ||
                fileUrl.startsWith("https://")
              ) {
                const mediaType =
                  "mimeType" in part && typeof part.mimeType === "string"
                    ? part.mimeType
                    : "mediaType" in part && typeof part.mediaType === "string"
                    ? part.mediaType
                    : undefined;

                content.push({
                  type: "file",
                  file: fileUrl,
                  mediaType,
                });
              } else {
                // Skip base64/data URLs - they should not be in messages
                console.warn(
                  "[convertAiSdkUIMessageToUIMessage] Skipping inline file data (base64/data URL)"
                );
              }
            }
          }
        }
      }

      // If only one text part, simplify to string
      if (content.length === 1 && content[0].type === "text") {
        return {
          role: "user",
          content: content[0].text,
        };
      }

      // Return with content array
      return {
        role: "user",
        content,
      };
    }
    // Already in our format (has 'content')
    if ("content" in message) {
      return message as UIMessage;
    }
    return null;
  }

  // Handle system messages
  if (role === "system") {
    if ("parts" in message && Array.isArray(message.parts)) {
      // Extract text from parts
      const textParts: string[] = [];
      for (const part of message.parts) {
        if (typeof part === "string") {
          textParts.push(part);
        } else if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "text" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          textParts.push(part.text);
        }
      }
      return {
        role: "system",
        content: textParts.join(""),
      };
    }
    if ("content" in message && typeof message.content === "string") {
      return message as UIMessage;
    }
    return null;
  }

  // Handle assistant messages
  if (role === "assistant") {
    if ("parts" in message && Array.isArray(message.parts)) {
      // Convert parts array to content array
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
      > = [];

      for (const part of message.parts) {
        if (typeof part === "string") {
          content.push({ type: "text", text: part });
        } else if (part && typeof part === "object" && "type" in part) {
          if (part.type === "text" && "text" in part) {
            content.push({ type: "text", text: part.text });
          } else if (
            part.type === "reasoning" &&
            "text" in part &&
            typeof part.text === "string"
          ) {
            // Handle reasoning parts from AI SDK
            content.push({
              type: "reasoning",
              text: part.text,
            });
          } else if (
            part.type === "tool-call" &&
            "toolCallId" in part &&
            "toolName" in part
          ) {
            content.push({
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args:
                "args" in part ? part.args : "input" in part ? part.input : {},
            });
          } else if (
            part.type === "tool-result" &&
            "toolCallId" in part &&
            "toolName" in part
          ) {
            // Extract result value
            // Prefer output over result (matches toolFormatting.ts behavior)
            const rawResult =
              "output" in part && part.output !== undefined
                ? part.output
                : "result" in part
                ? part.result
                : null;

            // Extract cost from result string if present (format: __HM_TOOL_COST__:8000)
            let costUsd: number | undefined;
            let processedResult = rawResult;

            if (typeof rawResult === "string") {
              const extractionResult = extractToolCostFromResult(rawResult);
              costUsd = extractionResult.costUsd;
              processedResult = extractionResult.processedResult;
            }

            content.push({
              type: "tool-result",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              result: processedResult,
              ...(costUsd !== undefined && { costUsd }),
            });
          }
        }
      }

      // If only one text part, simplify to string
      if (content.length === 1 && content[0].type === "text") {
        return {
          role: "assistant",
          content: content[0].text,
        };
      }

      return {
        role: "assistant",
        content,
      };
    }
    // Already in our format
    if ("content" in message) {
      return message as UIMessage;
    }
    return null;
  }

  // Handle tool messages
  if (role === "tool") {
    if ("parts" in message && Array.isArray(message.parts)) {
      // Convert tool message parts to content array
      const content: Array<{
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        result: unknown;
        costUsd?: number;
      }> = [];

      for (const part of message.parts) {
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "tool-result" &&
          "toolCallId" in part &&
          "toolName" in part
        ) {
          // Extract result value
          // Prefer output over result (matches toolFormatting.ts behavior)
          const rawResult =
            "output" in part && part.output !== undefined
              ? part.output
              : "result" in part
              ? part.result
              : null;

          // Extract cost from result string if present (format: __HM_TOOL_COST__:8000)
          let costUsd: number | undefined;
          let processedResult = rawResult;

          if (typeof rawResult === "string") {
            const extractionResult = extractToolCostFromResult(rawResult);
            costUsd = extractionResult.costUsd;
            processedResult = extractionResult.processedResult;
          }

          content.push({
            type: "tool-result",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            result: processedResult,
            ...(costUsd !== undefined && { costUsd }),
          });
        }
      }

      return {
        role: "tool",
        content,
      };
    }
    // Already in our format
    if ("content" in message) {
      return message as UIMessage;
    }
    return null;
  }

  return null;
}

/**
 * Converts an array of ai-sdk UIMessages to our UIMessage format
 * Filters out any null/invalid messages
 */
export function convertAiSdkUIMessagesToUIMessages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ai-sdk UIMessage type is complex
  messages: any[]
): UIMessage[] {
  const converted: UIMessage[] = [];
  for (const message of messages) {
    const convertedMsg = convertAiSdkUIMessageToUIMessage(message);
    if (convertedMsg) {
      converted.push(convertedMsg);
    }
  }
  return converted;
}

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
  // LanguageModelV2ToolResultOutput requires a discriminated union:
  // - { type: 'text', value: string } for text outputs
  // - { type: 'json', value: JSONValue } for JSON outputs
  // - { type: 'error-text', value: string } for error text
  // - { type: 'error-json', value: JSONValue } for error JSON
  // - { type: 'content', value: Array<...> } for content arrays
  let outputValue: ToolResultPart["output"];

  if (rawValue === null || rawValue === undefined) {
    // Use empty text output for null/undefined
    outputValue = { type: "text", value: "" };
  } else if (typeof rawValue === "string") {
    // Format string as text output
    outputValue = { type: "text", value: rawValue };
  } else if (typeof rawValue === "object") {
    // Format object as JSON output
    // Type assertion needed because JSONValue is an internal type that accepts any JSON-serializable object
    outputValue = {
      type: "json",
      value: rawValue as unknown as Extract<
        ToolResultPart["output"],
        { type: "json" }
      >["value"],
    };
  } else {
    // Convert other primitives to string and format as text output
    outputValue = { type: "text", value: String(rawValue) };
  }

  return {
    type: "tool-result",
    toolCallId,
    toolName,
    output: outputValue,
  };
}

/**
 * Converts UI messages to model messages format for AI SDK
 * Handles text extraction, tool calls, and tool results
 */
export function convertUIMessagesToModelMessages(
  messages: UIMessage[]
): ModelMessage[] {
  const modelMessages: ModelMessage[] = [];

  for (const message of messages) {
    // Skip invalid messages
    if (!message || typeof message !== "object" || !("role" in message)) {
      console.warn(
        "[convertUIMessagesToModelMessages] Skipping invalid message:",
        message
      );
      continue;
    }

    const role = message.role;

    // Handle user messages
    if (role === "user") {
      if (typeof message.content === "string") {
        // Simple text content
        if (message.content.trim()) {
          const userMessage: UserModelMessage = {
            role: "user",
            content: message.content,
          };
          modelMessages.push(userMessage);
        }
      } else if (Array.isArray(message.content)) {
        // Content array - extract text, images, and files
        const textParts: string[] = [];
        const imageParts: ImagePart[] = [];
        const fileParts: FilePart[] = [];

        for (const part of message.content) {
          if (typeof part === "string") {
            textParts.push(part);
          } else if (part && typeof part === "object" && "type" in part) {
            const partType = part.type;
            if (
              partType === "text" &&
              "text" in part &&
              typeof part.text === "string"
            ) {
              textParts.push(part.text);
            } else if ("image" in part && typeof part.image === "string") {
              // Handle image type (from schema: { type: "image", image: "https://..." })
              // Note: Schema allows this format even though TypeScript types use FileContent
              const imagePart = part as {
                type: string;
                image: string;
                mediaType?: unknown;
              };
              const imageUrl = imagePart.image;
              const imageMediaType =
                imagePart.mediaType && typeof imagePart.mediaType === "string"
                  ? imagePart.mediaType
                  : undefined;

              // Validate that image URL is an S3 URL, not base64/data URL
              // Reject base64/data URLs
              if (
                imageUrl.startsWith("data:") ||
                imageUrl.startsWith("data;")
              ) {
                throw new Error(
                  "Inline image data (base64/data URLs) is not allowed. Images must be uploaded to S3 first."
                );
              }

              // Ensure it's a valid URL
              if (
                !imageUrl.startsWith("http://") &&
                !imageUrl.startsWith("https://")
              ) {
                throw new Error("Image URL must be a valid HTTP/HTTPS URL");
              }

              // Use ImagePart for images
              // Include mediaType if available (some providers may need it)
              imageParts.push({
                type: "image",
                image: imageUrl,
                ...(imageMediaType && { mediaType: imageMediaType }),
              } as ImagePart);
            } else if (partType === "file" && "file" in part) {
              // Handle file type
              const filePart = part as {
                type: "file";
                file: unknown;
                mediaType?: unknown;
              };
              const fileUrl = filePart.file;
              const mediaType =
                filePart.mediaType && typeof filePart.mediaType === "string"
                  ? filePart.mediaType
                  : undefined;

              // Validate that file URL is an S3 URL, not base64/data URL
              if (typeof fileUrl !== "string") {
                throw new Error(
                  "File content must be a URL string, not inline data"
                );
              }

              // Reject base64/data URLs
              if (fileUrl.startsWith("data:") || fileUrl.startsWith("data;")) {
                throw new Error(
                  "Inline file data (base64/data URLs) is not allowed. Files must be uploaded to S3 first."
                );
              }

              // Ensure it's a valid URL
              if (
                !fileUrl.startsWith("http://") &&
                !fileUrl.startsWith("https://")
              ) {
                throw new Error("File URL must be a valid HTTP/HTTPS URL");
              }

              // Determine if it's an image based on mediaType or URL
              const isImage =
                mediaType?.startsWith("image/") ||
                !!fileUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);

              if (isImage) {
                // Use ImagePart for images
                // Include mediaType if available (some providers may need it)
                imageParts.push({
                  type: "image",
                  image: fileUrl,
                  ...(mediaType && { mediaType }),
                } as ImagePart);
              } else {
                // Use FilePart for other files
                // FilePart uses 'data' for URL (can be string URL)
                fileParts.push({
                  type: "file",
                  data: fileUrl,
                  mimeType: mediaType || "application/octet-stream",
                } as unknown as FilePart);
              }
            }
          }
        }

        // Build content array for user message
        // AI SDK UserContent can be string or array of TextPart | ImagePart | FilePart
        const contentParts: Array<
          { type: "text"; text: string } | ImagePart | FilePart
        > = [];

        // Add text content as TextPart
        const combinedText = textParts.join("").trim();
        if (combinedText) {
          contentParts.push({ type: "text", text: combinedText });
        }

        // Add image parts
        contentParts.push(...imageParts);

        // Add file parts
        contentParts.push(...fileParts);

        // Log if we have image/file parts to verify they're being included
        if (imageParts.length > 0 || fileParts.length > 0) {
          console.log(
            "[convertUIMessagesToModelMessages] User message with files/images:",
            {
              imageCount: imageParts.length,
              fileCount: fileParts.length,
              hasText: combinedText.length > 0,
              totalParts: contentParts.length,
              imageUrls: imageParts.map((p) => p.image),
              fileUrls: fileParts.map((p) => (p as { data?: unknown }).data),
            }
          );
        }

        // Create user message with content array
        if (contentParts.length > 0) {
          // If only one text part, use string format for simplicity
          const firstPart = contentParts[0];
          if (
            contentParts.length === 1 &&
            firstPart &&
            typeof firstPart === "object" &&
            "type" in firstPart &&
            firstPart.type === "text"
          ) {
            const userMessage: UserModelMessage = {
              role: "user",
              content: firstPart.text,
            };
            modelMessages.push(userMessage);
          } else {
            // Multiple parts - use array format
            const userMessage: UserModelMessage = {
              role: "user",
              content: contentParts,
            };
            modelMessages.push(userMessage);
          }
        }
      }
      continue;
    }

    // Handle system messages
    if (role === "system") {
      const content =
        typeof message.content === "string" ? message.content : "";
      if (content.trim()) {
        const systemMessage: SystemModelMessage = {
          role: "system",
          content,
        };
        modelMessages.push(systemMessage);
      }
      continue;
    }

    // Handle assistant messages
    if (role === "assistant") {
      if (typeof message.content === "string") {
        // Simple text content
        if (message.content.trim()) {
          const assistantMessage: AssistantModelMessage = {
            role: "assistant",
            content: message.content,
          };
          modelMessages.push(assistantMessage);
        }
      } else if (Array.isArray(message.content)) {
        // Content array - extract text, tool calls, and tool results
        const textParts: string[] = [];
        const toolCalls: ToolCallPart[] = [];
        const toolResults: ToolResultPart[] = [];

        for (const item of message.content) {
          if (typeof item === "string") {
            textParts.push(item);
          } else if (item && typeof item === "object" && "type" in item) {
            if (
              item.type === "text" &&
              "text" in item &&
              typeof item.text === "string"
            ) {
              textParts.push(item.text);
            } else if (
              item.type === "tool-call" &&
              "toolCallId" in item &&
              "toolName" in item &&
              typeof item.toolCallId === "string" &&
              typeof item.toolName === "string"
            ) {
              // AI SDK expects 'input' instead of 'args'
              const inputValue =
                "args" in item && item.args !== undefined
                  ? item.args
                  : "input" in item && item.input !== undefined
                  ? item.input
                  : {};
              const toolCall: ToolCallPart = {
                type: "tool-call",
                toolCallId: item.toolCallId,
                toolName: item.toolName,
                input: inputValue,
              };
              toolCalls.push(toolCall);
            } else if (
              item.type === "tool-result" &&
              "toolCallId" in item &&
              "toolName" in item &&
              typeof item.toolCallId === "string" &&
              typeof item.toolName === "string"
            ) {
              // Convert tool-result in assistant messages to tool role messages
              // AI SDK expects 'output' instead of 'result'
              const rawValue =
                "result" in item && item.result !== undefined
                  ? item.result
                  : "output" in item && item.output !== undefined
                  ? item.output
                  : "";
              toolResults.push(
                createToolResultPart(item.toolCallId, item.toolName, rawValue)
              );
            }
          }
        }

        // If we have tool calls, create assistant message with tool calls
        if (toolCalls.length > 0) {
          const assistantMessage: AssistantModelMessage = {
            role: "assistant",
            content: toolCalls,
          };
          modelMessages.push(assistantMessage);
        }

        // If we have text content, create assistant message with text
        const combinedText = textParts.join("").trim();
        if (combinedText) {
          const assistantMessage: AssistantModelMessage = {
            role: "assistant",
            content: combinedText,
          };
          modelMessages.push(assistantMessage);
        }

        // If we have tool results, add them to the assistant message content
        // In AI SDK v5, tool results can be part of assistant messages
        if (toolResults.length > 0) {
          // If we already have an assistant message with tool calls, add tool results to it
          // Otherwise create a new assistant message with tool results
          const existingAssistantIndex = modelMessages.findIndex(
            (msg) => msg.role === "assistant"
          );
          if (existingAssistantIndex >= 0) {
            const existingMsg = modelMessages[existingAssistantIndex];
            if (
              Array.isArray(existingMsg.content) &&
              existingMsg.content.length > 0
            ) {
              // Add tool results to existing assistant message content
              (existingMsg.content as Array<unknown>).push(...toolResults);
            } else {
              // Replace content with tool results
              (
                modelMessages[existingAssistantIndex] as AssistantModelMessage
              ).content = toolResults;
            }
          } else {
            // Create new assistant message with tool results
            const assistantMessage: AssistantModelMessage = {
              role: "assistant",
              content: toolResults,
            };
            modelMessages.push(assistantMessage);
          }
        }
      }
      continue;
    }

    // Handle tool messages - convert to assistant messages with tool results
    // In AI SDK v5, tool results should be in assistant messages, not tool messages
    if (role === "tool") {
      const toolResults: ToolResultPart[] = [];

      if (Array.isArray(message.content)) {
        for (const item of message.content) {
          if (
            item &&
            typeof item === "object" &&
            "type" in item &&
            item.type === "tool-result" &&
            "toolCallId" in item &&
            "toolName" in item &&
            typeof item.toolCallId === "string" &&
            typeof item.toolName === "string"
          ) {
            // AI SDK expects 'output' instead of 'result'
            const rawValue =
              "result" in item && item.result !== undefined
                ? item.result
                : "output" in item && item.output !== undefined
                ? item.output
                : "";
            toolResults.push(
              createToolResultPart(item.toolCallId, item.toolName, rawValue)
            );
          }
        }
      } else if (typeof message.content === "string") {
        // If content is a string, we can't create a proper tool result
        // This shouldn't happen in normal flow, but handle gracefully
        console.warn(
          "[convertUIMessagesToModelMessages] Tool message with string content, skipping"
        );
      }

      if (toolResults.length > 0) {
        // Create assistant message with tool results instead of tool message
        const assistantMessage: AssistantModelMessage = {
          role: "assistant",
          content: toolResults,
        };
        modelMessages.push(assistantMessage);
      }
      continue;
    }

    // Unknown role - log warning and skip
    console.warn(
      "[convertUIMessagesToModelMessages] Unknown message role:",
      role
    );
  }

  return modelMessages;
}
