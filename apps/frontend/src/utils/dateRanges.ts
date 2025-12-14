export type DateRangePreset =
  | "last-30-days"
  | "last-7-days"
  | "this-week"
  | "current-month"
  | "last-month";

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

/**
 * Format a Date to YYYY-MM-DD string
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get the start of the week (Monday)
 */
function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  return new Date(d.setDate(diff));
}

/**
 * Get the start of the month
 */
function getStartOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Get the end of the month
 */
function getEndOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/**
 * Calculate date range for a preset option
 */
export function getDateRange(preset: DateRangePreset): DateRange {
  const today = new Date();
  today.setHours(23, 59, 59, 999); // End of today

  let startDate: Date;
  let endDate: Date = today;

  switch (preset) {
    case "last-30-days": {
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
      break;
    }

    case "last-7-days": {
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      break;
    }

    case "this-week": {
      startDate = getStartOfWeek(today);
      startDate.setHours(0, 0, 0, 0);
      break;
    }

    case "current-month": {
      startDate = getStartOfMonth(today);
      startDate.setHours(0, 0, 0, 0);
      break;
    }

    case "last-month": {
      const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      startDate = getStartOfMonth(lastMonth);
      startDate.setHours(0, 0, 0, 0);
      endDate = getEndOfMonth(lastMonth);
      endDate.setHours(23, 59, 59, 999);
      break;
    }

    default: {
      // Default to last 30 days
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
      break;
    }
  }

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  };
}

/**
 * Get display label for a preset
 */
export function getDateRangeLabel(preset: DateRangePreset): string {
  switch (preset) {
    case "last-30-days":
      return "Last 30 Days";
    case "last-7-days":
      return "Last 7 Days";
    case "this-week":
      return "This Week";
    case "current-month":
      return "Current Month";
    case "last-month":
      return "Last Month";
    default:
      return "Last 30 Days";
  }
}

