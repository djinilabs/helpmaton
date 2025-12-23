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
      tokenUsage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        reasoningTokens?: number;
        cachedPromptTokens?: number;
      };
      modelName?: string; // AI model name used for this message (e.g., "gemini-2.0-flash-exp")
      provider?: string; // AI provider name used for this message (e.g., "google")
      openrouterGenerationId?: string; // OpenRouter generation ID for cost verification
      provisionalCostUsd?: number; // Provisional cost extracted from LLM response (in millionths)
      finalCostUsd?: number; // Final cost from OpenRouter API (in millionths) after verification
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
