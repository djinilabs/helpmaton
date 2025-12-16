import { randomUUID } from "crypto";

import type { DatabaseSchema, WorkspaceRecord } from "../tables/schema";

import type { TokenUsage } from "./conversationLogger";
import { CreditDeductionError, InsufficientCreditsError } from "./creditErrors";
import { calculateTokenCost } from "./pricing";
import type { Currency } from "./pricing";

/**
 * Calculate TTL timestamp (15 minutes from now in seconds)
 * Used for credit reservation expiration
 */
function calculateReservationTTL(): number {
  return Math.floor(Date.now() / 1000) + 15 * 60; // 15 minutes
}

/**
 * Calculate hour bucket for GSI (hour timestamp in seconds, truncated to hour)
 * Used to efficiently query reservations by expiration hour
 */
function calculateExpiresHourBucket(expires: number): number {
  // Truncate to hour: divide by 3600, floor, multiply by 3600
  return Math.floor(expires / 3600) * 3600;
}

/**
 * Calculate actual cost from token usage in workspace currency
 * Includes reasoning tokens and cached tokens if present
 */
function calculateActualCost(
  provider: string,
  modelName: string,
  tokenUsage: TokenUsage,
  currency: Currency
): number {
  const cost = calculateTokenCost(
    provider,
    modelName,
    tokenUsage.promptTokens || 0,
    tokenUsage.completionTokens || 0,
    currency,
    tokenUsage.reasoningTokens || 0,
    tokenUsage.cachedPromptTokens || 0
  );

  console.log("[calculateActualCost] Cost calculation:", {
    provider,
    modelName,
    currency,
    promptTokens: tokenUsage.promptTokens || 0,
    cachedPromptTokens: tokenUsage.cachedPromptTokens || 0,
    completionTokens: tokenUsage.completionTokens || 0,
    reasoningTokens: tokenUsage.reasoningTokens || 0,
    cost,
  });

  return cost;
}

export interface CreditReservation {
  reservationId: string;
  reservedAmount: number;
  workspace: WorkspaceRecord;
}

/**
 * Atomically reserve credits before LLM call
 * Deducts estimated cost immediately and creates reservation record with TTL
 *
 * @param db - Database instance
 * @param workspaceId - Workspace ID
 * @param estimatedCost - Estimated cost for the LLM call
 * @param currency - Workspace currency
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param usesByok - Whether request was made with user key (BYOK)
 * @returns Reservation info with reservationId, reservedAmount, and updated workspace
 * @throws InsufficientCreditsError if credit balance is insufficient
 */
export async function reserveCredits(
  db: DatabaseSchema,
  workspaceId: string,
  estimatedCost: number,
  currency: Currency,
  maxRetries: number = 3,
  usesByok?: boolean
): Promise<CreditReservation> {
  // Skip reservation if request was made with user key (BYOK)
  if (usesByok) {
    console.log(
      "[reserveCredits] Request made with user key (BYOK), skipping credit reservation",
      { workspaceId, estimatedCost }
    );
    // Return workspace record without creating reservation
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    // Return a dummy reservation ID for BYOK (won't be used)
    return {
      reservationId: "byok",
      reservedAmount: 0,
      workspace,
    };
  }

  const workspacePk = `workspaces/${workspaceId}`;

  try {
    // Atomically reserve credits by deducting estimated cost
    const updated = await db.workspace.atomicUpdate(
      workspacePk,
      "workspace",
      async (current) => {
        if (!current) {
          throw new Error(`Workspace ${workspaceId} not found`);
        }

        // Check if balance is sufficient
        if (current.creditBalance < estimatedCost) {
          throw new InsufficientCreditsError(
            workspaceId,
            estimatedCost,
            current.creditBalance,
            current.currency
          );
        }

        // Round to 6 decimal places to avoid floating point precision issues
        const newBalance =
          Math.round((current.creditBalance - estimatedCost) * 1_000_000) /
          1_000_000;

        console.log("[reserveCredits] Reserving credits:", {
          workspaceId,
          estimatedCost,
          oldBalance: current.creditBalance,
          newBalance,
          currency: current.currency,
        });

        return {
          pk: workspacePk,
          sk: "workspace",
          creditBalance: newBalance,
        };
      },
      { maxRetries }
    );

    // Create reservation record with TTL
    const reservationId = randomUUID();
    const reservationPk = `credit-reservations/${reservationId}`;
    const expires = calculateReservationTTL();
    const expiresHour = calculateExpiresHourBucket(expires);

    await db["credit-reservations"].create({
      pk: reservationPk,
      workspaceId,
      reservedAmount: estimatedCost,
      estimatedCost,
      currency,
      expires,
      expiresHour, // For GSI querying
    });

    console.log("[reserveCredits] Successfully reserved credits:", {
      workspaceId,
      reservationId,
      reservedAmount: estimatedCost,
      newBalance: updated.creditBalance,
      currency: updated.currency,
      expires,
    });

    return {
      reservationId,
      reservedAmount: estimatedCost,
      workspace: updated,
    };
  } catch (error) {
    // If it's an InsufficientCreditsError, rethrow it
    if (error instanceof InsufficientCreditsError) {
      throw error;
    }

    const lastError = error instanceof Error ? error : new Error(String(error));

    // Check if it's a version conflict error
    if (
      error instanceof Error &&
      (error.message.toLowerCase().includes("item was outdated") ||
        error.message.toLowerCase().includes("conditional request failed") ||
        error.message.toLowerCase().includes("failed to atomically update"))
    ) {
      throw new Error(
        `Failed to reserve credits after ${maxRetries} retries: ${lastError.message}`
      );
    }

    // If it's not a version conflict, rethrow immediately
    throw lastError;
  }
}

/**
 * Adjust credit reservation based on actual cost
 * Refunds difference if actual < reserved, or deducts additional if actual > reserved
 *
 * @param db - Database instance
 * @param reservationId - Reservation ID
 * @param workspaceId - Workspace ID
 * @param provider - LLM provider name
 * @param modelName - Model name
 * @param tokenUsage - Token usage from API response
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param usesByok - Whether request was made with user key (BYOK)
 * @returns Updated workspace record
 */
export async function adjustCreditReservation(
  db: DatabaseSchema,
  reservationId: string,
  workspaceId: string,
  provider: string,
  modelName: string,
  tokenUsage: TokenUsage,
  maxRetries: number = 3,
  usesByok?: boolean
): Promise<WorkspaceRecord> {
  // Skip adjustment if request was made with user key (BYOK)
  if (usesByok || reservationId === "byok") {
    console.log(
      "[adjustCreditReservation] Request made with user key (BYOK), skipping adjustment",
      { workspaceId, reservationId }
    );
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return workspace;
  }

  // Get reservation to find reserved amount
  const reservationPk = `credit-reservations/${reservationId}`;
  const reservation = await db["credit-reservations"].get(reservationPk);

  if (!reservation) {
    console.warn(
      "[adjustCreditReservation] Reservation not found, assuming already processed:",
      { reservationId, workspaceId }
    );
    // Reservation might have been cleaned up, just return workspace
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return workspace;
  }

  const workspacePk = `workspaces/${workspaceId}`;

  // Calculate actual cost
  const actualCost = calculateActualCost(
    provider,
    modelName,
    tokenUsage,
    reservation.currency
  );

  // Calculate difference
  const difference = actualCost - reservation.reservedAmount;

  try {
    const updated = await db.workspace.atomicUpdate(
      workspacePk,
      "workspace",
      async (current) => {
        if (!current) {
          throw new Error(`Workspace ${workspaceId} not found`);
        }

        // Adjust balance based on difference
        // If actual > reserved, deduct more (difference is positive)
        // If actual < reserved, refund difference (difference is negative, so we add it back)
        const newBalance =
          Math.round((current.creditBalance - difference) * 1_000_000) /
          1_000_000;

        console.log("[adjustCreditReservation] Adjusting credits:", {
          workspaceId,
          reservationId,
          reservedAmount: reservation.reservedAmount,
          actualCost,
          difference,
          oldBalance: current.creditBalance,
          newBalance,
          currency: current.currency,
          tokenUsage: {
            promptTokens: tokenUsage.promptTokens || 0,
            cachedPromptTokens: tokenUsage.cachedPromptTokens || 0,
            completionTokens: tokenUsage.completionTokens || 0,
            reasoningTokens: tokenUsage.reasoningTokens || 0,
          },
        });

        return {
          pk: workspacePk,
          sk: "workspace",
          creditBalance: newBalance,
        };
      },
      { maxRetries }
    );

    // Delete reservation record
    try {
      await db["credit-reservations"].delete(reservationPk);
      console.log(
        "[adjustCreditReservation] Successfully deleted reservation:",
        { reservationId }
      );
    } catch (deleteError) {
      // Log but don't fail - reservation might have expired
      console.warn(
        "[adjustCreditReservation] Error deleting reservation (may have expired):",
        {
          reservationId,
          error:
            deleteError instanceof Error
              ? deleteError.message
              : String(deleteError),
        }
      );
    }

    console.log("[adjustCreditReservation] Successfully adjusted credits:", {
      workspaceId,
      reservationId,
      newBalance: updated.creditBalance,
      currency: updated.currency,
    });

    return updated;
  } catch (error) {
    const lastError = error instanceof Error ? error : new Error(String(error));

    // Check if it's a version conflict error
    if (
      error instanceof Error &&
      (error.message.toLowerCase().includes("item was outdated") ||
        error.message.toLowerCase().includes("conditional request failed") ||
        error.message.toLowerCase().includes("failed to atomically update"))
    ) {
      throw new Error(
        `Failed to adjust credit reservation after ${maxRetries} retries: ${lastError.message}`
      );
    }

    // If it's not a version conflict, rethrow immediately
    throw lastError;
  }
}

/**
 * Refund reserved credits (used when error occurs before LLM call)
 *
 * @param db - Database instance
 * @param reservationId - Reservation ID
 * @param maxRetries - Maximum number of retries (default: 3)
 */
export async function refundReservation(
  db: DatabaseSchema,
  reservationId: string,
  maxRetries: number = 3
): Promise<void> {
  // Skip if BYOK reservation
  if (reservationId === "byok") {
    console.log("[refundReservation] BYOK reservation, skipping refund", {
      reservationId,
    });
    return;
  }

  const reservationPk = `credit-reservations/${reservationId}`;
  const reservation = await db["credit-reservations"].get(reservationPk);

  if (!reservation) {
    console.warn(
      "[refundReservation] Reservation not found, may have already been processed:",
      { reservationId }
    );
    return;
  }

  const workspacePk = `workspaces/${reservation.workspaceId}`;

  try {
    // Refund the reserved amount
    const updated = await db.workspace.atomicUpdate(
      workspacePk,
      "workspace",
      async (current) => {
        if (!current) {
          throw new Error(`Workspace ${reservation.workspaceId} not found`);
        }

        // Refund the reserved amount
        const newBalance =
          Math.round(
            (current.creditBalance + reservation.reservedAmount) * 1_000_000
          ) / 1_000_000;

        console.log("[refundReservation] Refunding credits:", {
          workspaceId: reservation.workspaceId,
          reservationId,
          refundAmount: reservation.reservedAmount,
          oldBalance: current.creditBalance,
          newBalance,
          currency: reservation.currency,
        });

        return {
          pk: workspacePk,
          sk: "workspace",
          creditBalance: newBalance,
        };
      },
      { maxRetries }
    );

    // Delete reservation record
    try {
      await db["credit-reservations"].delete(reservationPk);
      console.log("[refundReservation] Successfully deleted reservation:", {
        reservationId,
      });
    } catch (deleteError) {
      // Log but don't fail
      console.warn("[refundReservation] Error deleting reservation:", {
        reservationId,
        error:
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError),
      });
    }

    console.log("[refundReservation] Successfully refunded credits:", {
      workspaceId: reservation.workspaceId,
      reservationId,
      newBalance: updated.creditBalance,
      currency: updated.currency,
    });
  } catch (error) {
    const lastError = error instanceof Error ? error : new Error(String(error));

    // Check if it's a version conflict error
    if (
      error instanceof Error &&
      (error.message.toLowerCase().includes("item was outdated") ||
        error.message.toLowerCase().includes("conditional request failed") ||
        error.message.toLowerCase().includes("failed to atomically update"))
    ) {
      throw new Error(
        `Failed to refund reservation after ${maxRetries} retries: ${lastError.message}`
      );
    }

    // If it's not a version conflict, rethrow immediately
    throw lastError;
  }
}

/**
 * Atomically deduct credits after successful LLM call
 * Uses atomicUpdate API with automatic retry on version conflicts
 *
 * @param db - Database instance
 * @param workspaceId - Workspace ID
 * @param provider - LLM provider name
 * @param modelName - Model name
 * @param tokenUsage - Token usage from API response
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param usesByok - Whether request was made with user key (BYOK)
 * @returns Updated workspace record
 * @throws CreditDeductionError if deduction fails after retries
 */
export async function debitCredits(
  db: DatabaseSchema,
  workspaceId: string,
  provider: string,
  modelName: string,
  tokenUsage: TokenUsage,
  maxRetries: number = 3,
  usesByok?: boolean
): Promise<WorkspaceRecord> {
  // Skip deduction if request was made with user key (BYOK)
  if (usesByok) {
    console.log(
      "[debitCredits] Request made with user key (BYOK), skipping credit deduction",
      { workspaceId, provider, modelName }
    );
    // Return workspace record without updating
    const workspacePk = `workspaces/${workspaceId}`;
    const workspace = await db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return workspace;
  }

  const workspacePk = `workspaces/${workspaceId}`;

  try {
    const updated = await db.workspace.atomicUpdate(
      workspacePk,
      "workspace",
      async (current) => {
        if (!current) {
          throw new Error(`Workspace ${workspaceId} not found`);
        }

        // Calculate actual cost from token usage in workspace currency
        const actualCost = calculateActualCost(
          provider,
          modelName,
          tokenUsage,
          current.currency
        );

        console.log("[debitCredits] Cost calculation:", {
          workspaceId,
          provider,
          modelName,
          promptTokens: tokenUsage.promptTokens || 0,
          cachedPromptTokens: tokenUsage.cachedPromptTokens || 0,
          completionTokens: tokenUsage.completionTokens || 0,
          reasoningTokens: tokenUsage.reasoningTokens || 0,
          currency: current.currency,
          actualCost,
          oldBalance: current.creditBalance,
        });

        // Update credit balance (negative balances are allowed)
        // Round to 6 decimal places to avoid floating point precision issues
        const newBalance =
          Math.round((current.creditBalance - actualCost) * 1_000_000) /
          1_000_000;

        console.log("[debitCredits] Deducting credits:", {
          workspaceId,
          actualCost,
          oldBalance: current.creditBalance,
          newBalance,
          currency: current.currency,
        });

        return {
          pk: workspacePk,
          sk: "workspace",
          creditBalance: newBalance,
        };
      },
      { maxRetries }
    );

    console.log("[debitCredits] Successfully deducted credits:", {
      workspaceId,
      newBalance: updated.creditBalance,
      currency: updated.currency,
    });

    return updated;
  } catch (error) {
    const lastError = error instanceof Error ? error : new Error(String(error));

    // Check if it's a version conflict error (shouldn't happen with atomicUpdate, but handle gracefully)
    if (
      error instanceof Error &&
      (error.message.toLowerCase().includes("item was outdated") ||
        error.message.toLowerCase().includes("conditional request failed") ||
        error.message.toLowerCase().includes("failed to atomically update"))
    ) {
      throw new CreditDeductionError(workspaceId, maxRetries, lastError);
    }

    // If it's not a version conflict, rethrow immediately
    throw lastError;
  }
}

/**
 * Add credits to workspace (for future subscription/refund use)
 * Uses atomicUpdate API with automatic retry on version conflicts
 *
 * @param db - Database instance
 * @param workspaceId - Workspace ID
 * @param amount - Amount to add
 * @param maxRetries - Maximum number of retries (default: 3)
 * @returns Updated workspace record
 * @throws Error if operation fails after retries
 */
export async function creditCredits(
  db: DatabaseSchema,
  workspaceId: string,
  amount: number,
  maxRetries: number = 3
): Promise<WorkspaceRecord> {
  const workspacePk = `workspaces/${workspaceId}`;

  const updated = await db.workspace.atomicUpdate(
    workspacePk,
    "workspace",
    async (current) => {
      if (!current) {
        throw new Error(`Workspace ${workspaceId} not found`);
      }

      // Update credit balance
      // Round to 6 decimal places to avoid floating point precision issues
      const newBalance =
        Math.round((current.creditBalance + amount) * 1_000_000) / 1_000_000;

      console.log("[creditCredits] Adding credits:", {
        workspaceId,
        amount,
        oldBalance: current.creditBalance,
        newBalance,
        currency: current.currency,
      });

      return {
        pk: workspacePk,
        sk: "workspace",
        creditBalance: newBalance,
      };
    },
    { maxRetries }
  );

  console.log("[creditCredits] Successfully added credits:", {
    workspaceId,
    amount,
    newBalance: updated.creditBalance,
    currency: updated.currency,
  });

  return updated;
}
