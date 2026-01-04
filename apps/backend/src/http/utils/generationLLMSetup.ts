import type { ModelMessage } from "ai";

import { logToolDefinitions } from "./agentSetup";
import { buildGenerateTextOptions } from "./agentUtils";
import type { GenerationEndpoint } from "./generationErrorHandling";

/**
 * Agent configuration for LLM calls
 */
export interface AgentConfig {
  systemPrompt: string;
  modelName?: string | null;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxOutputTokens?: number | null;
  stopSequences?: string[] | null;
  maxToolRoundtrips?: number | null;
  name?: string;
  [key: string]: unknown; // Allow additional properties
}

/**
 * Prepares LLM call by logging tool definitions and building generate options
 */
export function prepareLLMCall(
  agent: AgentConfig,
  tools: Record<string, unknown> | undefined,
  modelMessages: ModelMessage[],
  endpoint: GenerationEndpoint,
  workspaceId?: string,
  agentId?: string
): ReturnType<typeof buildGenerateTextOptions> {
  const generateOptions = buildGenerateTextOptions(agent);

  console.log(
    `[${endpoint} Handler] Executing LLM call with parameters:`,
    {
      workspaceId: workspaceId || "unknown",
      agentId: agentId || "unknown",
      model:
        typeof agent.modelName === "string" ? agent.modelName : "default",
      systemPromptLength: agent.systemPrompt.length,
      messagesCount: modelMessages.length,
      toolsCount: tools ? Object.keys(tools).length : 0,
      ...generateOptions,
    }
  );

  // Log tool definitions before LLM call
  if (tools) {
    logToolDefinitions(tools, `${endpoint} Handler`, agent);
  }

  return generateOptions;
}

