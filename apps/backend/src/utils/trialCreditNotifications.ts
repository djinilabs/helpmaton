import { getDefined } from "../utils";

import type { Currency } from "./aggregation";
import { sendDiscordMessage } from "./discord";

/**
 * Send a Discord notification for a trial credit request
 * @param workspaceId - Workspace ID
 * @param userEmail - User email address
 * @param currency - Workspace currency
 */
export async function sendTrialCreditRequestNotification(
  workspaceId: string,
  userEmail: string,
  currency: Currency
): Promise<void> {
  const botToken = getDefined(
    process.env.DISCORD_BOT_TOKEN,
    "DISCORD_BOT_TOKEN is required"
  );

  const channelId = getDefined(
    process.env.DISCORD_TRIAL_CREDIT_CHANNEL_ID,
    "DISCORD_TRIAL_CREDIT_CHANNEL_ID is required"
  );

  const creditAmount = 2; // Fixed amount: 2 EUR/USD/GBP
  const currencyUpper = currency.toUpperCase();

  const message = `🔔 **Trial Credit Request**

**User Email:** ${userEmail}
**Workspace ID:** \`${workspaceId}\`
**Currency:** ${currencyUpper}
**Requested Amount:** ${creditAmount} ${currencyUpper}

Please review and approve using the Discord \`/credit\` command:
\`/credit workspace_id:${workspaceId} amount:${creditAmount}\`

To link this to the trial request, include the trial_request_id parameter when available.`;

  await sendDiscordMessage(botToken, channelId, message);
}

