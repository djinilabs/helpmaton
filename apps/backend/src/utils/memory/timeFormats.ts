import type { TemporalGrain } from "../vectordb/types";

/**
 * Get ISO week number for a date
 * Week 1 is the week containing January 4th
 */
export function getWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Get quarter number (1-4) for a date
 */
export function getQuarterNumber(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1;
}

/**
 * Format a date to the time string format for a specific grain
 * - working: "" (empty string, no time component)
 * - daily: YYYY-MM-DD
 * - weekly: YYYY-W{week}
 * - monthly: YYYY-MM
 * - quarterly: YYYY-Q{quarter}
 * - yearly: YYYY
 */
export function formatTimeForGrain(grain: TemporalGrain, date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  switch (grain) {
    case "working":
      return ""; // No time component for working memory
    case "daily":
      return `${year}-${month}-${day}`;
    case "weekly": {
      const week = getWeekNumber(date);
      return `${year}-W${week}`;
    }
    case "monthly":
      return `${year}-${month}`;
    case "quarterly": {
      const quarter = getQuarterNumber(date);
      return `${year}-Q${quarter}`;
    }
    case "yearly":
      return String(year);
    default:
      throw new Error(`Unknown temporal grain: ${grain}`);
  }
}

/**
 * Parse a time string from a grain format back to a Date
 * For working grain, returns the current date (since there's no time component)
 */
export function parseTimeFromGrain(
  grain: TemporalGrain,
  timeString: string
): Date {
  if (grain === "working") {
    // Working memory has no time component, return current date
    return new Date();
  }

  if (!timeString) {
    throw new Error(`Time string is required for grain: ${grain}`);
  }

  switch (grain) {
    case "daily": {
      // Format: YYYY-MM-DD
      const match = timeString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) {
        throw new Error(`Invalid daily time format: ${timeString}`);
      }
      const [, year, month, day] = match;
      return new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10)
      );
    }
    case "weekly": {
      // Format: YYYY-W{week}
      const match = timeString.match(/^(\d{4})-W(\d+)$/);
      if (!match) {
        throw new Error(`Invalid weekly time format: ${timeString}`);
      }
      const [, year, week] = match;
      const yearNum = parseInt(year, 10);
      const weekNum = parseInt(week, 10);
      // Calculate date for week 1 (first week containing January 4th)
      const jan4 = new Date(yearNum, 0, 4);
      const jan4Day = jan4.getDay() || 7; // Convert Sunday (0) to 7
      const daysToAdd = (weekNum - 1) * 7 - (jan4Day - 1);
      return new Date(yearNum, 0, 4 + daysToAdd);
    }
    case "monthly": {
      // Format: YYYY-MM
      const match = timeString.match(/^(\d{4})-(\d{2})$/);
      if (!match) {
        throw new Error(`Invalid monthly time format: ${timeString}`);
      }
      const [, year, month] = match;
      return new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
    }
    case "quarterly": {
      // Format: YYYY-Q{quarter}
      const match = timeString.match(/^(\d{4})-Q(\d+)$/);
      if (!match) {
        throw new Error(`Invalid quarterly time format: ${timeString}`);
      }
      const [, year, quarter] = match;
      const yearNum = parseInt(year, 10);
      const quarterNum = parseInt(quarter, 10);
      if (quarterNum < 1 || quarterNum > 4) {
        throw new Error(`Invalid quarter number: ${quarterNum}`);
      }
      const month = (quarterNum - 1) * 3;
      return new Date(yearNum, month, 1);
    }
    case "yearly": {
      // Format: YYYY
      const match = timeString.match(/^(\d{4})$/);
      if (!match) {
        throw new Error(`Invalid yearly time format: ${timeString}`);
      }
      const year = parseInt(timeString, 10);
      return new Date(year, 0, 1);
    }
    default:
      throw new Error(`Unknown temporal grain: ${grain}`);
  }
}

/**
 * Get the date range (start and end) for a time string in a specific grain
 * Returns the start and end dates of the period
 */
export function getDateRangeForGrain(
  grain: TemporalGrain,
  timeString: string
): { start: Date; end: Date } {
  if (grain === "working") {
    // Working memory has no time component, return full range
    return {
      start: new Date(0), // Beginning of time
      end: new Date(), // Current date
    };
  }

  const start = parseTimeFromGrain(grain, timeString);

  switch (grain) {
    case "daily": {
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end };
    }
    case "weekly": {
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }
    case "monthly": {
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      return { start, end };
    }
    case "quarterly": {
      const end = new Date(start);
      end.setMonth(end.getMonth() + 3);
      return { start, end };
    }
    case "yearly": {
      const end = new Date(start);
      end.setFullYear(end.getFullYear() + 1);
      return { start, end };
    }
    default:
      throw new Error(`Unknown temporal grain: ${grain}`);
  }
}
