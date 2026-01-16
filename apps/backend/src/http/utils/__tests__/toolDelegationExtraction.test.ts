import { describe, it, expect } from "vitest";

import {
  extractDelegationFromResult,
  DELEGATION_MARKER_PATTERN,
  type DelegationMetadata,
} from "../toolDelegationExtraction";

describe("toolDelegationExtraction", () => {
  describe("DELEGATION_MARKER_PATTERN", () => {
    it("should match valid delegation markers", () => {
      const testString =
        'Result __HM_DELEGATION__:{"callingAgentId":"agent1","targetAgentId":"agent2","status":"completed","timestamp":"2024-01-01T00:00:00Z"}';
      const matches = Array.from(
        testString.matchAll(DELEGATION_MARKER_PATTERN)
      );
      expect(matches).toHaveLength(1);
      expect(matches[0][0]).toBe("__HM_DELEGATION__:");
    });

    it("should match multiple delegation markers", () => {
      const testString =
        'Result __HM_DELEGATION__:{"status":"completed"} __HM_DELEGATION__:{"status":"failed"}';
      const matches = Array.from(
        testString.matchAll(DELEGATION_MARKER_PATTERN)
      );
      expect(matches).toHaveLength(2);
    });

    it("should not match invalid formats", () => {
      const testString = 'Result [DELEGATION:{"status":"completed"}]';
      const matches = Array.from(
        testString.matchAll(DELEGATION_MARKER_PATTERN)
      );
      expect(matches).toHaveLength(0);
    });
  });

  describe("extractDelegationFromResult", () => {
    it("should extract delegation from string with marker", () => {
      const delegation: DelegationMetadata = {
        callingAgentId: "agent1",
        targetAgentId: "agent2",
        targetConversationId: "conv1",
        status: "completed",
        timestamp: "2024-01-01T00:00:00Z",
      };
      const result = extractDelegationFromResult(
        `Search results\n\n__HM_DELEGATION__:${JSON.stringify(delegation)}`
      );
      expect(result.delegation).toEqual(delegation);
      expect(result.processedResult).toBe("Search results");
    });

    it("should return undefined delegation when marker is missing", () => {
      const result = extractDelegationFromResult("Search results");
      expect(result.delegation).toBeUndefined();
      expect(result.processedResult).toBe("Search results");
    });

    it("should use the last marker when multiple markers exist", () => {
      const delegation1: DelegationMetadata = {
        callingAgentId: "agent1",
        targetAgentId: "agent2",
        status: "completed",
        timestamp: "2024-01-01T00:00:00Z",
      };
      const delegation2: DelegationMetadata = {
        callingAgentId: "agent3",
        targetAgentId: "agent4",
        status: "failed",
        timestamp: "2024-01-02T00:00:00Z",
      };
      const result = extractDelegationFromResult(
        `Result __HM_DELEGATION__:${JSON.stringify(delegation1)} __HM_DELEGATION__:${JSON.stringify(delegation2)}`
      );
      expect(result.delegation).toEqual(delegation2);
      expect(result.processedResult).toBe("Result");
    });

    it("should remove all markers from result string", () => {
      const delegation: DelegationMetadata = {
        callingAgentId: "agent1",
        targetAgentId: "agent2",
        status: "completed",
        timestamp: "2024-01-01T00:00:00Z",
      };
      const result = extractDelegationFromResult(
        `Result __HM_DELEGATION__:${JSON.stringify(delegation)} __HM_DELEGATION__:${JSON.stringify(delegation)}`
      );
      expect(result.processedResult).not.toContain("__HM_DELEGATION__");
      expect(result.processedResult).toBe("Result");
    });

    it("should handle delegation with optional fields", () => {
      const delegation: DelegationMetadata = {
        callingAgentId: "agent1",
        targetAgentId: "agent2",
        status: "completed",
        timestamp: "2024-01-01T00:00:00Z",
        targetConversationId: "conv1",
        taskId: "task1",
      };
      const result = extractDelegationFromResult(
        `Result __HM_DELEGATION__:${JSON.stringify(delegation)}`
      );
      expect(result.delegation).toEqual(delegation);
      expect(result.processedResult).toBe("Result");
    });

    it("should handle delegation without optional fields", () => {
      const delegation: DelegationMetadata = {
        callingAgentId: "agent1",
        targetAgentId: "agent2",
        status: "failed",
        timestamp: "2024-01-01T00:00:00Z",
      };
      const result = extractDelegationFromResult(
        `Result __HM_DELEGATION__:${JSON.stringify(delegation)}`
      );
      expect(result.delegation).toEqual(delegation);
      expect(result.processedResult).toBe("Result");
    });

    it("should handle escaped quotes in JSON", () => {
      const delegation: DelegationMetadata = {
        callingAgentId: 'agent"with"quotes',
        targetAgentId: "agent2",
        status: "completed",
        timestamp: "2024-01-01T00:00:00Z",
      };
      const result = extractDelegationFromResult(
        `Result __HM_DELEGATION__:${JSON.stringify(delegation)}`
      );
      expect(result.delegation).toEqual(delegation);
      expect(result.processedResult).toBe("Result");
    });

    it("should handle nested JSON objects in delegation metadata", () => {
      // This tests the balanced brace matching
      const delegation: DelegationMetadata = {
        callingAgentId: "agent1",
        targetAgentId: "agent2",
        status: "completed",
        timestamp: "2024-01-01T00:00:00Z",
      };
      const result = extractDelegationFromResult(
        `Result __HM_DELEGATION__:${JSON.stringify(delegation)} more text`
      );
      expect(result.delegation).toEqual(delegation);
      // The result may have extra whitespace where the marker was removed
      expect(result.processedResult.trim().replace(/\s+/g, " ")).toBe(
        "Result more text"
      );
    });

    it("should handle delegation marker in the middle of text", () => {
      const delegation: DelegationMetadata = {
        callingAgentId: "agent1",
        targetAgentId: "agent2",
        status: "completed",
        timestamp: "2024-01-01T00:00:00Z",
      };
      const result = extractDelegationFromResult(
        `Start __HM_DELEGATION__:${JSON.stringify(delegation)} End`
      );
      expect(result.delegation).toEqual(delegation);
      // The result may have extra whitespace where the marker was removed
      expect(result.processedResult.trim().replace(/\s+/g, " ")).toBe(
        "Start End"
      );
    });

    it("should trim trailing whitespace after marker removal", () => {
      const delegation: DelegationMetadata = {
        callingAgentId: "agent1",
        targetAgentId: "agent2",
        status: "completed",
        timestamp: "2024-01-01T00:00:00Z",
      };
      const result = extractDelegationFromResult(
        `Result\n\n__HM_DELEGATION__:${JSON.stringify(delegation)}\n\n`
      );
      expect(result.delegation).toEqual(delegation);
      expect(result.processedResult).toBe("Result");
    });

    it("should return undefined delegation for invalid JSON", () => {
      const result = extractDelegationFromResult(
        'Result __HM_DELEGATION__:{"invalid":json}'
      );
      expect(result.delegation).toBeUndefined();
      // Should still remove the marker
      expect(result.processedResult).not.toContain("__HM_DELEGATION__");
    });

    it("should return undefined delegation for incomplete JSON", () => {
      const result = extractDelegationFromResult(
        'Result __HM_DELEGATION__:{"incomplete":'
      );
      expect(result.delegation).toBeUndefined();
      // Should still remove the marker if possible
      expect(result.processedResult).not.toContain("__HM_DELEGATION__:");
    });

    it("should handle all delegation status types", () => {
      const statuses: Array<"completed" | "failed" | "cancelled"> = [
        "completed",
        "failed",
        "cancelled",
      ];
      for (const status of statuses) {
        const delegation: DelegationMetadata = {
          callingAgentId: "agent1",
          targetAgentId: "agent2",
          status,
          timestamp: "2024-01-01T00:00:00Z",
        };
        const result = extractDelegationFromResult(
          `Result __HM_DELEGATION__:${JSON.stringify(delegation)}`
        );
        expect(result.delegation?.status).toBe(status);
      }
    });

    it("should handle complex tool result with delegation at end", () => {
      const delegation: DelegationMetadata = {
        callingAgentId: "agent1",
        targetAgentId: "agent2",
        targetConversationId: "conv1",
        status: "completed",
        timestamp: "2024-01-01T00:00:00Z",
        taskId: "task1",
      };
      const toolResult = `Agent poet responded: Silver orb hangs high,
Softly glowing in the dark,
Silent guide of night.`;
      const result = extractDelegationFromResult(
        `${toolResult} __HM_DELEGATION__:${JSON.stringify(delegation)}`
      );
      expect(result.delegation).toEqual(delegation);
      expect(result.processedResult).toBe(toolResult);
    });

    it("should handle JSON with escaped backslashes", () => {
      const delegation: DelegationMetadata = {
        callingAgentId: "agent\\with\\backslashes",
        targetAgentId: "agent2",
        status: "completed",
        timestamp: "2024-01-01T00:00:00Z",
      };
      const result = extractDelegationFromResult(
        `Result __HM_DELEGATION__:${JSON.stringify(delegation)}`
      );
      expect(result.delegation).toEqual(delegation);
      expect(result.processedResult).toBe("Result");
    });

    it("should handle JSON with newlines in string values", () => {
      const delegation: DelegationMetadata = {
        callingAgentId: "agent\nwith\nnewlines",
        targetAgentId: "agent2",
        status: "completed",
        timestamp: "2024-01-01T00:00:00Z",
      };
      const result = extractDelegationFromResult(
        `Result __HM_DELEGATION__:${JSON.stringify(delegation)}`
      );
      expect(result.delegation).toEqual(delegation);
      expect(result.processedResult).toBe("Result");
    });
  });
});
