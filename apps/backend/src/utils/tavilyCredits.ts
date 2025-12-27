/**
 * Credit management utilities for Tavily API calls
 * Handles credit reservation and adjustment based on actual usage from Tavily API
 */

import type { DatabaseSchema } from "../tables/schema";

import type { CreditReservation } from "./creditManagement";
import { reserveCredits } from "./creditManagement";
import type { AugmentedContext } from "./workspaceCreditContext";

// Tavily pricing: $0.008 per API call = 8,000 millionths (1 Tavily API call = $0.008)
const TAVILY_COST_PER_CALL_MILLIONTHS = 8_000; // $0.008 = 8,000 millionths

/**
 * Calculate estimated cost for a Tavily API call
 * @returns Cost in millionths (8,000 = $0.008)
 */
export function calculateTavilyCost(creditsUsed: number = 1): number {
  // Each credit = $0.008 = 8,000 millionths
  return creditsUsed * TAVILY_COST_PER_CALL_MILLIONTHS;
}

/**
 * Reserve credits for a Tavily API call
 * @param db - Database instance
 * @param workspaceId - Workspace ID
 * @param estimatedCredits - Estimated credits to use (default: 1)
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param context - Augmented Lambda context for transaction creation (optional)
 * @param agentId - Agent ID (optional, for transaction tracking)
 * @param conversationId - Conversation ID (optional, for transaction tracking)
 * @returns Credit reservation info
 */
export async function reserveTavilyCredits(
  db: DatabaseSchema,
  workspaceId: string,
  estimatedCredits: number = 1,
  maxRetries: number = 3,
  context?: AugmentedContext,
  agentId?: string,
  conversationId?: string
): Promise<CreditReservation> {
  const estimatedCost = calculateTavilyCost(estimatedCredits);
  console.log("[reserveTavilyCredits] Reserving credits:", {
    workspaceId,
    estimatedCredits,
    estimatedCost,
    agentId,
    conversationId,
  });

  return await reserveCredits(
    db,
    workspaceId,
    estimatedCost,
    maxRetries,
    false,
    context,
    "tavily",
    "tavily-api",
    agentId,
    conversationId
  );
}

/**
 * Adjust credit reservation based on actual credits used from Tavily API response
 * @param db - Database instance
 * @param reservationId - Reservation ID
 * @param workspaceId - Workspace ID
 * @param actualCreditsUsed - Actual credits consumed from Tavily API response
 * @param context - Augmented Lambda context for transaction creation (required)
 * @param toolName - Tool name ("search_web" or "fetch_web") for transaction metadata
 * @param maxRetries - Maximum number of retries (default: 3, not used for transactions)
 * @param agentId - Agent ID (optional, for transaction tracking)
 * @param conversationId - Conversation ID (optional, for transaction tracking)
 * @returns Updated workspace record
 */
export async function adjustTavilyCreditReservation(
  db: DatabaseSchema,
  reservationId: string,
  workspaceId: string,
  actualCreditsUsed: number,
  context: AugmentedContext,
  toolName: "search_web" | "fetch_web",
  _maxRetries: number = 3,
  agentId?: string,
  conversationId?: string
): Promise<void> {
  // Get reservation to find reserved amount
  const reservationPk = `credit-reservations/${reservationId}`;
  const reservation = await db["credit-reservations"].get(reservationPk);

  if (!reservation) {
    console.warn(
      "[adjustTavilyCreditReservation] Reservation not found, assuming already processed:",
      { reservationId, workspaceId }
    );
    return;
  }

  // Calculate actual cost from credits used
  const actualCost = calculateTavilyCost(actualCreditsUsed);

  // Calculate difference between actual cost and reserved amount
  const difference = actualCost - reservation.reservedAmount;

  console.log("[adjustTavilyCreditReservation] Adjusting credits:", {
    workspaceId,
    reservationId,
    reservedAmount: reservation.reservedAmount,
    actualCreditsUsed,
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
  const newBalance = oldBalance - difference; // Will be applied when transaction commits

  console.log("[adjustTavilyCreditReservation] Creating credit transaction (will commit at end of request):", {
    workspaceId,
    reservationId,
    difference,
    transactionAmount: difference,
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
    supplier: "tavily",
    tool_call: toolName,
    description: `Tavily API call: ${toolName} - adjust reservation`,
    amountMillionthUsd: difference,
  });

  // Delete reservation after adjustment (Tavily doesn't need step 3 like OpenRouter)
  await db["credit-reservations"].delete(reservationPk);
  console.log("[adjustTavilyCreditReservation] Successfully deleted reservation:", {
    reservationId,
  });

  console.log("[adjustTavilyCreditReservation] Successfully created transaction:", {
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
 * @param toolName - Tool name ("search_web" or "fetch_web") for transaction metadata (optional)
 * @param maxRetries - Maximum number of retries (default: 3, not used for transactions)
 * @param agentId - Agent ID (optional, for transaction tracking)
 * @param conversationId - Conversation ID (optional, for transaction tracking)
 */
export async function refundTavilyCredits(
  db: DatabaseSchema,
  reservationId: string,
  workspaceId: string,
  context: AugmentedContext,
  toolName?: "search_web" | "fetch_web",
  _maxRetries: number = 3,
  agentId?: string,
  conversationId?: string
): Promise<void> {
  // Get reservation to find reserved amount
  const reservationPk = `credit-reservations/${reservationId}`;
  const reservation = await db["credit-reservations"].get(reservationPk);

  if (!reservation) {
    console.warn(
      "[refundTavilyCredits] Reservation not found, assuming already processed:",
      { reservationId, workspaceId }
    );
    return;
  }

  const reservedAmount = reservation.reservedAmount;

  console.log("[refundTavilyCredits] Refunding credits:", {
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
  const newBalance = oldBalance + reservedAmount; // Will be applied when transaction commits

  console.log("[refundTavilyCredits] Creating credit transaction (will commit at end of request):", {
    workspaceId,
    reservationId,
    refundAmount: reservedAmount,
    transactionAmount: -reservedAmount, // Negative for credit/refund
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
    supplier: "tavily",
    tool_call: toolName,
    description: `Tavily API call refund (error occurred)${toolName ? ` - ${toolName}` : ""}`,
    amountMillionthUsd: -reservedAmount, // Negative for credit/refund
  });

  // Delete the reservation
  await db["credit-reservations"].delete(reservationPk);

  console.log("[refundTavilyCredits] Successfully created refund transaction:", {
    workspaceId,
    reservationId,
    newBalance,
  });
}

