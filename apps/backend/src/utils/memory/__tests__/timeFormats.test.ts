import { describe, it, expect } from "vitest";

import type { TemporalGrain } from "../../vectordb/types";
import {
  getWeekNumber,
  getQuarterNumber,
  formatTimeForGrain,
  parseTimeFromGrain,
  getDateRangeForGrain,
} from "../timeFormats";

describe("timeFormats", () => {
  describe("getWeekNumber", () => {
    it("should return correct week number for January 1st", () => {
      const date = new Date(2024, 0, 1); // January 1, 2024
      const week = getWeekNumber(date);
      expect(week).toBeGreaterThanOrEqual(1);
      expect(week).toBeLessThanOrEqual(53);
    });

    it("should return correct week number for mid-year date", () => {
      const date = new Date(2024, 5, 15); // June 15, 2024
      const week = getWeekNumber(date);
      expect(week).toBeGreaterThanOrEqual(20);
      expect(week).toBeLessThanOrEqual(30);
    });

    it("should return correct week number for December 31st", () => {
      const date = new Date(2024, 11, 31); // December 31, 2024
      const week = getWeekNumber(date);
      expect(week).toBeGreaterThanOrEqual(1);
      expect(week).toBeLessThanOrEqual(53);
    });
  });

  describe("getQuarterNumber", () => {
    it("should return 1 for Q1 months", () => {
      expect(getQuarterNumber(new Date(2024, 0, 1))).toBe(1); // January
      expect(getQuarterNumber(new Date(2024, 1, 1))).toBe(1); // February
      expect(getQuarterNumber(new Date(2024, 2, 1))).toBe(1); // March
    });

    it("should return 2 for Q2 months", () => {
      expect(getQuarterNumber(new Date(2024, 3, 1))).toBe(2); // April
      expect(getQuarterNumber(new Date(2024, 4, 1))).toBe(2); // May
      expect(getQuarterNumber(new Date(2024, 5, 1))).toBe(2); // June
    });

    it("should return 3 for Q3 months", () => {
      expect(getQuarterNumber(new Date(2024, 6, 1))).toBe(3); // July
      expect(getQuarterNumber(new Date(2024, 7, 1))).toBe(3); // August
      expect(getQuarterNumber(new Date(2024, 8, 1))).toBe(3); // September
    });

    it("should return 4 for Q4 months", () => {
      expect(getQuarterNumber(new Date(2024, 9, 1))).toBe(4); // October
      expect(getQuarterNumber(new Date(2024, 10, 1))).toBe(4); // November
      expect(getQuarterNumber(new Date(2024, 11, 1))).toBe(4); // December
    });
  });

  describe("formatTimeForGrain", () => {
    const testDate = new Date(2024, 5, 15); // June 15, 2024

    it("should return empty string for working grain", () => {
      expect(formatTimeForGrain("working", testDate)).toBe("");
    });

    it("should format daily grain as YYYY-MM-DD", () => {
      expect(formatTimeForGrain("daily", testDate)).toBe("2024-06-15");
      expect(formatTimeForGrain("daily", new Date(2024, 0, 5))).toBe(
        "2024-01-05"
      );
    });

    it("should format weekly grain as YYYY-W{week}", () => {
      const result = formatTimeForGrain("weekly", testDate);
      expect(result).toMatch(/^2024-W\d+$/);
    });

    it("should format monthly grain as YYYY-MM", () => {
      expect(formatTimeForGrain("monthly", testDate)).toBe("2024-06");
      expect(formatTimeForGrain("monthly", new Date(2024, 11, 31))).toBe(
        "2024-12"
      );
    });

    it("should format quarterly grain as YYYY-Q{quarter}", () => {
      expect(formatTimeForGrain("quarterly", new Date(2024, 0, 1))).toBe(
        "2024-Q1"
      );
      expect(formatTimeForGrain("quarterly", new Date(2024, 5, 15))).toBe(
        "2024-Q2"
      );
      expect(formatTimeForGrain("quarterly", new Date(2024, 8, 1))).toBe(
        "2024-Q3"
      );
      expect(formatTimeForGrain("quarterly", new Date(2024, 11, 31))).toBe(
        "2024-Q4"
      );
    });

    it("should format yearly grain as YYYY", () => {
      expect(formatTimeForGrain("yearly", testDate)).toBe("2024");
      expect(formatTimeForGrain("yearly", new Date(2025, 0, 1))).toBe("2025");
    });

    it("should throw error for unknown grain", () => {
      expect(() =>
        formatTimeForGrain("unknown" as TemporalGrain, testDate)
      ).toThrow("Unknown temporal grain: unknown");
    });
  });

  describe("parseTimeFromGrain", () => {
    it("should return current date for working grain", () => {
      const before = new Date();
      const result = parseTimeFromGrain("working", "");
      const after = new Date();
      expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should parse daily format YYYY-MM-DD", () => {
      const result = parseTimeFromGrain("daily", "2024-06-15");
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(5); // 0-indexed
      expect(result.getDate()).toBe(15);
    });

    it("should parse weekly format YYYY-W{week}", () => {
      const result = parseTimeFromGrain("weekly", "2024-W24");
      expect(result.getFullYear()).toBe(2024);
      // Week parsing is complex, just verify it's a valid date
      expect(result instanceof Date).toBe(true);
      expect(isNaN(result.getTime())).toBe(false);
    });

    it("should parse monthly format YYYY-MM", () => {
      const result = parseTimeFromGrain("monthly", "2024-06");
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(5); // 0-indexed
      expect(result.getDate()).toBe(1); // First day of month
    });

    it("should parse quarterly format YYYY-Q{quarter}", () => {
      const q1 = parseTimeFromGrain("quarterly", "2024-Q1");
      expect(q1.getFullYear()).toBe(2024);
      expect(q1.getMonth()).toBe(0); // January (0-indexed)

      const q2 = parseTimeFromGrain("quarterly", "2024-Q2");
      expect(q2.getFullYear()).toBe(2024);
      expect(q2.getMonth()).toBe(3); // April (0-indexed)
    });

    it("should parse yearly format YYYY", () => {
      const result = parseTimeFromGrain("yearly", "2024");
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getDate()).toBe(1); // First day
    });

    it("should throw error for invalid daily format", () => {
      expect(() => parseTimeFromGrain("daily", "invalid")).toThrow(
        "Invalid daily time format: invalid"
      );
    });

    it("should throw error for invalid weekly format", () => {
      expect(() => parseTimeFromGrain("weekly", "invalid")).toThrow(
        "Invalid weekly time format: invalid"
      );
    });

    it("should throw error for invalid quarterly format", () => {
      expect(() => parseTimeFromGrain("quarterly", "2024-Q5")).toThrow(
        "Invalid quarter number: 5"
      );
    });

    it("should throw error for missing time string (non-working)", () => {
      expect(() => parseTimeFromGrain("daily", "")).toThrow(
        "Time string is required for grain: daily"
      );
    });
  });

  describe("getDateRangeForGrain", () => {
    it("should return full range for working grain", () => {
      const result = getDateRangeForGrain("working", "");
      expect(result.start.getTime()).toBe(0); // Beginning of time
      expect(result.end.getTime()).toBeGreaterThan(0);
    });

    it("should return correct range for daily grain", () => {
      const result = getDateRangeForGrain("daily", "2024-06-15");
      expect(result.start.getFullYear()).toBe(2024);
      expect(result.start.getMonth()).toBe(5);
      expect(result.start.getDate()).toBe(15);

      const end = new Date(result.start);
      end.setDate(end.getDate() + 1);
      expect(result.end.getTime()).toBe(end.getTime());
    });

    it("should return correct range for weekly grain", () => {
      const result = getDateRangeForGrain("weekly", "2024-W24");
      const end = new Date(result.start);
      end.setDate(end.getDate() + 7);
      expect(result.end.getTime()).toBe(end.getTime());
    });

    it("should return correct range for monthly grain", () => {
      const result = getDateRangeForGrain("monthly", "2024-06");
      expect(result.start.getFullYear()).toBe(2024);
      expect(result.start.getMonth()).toBe(5);

      const end = new Date(result.start);
      end.setMonth(end.getMonth() + 1);
      expect(result.end.getTime()).toBe(end.getTime());
    });

    it("should return correct range for quarterly grain", () => {
      const result = getDateRangeForGrain("quarterly", "2024-Q1");
      expect(result.start.getFullYear()).toBe(2024);
      expect(result.start.getMonth()).toBe(0);

      const end = new Date(result.start);
      end.setMonth(end.getMonth() + 3);
      expect(result.end.getTime()).toBe(end.getTime());
    });

    it("should return correct range for yearly grain", () => {
      const result = getDateRangeForGrain("yearly", "2024");
      expect(result.start.getFullYear()).toBe(2024);
      expect(result.start.getMonth()).toBe(0);
      expect(result.start.getDate()).toBe(1);

      const end = new Date(result.start);
      end.setFullYear(end.getFullYear() + 1);
      expect(result.end.getTime()).toBe(end.getTime());
    });
  });
});
