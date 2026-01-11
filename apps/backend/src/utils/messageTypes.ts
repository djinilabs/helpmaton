/**
 * Type definitions for message conversion utilities
 */

import type { SearchResult } from "./documentSearch";

export type TextContent = string | { type: "text"; text: string };

export type ToolCallContent = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
  toolCallStartedAt?: string; // ISO timestamp when tool call started
};

export type ToolResultContent = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
  toolExecutionTimeMs?: number; // Duration in milliseconds
  costUsd?: number; // Cost in millionths (e.g., 8000 = $0.008)
};

export type UIMessage =
  | {
      role: "user";
      content: string | Array<{ type: "text"; text: string }>;
      awsRequestId?: string; // AWS Lambda/API Gateway request ID that added this message
      knowledgeInjection?: true; // Marker for knowledge injection messages
      knowledgeSnippets?: SearchResult[]; // Original snippets for reuse
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
      generationTimeMs?: number; // Time in milliseconds for LLM generation call
      awsRequestId?: string; // AWS Lambda/API Gateway request ID that added this message
    }
  | {
      role: "system";
      content: string;
      awsRequestId?: string; // AWS Lambda/API Gateway request ID that added this message
    }
  | {
      role: "tool";
      content: string | Array<ToolResultContent>;
      awsRequestId?: string; // AWS Lambda/API Gateway request ID that added this message
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
