/**
 * Agent Error Notification System
 * Sends email notifications to workspace owners when credit or spending limit errors occur
 * Implements 1-hour rate limiting per error type to avoid email flooding
 */

import { sendEmail } from "../send-email";
import { database } from "../tables";
import type { SubscriptionRecord, WorkspaceRecord } from "../tables/schema";

import type {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "./creditErrors";
import { getSubscriptionById } from "./subscriptionUtils";

const BASE_URL = process.env.BASE_URL || "https://app.helpmaton.com";
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Get user email from workspace owner
 */
async function getUserEmailFromWorkspace(
  workspaceId: string
): Promise<string | null> {
  try {
    const db = await database();
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = (await db.workspace.get(workspacePk, "workspace")) as
      | WorkspaceRecord
      | undefined;

    if (!workspace || !workspace.subscriptionId) {
      console.error(
        "[agentErrorNotifications] Workspace not found or has no subscription:",
        { workspaceId }
      );
      return null;
    }

    const subscription = await getSubscriptionById(workspace.subscriptionId);
    if (!subscription) {
      console.error(
        "[agentErrorNotifications] Subscription not found:",
        workspace.subscriptionId
      );
      return null;
    }

    // Get user email from next-auth table
    const userPk = `users/${subscription.userId}`;
    const userSk = "USER";
    const user = await db["next-auth"].get(userPk, userSk);

    if (!user || !user.email) {
      console.error(
        "[agentErrorNotifications] User email not found:",
        subscription.userId
      );
      return null;
    }

    return user.email;
  } catch (error) {
    console.error("[agentErrorNotifications] Error getting user email:", error);
    return null;
  }
}

/**
 * Check if we should send an error email based on rate limiting
 */
function shouldSendErrorEmail(
  subscription: SubscriptionRecord,
  errorType: "credit" | "spendingLimit"
): boolean {
  const lastEmailField =
    errorType === "credit"
      ? subscription.lastCreditErrorEmailSentAt
      : subscription.lastSpendingLimitErrorEmailSentAt;

  if (!lastEmailField) {
    return true; // Never sent before
  }

  const lastEmailTime = new Date(lastEmailField).getTime();
  const now = Date.now();
  const timeSinceLastEmail = now - lastEmailTime;

  return timeSinceLastEmail > ONE_HOUR_MS;
}

/**
 * Send credit error email to workspace owner
 */
async function sendCreditErrorEmail(
  workspaceId: string,
  userEmail: string
): Promise<void> {
  const creditPurchaseUrl = `${BASE_URL}/workspaces/${workspaceId}/credits`;

  const subject = "Insufficient Credits - Helpmaton";
  const text = `Your workspace has insufficient credits to complete agent requests.

To continue, please purchase additional credits.

Visit: ${creditPurchaseUrl}

Best regards,
The Helpmaton Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .content { padding: 20px; }
    .button { display: inline-block; padding: 12px 24px; background: #000; color: #fff; text-decoration: none; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Insufficient Credits</h1>
    </div>
    <div class="content">
      <p>Your workspace has insufficient credits to complete agent requests.</p>
      <p>To continue, please purchase additional credits.</p>
      <p>
        <a href="${creditPurchaseUrl}" class="button">Buy Credits</a>
      </p>
      <p>Best regards,<br>The Helpmaton Team</p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail({
    to: userEmail,
    subject,
    text,
    html,
  });

  console.log("[agentErrorNotifications] Sent credit error email:", {
    workspaceId,
    userEmail,
  });
}

/**
 * Send spending limit error email to workspace owner
 */
async function sendSpendingLimitErrorEmail(
  workspaceId: string,
  userEmail: string
): Promise<void> {
  const settingsUrl = `${BASE_URL}/workspaces/${workspaceId}/settings`;

  const subject = "Spending Limit Reached - Helpmaton";
  const text = `Your self-imposed spending limit has been reached.

Agent requests are currently blocked. If you'd like to continue, you can adjust your spending limits in workspace settings.

Visit: ${settingsUrl}

Best regards,
The Helpmaton Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .content { padding: 20px; }
    .button { display: inline-block; padding: 12px 24px; background: #000; color: #fff; text-decoration: none; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Spending Limit Reached</h1>
    </div>
    <div class="content">
      <p>Your self-imposed spending limit has been reached.</p>
      <p>Agent requests are currently blocked. If you'd like to continue, you can adjust your spending limits in workspace settings.</p>
      <p>
        <a href="${settingsUrl}" class="button">Manage Settings</a>
      </p>
      <p>Best regards,<br>The Helpmaton Team</p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail({
    to: userEmail,
    subject,
    text,
    html,
  });

  console.log("[agentErrorNotifications] Sent spending limit error email:", {
    workspaceId,
    userEmail,
  });
}

/**
 * Main function to send agent error notifications
 * Handles rate limiting and email sending for credit and spending limit errors
 */
export async function sendAgentErrorNotification(
  workspaceId: string,
  errorType: "credit" | "spendingLimit",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  error: InsufficientCreditsError | SpendingLimitExceededError
): Promise<void> {
  try {
    // 1. Get workspace subscription
    const db = await database();
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = (await db.workspace.get(workspacePk, "workspace")) as
      | WorkspaceRecord
      | undefined;

    if (!workspace || !workspace.subscriptionId) {
      console.error(
        "[agentErrorNotifications] Workspace not found or has no subscription:",
        { workspaceId }
      );
      return;
    }

    const subscription = await getSubscriptionById(workspace.subscriptionId);
    if (!subscription) {
      console.error(
        "[agentErrorNotifications] Subscription not found:",
        workspace.subscriptionId
      );
      return;
    }

    // 2. Check rate limiting
    if (!shouldSendErrorEmail(subscription, errorType)) {
      console.log(
        "[agentErrorNotifications] Skipping email due to rate limiting:",
        {
          workspaceId,
          errorType,
          lastEmailSentAt:
            errorType === "credit"
              ? subscription.lastCreditErrorEmailSentAt
              : subscription.lastSpendingLimitErrorEmailSentAt,
        }
      );
      return;
    }

    // 3. Get user email
    const userEmail = await getUserEmailFromWorkspace(workspaceId);
    if (!userEmail) {
      console.error(
        "[agentErrorNotifications] Could not get user email for workspace:",
        workspaceId
      );
      return;
    }

    // 4. Send appropriate email
    if (errorType === "credit") {
      await sendCreditErrorEmail(workspaceId, userEmail);
    } else {
      await sendSpendingLimitErrorEmail(workspaceId, userEmail);
    }

    // 5. Update lastXxxEmailSentAt timestamp
    const now = new Date().toISOString();
    const updateFields =
      errorType === "credit"
        ? { lastCreditErrorEmailSentAt: now }
        : { lastSpendingLimitErrorEmailSentAt: now };

    await db.subscription.update({
      ...subscription,
      ...updateFields,
    });

    console.log("[agentErrorNotifications] Updated email timestamp:", {
      workspaceId,
      errorType,
      timestamp: now,
    });
  } catch (error) {
    console.error("[agentErrorNotifications] Error sending notification:", {
      workspaceId,
      errorType,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Don't throw - email sending should not break agent requests
  }
}


