import { describe, expect, it } from "vitest";

import {
  buildNonStreamingSetupOptions,
  type AgentCallNonStreamingOptions,
} from "../agentCallNonStreaming";
import { createLlmObserver } from "../llmObserver";

describe("buildNonStreamingSetupOptions", () => {
  it("uses defaults and agentId for conversationOwnerAgentId", () => {
    const options: AgentCallNonStreamingOptions = {};
    const setupOptions = buildNonStreamingSetupOptions(
      "agent-123",
      options,
      createLlmObserver()
    );

    expect(setupOptions.modelReferer).toBe("http://localhost:3000/api/bridge");
    expect(setupOptions.conversationOwnerAgentId).toBe("agent-123");
    expect(setupOptions.callDepth).toBe(0);
    expect(setupOptions.maxDelegationDepth).toBe(3);
  });

  it("honors provided modelReferer and owner overrides", () => {
    const options: AgentCallNonStreamingOptions = {
      modelReferer: "https://example.com/bridge",
      conversationOwnerAgentId: "owner-456",
    };

    const setupOptions = buildNonStreamingSetupOptions(
      "agent-123",
      options,
      createLlmObserver()
    );

    expect(setupOptions.modelReferer).toBe("https://example.com/bridge");
    expect(setupOptions.conversationOwnerAgentId).toBe("owner-456");
  });
});
