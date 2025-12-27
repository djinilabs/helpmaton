/**
 * Reconstructs tool calls from tool results when tool calls are missing
 * This can happen when tools execute synchronously and the AI SDK doesn't populate toolCalls
 */

type ToolResult = {
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  input?: unknown;
  [key: string]: unknown;
};

export function reconstructToolCallsFromResults(
  toolResults: unknown[],
  endpoint: string
): Array<{
  toolCallId: string;
  toolName: string;
  args: unknown;
}> {
  if (toolResults.length === 0) {
    return [];
  }

  console.log(
    `[${endpoint} Handler] Tool calls missing but tool results exist, reconstructing tool calls from results`
  );

  // Reconstruct tool calls from tool results
  const reconstructed = toolResults.map((toolResult: unknown) => {
    const result = toolResult as ToolResult;
    return {
      toolCallId:
        result.toolCallId ||
        `call-${Math.random().toString(36).substring(7)}`,
      toolName: result.toolName || "unknown",
      args: result.args || result.input || {},
    };
  });

  console.log(`[${endpoint} Handler] Reconstructed tool calls:`, reconstructed);

  return reconstructed;
}

