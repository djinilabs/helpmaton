/**
 * Type definitions for message conversion utilities
 */

import type { SearchResult } from "./documentSearch";

export type TextContent = string | { type: "text"; text: string };

export type FileContent = {
  type: "file";
  file: string; // S3 URL - must be a URL, never base64/data URL
  mediaType?: string;
};

// For backward compatibility, ImageContent maps to FileContent
export type ImageContent = FileContent;

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

export type ReasoningContent = {
  type: "reasoning";
  text: string;
};

export type RerankingRequestContent = {
  type: "reranking-request";
  query: string;
  model: string;
  documentCount: number;
  documentNames: string[]; // Just document names, not full snippets
};

export type RerankingResultContent = {
  type: "reranking-result";
  model: string;
  documentCount: number;
  costUsd: number; // Cost in millionths (e.g., 1000 = $0.001)
  generationId?: string; // Generation ID for cost verification
  executionTimeMs?: number; // Duration in milliseconds
  rerankedDocuments: Array<{
    documentName: string;
    relevanceScore: number;
  }>;
  error?: string; // Error message if re-ranking failed
};

export type UIMessage =
  | {
      role: "user";
      content: string | Array<TextContent | FileContent>;
      awsRequestId?: string; // AWS Lambda/API Gateway request ID that added this message
      knowledgeInjection?: true; // Marker for knowledge injection messages
      knowledgeSnippets?: SearchResult[]; // Original snippets for reuse
      generationStartedAt?: string; // ISO timestamp when message was received
      generationEndedAt?: string; // ISO timestamp when message was received (same as started for user messages)
    }
  | {
      role: "assistant";
      content:
        | string
        | Array<TextContent | ToolCallContent | ToolResultContent | ReasoningContent>;
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
      generationStartedAt?: string; // ISO timestamp when message generation started
      generationEndedAt?: string; // ISO timestamp when message generation ended
    }
  | {
      role: "system";
      content:
        | string
        | Array<
            | { type: "text"; text: string }
            | RerankingRequestContent
            | RerankingResultContent
          >;
      awsRequestId?: string; // AWS Lambda/API Gateway request ID that added this message
      generationStartedAt?: string; // ISO timestamp when message was created
      generationEndedAt?: string; // ISO timestamp when message was created (same as started for system messages)
    }
  | {
      role: "tool";
      content: string | Array<ToolResultContent>;
      awsRequestId?: string; // AWS Lambda/API Gateway request ID that added this message
      generationStartedAt?: string; // ISO timestamp when tool execution started
      generationEndedAt?: string; // ISO timestamp when tool execution ended
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
