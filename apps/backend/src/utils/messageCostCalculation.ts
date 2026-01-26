import type { UIMessage } from "./messageTypes";
import { calculateConversationCosts } from "./tokenAccounting";

/**
 * Result of getting message cost
 */
export interface MessageCostResult {
  /**
   * For assistant messages: The best available cost in nano-dollars
   * For tool messages: undefined (use toolCosts array instead)
   */
  costUsd?: number;
  /**
   * For tool messages: Array of individual tool costs (one per tool result)
   * For assistant messages: undefined
   */
  toolCosts?: Array<{ toolName: string; costUsd: number }>;
  /**
   * Whether the cost is final (true), provisional (false), or calculated (undefined)
   */
  isFinal?: boolean;
}

/**
 * Get the cost for a message
 * For assistant messages: Returns the best available cost (finalCostUsd > provisionalCostUsd > calculated from tokenUsage)
 * For tool messages: Returns individual costs for each tool result
 *
 * @param message - The message to get cost for
 * @returns MessageCostResult with cost information, or undefined if no cost available
 */
export function getMessageCost(
  message: UIMessage
): MessageCostResult | undefined {
  if (message.role === "assistant") {
    // Prefer finalCostUsd if available (indicates final cost)
    if ("finalCostUsd" in message && typeof message.finalCostUsd === "number") {
      return {
        costUsd: message.finalCostUsd,
        isFinal: true,
      };
    }

    // Fall back to provisionalCostUsd if available (indicates provisional cost)
    if (
      "provisionalCostUsd" in message &&
      typeof message.provisionalCostUsd === "number"
    ) {
      return {
        costUsd: message.provisionalCostUsd,
        isFinal: false,
      };
    }

    // Fall back to calculating from tokenUsage (indicates calculated cost)
    if ("tokenUsage" in message && message.tokenUsage) {
      const modelName =
        "modelName" in message && typeof message.modelName === "string"
          ? message.modelName
          : undefined;
      const provider =
        "provider" in message && typeof message.provider === "string"
          ? message.provider
          : "google";
      const messageCosts = calculateConversationCosts(
        provider,
        modelName,
        message.tokenUsage
      );
      return {
        costUsd: messageCosts.usd,
        isFinal: undefined, // Calculated, not final or provisional
      };
    }

    // No cost information available
    return undefined;
  }

  if (message.role === "tool") {
    // For tool messages, extract individual costs from tool-result content items
    const toolCosts: Array<{ toolName: string; costUsd: number }> = [];

    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool-result" &&
          "costUsd" in item &&
          typeof item.costUsd === "number"
        ) {
          const toolName =
            "toolName" in item && typeof item.toolName === "string"
              ? item.toolName
              : "unknown";
          toolCosts.push({
            toolName,
            costUsd: item.costUsd,
          });
        }
      }
    }

    // Return individual tool costs (not cumulative)
    if (toolCosts.length > 0) {
      return {
        toolCosts,
        isFinal: true, // Tool costs are always final (from tool execution)
      };
    }

    // No tool costs available
    return undefined;
  }

  if (message.role === "system") {
    // For system messages, check for re-ranking result content
    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "reranking-result" &&
          "costUsd" in item &&
          typeof item.costUsd === "number"
        ) {
          // Return re-ranking cost
          return {
            costUsd: item.costUsd,
            isFinal: true, // Re-ranking costs are final (from API response)
          };
        }
      }
    }
  }

  // Other message types (user) have no costs
  return undefined;
}
