import { CronExpressionParser } from "cron-parser";

const DEFAULT_CRON_OPTIONS = {
  tz: "UTC",
  strict: false,
};

function normalizeCronDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (value && typeof value === "object") {
    const maybeCronDate = value as { toDate?: () => Date; toString?: () => string };
    if (typeof maybeCronDate.toDate === "function") {
      return maybeCronDate.toDate();
    }
    if (typeof maybeCronDate.toString === "function") {
      const parsed = new Date(maybeCronDate.toString());
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  return new Date(value as string);
}

export function isValidCronExpression(expression: string): boolean {
  try {
    CronExpressionParser.parse(expression, DEFAULT_CRON_OPTIONS);
    return true;
  } catch {
    return false;
  }
}

export function getNextRunAt(expression: string, fromDate: Date): Date {
  const interval = CronExpressionParser.parse(expression, {
    ...DEFAULT_CRON_OPTIONS,
    currentDate: fromDate,
  });
  return normalizeCronDate(interval.next());
}

export function getNextRunAtEpochSeconds(
  expression: string,
  fromDate: Date
): number {
  const next = getNextRunAt(expression, fromDate);
  return Math.floor(next.getTime() / 1000);
}
