import { sendEmail } from "../send-email";
import { database } from "../tables";
import { PERMISSION_LEVELS, type WorkspaceRecord } from "../tables/schema";

import { fromNanoDollars } from "./creditConversions";
import { getUserEmailById } from "./subscriptionUtils";

function formatAmount(nanoDollars: number): string {
  return fromNanoDollars(nanoDollars)
    .toFixed(12)
    .replace(/\.?0+$/, "");
}

export async function getWorkspaceOwnerEmails(
  workspaceId: string
): Promise<string[]> {
  const db = await database();
  const workspacePk = `workspaces/${workspaceId}`;
  const permissions = await db.permission.query({
    KeyConditionExpression: "pk = :workspacePk",
    ExpressionAttributeValues: {
      ":workspacePk": workspacePk,
    },
  });

  const ownerUserIds = permissions.items
    .filter((permission) => permission.type === PERMISSION_LEVELS.OWNER)
    .map((permission) => permission.sk.replace("users/", ""));

  const emails = await Promise.all(
    ownerUserIds.map(async (userId) => getUserEmailById(userId))
  );

  return emails.filter((email): email is string => Boolean(email));
}

export async function sendWorkspaceCreditNotifications({
  workspace,
  amountInNanoDollars,
  oldBalance,
  newBalance,
  currency,
  trialRequestId,
}: {
  workspace: WorkspaceRecord;
  amountInNanoDollars: number;
  oldBalance: number;
  newBalance: number;
  currency: string;
  trialRequestId?: string;
}): Promise<void> {
  const workspaceId = workspace.pk.replace("workspaces/", "");
  const ownerEmails = await getWorkspaceOwnerEmails(workspaceId);

  if (ownerEmails.length === 0) {
    console.log(
      "[creditAdminNotifications] No workspace owners with email found:",
      { workspaceId }
    );
    return;
  }

  const amountDisplay = formatAmount(amountInNanoDollars);
  const oldBalanceDisplay = formatAmount(oldBalance);
  const newBalanceDisplay = formatAmount(newBalance);
  const currencyDisplay = currency.toUpperCase();
  const trialNote = trialRequestId
    ? "This credit was linked to a trial request approval."
    : "This credit was applied manually via the Discord /credit command.";

  const subject = `Workspace credit applied: ${workspace.name}`;
  const text = `Workspace credit applied

Workspace: ${workspace.name} (${workspaceId})
Amount credited: ${amountDisplay} ${currencyDisplay}
Previous balance: ${oldBalanceDisplay} ${currencyDisplay}
New balance: ${newBalanceDisplay} ${currencyDisplay}

${trialNote}

If you have any questions, reply to this email.`;

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
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Workspace credit applied</h1>
    </div>
    <div class="content">
      <p class="summary">
        <span class="label">Workspace:</span> ${workspace.name} (${workspaceId})
      </p>
      <p><span class="label">Amount credited:</span> ${amountDisplay} ${currencyDisplay}</p>
      <p><span class="label">Previous balance:</span> ${oldBalanceDisplay} ${currencyDisplay}</p>
      <p><span class="label">New balance:</span> ${newBalanceDisplay} ${currencyDisplay}</p>
      <p>${trialNote}</p>
      <p>If you have any questions, reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

  await Promise.all(
    ownerEmails.map((email) =>
      sendEmail({
        to: email,
        subject,
        text,
        html,
      })
    )
  );

  console.log("[creditAdminNotifications] Sent credit emails:", {
    workspaceId,
    ownerEmails,
  });
}
