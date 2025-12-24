/**
 * Reconstructs tool calls from tool results when tool calls are missing
 * This can happen when tools execute synchronously and the AI SDK doesn't populate toolCalls
 */
 
export function reconstructToolCallsFromResults(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool result types vary
  toolResults: any[],
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
  const reconstructed = toolResults.map((toolResult: any) => ({
    toolCallId:
      toolResult.toolCallId ||
      `call-${Math.random().toString(36).substring(7)}`,
    toolName: toolResult.toolName || "unknown",
    args: toolResult.args || toolResult.input || {},
  }));

  console.log(`[${endpoint} Handler] Reconstructed tool calls:`, reconstructed);

  return reconstructed;
}

