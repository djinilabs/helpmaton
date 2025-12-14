/**
 * Response formatting utilities for useChat data stream format
 * Formats responses in the format expected by useChat from @ai-sdk/react
 */

/**
 * Formats a text chunk in the data stream format
 * Format: 0:${JSON.stringify(text)}\n
 */
export function formatTextChunk(text: string): string {
  return `0:${JSON.stringify(text)}\n`;
}

/**
 * Formats a tool call chunk in the data stream format
 * Format: 1:${JSON.stringify({type: "tool-call", ...})}\n
 */
export function formatToolCallChunk(toolCall: {
  toolCallId: string;
  toolName: string;
  args: unknown;
}): string {
  const toolCallMessage = {
    type: "tool-call" as const,
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    args: toolCall.args,
  };
  return `1:${JSON.stringify(toolCallMessage)}\n`;
}

/**
 * Formats the complete assistant response from generateText result
 * Returns a string in the data stream format expected by useChat
 *
 * @param result - The generateText result from ai-sdk
 * @param clientToolNames - Set of client-side tool names that should be sent to the client
 * @param responseText - The processed text response (after tool continuations if any)
 * @returns Formatted response string in data stream format
 */
export function formatAssistantResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK generateText result types are complex
  result: any,
  clientToolNames: Set<string>,
  responseText: string
): string {
  const responseLines: string[] = [];

  // Extract tool calls from result
  const toolCalls = (result.toolCalls || []) as Array<{
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    input?: unknown;
  }>;

  // Send client-side tool calls first (before text)
  for (const toolCall of toolCalls) {
    if (
      toolCall.toolName &&
      typeof toolCall.toolName === "string" &&
      clientToolNames.has(toolCall.toolName)
    ) {
      const toolCallId = toolCall.toolCallId || "";
      const args = toolCall.args || toolCall.input || {};
      responseLines.push(
        formatToolCallChunk({ toolCallId, toolName: toolCall.toolName, args })
      );
    }
  }

  // Send text response if present
  if (responseText && responseText.trim().length > 0) {
    responseLines.push(formatTextChunk(responseText));
  }

  return responseLines.join("");
}

