import { describe, expect, it } from "vitest";

import { callAgentInternal } from "../call-agent-internal";

describe("callAgentInternal", () => {
  it("returns early when max delegation depth is reached", async () => {
    const result = await callAgentInternal(
      "workspace-1",
      "agent-1",
      "Hello",
      2,
      2
    );

    expect(result.response).toContain("Maximum delegation depth");
    expect(result.shouldTrackRequest).toBe(false);
    expect(result.targetAgentConversationId).toBeTruthy();
  });
});
