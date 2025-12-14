import { describe, it, expect } from "vitest";

import { buildContinuationInstructions } from "../continuation";

describe("buildContinuationInstructions", () => {
  it("should return empty string when no tool results", () => {
    const result = buildContinuationInstructions([]);
    expect(result).toBe("");
  });

  it("should include notification instructions when notification result present", () => {
    const toolResults = [{ toolName: "send_notification" }];
    const result = buildContinuationInstructions(toolResults);
    expect(result).toContain("notification");
    expect(result).toContain("✅");
  });

  it("should include search instructions when search result present", () => {
    const toolResults = [{ toolName: "search_documents" }];
    const result = buildContinuationInstructions(toolResults);
    expect(result).toContain("document searches");
    expect(result).toContain("summary");
  });

  it("should include both instructions when both results present", () => {
    const toolResults = [
      { toolName: "send_notification" },
      { toolName: "search_documents" },
    ];
    const result = buildContinuationInstructions(toolResults);
    expect(result).toContain("notification");
    expect(result).toContain("document searches");
  });

  it("should handle tool results without toolName", () => {
    const toolResults = [{}];
    const result = buildContinuationInstructions(toolResults);
    expect(result).toBe("");
  });

  it("should handle mixed tool results", () => {
    const toolResults = [
      { toolName: "send_notification" },
      {},
      { toolName: "other_tool" },
    ];
    const result = buildContinuationInstructions(toolResults);
    expect(result).toContain("notification");
    expect(result).not.toContain("other_tool");
  });
});

// Note: handleToolContinuation is an integration function that requires
// extensive mocking of AI SDK and other dependencies.
// Unit tests for this function would require complex setup and are better
// suited for integration tests.

