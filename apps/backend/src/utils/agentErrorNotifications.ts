/**
 * Agent Error Notification System
 * Sends email notifications to workspace owners when credit or spending limit errors occur
 * Implements 1-hour rate limiting per user per error type to avoid email flooding
 */

import { sendEmail } from "../send-email";
import { database } from "../tables";
import type { AgentRecord, WorkspaceRecord } from "../tables/schema";

import { getWorkspaceOwnerRecipients } from "./creditAdminNotifications";
import { fromNanoDollars } from "./creditConversions";
import type {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "./creditErrors";
import { Sentry, ensureError } from "./sentry";

const BASE_URL = process.env.BASE_URL || "https://app.helpmaton.com";
const ONE_HOUR_MS = 60 * 60 * 1000;

type NextAuthUserRecord = {
  pk: string;
  sk: string;
  email?: string;
  lastCreditErrorEmailSentAt?: string;
  lastSpendingLimitErrorEmailSentAt?: string;
};

function formatAmount(nanoDollars: number, currency: string): string {
  const value = fromNanoDollars(nanoDollars)
    .toFixed(12)
    .replace(/\.?0+$/, "");
  return `${value} ${currency.toUpperCase()}`;
}

function buildWorkspaceUrl(workspaceId: string): string {
  return `${BASE_URL}/workspaces/${workspaceId}`;
}

function buildWorkspaceCreditsUrl(workspaceId: string): string {
  return `${BASE_URL}/workspaces/${workspaceId}/credits`;
}

function buildWorkspaceSettingsUrl(workspaceId: string): string {
  return `${BASE_URL}/workspaces/${workspaceId}/settings`;
}

function buildAgentSummary(
  agentId: string | undefined,
  agent?: AgentRecord
): string {
  if (!agentId) {
    return "Agent: (not specified)";
  }
  if (agent) {
    return `Agent: ${agent.name} (${agentId})`;
  }
  return `Agent: ${agentId}`;
}

function shouldSendUserErrorEmail(
  user: NextAuthUserRecord,
  errorType: "credit" | "spendingLimit"
): boolean {
  const lastEmailField =
    errorType === "credit"
      ? user.lastCreditErrorEmailSentAt
      : user.lastSpendingLimitErrorEmailSentAt;

  if (!lastEmailField) {
    return true;
  }

  const lastEmailTime = new Date(lastEmailField).getTime();
  const now = Date.now();
  const timeSinceLastEmail = now - lastEmailTime;

  return timeSinceLastEmail > ONE_HOUR_MS;
}

async function sendCreditErrorEmail(params: {
  workspace: WorkspaceRecord;
  agent?: AgentRecord;
  agentId?: string;
  recipientEmail: string;
  error: InsufficientCreditsError;
}): Promise<void> {
  const { workspace, agent, agentId, recipientEmail, error } = params;
  const workspaceId = workspace.pk.replace("workspaces/", "");
  const workspaceUrl = buildWorkspaceUrl(workspaceId);
  const creditPurchaseUrl = buildWorkspaceCreditsUrl(workspaceId);
  const agentSummary = buildAgentSummary(agentId, agent);
  const required = formatAmount(error.required, error.currency);
  const available = formatAmount(error.available, error.currency);

  const subject = `Insufficient Credits - ${workspace.name}`;
  const text = `A request failed due to insufficient credits.

Workspace: ${workspace.name} (${workspaceId})
Workspace link: ${workspaceUrl}
${agentSummary}

Error: ${error.message}
Required: ${required}
Available: ${available}

To continue, please purchase additional credits:
${creditPurchaseUrl}

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
    .summary { background: #eef2ff; padding: 12px; border-radius: 6px; margin: 16px 0; }
    .label { font-weight: bold; }
    .button { display: inline-block; padding: 12px 24px; background: #000; color: #fff; text-decoration: none; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Insufficient Credits</h1>
    </div>
    <div class="content">
      <p class="summary">
        <span class="label">Workspace:</span> ${workspace.name} (${workspaceId})
      </p>
      <p><span class="label">Workspace link:</span> <a href="${workspaceUrl}">${workspaceUrl}</a></p>
      <p><span class="label">${agentSummary}</span></p>
      <p><span class="label">Error:</span> ${error.message}</p>
      <p><span class="label">Required:</span> ${required}</p>
      <p><span class="label">Available:</span> ${available}</p>
      <p>
        <a href="${creditPurchaseUrl}" class="button">Buy Credits</a>
      </p>
      <p>Best regards,<br>The Helpmaton Team</p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail({
    to: recipientEmail,
    subject,
    text,
    html,
  });

  console.log("[agentErrorNotifications] Sent credit error email:", {
    workspaceId,
    recipientEmail,
  });
}

async function sendSpendingLimitErrorEmail(params: {
  workspace: WorkspaceRecord;
  agent?: AgentRecord;
  agentId?: string;
  recipientEmail: string;
  error: SpendingLimitExceededError;
}): Promise<void> {
  const { workspace, agent, agentId, recipientEmail, error } = params;
  const workspaceId = workspace.pk.replace("workspaces/", "");
  const workspaceUrl = buildWorkspaceUrl(workspaceId);
  const settingsUrl = buildWorkspaceSettingsUrl(workspaceId);
  const agentSummary = buildAgentSummary(agentId, agent);
  const currency = workspace.currency || "usd";
  const limitsSummary = error.failedLimits
    .map(
      (limit) =>
        `${limit.scope} ${limit.timeFrame}: ${formatAmount(
          limit.current,
          currency
        )}/${formatAmount(limit.limit, currency)}`
    )
    .join("\n");
  const limitsHtml = error.failedLimits
    .map(
      (limit) =>
        `<li>${limit.scope} ${limit.timeFrame}: ${formatAmount(
          limit.current,
          currency
        )}/${formatAmount(limit.limit, currency)}</li>`
    )
    .join("");

  const subject = `Spending Limit Reached - ${workspace.name}`;
  const text = `A request failed due to spending limits being reached.

Workspace: ${workspace.name} (${workspaceId})
Workspace link: ${workspaceUrl}
${agentSummary}

Error: ${error.message}
Failed limits:
${limitsSummary}

You can adjust spending limits in workspace settings:
${settingsUrl}

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
    .summary { background: #eef2ff; padding: 12px; border-radius: 6px; margin: 16px 0; }
    .label { font-weight: bold; }
    .button { display: inline-block; padding: 12px 24px; background: #000; color: #fff; text-decoration: none; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Spending Limit Reached</h1>
    </div>
    <div class="content">
      <p class="summary">
        <span class="label">Workspace:</span> ${workspace.name} (${workspaceId})
      </p>
      <p><span class="label">Workspace link:</span> <a href="${workspaceUrl}">${workspaceUrl}</a></p>
      <p><span class="label">${agentSummary}</span></p>
      <p><span class="label">Error:</span> ${error.message}</p>
      <p><span class="label">Failed limits:</span></p>
      <ul>${limitsHtml}</ul>
      <p>
        <a href="${settingsUrl}" class="button">Manage Settings</a>
      </p>
      <p>Best regards,<br>The Helpmaton Team</p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail({
    to: recipientEmail,
    subject,
    text,
    html,
  });

  console.log("[agentErrorNotifications] Sent spending limit error email:", {
    workspaceId,
    recipientEmail,
  });
}

export async function sendAgentErrorNotification(
  workspaceId: string,
  errorType: "credit" | "spendingLimit",
  error: InsufficientCreditsError | SpendingLimitExceededError
): Promise<void> {
  try {
    const db = await database();
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = (await db.workspace.get(workspacePk, "workspace")) as
      | WorkspaceRecord
      | undefined;

    if (!workspace) {
      console.error(
        "[agentErrorNotifications] Workspace not found:",
        workspaceId
      );
      return;
    }

    const agentId = error.agentId;
    let agent: AgentRecord | undefined;
    if (agentId) {
      const agentPk = `agents/${workspaceId}/${agentId}`;
      agent = await db.agent.get(agentPk, "agent");
      if (!agent) {
        console.warn(
          "[agentErrorNotifications] Agent not found for error notification:",
          { workspaceId, agentId }
        );
      }
    }

    const recipients = await getWorkspaceOwnerRecipients(workspaceId);
    if (recipients.length === 0) {
      console.log(
        "[agentErrorNotifications] No workspace owners with email found:",
        { workspaceId }
      );
      return;
    }

    for (const recipient of recipients) {
      const userPk = `USER#${recipient.userId}`;
      const userSk = `USER#${recipient.userId}`;
      const userRecord = (await db["next-auth"].get(
        userPk,
        userSk
      )) as NextAuthUserRecord | undefined;

      if (!userRecord) {
        console.error(
          "[agentErrorNotifications] User record not found for rate limiting:",
          recipient.userId
        );
        continue;
      }

      if (!shouldSendUserErrorEmail(userRecord, errorType)) {
        console.log(
          "[agentErrorNotifications] Skipping email due to rate limiting:",
          {
            workspaceId,
            userId: recipient.userId,
            errorType,
            lastEmailSentAt:
              errorType === "credit"
                ? userRecord.lastCreditErrorEmailSentAt
                : userRecord.lastSpendingLimitErrorEmailSentAt,
          }
        );
        continue;
      }

      if (errorType === "credit") {
        await sendCreditErrorEmail({
          workspace,
          agent,
          agentId,
          recipientEmail: recipient.email,
          error: error as InsufficientCreditsError,
        });
      } else {
        await sendSpendingLimitErrorEmail({
          workspace,
          agent,
          agentId,
          recipientEmail: recipient.email,
          error: error as SpendingLimitExceededError,
        });
      }

      const now = new Date().toISOString();
      const updateFields =
        errorType === "credit"
          ? { lastCreditErrorEmailSentAt: now }
          : { lastSpendingLimitErrorEmailSentAt: now };

      await db["next-auth"].update({
        pk: userRecord.pk,
        sk: userRecord.sk,
        ...updateFields,
      });

      console.log("[agentErrorNotifications] Updated email timestamp:", {
        workspaceId,
        userId: recipient.userId,
        errorType,
        timestamp: now,
      });
    }
  } catch (error) {
    console.error("[agentErrorNotifications] Error sending notification:", {
      workspaceId,
      errorType,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "email-notifications",
        operation: "send-agent-error-email",
      },
    });
  }
}


