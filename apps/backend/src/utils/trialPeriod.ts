import { database } from "../tables/database";

const TRIAL_PERIOD_DAYS = 7;

/**
 * Check if a user is within their trial period (7 days from account creation)
 * @param userId - User ID from session
 * @returns true if user is in trial period, false otherwise
 */
export async function isUserInTrialPeriod(userId: string): Promise<boolean> {
  try {
    // DynamoDBAdapter stores users with pk = USER#{userId}, sk = USER#{userId}
    const userPk = `USER#${userId}`;
    const userSk = `USER#${userId}`;

    // Use low-level table directly to avoid Zod validation errors
    // Account records don't have email field and will fail schema validation

    const client = await database();
    const lowLevelTable = client["next-auth"];

    let userAccount;
    try {
      const rawItem = await lowLevelTable.get(userPk, userSk);

      // Manually check if it has the required fields for a user record
      if (
        rawItem &&
        rawItem.createdAt &&
        rawItem.email &&
        rawItem.sk === userSk
      ) {
        userAccount = rawItem;
      } else {
        userAccount = undefined;
      }
    } catch {
      // If get fails, user record doesn't exist
      userAccount = undefined;
    }

    if (!userAccount || !userAccount.createdAt) {
      return false;
    }

    const accountCreatedAt = new Date(userAccount.createdAt);
    const now = new Date();
    const daysSinceCreation = Math.floor(
      (now.getTime() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    return daysSinceCreation < TRIAL_PERIOD_DAYS;
  } catch (error) {
    console.error("[isUserInTrialPeriod] Error checking trial period:", error);
    // If we can't find the user, assume not in trial
    return false;
  }
}

/**
 * Get the number of days remaining in the trial period
 * @param userId - User ID from session
 * @returns Number of days remaining (0 if trial expired or user not found)
 */
export async function getTrialDaysRemaining(userId: string): Promise<number> {
  try {
    // DynamoDBAdapter stores users with pk = USER#{userId}, sk = USER#{userId}
    const userPk = `USER#${userId}`;
    const userSk = `USER#${userId}`;

    // Use low-level table directly to avoid Zod validation errors
    // Account records don't have email field and will fail schema validation

    const client = await database();
    const table = client["next-auth"];

    let userAccount;
    try {
      const rawItem = await table.get(userPk, userSk);

      // Manually check if it has the required fields for a user record
      if (
        rawItem &&
        rawItem.createdAt &&
        rawItem.email &&
        rawItem.sk === userSk
      ) {
        userAccount = rawItem;
      } else {
        userAccount = undefined;
      }
    } catch {
      // If get fails, user record doesn't exist
      userAccount = undefined;
    }

    if (!userAccount || !userAccount.createdAt) {
      return 0;
    }

    const accountCreatedAt = new Date(userAccount.createdAt);
    const now = new Date();
    const daysSinceCreation = Math.floor(
      (now.getTime() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    const daysRemaining = TRIAL_PERIOD_DAYS - daysSinceCreation;
    return Math.max(0, daysRemaining);
  } catch (error) {
    console.error("[getTrialDaysRemaining] Error getting trial days:", error);
    return 0;
  }
}
