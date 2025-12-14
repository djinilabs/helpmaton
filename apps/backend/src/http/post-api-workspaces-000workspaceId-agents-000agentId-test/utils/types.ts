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

export type UIMessage =
  | {
      role: "user";
      content: string | Array<{ type: "text"; text: string }>;
    }
  | {
      role: "assistant";
      content:
        | string
        | Array<TextContent | ToolCallContent | ToolResultContent>;
    }
  | {
      role: "system";
      content: string;
    }
  | {
      role: "tool";
      content: string | Array<ToolResultContent>;
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

