import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { SubscriptionPlan } from "../../subscriptionPlans";
import type { TemporalGrain } from "../../vectordb/types";
import {
  getRetentionPeriods,
  calculateRetentionCutoff,
} from "../retentionPolicies";

describe("retentionPolicies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getRetentionPeriods", () => {
    it("should return correct retention periods for free plan", () => {
      const periods = getRetentionPeriods("free");
      expect(periods.working).toBe(48);
      expect(periods.daily).toBe(30);
      expect(periods.weekly).toBe(6);
      expect(periods.monthly).toBe(6);
      expect(periods.quarterly).toBe(4);
      expect(periods.yearly).toBe(2);
    });

    it("should return correct retention periods for starter plan", () => {
      const periods = getRetentionPeriods("starter");
      expect(periods.working).toBe(120);
      expect(periods.daily).toBe(60);
      expect(periods.weekly).toBe(12);
      expect(periods.monthly).toBe(12);
      expect(periods.quarterly).toBe(8);
      expect(periods.yearly).toBe(4);
    });

    it("should return correct retention periods for pro plan", () => {
      const periods = getRetentionPeriods("pro");
      expect(periods.working).toBe(240);
      expect(periods.daily).toBe(120);
      expect(periods.weekly).toBe(24);
      expect(periods.monthly).toBe(24);
      expect(periods.quarterly).toBe(16);
      expect(periods.yearly).toBe(8);
    });

    it("should return all grains for any plan", () => {
      const plans: SubscriptionPlan[] = ["free", "starter", "pro"];
      const grains: TemporalGrain[] = [
        "working",
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "yearly",
      ];

      for (const plan of plans) {
        const periods = getRetentionPeriods(plan);
        for (const grain of grains) {
          expect(periods[grain]).toBeDefined();
          expect(typeof periods[grain]).toBe("number");
          expect(periods[grain]).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("calculateRetentionCutoff", () => {
    const fixedDate = new Date("2024-06-15T12:00:00Z");

    beforeEach(() => {
      vi.setSystemTime(fixedDate);
    });

    it("should calculate cutoff for working grain (hours)", () => {
      const cutoff = calculateRetentionCutoff("working", "free");
      const expected = new Date(fixedDate);
      expected.setHours(expected.getHours() - 48);
      expect(cutoff.getTime()).toBe(expected.getTime());
    });

    it("should calculate cutoff for daily grain (days)", () => {
      const cutoff = calculateRetentionCutoff("daily", "free");
      const expected = new Date(fixedDate);
      expected.setDate(expected.getDate() - 30);
      expect(cutoff.getTime()).toBe(expected.getTime());
    });

    it("should calculate cutoff for weekly grain (weeks)", () => {
      const cutoff = calculateRetentionCutoff("weekly", "free");
      const expected = new Date(fixedDate);
      expected.setDate(expected.getDate() - 6 * 7);
      expect(cutoff.getTime()).toBe(expected.getTime());
    });

    it("should calculate cutoff for monthly grain (months)", () => {
      const cutoff = calculateRetentionCutoff("monthly", "free");
      const expected = new Date(fixedDate);
      expected.setMonth(expected.getMonth() - 6);
      expect(cutoff.getTime()).toBe(expected.getTime());
    });

    it("should calculate cutoff for quarterly grain (quarters)", () => {
      const cutoff = calculateRetentionCutoff("quarterly", "free");
      const expected = new Date(fixedDate);
      expected.setMonth(expected.getMonth() - 4 * 3);
      expect(cutoff.getTime()).toBe(expected.getTime());
    });

    it("should calculate cutoff for yearly grain (years)", () => {
      const cutoff = calculateRetentionCutoff("yearly", "free");
      const expected = new Date(fixedDate);
      expected.setFullYear(expected.getFullYear() - 2);
      expect(cutoff.getTime()).toBe(expected.getTime());
    });

    it("should calculate different cutoffs for different plans", () => {
      const freeCutoff = calculateRetentionCutoff("daily", "free");
      const starterCutoff = calculateRetentionCutoff("daily", "starter");
      const proCutoff = calculateRetentionCutoff("daily", "pro");

      // Pro should have the longest retention (older cutoff, smaller timestamp)
      // Free: 30 days, Starter: 60 days, Pro: 120 days
      // More days retention = cutoff further in past = smaller timestamp
      expect(proCutoff.getTime()).toBeLessThan(starterCutoff.getTime());
      expect(starterCutoff.getTime()).toBeLessThan(freeCutoff.getTime());

      // Verify the actual differences
      const freeDays = 30;
      const starterDays = 60;
      const proDays = 120;

      const expectedFree = new Date(fixedDate);
      expectedFree.setDate(expectedFree.getDate() - freeDays);
      const expectedStarter = new Date(fixedDate);
      expectedStarter.setDate(expectedStarter.getDate() - starterDays);
      const expectedPro = new Date(fixedDate);
      expectedPro.setDate(expectedPro.getDate() - proDays);

      expect(freeCutoff.getTime()).toBe(expectedFree.getTime());
      expect(starterCutoff.getTime()).toBe(expectedStarter.getTime());
      expect(proCutoff.getTime()).toBe(expectedPro.getTime());
    });

    it("should calculate correct cutoffs for all grains and plans", () => {
      const plans: SubscriptionPlan[] = ["free", "starter", "pro"];
      const grains: TemporalGrain[] = [
        "working",
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "yearly",
      ];

      for (const plan of plans) {
        for (const grain of grains) {
          const cutoff = calculateRetentionCutoff(grain, plan);
          expect(cutoff instanceof Date).toBe(true);
          expect(cutoff.getTime()).toBeLessThan(fixedDate.getTime());
          expect(isNaN(cutoff.getTime())).toBe(false);
        }
      }
    });

    it("should throw error for unknown grain", () => {
      expect(() =>
        calculateRetentionCutoff("unknown" as TemporalGrain, "free")
      ).toThrow("Unknown temporal grain: unknown");
    });
  });
});

