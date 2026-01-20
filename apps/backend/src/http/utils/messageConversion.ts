import type { ModelMessage, ToolResultPart } from "ai";

import type { UIMessage } from "../../utils/messageTypes";

import { convertAiSdkUIMessageToUIMessage as convertAiSdkUIMessageToUIMessageImpl } from "./convert-ai-sdk-ui-message-to-ui-message";
import {
  convertUIMessagesToModelMessages as convertUIMessagesToModelMessagesImpl,
  createToolResultPart as createToolResultPartImpl,
} from "./convert-ui-messages-to-model-messages";

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
  return convertAiSdkUIMessageToUIMessageImpl(message);
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
  return createToolResultPartImpl(toolCallId, toolName, rawValue);
}

/**
 * Converts UI messages to model messages format for AI SDK
 * Handles text extraction, tool calls, and tool results
 */
export function convertUIMessagesToModelMessages(
  messages: UIMessage[]
): ModelMessage[] {
  return convertUIMessagesToModelMessagesImpl(messages);
}
