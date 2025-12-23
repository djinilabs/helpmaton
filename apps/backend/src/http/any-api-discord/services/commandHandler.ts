import { APIGatewayProxyResult } from "aws-lambda";

import { database } from "../../../tables/index";
import { fromMillionths, toMillionths } from "../../../utils/creditConversions";
import { creditCredits } from "../../../utils/creditManagement";

import { discordResponse } from "./discordResponse";

/**
 * Sleep for a given number of milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DiscordInteraction {
  data: {
    name: string;
    options?: Array<{
      name: string;
      value: string | number;
    }>;
  };
}

/**
 * Manually debit credits from a workspace
 * Similar to creditCredits but subtracts instead of adds
 * Uses optimistic locking with retry logic for concurrent updates
 * @param workspaceId - Workspace ID
 * @param amount - Amount in millionths (integer)
 */
async function debitCreditsManual(
  workspaceId: string,
  amount: number // millionths
): Promise<{
  workspaceId: string;
  oldBalance: number; // millionths
  newBalance: number; // millionths
  currency: string;
}> {
  const db = await database();
  const workspacePk = `workspaces/${workspaceId}`;
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 100;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const workspace = await db.workspace.get(workspacePk, "workspace");

      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      // Calculate new balance (all values in millionths, so simple subtraction)
      const newBalance = workspace.creditBalance - amount;

      // Warn if debit would result in negative balance
      if (newBalance < 0) {
        console.warn(
          `[debitCreditsManual] Negative balance detected for workspace ${workspaceId}: ` +
            `Attempted to debit ${amount} millionths from balance ${workspace.creditBalance} millionths. ` +
            `Resulting balance: ${newBalance} millionths`
        );
      }

      // Update workspace with optimistic locking
      const updated = await db.workspace.update({
        pk: workspacePk,
        sk: "workspace",
        creditBalance: newBalance,
      });

      return {
        workspaceId,
        oldBalance: workspace.creditBalance,
        newBalance: updated.creditBalance,
        currency: workspace.currency,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Check for optimistic locking error
      const isOptimisticLockError =
        err instanceof Error &&
        (err.message.toLowerCase().includes("item was outdated") ||
          err.message.toLowerCase().includes("conditional request failed") ||
          err.message.toLowerCase().includes("conditionalcheckfailed"));

      if (isOptimisticLockError && attempt < MAX_RETRIES - 1) {
        const backoffMs = BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(
          `[debitCreditsManual] Version conflict, retrying in ${backoffMs}ms (attempt ${
            attempt + 1
          }/${MAX_RETRIES}):`,
          {
            workspaceId,
            error: lastError.message,
          }
        );
        await delay(backoffMs);
        continue;
      }

      throw lastError;
    }
  }

  throw new Error(
    `Failed to debit credits after ${MAX_RETRIES} attempts due to concurrent updates: ${
      lastError?.message || "Unknown error"
    }`
  );
}

export async function handleDiscordCommand(
  interaction: DiscordInteraction
): Promise<APIGatewayProxyResult> {
  const commandName = interaction.data.name;

  try {
    switch (commandName) {
      case "credit":
        return await handleCreditCommand(interaction);
      case "debit":
        return await handleDebitCommand(interaction);
      default:
        return discordResponse("❌ Unknown command");
    }
  } catch (error) {
    console.error("Error handling Discord command:", error);

    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";

    return discordResponse(`❌ **Error:** ${errorMessage}`);
  }
}

async function handleCreditCommand(
  interaction: DiscordInteraction
): Promise<APIGatewayProxyResult> {
  // Extract parameters from command options
  const workspaceIdOption = interaction.data.options?.find(
    (option) => option.name === "workspace_id"
  );
  const amountOption = interaction.data.options?.find(
    (option) => option.name === "amount"
  );
  const trialRequestIdOption = interaction.data.options?.find(
    (option) => option.name === "trial_request_id"
  );

  if (!workspaceIdOption) {
    return discordResponse("❌ `workspace_id` parameter is required");
  }

  if (!amountOption) {
    return discordResponse("❌ `amount` parameter is required");
  }

  const workspaceId = workspaceIdOption.value as string;
  const amount = parseFloat(String(amountOption.value));
  const trialRequestId = trialRequestIdOption?.value as string | undefined;

  if (isNaN(amount) || amount <= 0) {
    return discordResponse("❌ Amount must be a positive number");
  }

  try {
    const db = await database();

    // Get workspace to show current balance
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");

    if (!workspace) {
      return discordResponse(`❌ Workspace \`${workspaceId}\` not found`);
    }

    // If trial_request_id is provided, verify and update the trial request
    if (trialRequestId) {
      const requestPk = `trial-credit-requests/${workspaceId}`;
      const requestSk = "request";

      const trialRequest = await db["trial-credit-requests"].get(
        requestPk,
        requestSk
      );

      if (!trialRequest) {
        return discordResponse(
          `❌ Trial credit request not found for workspace \`${workspaceId}\``
        );
      }

      if (trialRequest.status !== "pending") {
        return discordResponse(
          `❌ Trial credit request is not pending (current status: ${trialRequest.status})`
        );
      }

      // Update trial request status to approved
      await db["trial-credit-requests"].update({
        pk: requestPk,
        sk: requestSk,
        status: "approved",
        approvedAt: new Date().toISOString(),
        approvedBy: "discord-admin", // Could be enhanced to get actual Discord user ID
      });

      // Update workspace to mark credits as approved and store the amount (in millionths)
      await db.workspace.update({
        pk: workspacePk,
        sk: "workspace",
        trialCreditApproved: true,
        trialCreditApprovedAt: new Date().toISOString(),
        trialCreditAmount: toMillionths(amount),
      });
    }

    // Convert amount from currency units to millionths
    const amountInMillionths = toMillionths(amount);
    
    // Add credits (amount is in millionths)
    const updated = await creditCredits(db, workspaceId, amountInMillionths);

    const trialInfo = trialRequestId
      ? `\n🎁 Trial credit request approved and linked.`
      : "";

    // Convert millionths back to currency units for display
    const amountDisplay = fromMillionths(amountInMillionths);
    const balanceDisplay = fromMillionths(updated.creditBalance);
    const oldBalanceDisplay = fromMillionths(workspace.creditBalance);

    return discordResponse(
      `✅ Successfully credited **${amountDisplay.toFixed(
        10
      )} ${updated.currency.toUpperCase()}** to workspace \`${workspaceId}\`\n` +
        `📊 Balance: **${balanceDisplay.toFixed(
          10
        )} ${updated.currency.toUpperCase()}** (was ${oldBalanceDisplay.toFixed(
          10
        )})${trialInfo}`
    );
  } catch (error) {
    console.error("Error crediting workspace:", error);

    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";

    return discordResponse(`❌ **Error:** ${errorMessage}`);
  }
}

async function handleDebitCommand(
  interaction: DiscordInteraction
): Promise<APIGatewayProxyResult> {
  // Extract parameters from command options
  const workspaceIdOption = interaction.data.options?.find(
    (option) => option.name === "workspace_id"
  );
  const amountOption = interaction.data.options?.find(
    (option) => option.name === "amount"
  );

  if (!workspaceIdOption) {
    return discordResponse("❌ `workspace_id` parameter is required");
  }

  if (!amountOption) {
    return discordResponse("❌ `amount` parameter is required");
  }

  const workspaceId = workspaceIdOption.value as string;
  const amount = parseFloat(String(amountOption.value));

  if (isNaN(amount) || amount <= 0) {
    return discordResponse("❌ Amount must be a positive number");
  }

  try {
    // Convert amount from currency units to millionths
    const amountInMillionths = toMillionths(amount);
    
    // Debit credits (amount is in millionths)
    const result = await debitCreditsManual(workspaceId, amountInMillionths);

    // Convert millionths back to currency units for display
    const amountDisplay = fromMillionths(amountInMillionths);
    const newBalanceDisplay = fromMillionths(result.newBalance);
    const oldBalanceDisplay = fromMillionths(result.oldBalance);

    return discordResponse(
      `✅ Successfully debited **${amountDisplay.toFixed(
        10
      )} ${result.currency.toUpperCase()}** from workspace \`${workspaceId}\`\n` +
        `📊 Balance: **${newBalanceDisplay.toFixed(
          10
        )} ${result.currency.toUpperCase()}** (was ${oldBalanceDisplay.toFixed(
          10
        )})`
    );
  } catch (error) {
    console.error("Error debiting workspace:", error);

    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";

    return discordResponse(`❌ **Error:** ${errorMessage}`);
  }
}
