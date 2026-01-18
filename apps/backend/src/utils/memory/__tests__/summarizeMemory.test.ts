import { describe, it, expect } from "vitest";

import type { TemporalGrain } from "../../vectordb/types";
import {
  getSummarizationPrompt,
  normalizeSummarizationPrompts,
  resolveSummarizationPrompt,
} from "../summarizeMemory";

describe("summarizeMemory", () => {
  describe("getSummarizationPrompt", () => {
    it("should return prompt for daily grain", () => {
      const prompt = getSummarizationPrompt("daily");
      expect(prompt).toContain("daily events");
      expect(prompt).toContain("working memory");
      expect(prompt).toContain("important facts");
      expect(prompt).toContain("people mentioned");
    });

    it("should return prompt for weekly grain", () => {
      const prompt = getSummarizationPrompt("weekly");
      expect(prompt).toContain("week's worth");
      expect(prompt).toContain("daily summaries");
      expect(prompt).toContain("cohesive narrative");
    });

    it("should return prompt for monthly grain", () => {
      const prompt = getSummarizationPrompt("monthly");
      expect(prompt).toContain("month's worth");
      expect(prompt).toContain("weekly summaries");
      expect(prompt).toContain("high-level overview");
    });

    it("should return prompt for quarterly grain", () => {
      const prompt = getSummarizationPrompt("quarterly");
      expect(prompt).toContain("quarter's worth");
      expect(prompt).toContain("monthly summaries");
      expect(prompt).toContain("high-level overview");
    });

    it("should return prompt for yearly grain", () => {
      const prompt = getSummarizationPrompt("yearly");
      expect(prompt).toContain("year's worth");
      expect(prompt).toContain("quarterly summaries");
      expect(prompt).toContain("high-level overview");
    });

    it("should throw error for working grain", () => {
      expect(() => getSummarizationPrompt("working")).toThrow(
        "Summarization not supported for grain: working"
      );
    });

    it("should throw error for unknown grain", () => {
      expect(() => getSummarizationPrompt("unknown" as TemporalGrain)).toThrow(
        "Summarization not supported for grain: unknown"
      );
    });

    it("should return different prompts for different grains", () => {
      const daily = getSummarizationPrompt("daily");
      const weekly = getSummarizationPrompt("weekly");
      const monthly = getSummarizationPrompt("monthly");

      expect(daily).not.toBe(weekly);
      expect(weekly).not.toBe(monthly);
      expect(daily).not.toBe(monthly);
    });

    it("should return non-empty prompts for all supported grains", () => {
      const grains: TemporalGrain[] = [
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "yearly",
      ];

      for (const grain of grains) {
        const prompt = getSummarizationPrompt(grain);
        expect(prompt.length).toBeGreaterThan(0);
        expect(typeof prompt).toBe("string");
      }
    });
  });

  describe("normalizeSummarizationPrompts", () => {
    it("should trim and keep non-empty prompts", () => {
      const prompts = normalizeSummarizationPrompts({
        daily: "  Daily override  ",
        weekly: "\nWeekly override\n",
      });
      expect(prompts).toEqual({
        daily: "Daily override",
        weekly: "Weekly override",
      });
    });

    it("should drop empty or null prompts", () => {
      const prompts = normalizeSummarizationPrompts({
        daily: "   ",
        weekly: null,
        monthly: "",
      });
      expect(prompts).toBeUndefined();
    });
  });

  describe("resolveSummarizationPrompt", () => {
    it("should use override when provided", () => {
      const prompt = resolveSummarizationPrompt("daily", {
        daily: "Custom daily prompt",
      });
      expect(prompt).toBe("Custom daily prompt");
    });

    it("should fall back to default when no override exists", () => {
      const prompt = resolveSummarizationPrompt("weekly", {
        daily: "Custom daily prompt",
      });
      expect(prompt).toContain("week's worth");
    });
  });
});

