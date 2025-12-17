import type { SubscriptionPlan } from "../subscriptionPlans";
import type { TemporalGrain } from "../vectordb/types";

/**
 * Retention periods for each grain and subscription plan
 * Values are in the unit appropriate for each grain:
 * - working: hours
 * - daily: days
 * - weekly: weeks
 * - monthly: months
 * - quarterly: quarters
 * - yearly: years
 */
const RETENTION_PERIODS: Record<
  SubscriptionPlan,
  Record<TemporalGrain, number>
> = {
  free: {
    working: 48, // 48 hours
    daily: 30, // 30 days
    weekly: 6, // 6 weeks
    monthly: 6, // 6 months
    quarterly: 4, // 4 quarters
    yearly: 2, // 2 years
  },
  starter: {
    working: 120, // 120 hours (5 days)
    daily: 60, // 60 days
    weekly: 12, // 12 weeks
    monthly: 12, // 12 months
    quarterly: 8, // 8 quarters
    yearly: 4, // 4 years
  },
  pro: {
    working: 240, // 240 hours (10 days)
    daily: 120, // 120 days
    weekly: 24, // 24 weeks
    monthly: 24, // 24 months
    quarterly: 16, // 16 quarters
    yearly: 8, // 8 years
  },
};

/**
 * Get retention periods for a subscription plan
 */
export function getRetentionPeriods(
  plan: SubscriptionPlan
): Record<TemporalGrain, number> {
  return RETENTION_PERIODS[plan];
}

/**
 * Calculate the cutoff date for a specific grain based on subscription plan
 * Records older than this date should be deleted
 */
export function calculateRetentionCutoff(
  grain: TemporalGrain,
  plan: SubscriptionPlan
): Date {
  const retentionPeriod = RETENTION_PERIODS[plan][grain];
  const now = new Date();

  switch (grain) {
    case "working": {
      // Retention in hours
      const cutoff = new Date(now);
      cutoff.setHours(cutoff.getHours() - retentionPeriod);
      return cutoff;
    }
    case "daily": {
      // Retention in days
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - retentionPeriod);
      return cutoff;
    }
    case "weekly": {
      // Retention in weeks
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - retentionPeriod * 7);
      return cutoff;
    }
    case "monthly": {
      // Retention in months
      const cutoff = new Date(now);
      cutoff.setMonth(cutoff.getMonth() - retentionPeriod);
      return cutoff;
    }
    case "quarterly": {
      // Retention in quarters (3 months each)
      const cutoff = new Date(now);
      cutoff.setMonth(cutoff.getMonth() - retentionPeriod * 3);
      return cutoff;
    }
    case "yearly": {
      // Retention in years
      const cutoff = new Date(now);
      cutoff.setFullYear(cutoff.getFullYear() - retentionPeriod);
      return cutoff;
    }
    default:
      throw new Error(`Unknown temporal grain: ${grain}`);
  }
}
