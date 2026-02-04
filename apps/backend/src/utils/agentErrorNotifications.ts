/**
 * Agent Error Notification System
 * Sends email notifications to workspace owners when credit or spending limit errors occur
 * Implements 1-hour rate limiting per user per error type to avoid email flooding
 */

import { sendEmail } from "../send-email";
import { database } from "../tables";
import type { AgentRecord, TableRecord, WorkspaceRecord } from "../tables/schema";

import { getWorkspaceOwnerRecipients } from "./creditAdminNotifications";
import { fromNanoDollars } from "./creditConversions";
import type {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "./creditErrors";
import { Sentry, ensureError } from "./sentry";

const BASE_URL = process.env.BASE_URL || "https://app.helpmaton.com";
const ONE_HOUR_MS = 60 * 60 * 1000;

type NextAuthUserRecord = TableRecord & {
  pk: string;
  sk: string;
  email?: string;
  lastCreditErrorEmailSentAt?: string;
  lastSpendingLimitErrorEmailSentAt?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeSubjectValue(value?: string): string {
  const input = value || "";
  let output = "";
  for (const char of input) {
    const code = char.charCodeAt(0);
    output += code < 32 || code === 127 ? " " : char;
  }
  return output.replace(/\s+/g, " ").trim();
}

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

/**
 * True if the error is a DynamoDB conditional check / transaction cancelled failure.
 * Used to treat concurrent updates as "skip send" instead of failing the flow.
 */
function isConditionalCheckOrTransactionCancelledError(error: Error): boolean {
  const name = error.name?.toLowerCase() || "";
  const message = error.message?.toLowerCase() || "";
  const code = String((error as { code?: string }).code ?? "").toLowerCase();
  return (
    name === "transactioncanceledexception" ||
    code === "transactioncanceledexception" ||
    message.includes("conditionalcheckfailed") ||
    message.includes("conditional check failed") ||
    message.includes("transaction cancelled")
  );
}

async function reserveUserNotificationWindow(params: {
  db: Awaited<ReturnType<typeof database>>;
  userPk: string;
  userSk: string;
  errorType: "credit" | "spendingLimit";
}): Promise<{ updated: boolean; timestamp?: string; skipReason?: string }> {
  const { db, userPk, userSk, errorType } = params;
  const now = new Date().toISOString();
  let skipReason: string | undefined;

  try {
    const updated = await db.atomicUpdate(
      new Map([
        [
          "user",
          {
            table: "next-auth",
            pk: userPk,
            sk: userSk,
          },
        ],
      ]),
      async (fetched) => {
        const existing = fetched.get("user") as NextAuthUserRecord | undefined;
        if (!existing) {
          skipReason = "missing_record";
          return [];
        }

        if (!shouldSendUserErrorEmail(existing, errorType)) {
          skipReason = "rate_limited";
          return [];
        }

        skipReason = undefined;
        const updateFields =
          errorType === "credit"
            ? { lastCreditErrorEmailSentAt: now }
            : { lastSpendingLimitErrorEmailSentAt: now };
        const updatedRecord: TableRecord = {
          ...(existing as TableRecord),
          ...updateFields,
        };
        return [updatedRecord];
      }
    );

    return {
      updated: updated.length > 0,
      timestamp: updated.length > 0 ? now : undefined,
      skipReason,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (isConditionalCheckOrTransactionCancelledError(error)) {
      // Another process updated the user's rate-limit timestamp; skip sending (rate limit still enforced).
      return {
        updated: false,
        skipReason: "concurrent_update",
      };
    }
    throw err;
  }
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
  const safeWorkspaceName = sanitizeSubjectValue(workspace.name) || "Workspace";

  const subject = `Insufficient Credits - ${safeWorkspaceName}`;
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

  const htmlWorkspaceName = escapeHtml(workspace.name);
  const htmlWorkspaceUrl = escapeHtml(workspaceUrl);
  const htmlAgentSummary = escapeHtml(agentSummary);
  const htmlErrorMessage = escapeHtml(error.message);
  const htmlRequired = escapeHtml(required);
  const htmlAvailable = escapeHtml(available);
  const htmlPurchaseUrl = escapeHtml(creditPurchaseUrl);

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
        <span class="label">Workspace:</span> ${htmlWorkspaceName} (${workspaceId})
      </p>
      <p><span class="label">Workspace link:</span> <a href="${htmlWorkspaceUrl}">${htmlWorkspaceUrl}</a></p>
      <p><span class="label">${htmlAgentSummary}</span></p>
      <p><span class="label">Error:</span> ${htmlErrorMessage}</p>
      <p><span class="label">Required:</span> ${htmlRequired}</p>
      <p><span class="label">Available:</span> ${htmlAvailable}</p>
      <p>
        <a href="${htmlPurchaseUrl}" class="button">Buy Credits</a>
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
  const safeWorkspaceName = sanitizeSubjectValue(workspace.name) || "Workspace";
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
        `<li>${escapeHtml(
          `${limit.scope} ${limit.timeFrame}: ${formatAmount(
            limit.current,
            currency
          )}/${formatAmount(limit.limit, currency)}`
        )}</li>`
    )
    .join("");

  const subject = `Spending Limit Reached - ${safeWorkspaceName}`;
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

  const htmlWorkspaceName = escapeHtml(workspace.name);
  const htmlWorkspaceUrl = escapeHtml(workspaceUrl);
  const htmlAgentSummary = escapeHtml(agentSummary);
  const htmlErrorMessage = escapeHtml(error.message);
  const htmlSettingsUrl = escapeHtml(settingsUrl);

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
        <span class="label">Workspace:</span> ${htmlWorkspaceName} (${workspaceId})
      </p>
      <p><span class="label">Workspace link:</span> <a href="${htmlWorkspaceUrl}">${htmlWorkspaceUrl}</a></p>
      <p><span class="label">${htmlAgentSummary}</span></p>
      <p><span class="label">Error:</span> ${htmlErrorMessage}</p>
      <p><span class="label">Failed limits:</span></p>
      <ul>${limitsHtml}</ul>
      <p>
        <a href="${htmlSettingsUrl}" class="button">Manage Settings</a>
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
      const reservation = await reserveUserNotificationWindow({
        db,
        userPk,
        userSk,
        errorType,
      });

      if (!reservation.updated) {
        const logContext =
          reservation.skipReason === "missing_record"
            ? "User record not found for rate limiting"
            : reservation.skipReason === "concurrent_update"
              ? "Skipping email due to concurrent update (rate limit applied by another process)"
              : "Skipping email due to rate limiting";
        console.log(`[agentErrorNotifications] ${logContext}:`, {
          workspaceId,
          userId: recipient.userId,
          errorType,
        });
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
      console.log("[agentErrorNotifications] Updated email timestamp:", {
        workspaceId,
        userId: recipient.userId,
        errorType,
        timestamp: reservation.timestamp,
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


