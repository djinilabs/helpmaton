import { describe, it, expect } from "vitest";

import {
  extractToolCostFromResult,
  TOOL_COST_MARKER_PATTERN,
} from "../toolCostExtraction";

describe("toolCostExtraction", () => {
  describe("TOOL_COST_MARKER_PATTERN", () => {
    it("should match valid cost markers", () => {
      const testString = "Result__HM_TOOL_COST__:8000";
      const matches = Array.from(testString.matchAll(TOOL_COST_MARKER_PATTERN));
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("8000");
    });

    it("should match multiple cost markers", () => {
      const testString =
        "Result__HM_TOOL_COST__:1000__HM_TOOL_COST__:2000__HM_TOOL_COST__:3000";
      const matches = Array.from(testString.matchAll(TOOL_COST_MARKER_PATTERN));
      expect(matches).toHaveLength(3);
      expect(matches[0][1]).toBe("1000");
      expect(matches[1][1]).toBe("2000");
      expect(matches[2][1]).toBe("3000");
    });

    it("should not match invalid formats", () => {
      const testString = "Result[TOOL_COST:8000]";
      const matches = Array.from(testString.matchAll(TOOL_COST_MARKER_PATTERN));
      expect(matches).toHaveLength(0);
    });
  });

  describe("extractToolCostFromResult", () => {
    it("should extract cost from string with marker", () => {
      const result = extractToolCostFromResult(
        "Search results\n\n__HM_TOOL_COST__:8000"
      );
      expect(result.costUsd).toBe(8000);
      expect(result.processedResult).toBe("Search results");
    });

    it("should return undefined cost when marker is missing", () => {
      const result = extractToolCostFromResult("Search results");
      expect(result.costUsd).toBeUndefined();
      expect(result.processedResult).toBe("Search results");
    });

    it("should use the last marker when multiple markers exist", () => {
      const result = extractToolCostFromResult(
        "Result__HM_TOOL_COST__:1000__HM_TOOL_COST__:2000__HM_TOOL_COST__:3000"
      );
      expect(result.costUsd).toBe(3000);
      expect(result.processedResult).toBe("Result");
    });

    it("should remove all markers from result string", () => {
      const result = extractToolCostFromResult(
        "Result__HM_TOOL_COST__:1000__HM_TOOL_COST__:2000"
      );
      expect(result.processedResult).not.toContain("__HM_TOOL_COST__");
      expect(result.processedResult).toBe("Result");
    });

    it("should handle zero cost", () => {
      const result = extractToolCostFromResult(
        "Free result__HM_TOOL_COST__:0"
      );
      expect(result.costUsd).toBe(0);
      expect(result.processedResult).toBe("Free result");
    });

    it("should not extract invalid cost values", () => {
      const result = extractToolCostFromResult(
        "Result__HM_TOOL_COST__:invalid"
      );
      expect(result.costUsd).toBeUndefined();
      expect(result.processedResult).toBe("Result__HM_TOOL_COST__:invalid");
    });

    it("should not extract negative costs", () => {
      const result = extractToolCostFromResult(
        "Result__HM_TOOL_COST__:-1000"
      );
      expect(result.costUsd).toBeUndefined();
      expect(result.processedResult).toBe("Result__HM_TOOL_COST__:-1000");
    });

    it("should trim trailing whitespace after marker removal", () => {
      const result = extractToolCostFromResult(
        "Result\n\n__HM_TOOL_COST__:8000\n\n"
      );
      expect(result.costUsd).toBe(8000);
      expect(result.processedResult).toBe("Result");
    });

    it("should handle large cost values", () => {
      const result = extractToolCostFromResult(
        "Result__HM_TOOL_COST__:999999999"
      );
      expect(result.costUsd).toBe(999999999);
      expect(result.processedResult).toBe("Result");
    });

    it("should preserve content when marker is in the middle", () => {
      const result = extractToolCostFromResult(
        "Start__HM_TOOL_COST__:8000End"
      );
      expect(result.costUsd).toBe(8000);
      expect(result.processedResult).toBe("StartEnd");
    });
  });
});

