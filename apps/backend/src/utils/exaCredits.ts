/**
 * Credit management utilities for Exa.ai API calls
 * Handles credit reservation and adjustment based on actual usage from Exa.ai API
 */

import type { DatabaseSchema } from "../tables/schema";

import { formatCurrencyMillionths } from "./creditConversions";
import type { CreditReservation } from "./creditManagement";
import { reserveCredits } from "./creditManagement";
import { isCreditDeductionEnabled } from "./featureFlags";
import type { AugmentedContext } from "./workspaceCreditContext";

/**
 * Convert dollars to millionths
 * @param dollars - Cost in dollars
 * @returns Cost in millionths
 */
function dollarsToMillionths(dollars: number): number {
  return Math.ceil(dollars * 1_000_000);
}

/**
 * Reserve credits for an Exa.ai API call
 * @param db - Database instance
 * @param workspaceId - Workspace ID
 * @param estimatedCostDollars - Estimated cost in dollars (default: $0.01)
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param context - Augmented Lambda context for transaction creation (optional)
 * @param agentId - Agent ID (optional, for transaction tracking)
 * @param conversationId - Conversation ID (optional, for transaction tracking)
 * @returns Credit reservation info
 */
export async function reserveExaCredits(
  db: DatabaseSchema,
  workspaceId: string,
  estimatedCostDollars: number = 0.01, // Conservative estimate: $0.01
  maxRetries: number = 3,
  context?: AugmentedContext,
  agentId?: string,
  conversationId?: string
): Promise<CreditReservation> {
  const estimatedCost = dollarsToMillionths(estimatedCostDollars);
  console.log("[reserveExaCredits] Reserving credits:", {
    workspaceId,
    estimatedCostDollars,
    estimatedCost,
    agentId,
    conversationId,
    creditDeductionEnabled: isCreditDeductionEnabled(),
  });

  // If credit deduction is disabled, still create a transaction to track usage
  // but skip the actual reservation (no credit balance check or deduction)
  if (!isCreditDeductionEnabled()) {
    console.log(
      "[reserveExaCredits] Credit deduction disabled, creating transaction without reservation:",
      {
        workspaceId,
        estimatedCost,
        agentId,
        conversationId,
      }
    );

    // Get workspace for return value
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    // Create transaction immediately (amount 0 since deduction is disabled, but still track usage)
    if (context) {
      context.addWorkspaceCreditTransaction({
        workspaceId,
        agentId: agentId || undefined,
        conversationId: conversationId || undefined,
        source: "tool-execution",
        supplier: "exa",
        tool_call: "exa-api", // Will be updated in adjustment
        description: `Exa API call: reservation (credit deduction disabled)`,
        amountMillionthUsd: 0, // No charge when deduction is disabled
      });
      console.log(
        "[reserveExaCredits] Created transaction (deduction disabled):",
        {
          workspaceId,
          estimatedCost,
        }
      );
    }

    // Return a special reservation ID that indicates deduction is disabled
    // The adjustment step will update the transaction with actual cost
    return {
      reservationId: "deduction-disabled",
      reservedAmount: 0,
      workspace,
    };
  }

  return await reserveCredits(
    db,
    workspaceId,
    estimatedCost,
    maxRetries,
    false,
    context,
    "exa",
    "exa-api",
    agentId,
    conversationId
  );
}

/**
 * Adjust credit reservation based on actual cost from Exa.ai API response
 * @param db - Database instance
 * @param reservationId - Reservation ID
 * @param workspaceId - Workspace ID
 * @param actualCostDollars - Actual cost in dollars from result.costDollars.total
 * @param context - Augmented Lambda context for transaction creation (required)
 * @param toolName - Tool name ("search") for transaction metadata
 * @param maxRetries - Maximum number of retries (default: 3, not used for transactions)
 * @param agentId - Agent ID (optional, for transaction tracking)
 * @param conversationId - Conversation ID (optional, for transaction tracking)
 * @returns Updated workspace record
 */
export async function adjustExaCreditReservation(
  db: DatabaseSchema,
  reservationId: string,
  workspaceId: string,
  actualCostDollars: number,
  context: AugmentedContext,
  toolName: "search",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _maxRetries: number = 3,
  agentId?: string,
  conversationId?: string
): Promise<void> {
  // Handle special case: deduction disabled (transaction already created in reservation step)
  if (reservationId === "deduction-disabled") {
    const actualCost = dollarsToMillionths(actualCostDollars);
    console.log(
      "[adjustExaCreditReservation] Credit deduction disabled, updating transaction with actual cost:",
      {
        workspaceId,
        actualCostDollars,
        actualCost,
        toolName,
      }
    );

    // Get current workspace for logging
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    // Create a new transaction with actual cost (amount 0 since deduction is disabled, but track usage)
    // Note: The previous transaction with amount 0 will also be created, but that's okay for tracking
    context.addWorkspaceCreditTransaction({
      workspaceId,
      agentId: agentId || undefined,
      conversationId: conversationId || undefined,
      source: "tool-execution",
      supplier: "exa",
      tool_call: toolName,
      description: `Exa API call: ${toolName} (credit deduction disabled) - actual cost: ${actualCost} millionths`,
      amountMillionthUsd: 0, // No charge when deduction is disabled, but track usage
    });

    console.log(
      "[adjustExaCreditReservation] Created transaction (deduction disabled):",
      {
        workspaceId,
        actualCost,
        toolName,
      }
    );
    return;
  }

  // Get reservation to find reserved amount
  const reservationPk = `credit-reservations/${reservationId}`;
  const reservation = await db["credit-reservations"].get(reservationPk);

  if (!reservation) {
    console.warn(
      "[adjustExaCreditReservation] Reservation not found, creating transaction with actual cost:",
      { reservationId, workspaceId }
    );

    // Even if reservation is not found, create a transaction to track the API call
    const actualCost = dollarsToMillionths(actualCostDollars);

    // Get current workspace for logging
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    console.log("[adjustExaCreditReservation] Creating transaction without reservation:", {
      workspaceId,
      reservationId,
      actualCostDollars,
      actualCost,
      toolName,
    });

    // Create transaction with actual cost (reservation was already processed or missing)
    context.addWorkspaceCreditTransaction({
      workspaceId,
      agentId: agentId || undefined,
      conversationId: conversationId || undefined,
      source: "tool-execution",
      supplier: "exa",
      tool_call: toolName,
      description: `Exa API call: ${toolName} - reservation not found, using actual cost`,
      amountMillionthUsd: -actualCost, // Negative for debit (deducting from workspace)
    });

    console.log("[adjustExaCreditReservation] Created transaction (reservation not found):", {
      workspaceId,
      actualCost,
      toolName,
    });
    return;
  }

  // Calculate actual cost from dollars
  const actualCost = dollarsToMillionths(actualCostDollars);

  // Calculate difference between actual cost and reserved amount
  const difference = actualCost - reservation.reservedAmount;

  console.log("[adjustExaCreditReservation] Adjusting credits:", {
    workspaceId,
    reservationId,
    reservedAmount: reservation.reservedAmount,
    actualCostDollars,
    actualCost,
    difference,
    toolName,
  });

  // Get current workspace for logging
  const workspacePk = `workspaces/${workspaceId}`;
  const workspace = await db.workspace.get(workspacePk, "workspace");
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  const oldBalance = workspace.creditBalance;
  // Negative amount = debit (deduct from workspace), positive amount = credit (add to workspace)
  // If difference > 0, we need to charge more (debit = negative)
  // If difference < 0, we need to refund (credit = positive)
  const transactionAmount = difference === 0 ? 0 : -difference; // Negate: positive difference becomes negative (debit), negative becomes positive (credit), avoid -0
  const newBalance = oldBalance + transactionAmount; // Will be applied when transaction commits

  console.log("[adjustExaCreditReservation] Creating credit transaction (will commit at end of request):", {
    workspaceId,
    reservationId,
    difference,
    transactionAmount,
    oldBalance,
    newBalance,
    currency: workspace.currency,
    toolName,
  });

  // Format costs for description
  const actualCostFormatted = formatCurrencyMillionths(actualCost);
  const reservedAmountFormatted = formatCurrencyMillionths(reservation.reservedAmount);
  const differenceFormatted = formatCurrencyMillionths(Math.abs(difference));
  const action = difference > 0 ? "additional charge" : difference < 0 ? "refund" : "no adjustment";

  // For Exa, use the negated difference for the transaction amount
  // Negative amount = debit (deduct from workspace), positive amount = credit (add to workspace)
  // The actual cost is already accounted for in the reservation, so we only charge/refund the difference

  console.log("[adjustExaCreditReservation] Creating transaction:", {
    workspaceId,
    reservationId,
    actualCost,
    reservedAmount: reservation.reservedAmount,
    difference,
    transactionAmount,
    toolName,
    willBeTracked: transactionAmount === 0 ? "yes (tool-execution allows 0-amount)" : "yes",
  });

  // Create transaction in memory
  // Note: Even if difference is 0, this transaction will be created because tool-execution transactions
  // are not discarded (see addTransactionToBuffer)
  context.addWorkspaceCreditTransaction({
    workspaceId,
    agentId: agentId || undefined,
    conversationId: conversationId || undefined,
    source: "tool-execution",
    supplier: "exa",
    tool_call: toolName,
    description: `Exa API call: ${toolName} - actual cost ${actualCostFormatted}, reserved ${reservedAmountFormatted}, ${action} ${differenceFormatted}`,
    amountMillionthUsd: transactionAmount, // Negative for debit, positive for credit (can be 0, but will be tracked)
  });

  console.log("[adjustExaCreditReservation] Transaction added to buffer:", {
    workspaceId,
    transactionAmount,
    toolName,
  });

  // Delete reservation after adjustment (Exa doesn't need step 3 like OpenRouter)
  await db["credit-reservations"].delete(reservationPk);
  console.log("[adjustExaCreditReservation] Successfully deleted reservation:", {
    reservationId,
  });

  console.log("[adjustExaCreditReservation] Successfully created transaction:", {
    workspaceId,
    reservationId,
    newBalance,
  });
}

/**
 * Refund reserved credits (e.g., when API call fails)
 * @param db - Database instance
 * @param reservationId - Reservation ID
 * @param workspaceId - Workspace ID
 * @param context - Augmented Lambda context for transaction creation (required)
 * @param toolName - Tool name ("search") for transaction metadata (optional)
 * @param maxRetries - Maximum number of retries (default: 3, not used for transactions)
 * @param agentId - Agent ID (optional, for transaction tracking)
 * @param conversationId - Conversation ID (optional, for transaction tracking)
 */
export async function refundExaCredits(
  db: DatabaseSchema,
  reservationId: string,
  workspaceId: string,
  context: AugmentedContext,
  toolName?: "search",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _maxRetries: number = 3,
  agentId?: string,
  conversationId?: string
): Promise<void> {
  // Get reservation to find reserved amount
  const reservationPk = `credit-reservations/${reservationId}`;
  const reservation = await db["credit-reservations"].get(reservationPk);

  if (!reservation) {
    console.warn(
      "[refundExaCredits] Reservation not found, assuming already processed:",
      { reservationId, workspaceId }
    );
    return;
  }

  const reservedAmount = reservation.reservedAmount;

  console.log("[refundExaCredits] Refunding credits:", {
    workspaceId,
    reservationId,
    reservedAmount,
    toolName,
  });

  // Get current workspace for logging
  const workspacePk = `workspaces/${workspaceId}`;
  const workspace = await db.workspace.get(workspacePk, "workspace");
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  const oldBalance = workspace.creditBalance;
  // Positive amount = credit (adding back to workspace)
  const transactionAmount = reservedAmount; // Positive for credit/refund
  const newBalance = oldBalance + transactionAmount; // Will be applied when transaction commits

  console.log("[refundExaCredits] Creating credit transaction (will commit at end of request):", {
    workspaceId,
    reservationId,
    refundAmount: reservedAmount,
    transactionAmount, // Positive for credit/refund
    oldBalance,
    newBalance,
    currency: workspace.currency,
    toolName,
  });

  // Create transaction in memory
  context.addWorkspaceCreditTransaction({
    workspaceId,
    agentId: agentId || undefined,
    conversationId: conversationId || undefined,
    source: "tool-execution",
    supplier: "exa",
    tool_call: toolName,
    description: `Exa API call refund (error occurred)${toolName ? ` - ${toolName}` : ""}`,
    amountMillionthUsd: transactionAmount, // Positive for credit/refund
  });

  // Delete the reservation
  await db["credit-reservations"].delete(reservationPk);

  console.log("[refundExaCredits] Successfully created refund transaction:", {
    workspaceId,
    reservationId,
    newBalance,
  });
}

