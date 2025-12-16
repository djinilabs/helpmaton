import type { ModelMessage } from "ai";

import { calculateTokenCost } from "./pricing";

/**
 * Estimate input tokens from messages
 * Uses character count / 4 as a rough estimate (most models use ~4 characters per token)
 * Also considers system prompt and tool definitions
 */
export function estimateInputTokens(
  messages: ModelMessage[],
  systemPrompt?: string,
  toolDefinitions?: unknown[]
): number {
  let totalChars = 0;

  // Count characters in messages
  for (const message of messages) {
    const content = message.content as string | unknown[];
    if (typeof content === "string") {
      totalChars += content.length;
    } else if (Array.isArray(content)) {
      // Handle content arrays (e.g., text parts)
      for (const part of content) {
        if (typeof part === "string") {
          totalChars += part.length;
        } else if (
          typeof part === "object" &&
          part !== null &&
          "text" in part &&
          typeof (part as { text: unknown }).text === "string"
        ) {
          totalChars += (part as { text: string }).text.length;
        }
      }
    }
  }

  // Add system prompt if provided separately
  if (systemPrompt) {
    totalChars += systemPrompt.length;
  }

  // Add tool definitions if provided (estimate as JSON string length)
  if (toolDefinitions && toolDefinitions.length > 0) {
    try {
      totalChars += JSON.stringify(toolDefinitions).length;
    } catch {
      // If serialization fails, estimate based on array length
      totalChars += toolDefinitions.length * 100; // Rough estimate
    }
  }

  // Rough estimate: ~4 characters per token
  // Add some overhead for message formatting and metadata
  const estimatedTokens = Math.ceil(totalChars / 4) + messages.length * 3;

  return estimatedTokens;
}

/**
 * Estimate output tokens
 * Conservative estimate: 20% of input tokens or fixed minimum (e.g., 100 tokens)
 */
export function estimateOutputTokens(inputTokens: number): number {
  // Use 20% of input tokens as baseline
  const estimated = Math.ceil(inputTokens * 0.2);
  // Ensure minimum of 100 tokens for any response
  return Math.max(estimated, 100);
}

/**
 * Estimate total cost before LLM call
 *
 * @param provider - LLM provider name
 * @param modelName - Model name
 * @param messages - Messages to send
 * @param systemPrompt - Optional system prompt
 * @param toolDefinitions - Optional tool definitions
 * @returns Estimated cost in USD
 */
export function estimateTokenCost(
  provider: string,
  modelName: string,
  messages: ModelMessage[],
  systemPrompt?: string,
  toolDefinitions?: unknown[]
): number {
  // Estimate input and output tokens
  const inputTokens = estimateInputTokens(messages, systemPrompt, toolDefinitions);
  const outputTokens = estimateOutputTokens(inputTokens);

  // Calculate cost in USD
  return calculateTokenCost(provider, modelName, inputTokens, outputTokens);
}

