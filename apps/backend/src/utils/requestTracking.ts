import { tooManyRequests } from "@hapi/boom";

import { sendEmail } from "../send-email";
import { database } from "../tables/database";
import type { RequestBucketRecord } from "../tables/schema";

import { getPlanLimits } from "./subscriptionPlans";
import {
  getSubscriptionById,
  getUserEmailById,
  getWorkspaceSubscription,
} from "./subscriptionUtils";

const BASE_URL = process.env.BASE_URL || "https://app.helpmaton.com";

export type RequestCategory = "llm" | "search" | "fetch";

/**
 * Get current hour timestamp truncated to hour (YYYY-MM-DDTHH:00:00.000Z)
 * @returns ISO string truncated to hour
 */
export function getCurrentHourTimestamp(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now.toISOString();
}

/**
 * Get array of last 24 hour timestamps for querying
 * @returns Array of ISO strings (one per hour, most recent first)
 */
export function getLast24HourTimestamps(): string[] {
  const timestamps: string[] = [];
  const now = new Date();
  now.setMinutes(0, 0, 0); // This also sets seconds and milliseconds to 0

  for (let i = 0; i < 24; i++) {
    const hour = new Date(now);
    hour.setHours(hour.getHours() - i);
    timestamps.push(hour.toISOString());
  }

  return timestamps;
}

/**
 * Atomically increment the current hour's request bucket by category
 * Uses atomicUpdate API with automatic retry on version conflicts
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @param category - Request category ("llm", "search", or "fetch")
 * @param maxRetries - Maximum number of retries (default: 3)
 * @returns Updated bucket record
 */
export async function incrementRequestBucketByCategory(
  subscriptionId: string,
  category: RequestCategory,
  maxRetries: number = 3
): Promise<RequestBucketRecord> {
  console.log("[incrementRequestBucketByCategory] Starting increment:", {
    subscriptionId,
    category,
    maxRetries,
  });

  const db = await database();
  const hourTimestamp = getCurrentHourTimestamp();
  const bucketPk = `request-buckets/${subscriptionId}/${category}/${hourTimestamp}`;
  // TTL: 25 hours from bucket hour (ensures 24-hour window coverage)
  // Calculate from bucket hour timestamp, not current time, so all buckets
  // created within the same hour expire at the same time
  const bucketTime = new Date(hourTimestamp).getTime();
  const expires = Math.floor(bucketTime / 1000) + 25 * 60 * 60;

  console.log("[incrementRequestBucketByCategory] Bucket details:", {
    subscriptionId,
    category,
    hourTimestamp,
    bucketPk,
    expires,
  });

  // Verify table exists
  if (!db["request-buckets"]) {
    const error = new Error(
      "request-buckets table not found in database. Make sure the table is defined in app.arc and the app has been restarted."
    );
    console.error("[incrementRequestBucketByCategory] Table not found:", {
      subscriptionId,
      category,
      availableTables: Object.keys(db),
    });
    throw error;
  }

  console.log(
    "[incrementRequestBucketByCategory] Table exists, proceeding with increment"
  );

  const updated = await db["request-buckets"].atomicUpdate(
    bucketPk,
    undefined,
    async (current) => {
      if (current) {
        // Bucket exists, increment count
        // Preserve expires field (or recalculate if missing) to ensure TTL is always set
        const existingExpires = current.expires || expires;
        console.log(
          "[incrementRequestBucketByCategory] Incrementing existing bucket:",
          {
            subscriptionId,
            category,
            hourTimestamp,
            oldCount: current.count,
            newCount: current.count + 1,
            expires: existingExpires,
          }
        );
        return {
          pk: bucketPk,
          count: current.count + 1,
          expires: existingExpires,
        };
      } else {
        // Bucket doesn't exist, create new one
        console.log(
          "[incrementRequestBucketByCategory] Creating new bucket:",
          {
            subscriptionId,
            category,
            hourTimestamp,
            count: 1,
          }
        );
        return {
          pk: bucketPk,
          subscriptionId,
          category,
          hourTimestamp,
          count: 1,
          expires,
        };
      }
    },
    { maxRetries }
  );

  console.log(
    "[incrementRequestBucketByCategory] Successfully updated bucket:",
    {
      subscriptionId,
      category,
      hourTimestamp,
      count: updated.count,
    }
  );

  return updated;
}

/**
 * Get request count for the last 24 hours (rolling window) by category
 * Queries hourly buckets using GSI and sums the counts
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @param category - Request category ("llm", "search", or "fetch")
 * @returns Total request count in last 24 hours
 */
export async function getRequestCountLast24HoursByCategory(
  subscriptionId: string,
  category: RequestCategory
): Promise<number> {
  const db = await database();
  const timestamps = getLast24HourTimestamps();
  const oldestTimestamp = timestamps[timestamps.length - 1];
  const newestTimestamp = timestamps[0];

  // Query buckets using GSI for subscriptionId and category
  // Filter by hourTimestamp range (last 24 hours)
  const queryResult = await db["request-buckets"].query({
    IndexName: "bySubscriptionIdAndCategoryAndHour",
    KeyConditionExpression:
      "subscriptionId = :subscriptionId AND category = :category AND hourTimestamp BETWEEN :oldest AND :newest",
    ExpressionAttributeValues: {
      ":subscriptionId": subscriptionId,
      ":category": category,
      ":oldest": oldestTimestamp,
      ":newest": newestTimestamp,
    },
  });

  // Sum all bucket counts
  const totalCount = queryResult.items.reduce(
    (sum, bucket) => sum + (bucket.count || 0),
    0
  );

  console.log("[getRequestCountLast24HoursByCategory] Request count:", {
    subscriptionId,
    category,
    totalCount,
    bucketsFound: queryResult.items.length,
  });

  return totalCount;
}

/**
 * Atomically increment the current hour's search request bucket
 * Looks up subscriptionId from workspaceId and calls unified function
 * @param workspaceId - Workspace ID
 * @param maxRetries - Maximum number of retries (default: 3)
 * @returns Updated bucket record
 */
export async function incrementSearchRequestBucket(
  workspaceId: string,
  maxRetries: number = 3
): Promise<RequestBucketRecord> {
  const subscription = await getWorkspaceSubscription(workspaceId);
  if (!subscription) {
    throw new Error(
      `Could not find subscription for workspace ${workspaceId}`
    );
  }
  // Extract subscriptionId without "subscriptions/" prefix
  const subscriptionId = subscription.pk.replace("subscriptions/", "");
  return incrementRequestBucketByCategory(subscriptionId, "search", maxRetries);
}

/**
 * Atomically increment the current hour's fetch request bucket
 * Looks up subscriptionId from workspaceId and calls unified function
 * @param workspaceId - Workspace ID
 * @param maxRetries - Maximum number of retries (default: 3)
 * @returns Updated bucket record
 */
export async function incrementFetchRequestBucket(
  workspaceId: string,
  maxRetries: number = 3
): Promise<RequestBucketRecord> {
  const subscription = await getWorkspaceSubscription(workspaceId);
  if (!subscription) {
    throw new Error(
      `Could not find subscription for workspace ${workspaceId}`
    );
  }
  // Extract subscriptionId without "subscriptions/" prefix
  const subscriptionId = subscription.pk.replace("subscriptions/", "");
  return incrementRequestBucketByCategory(subscriptionId, "fetch", maxRetries);
}

/**
 * Get search request count for the last 24 hours (rolling window)
 * Looks up subscriptionId from workspaceId and queries "search" category
 * @param workspaceId - Workspace ID
 * @returns Total search request count in last 24 hours
 */
export async function getSearchRequestCountLast24Hours(
  workspaceId: string
): Promise<number> {
  const subscription = await getWorkspaceSubscription(workspaceId);
  if (!subscription) {
    throw new Error(
      `Could not find subscription for workspace ${workspaceId}`
    );
  }
  // Extract subscriptionId without "subscriptions/" prefix
  const subscriptionId = subscription.pk.replace("subscriptions/", "");
  return getRequestCountLast24HoursByCategory(subscriptionId, "search");
}

/**
 * Get fetch request count for the last 24 hours (rolling window)
 * Looks up subscriptionId from workspaceId and queries "fetch" category
 * @param workspaceId - Workspace ID
 * @returns Total fetch request count in last 24 hours
 */
export async function getFetchRequestCountLast24Hours(
  workspaceId: string
): Promise<number> {
  const subscription = await getWorkspaceSubscription(workspaceId);
  if (!subscription) {
    throw new Error(
      `Could not find subscription for workspace ${workspaceId}`
    );
  }
  // Extract subscriptionId without "subscriptions/" prefix
  const subscriptionId = subscription.pk.replace("subscriptions/", "");
  return getRequestCountLast24HoursByCategory(subscriptionId, "fetch");
}

/**
 * Check if subscription has exceeded daily request limit
 * Sends email notification if limit is exceeded (max once per 24 hours)
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @throws HTTP 429 if limit is exceeded
 */
export async function checkDailyRequestLimit(
  subscriptionId: string
): Promise<void> {
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw new Error(`Subscription ${subscriptionId} not found`);
  }

  const limits = getPlanLimits(subscription.plan);
  if (!limits || !limits.maxDailyRequests) {
    // No limit configured for this plan, allow request
    return;
  }

  const requestCount = await getRequestCountLast24HoursByCategory(
    subscriptionId,
    "llm"
  );

  if (requestCount >= limits.maxDailyRequests) {
    // Limit exceeded - check if we should send email
    const now = new Date();
    const lastEmailSentAt = subscription.lastLimitEmailSentAt
      ? new Date(subscription.lastLimitEmailSentAt)
      : null;

    const shouldSendEmail =
      !lastEmailSentAt ||
      now.getTime() - lastEmailSentAt.getTime() > 24 * 60 * 60 * 1000; // 24 hours in ms

    if (shouldSendEmail) {
      try {
        const userEmail = await getUserEmailById(subscription.userId);
        if (userEmail) {
          const planName =
            subscription.plan === "free"
              ? "Free"
              : subscription.plan === "starter"
              ? "Starter"
              : "Pro";

          // Build upgrade options based on current plan
          let upgradeOptionsText = "";
          let upgradeOptionsHtml = "";
          if (subscription.plan === "free") {
            upgradeOptionsText = `Upgrade options:
- Starter Plan: 3,000 requests per day
- Pro Plan: 10,000 requests per day`;
            upgradeOptionsHtml = `
    <h2 style="color: #000; margin-top: 30px;">Upgrade Options:</h2>
    <ul>
      <li><strong>Starter Plan:</strong> 3,000 requests per day</li>
      <li><strong>Pro Plan:</strong> 10,000 requests per day</li>
    </ul>`;
          } else if (subscription.plan === "starter") {
            upgradeOptionsText = `Upgrade option:
- Pro Plan: 10,000 requests per day`;
            upgradeOptionsHtml = `
    <h2 style="color: #000; margin-top: 30px;">Upgrade Option:</h2>
    <ul>
      <li><strong>Pro Plan:</strong> 10,000 requests per day</li>
    </ul>`;
          } else {
            // Pro plan - no upgrades available
            upgradeOptionsText = `You're already on the Pro plan. For higher limits, please contact support.`;
            upgradeOptionsHtml = `
    <p>You're already on the <strong>Pro plan</strong>. For higher limits or custom plans, please <a href="${BASE_URL}/support">contact support</a>.</p>`;
          }

          const emailSubject = "Daily Request Limit Reached - Helpmaton";
          const emailText = `Your ${planName} plan has reached its daily limit of ${limits.maxDailyRequests} LLM requests per 24 hours.

You've made ${requestCount} requests in the last 24 hours. To continue using Helpmaton, please upgrade your subscription plan.

${upgradeOptionsText}

Visit your subscription settings to upgrade.`;
          const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Daily Request Limit Reached</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h1 style="color: #000;">Daily Request Limit Reached</h1>
    <p>Your <strong>${planName}</strong> plan has reached its daily limit of <strong>${limits.maxDailyRequests} LLM requests per 24 hours</strong>.</p>
    <p>You've made <strong>${requestCount} requests</strong> in the last 24 hours.</p>
    <p>To continue using Helpmaton, please upgrade your subscription plan.</p>
    ${upgradeOptionsHtml}
    <p style="margin-top: 30px;">
      <a href="${BASE_URL}/subscription" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; display: inline-block; border-radius: 4px;">Upgrade Subscription</a>
    </p>
  </div>
</body>
</html>`;

          await sendEmail({
            to: userEmail,
            subject: emailSubject,
            text: emailText,
            html: emailHtml,
          });

          // Update subscription with lastLimitEmailSentAt
          const db = await database();
          await db.subscription.update({
            ...subscription,
            lastLimitEmailSentAt: now.toISOString(),
          });

          console.log("[checkDailyRequestLimit] Sent limit email:", {
            subscriptionId,
            userEmail,
            requestCount,
            limit: limits.maxDailyRequests,
          });
        } else {
          console.log(
            "[checkDailyRequestLimit] Could not find user email for subscription:",
            {
              subscriptionId,
              userId: subscription.userId,
            }
          );
        }
      } catch (error) {
        // Log error but don't throw - we still need to return 429
        console.error(
          "[checkDailyRequestLimit] Error sending limit email:",
          error
        );
      }
    }

    // Throw 429 error
    throw tooManyRequests(
      `Daily request limit exceeded. Your ${subscription.plan} plan allows ${limits.maxDailyRequests} requests per 24 hours.`
    );
  }
}

/**
 * Check if workspace has exceeded daily Tavily call limit
 * Free tier: max 10 calls/day
 * Paid tiers: 10 free calls/day, then require credits
 * Production Tavily API keys: No limit enforced (unlimited calls)
 * Queries both "search" and "fetch" categories and sums them
 * @param workspaceId - Workspace ID
 * @throws HTTP 429 if limit is exceeded (free tier only)
 * @returns true if within free tier limit, false if exceeding (paid tiers can continue with credits)
 */
export async function checkTavilyDailyLimit(
  workspaceId: string
): Promise<{ withinFreeLimit: boolean; callCount: number }> {
  // Get subscription to determine tier and extract subscriptionId
  const subscription = await getWorkspaceSubscription(workspaceId);
  if (!subscription) {
    throw new Error(
      `Could not find subscription for workspace ${workspaceId}`
    );
  }
  const subscriptionId = subscription.pk.replace("subscriptions/", "");

  // Query both search and fetch categories and sum them
  const [searchCount, fetchCount] = await Promise.all([
    getRequestCountLast24HoursByCategory(subscriptionId, "search"),
    getRequestCountLast24HoursByCategory(subscriptionId, "fetch"),
  ]);

  const callCount = searchCount + fetchCount;
  const FREE_TIER_LIMIT = 10;

  // In local sandbox (testing environment), disable free tier to ensure transactions are created
  if (process.env.ARC_ENV === "testing") {
    return { withinFreeLimit: false, callCount };
  }

  const isFreeTier = subscription.plan === "free";

  if (isFreeTier) {
    // Free tier: block if > 10 calls/day (10 is allowed)
    if (callCount > FREE_TIER_LIMIT) {
      throw tooManyRequests(
        `Daily Tavily API call limit exceeded. Free tier allows ${FREE_TIER_LIMIT} calls per 24 hours. You've made ${callCount} calls.`
      );
    }
    return { withinFreeLimit: true, callCount };
  }

  // Paid tiers: allow 10 free calls/day, then require credits
  const withinFreeLimit = callCount <= FREE_TIER_LIMIT;
  return { withinFreeLimit, callCount };
}

// Legacy function names for backward compatibility during migration
// These will be removed after all call sites are updated
export async function incrementRequestBucket(
  subscriptionId: string,
  maxRetries: number = 3
): Promise<RequestBucketRecord> {
  return incrementRequestBucketByCategory(subscriptionId, "llm", maxRetries);
}

export async function getRequestCountLast24Hours(
  subscriptionId: string
): Promise<number> {
  return getRequestCountLast24HoursByCategory(subscriptionId, "llm");
}

export async function incrementTavilyCallBucket(
  workspaceId: string,
  maxRetries: number = 3
): Promise<RequestBucketRecord> {
  // For backward compatibility, increment search bucket
  // This maintains existing behavior where both search and fetch were tracked together
  return incrementSearchRequestBucket(workspaceId, maxRetries);
}

export async function getTavilyCallCountLast24Hours(
  workspaceId: string
): Promise<number> {
  // For backward compatibility, return sum of search and fetch
  const subscription = await getWorkspaceSubscription(workspaceId);
  if (!subscription) {
    throw new Error(
      `Could not find subscription for workspace ${workspaceId}`
    );
  }
  const subscriptionId = subscription.pk.replace("subscriptions/", "");
  const [searchCount, fetchCount] = await Promise.all([
    getRequestCountLast24HoursByCategory(subscriptionId, "search"),
    getRequestCountLast24HoursByCategory(subscriptionId, "fetch"),
  ]);
  return searchCount + fetchCount;
}
