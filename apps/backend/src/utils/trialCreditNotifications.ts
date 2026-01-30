import { getDefined } from "../utils";

import { sendDiscordMessage } from "./discord";

/**
 * Send a Discord notification for a trial credit request
 * @param workspaceId - Workspace ID
 * @param userEmail - User email address
 */
export async function sendTrialCreditRequestNotification(
  workspaceId: string,
  userEmail: string,
  reason: string
): Promise<void> {
  const botToken = getDefined(
    process.env.DISCORD_BOT_TOKEN,
    "DISCORD_BOT_TOKEN is required"
  );

  const channelId = getDefined(
    process.env.DISCORD_TRIAL_CREDIT_CHANNEL_ID,
    "DISCORD_TRIAL_CREDIT_CHANNEL_ID is required"
  );

  const creditAmount = 2; // Fixed amount: 2 USD

  const message = `🔔 **Trial Credit Request**

**User Email:** ${userEmail}
**Workspace ID:** \`${workspaceId}\`
**Currency:** USD
**Requested Amount:** ${creditAmount} USD
**Reason:** ${reason}

Please review and approve using the Discord \`/credit\` command:
\`/credit workspace_id:${workspaceId} amount:${creditAmount}\`

To link this to the trial request, include the trial_request_id parameter when available.`;

  await sendDiscordMessage(botToken, channelId, message);
}

