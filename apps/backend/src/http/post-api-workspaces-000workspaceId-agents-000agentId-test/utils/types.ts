import type { UIMessage as AiSdkUIMessage } from "ai";

import type { TokenUsage } from "../../../utils/conversationLogger";

/**
 * Type definitions for message conversion utilities
 */

export type TextContent = string | { type: "text"; text: string };

export type ToolCallContent = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type ToolResultContent = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
};

/**
 * Extended UIMessage type based on ai-sdk UIMessage
 * Supports both ai-sdk format (with 'parts') and our format (with 'content')
 * Adds optional tokenUsage to all message types
 * Also supports 'tool' role which is not in ai-sdk UIMessage
 */
export type UIMessage =
  | (Omit<AiSdkUIMessage, "id" | "parts"> & {
      // Support both ai-sdk format (parts) and our format (content)
      parts?: AiSdkUIMessage["parts"];
      content?:
        | string
        | Array<TextContent | ToolCallContent | ToolResultContent>;
      tokenUsage?: TokenUsage; // Token usage for this specific LLM interaction
    })
  | {
      role: "tool";
      content: string | Array<ToolResultContent>;
      parts?: AiSdkUIMessage["parts"];
      tokenUsage?: TokenUsage;
    };

export interface RequestParams {
  workspaceId: string;
  agentId: string;
  messages: unknown[];
  conversationId?: string;
}

export interface HttpResponseMetadata {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string | string[]>;
}
