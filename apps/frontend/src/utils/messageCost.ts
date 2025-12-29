import type { ConversationDetail } from "./api";

/**
 * Result of getting message cost
 */
export interface MessageCostResult {
  /**
   * For assistant messages: The best available cost in millionths
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
 * For assistant messages: Returns the best available cost (finalCostUsd > provisionalCostUsd)
 * For tool messages: Returns individual costs for each tool result
 *
 * NOTE: This function intentionally omits token-based cost calculation that exists in the
 * backend version (`apps/backend/src/utils/messageCostCalculation.ts`). Token-based costs
 * are calculated and stored on the backend, and the frontend only displays costs that have
 * already been calculated (finalCostUsd or provisionalCostUsd). This separation ensures:
 * 1. Cost calculation logic stays on the backend where pricing data is available
 * 2. Frontend remains lightweight and doesn't duplicate complex pricing logic
 * 3. Consistency: all cost calculations use the same backend pricing tables
 *
 * @param message - The message to get cost for
 * @returns MessageCostResult with cost information, or undefined if no cost available
 */
export function getMessageCost(
  message: ConversationDetail["messages"][number]
): MessageCostResult | undefined {
  // Type guard: ensure message is an object with a role property
  if (typeof message !== "object" || message === null || !("role" in message)) {
    return undefined;
  }

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

    // No cost information available
    // Note: Calculated costs from tokenUsage are handled on the backend
    return undefined;
  }

  if (message.role === "tool") {
    // For tool messages, extract individual costs from tool-result content items
    const toolCosts: Array<{ toolName: string; costUsd: number }> = [];

    if ("content" in message && Array.isArray(message.content)) {
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

  // Other message types (user, system) have no costs
  return undefined;
}
