/**
 * Credit management utilities for OpenRouter re-ranking API calls
 * Handles credit reservation, provisional adjustment, and async cost verification
 * Uses 3-step pattern: Estimate → Provisional → Final (async)
 */

import type { DatabaseSchema } from "../tables/schema";

import { formatCurrencyNanoDollars } from "./creditConversions";
import type { CreditReservation } from "./creditManagement";
import { enqueueCostVerification, reserveCredits } from "./creditManagement";
import { getModelPricing } from "./pricing";
import { Sentry, ensureError } from "./sentry";
import type { AugmentedContext } from "./workspaceCreditContext";

/**
 * Convert dollars to nano-dollars
 * @param dollars - Cost in dollars
 * @returns Cost in nano-dollars
 */
function dollarsToNanoDollars(dollars: number): number {
  return Math.ceil(dollars * 1_000_000_000);
}

/**
 * Estimate cost for re-ranking API call
 * @param model - Re-ranking model name
 * @param documentCount - Number of documents being re-ranked
 * @returns Estimated cost in nano-dollars
 */
function estimateRerankingCost(model: string, documentCount: number): number {
  // Get pricing for the re-ranking model
  const pricing = getModelPricing("openrouter", model);

  let estimatedCostDollars: number; // Will be set based on pricing or conservative estimate

  if (pricing?.usd) {
    const currencyPricing = pricing.usd;

    // Check for per-request pricing first
    if (currencyPricing.request !== undefined && currencyPricing.request > 0) {
      estimatedCostDollars = currencyPricing.request;
    } else {
      // Estimate based on document count
      // Use per-document pricing if available, otherwise use conservative estimate
      // Most re-ranking models charge per document or per request
      // NOTE: These estimates ($0.001 per document, $0.01 minimum) are conservative defaults
      // when actual OpenRouter pricing is not available. Actual costs may vary.
      const perDocumentEstimate = 0.001; // $0.001 per document
      estimatedCostDollars = Math.max(
        0.01, // Minimum $0.01 per request
        documentCount * perDocumentEstimate
      );
    }
  } else {
    // No pricing found, use conservative estimate
    const perDocumentEstimate = 0.001;
    estimatedCostDollars = Math.max(0.01, documentCount * perDocumentEstimate);
  }

  // Apply 5.5% OpenRouter markup
  const baseCost = dollarsToNanoDollars(estimatedCostDollars);
  const totalCost = Math.ceil(baseCost * 1.055);

  console.log("[estimateRerankingCost] Estimated cost:", {
    model,
    documentCount,
    estimatedCostDollars,
    baseCost,
    totalCostWithMarkup: totalCost,
    hasPricing: !!pricing,
  });

  return totalCost;
}

/**
 * Reserve credits for a re-ranking API call (Step 1: Estimate)
 * @param db - Database instance
 * @param workspaceId - Workspace ID
 * @param model - Re-ranking model name
 * @param documentCount - Number of documents being re-ranked
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param context - Augmented Lambda context for transaction creation (optional)
 * @param agentId - Agent ID (optional, for transaction tracking)
 * @param conversationId - Conversation ID (optional, for transaction tracking)
 * @param usesByok - Whether workspace is using their own API key (BYOK)
 * @returns Credit reservation info
 */
export async function reserveRerankingCredits(
  db: DatabaseSchema,
  workspaceId: string,
  model: string,
  documentCount: number,
  maxRetries: number = 3,
  context?: AugmentedContext,
  agentId?: string,
  conversationId?: string,
  usesByok?: boolean
): Promise<CreditReservation> {
  const estimatedCost = estimateRerankingCost(model, documentCount);

  console.log("[reserveRerankingCredits] Reserving credits:", {
    workspaceId,
    model,
    documentCount,
    estimatedCost,
    agentId,
    conversationId,
    usesByok,
  });

  // If BYOK, skip credit reservation (workspace pays directly)
  if (usesByok) {
    console.log(
      "[reserveRerankingCredits] Request made with user key (BYOK), skipping credit reservation",
      { workspaceId, model }
    );
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return {
      reservationId: "byok",
      reservedAmount: 0,
      workspace,
    };
  }

  return await reserveCredits(
    db,
    workspaceId,
    estimatedCost,
    maxRetries,
    false, // usesByok - already handled above
    context,
    "openrouter",
    model,
    agentId,
    conversationId
  );
}

/**
 * Adjust credit reservation based on provisional cost from API response (Step 2: Provisional)
 * @param db - Database instance
 * @param reservationId - Reservation ID
 * @param workspaceId - Workspace ID
 * @param provisionalCostUsd - Provisional cost in USD from API response (optional)
 * @param generationId - Generation ID for async cost verification (optional)
 * @param context - Augmented Lambda context for transaction creation (required)
 * @param maxRetries - Maximum number of retries (default: 3, not used for transactions)
 * @param agentId - Agent ID (optional, for transaction tracking)
 * @param conversationId - Conversation ID (optional, for transaction tracking)
 */
export async function adjustRerankingCreditReservation(
  db: DatabaseSchema,
  reservationId: string,
  workspaceId: string,
  provisionalCostUsd: number | undefined,
  generationId: string | undefined,
  context: AugmentedContext,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _maxRetries: number = 3, // Not used - transactions don't require retries, kept for API consistency
  agentId?: string,
  conversationId?: string
): Promise<void> {
  // Handle BYOK case
  if (reservationId === "byok") {
    console.log(
      "[adjustRerankingCreditReservation] BYOK request, skipping adjustment",
      { workspaceId }
    );
    return;
  }

  // Get reservation to find reserved amount
  const reservationPk = `credit-reservations/${reservationId}`;
  const reservation = await db["credit-reservations"].get(reservationPk);

  if (!reservation) {
    console.warn(
      "[adjustRerankingCreditReservation] Reservation not found, creating transaction with provisional cost:",
      { reservationId, workspaceId }
    );

    // Report data inconsistency to Sentry
    Sentry.captureException(
      new Error("Re-ranking credit reservation not found during adjustment"),
      {
        tags: {
          context: "knowledge-reranking-credits",
          operation: "adjust-reservation-not-found",
        },
        extra: {
          reservationId,
          workspaceId,
          agentId,
          conversationId,
          provisionalCostUsd,
          generationId,
        },
        level: "warning",
      }
    );

    // Even if reservation is not found, create a transaction to track the API call
    if (provisionalCostUsd !== undefined) {
      const provisionalCost = dollarsToNanoDollars(provisionalCostUsd);
      // Apply 5.5% markup
      const totalCost = Math.ceil(provisionalCost * 1.055);

      context.addWorkspaceCreditTransaction({
        workspaceId,
        agentId: agentId || undefined,
        conversationId: conversationId || undefined,
        source: "tool-execution",
        supplier: "openrouter",
        tool_call: "rerank",
        description: `Re-ranking API call: reservation not found, using provisional cost`,
        amountNanoUsd: -totalCost, // Negative for debit
      });

      console.log(
        "[adjustRerankingCreditReservation] Created transaction (reservation not found):",
        {
          workspaceId,
          reservationId,
          provisionalCostUsd,
          totalCost,
        }
      );
    }
    return;
  }

  // Use provisional cost if available from API response
  // Otherwise, try to use request pricing from config
  // Finally, fall back to reserved amount
  let provisionalCost: number;
  if (provisionalCostUsd !== undefined) {
    provisionalCost = Math.ceil(dollarsToNanoDollars(provisionalCostUsd) * 1.055);
  } else {
    // Try to get request pricing from config as fallback
    const modelName = reservation.modelName;
    if (modelName) {
      const pricing = getModelPricing("openrouter", modelName);
      if (pricing?.usd?.request !== undefined && pricing.usd.request > 0) {
        // Use request pricing from config with 5.5% markup
        const requestCostDollars = pricing.usd.request;
        provisionalCost = Math.ceil(dollarsToNanoDollars(requestCostDollars) * 1.055);
        console.log(
          "[adjustRerankingCreditReservation] Using request pricing from config as provisional cost:",
          {
            modelName,
            requestCostDollars,
            provisionalCost,
          }
        );
      } else {
        // Fall back to reserved amount
        provisionalCost = reservation.reservedAmount;
        console.log(
          "[adjustRerankingCreditReservation] No request pricing in config, using reserved amount:",
          {
            modelName,
            reservedAmount: reservation.reservedAmount,
          }
        );
      }
    } else {
      // No model name, fall back to reserved amount
      provisionalCost = reservation.reservedAmount;
      console.log(
        "[adjustRerankingCreditReservation] No model name in reservation, using reserved amount:",
        {
          reservedAmount: reservation.reservedAmount,
        }
      );
    }
  }

  // Calculate difference between provisional and reserved amount
  const difference = provisionalCost - reservation.reservedAmount;

  console.log("[adjustRerankingCreditReservation] Adjusting credits:", {
    workspaceId,
    reservationId,
    reservedAmount: reservation.reservedAmount,
    provisionalCostUsd,
    provisionalCost,
    difference,
    generationId,
  });

  // Get current workspace for logging
  const workspacePk = `workspaces/${workspaceId}`;
  const workspace = await db.workspace.get(workspacePk, "workspace");
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  // Negative amount = debit (deduct from workspace), positive amount = credit (add to workspace)
  // If difference > 0, we need to charge more (debit = negative)
  // If difference < 0, we need to refund (credit = positive)
  const transactionAmount = difference === 0 ? 0 : -difference;

  // Format costs for description
  const provisionalCostFormatted = formatCurrencyNanoDollars(provisionalCost);
  const reservedAmountFormatted = formatCurrencyNanoDollars(
    reservation.reservedAmount
  );
  const differenceFormatted = formatCurrencyNanoDollars(Math.abs(difference));
  const action =
    difference > 0
      ? "additional charge"
      : difference < 0
      ? "refund"
      : "no adjustment";

  // Create transaction for the difference
  context.addWorkspaceCreditTransaction({
    workspaceId,
    agentId: agentId || undefined,
    conversationId: conversationId || undefined,
    source: "tool-execution",
    supplier: "openrouter",
    tool_call: "rerank",
    description: `Re-ranking API call: provisional cost ${provisionalCostFormatted}, reserved ${reservedAmountFormatted}, ${action} ${differenceFormatted}`,
    amountNanoUsd: transactionAmount,
  });

  // Store generationId in reservation for Step 3 (async verification)
  if (generationId) {
    await db["credit-reservations"].atomicUpdate(
      reservationPk,
      undefined,
      async (current) => {
        if (!current) {
          throw new Error(`Reservation ${reservationId} not found`);
        }
        return {
          ...current,
          openrouterGenerationId: generationId,
          provisionalCost: provisionalCost,
        };
      }
    );
    console.log(
      "[adjustRerankingCreditReservation] Stored generationId in reservation:",
      {
        reservationId,
        generationId,
        provisionalCost,
      }
    );
  }

  console.log(
    "[adjustRerankingCreditReservation] Successfully created transaction:",
    {
      workspaceId,
      reservationId,
      transactionAmount,
      generationId,
      note: generationId
        ? "Reservation kept for Step 3 (async verification)"
        : "No generationId, skipping Step 3",
    }
  );
}

/**
 * Queue async cost verification for re-ranking (Step 3: Final)
 * @param reservationId - Reservation ID
 * @param generationId - Generation ID from OpenRouter API response
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID (optional, for conversation updates)
 * @param conversationId - Conversation ID (optional, for conversation updates)
 */
export async function queueRerankingCostVerification(
  reservationId: string,
  generationId: string,
  workspaceId: string,
  agentId?: string,
  conversationId?: string
): Promise<void> {
  // Skip if BYOK
  if (reservationId === "byok") {
    console.log(
      "[queueRerankingCostVerification] BYOK request, skipping cost verification",
      { workspaceId }
    );
    return;
  }

  try {
    // Reuse existing enqueueCostVerification function
    await enqueueCostVerification(
      generationId,
      workspaceId,
      reservationId,
      conversationId,
      agentId
    );

    console.log(
      "[queueRerankingCostVerification] Successfully queued cost verification:",
      {
        reservationId,
        generationId,
        workspaceId,
        agentId,
        conversationId,
      }
    );
  } catch (error) {
    // Log error but don't fail the request
    console.error(
      "[queueRerankingCostVerification] Failed to queue cost verification:",
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        reservationId,
        generationId,
        workspaceId,
      }
    );
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "knowledge-reranking-credits",
        operation: "queue-cost-verification",
      },
    });
    // Don't throw - cost verification is best-effort
  }
}

/**
 * Refund reserved credits (e.g., when re-ranking API call fails)
 * @param db - Database instance
 * @param reservationId - Reservation ID
 * @param workspaceId - Workspace ID
 * @param context - Augmented Lambda context for transaction creation (required)
 * @param maxRetries - Maximum number of retries (default: 3, not used for transactions)
 * @param agentId - Agent ID (optional, for transaction tracking)
 * @param conversationId - Conversation ID (optional, for transaction tracking)
 */
export async function refundRerankingCredits(
  db: DatabaseSchema,
  reservationId: string,
  workspaceId: string,
  context: AugmentedContext,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _maxRetries: number = 3, // Not used - transactions don't require retries, kept for API consistency
  agentId?: string,
  conversationId?: string
): Promise<void> {
  // Handle BYOK case
  if (reservationId === "byok") {
    console.log("[refundRerankingCredits] BYOK request, skipping refund", {
      workspaceId,
    });
    return;
  }

  // Get reservation to find reserved amount
  const reservationPk = `credit-reservations/${reservationId}`;
  const reservation = await db["credit-reservations"].get(reservationPk);

  if (!reservation) {
    console.warn(
      "[refundRerankingCredits] Reservation not found, assuming already processed:",
      { reservationId, workspaceId }
    );

    // Report data inconsistency to Sentry (could indicate double-refund or race condition)
    Sentry.captureException(
      new Error("Re-ranking credit reservation not found during refund"),
      {
        tags: {
          context: "knowledge-reranking-credits",
          operation: "refund-reservation-not-found",
        },
        extra: {
          reservationId,
          workspaceId,
          agentId,
          conversationId,
        },
        level: "warning",
      }
    );
    return;
  }

  const reservedAmount = reservation.reservedAmount;

  console.log("[refundRerankingCredits] Refunding credits:", {
    workspaceId,
    reservationId,
    reservedAmount,
  });

  // Get current workspace for logging
  const workspacePk = `workspaces/${workspaceId}`;
  const workspace = await db.workspace.get(workspacePk, "workspace");
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  // Positive amount = credit (adding back to workspace)
  const transactionAmount = reservedAmount;

  console.log(
    "[refundRerankingCredits] Creating credit transaction (will commit at end of request):",
    {
      workspaceId,
      reservationId,
      refundAmount: reservedAmount,
      transactionAmount,
    }
  );

  // Create transaction in memory
  context.addWorkspaceCreditTransaction({
    workspaceId,
    agentId: agentId || undefined,
    conversationId: conversationId || undefined,
    source: "tool-execution",
    supplier: "openrouter",
    tool_call: "rerank",
    description: `Re-ranking API call refund (error occurred)`,
    amountNanoUsd: transactionAmount, // Positive for credit/refund
  });

  // Delete the reservation
  await db["credit-reservations"].delete(reservationPk);

  console.log(
    "[refundRerankingCredits] Successfully created refund transaction:",
    {
      workspaceId,
      reservationId,
    }
  );
}
