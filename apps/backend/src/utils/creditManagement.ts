import { randomUUID } from "crypto";

import { queues } from "@architect/functions";

import type { DatabaseSchema, WorkspaceRecord } from "../tables/schema";

import type { TokenUsage } from "./conversationLogger";
import { CreditDeductionError, InsufficientCreditsError } from "./creditErrors";
import { calculateTokenCost } from "./pricing";

/**
 * Send cost verification message to queue for OpenRouter cost lookup
 */
export async function enqueueCostVerification(
  reservationId: string,
  openrouterGenerationId: string,
  workspaceId: string,
  conversationId?: string,
  agentId?: string
): Promise<void> {
  try {
    const queue = queues;
    const queueName = "openrouter-cost-verification-queue";

    const message = {
      reservationId,
      openrouterGenerationId,
      workspaceId,
      ...(conversationId && { conversationId }),
      ...(agentId && { agentId }),
    };

    console.log("[enqueueCostVerification] Sending cost verification message:", {
      queueName,
      message,
    });

    await queue.publish({
      name: queueName,
      payload: message,
    });

    console.log("[enqueueCostVerification] Successfully enqueued cost verification:", {
      reservationId,
      openrouterGenerationId,
    });
  } catch (error) {
    // Log error but don't fail the request
    console.error(
      "[enqueueCostVerification] Failed to enqueue cost verification:",
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        reservationId,
        openrouterGenerationId,
        workspaceId,
      }
    );
    // Don't throw - cost verification is best-effort
  }
}

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
 * Calculate actual cost from token usage in USD
 * Includes reasoning tokens and cached tokens if present
 */
function calculateActualCost(
  provider: string,
  modelName: string,
  tokenUsage: TokenUsage
): number {
  const cost = calculateTokenCost(
    provider,
    modelName,
    tokenUsage.promptTokens || 0,
    tokenUsage.completionTokens || 0,
    tokenUsage.reasoningTokens || 0,
    tokenUsage.cachedPromptTokens || 0
  );

  // Validate cost is non-negative (pricing info may be wrong)
  // If negative, log warning and clamp to 0 to prevent incorrect deductions
  const validatedCost = cost < 0 ? 0 : cost;
  if (cost < 0) {
    console.warn("[calculateActualCost] Negative cost detected, clamping to 0:", {
      provider,
      modelName,
      originalCost: cost,
      promptTokens: tokenUsage.promptTokens || 0,
      cachedPromptTokens: tokenUsage.cachedPromptTokens || 0,
      completionTokens: tokenUsage.completionTokens || 0,
      reasoningTokens: tokenUsage.reasoningTokens || 0,
    });
  }

  console.log("[calculateActualCost] Cost calculation:", {
    provider,
    modelName,
    promptTokens: tokenUsage.promptTokens || 0,
    cachedPromptTokens: tokenUsage.cachedPromptTokens || 0,
    completionTokens: tokenUsage.completionTokens || 0,
    reasoningTokens: tokenUsage.reasoningTokens || 0,
    cost: validatedCost,
    originalCost: cost !== validatedCost ? cost : undefined,
  });

  return validatedCost;
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
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param usesByok - Whether request was made with user key (BYOK)
 * @returns Reservation info with reservationId, reservedAmount, and updated workspace
 * @throws InsufficientCreditsError if credit balance is insufficient
 */
export async function reserveCredits(
  db: DatabaseSchema,
  workspaceId: string,
  estimatedCost: number,
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

  // Validate estimated cost is non-negative (pricing info may be wrong)
  if (estimatedCost < 0) {
    console.warn("[reserveCredits] Negative estimated cost detected, clamping to 0:", {
      workspaceId,
      estimatedCost,
    });
    // Return workspace without creating reservation for zero cost
    const workspace = await db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    return {
      reservationId: "zero-cost",
      reservedAmount: 0,
      workspace,
    };
  }

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
            "usd"
          );
        }

        // Calculate new balance (all values in millionths, so simple subtraction)
        const newBalance = current.creditBalance - estimatedCost;

        console.log("[reserveCredits] Reserving credits:", {
          workspaceId,
          estimatedCost,
          oldBalance: current.creditBalance,
          newBalance,
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
      currency: updated.currency,
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
 * Adjust credit reservation based on actual cost (Step 2 of 3-step pricing)
 * Refunds difference if actual < reserved, or deducts additional if actual > reserved
 * Stores token usage-based cost and OpenRouter generation ID for final verification
 *
 * @param db - Database instance
 * @param reservationId - Reservation ID
 * @param workspaceId - Workspace ID
 * @param provider - LLM provider name
 * @param modelName - Model name
 * @param tokenUsage - Token usage from API response
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param usesByok - Whether request was made with user key (BYOK)
 * @param openrouterGenerationId - OpenRouter generation ID for cost verification (optional)
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
  usesByok?: boolean,
  openrouterGenerationId?: string
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

  // Calculate actual cost from token usage (always in USD) - Step 2
  const tokenUsageBasedCost = calculateActualCost(
    provider,
    modelName,
    tokenUsage
  );

  // Validate token usage cost is non-negative (pricing info may be wrong)
  // calculateActualCost already validates, but double-check for safety
  if (tokenUsageBasedCost < 0) {
    console.warn("[adjustCreditReservation] Negative token usage cost detected, clamping to 0:", {
      workspaceId,
      reservationId,
      provider,
      modelName,
      tokenUsageBasedCost,
    });
  }
  const validatedTokenUsageCost = tokenUsageBasedCost < 0 ? 0 : tokenUsageBasedCost;

  // Calculate difference between token usage cost and reserved amount
  const difference = validatedTokenUsageCost - reservation.reservedAmount;

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
        // All values in millionths, so simple subtraction
        const newBalance = current.creditBalance - difference;

        console.log("[adjustCreditReservation] Step 2: Adjusting credits based on token usage:", {
          workspaceId,
          reservationId,
          reservedAmount: reservation.reservedAmount,
          tokenUsageBasedCost: validatedTokenUsageCost,
          originalTokenUsageCost: tokenUsageBasedCost !== validatedTokenUsageCost ? tokenUsageBasedCost : undefined,
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

    // Update reservation record with token usage cost and OpenRouter generation ID
    // Don't delete yet - will be deleted in finalizeCreditReservation (step 3)
    if (openrouterGenerationId || provider === "openrouter") {
      await db["credit-reservations"].update({
        pk: reservationPk,
        tokenUsageBasedCost: validatedTokenUsageCost,
        openrouterGenerationId: openrouterGenerationId || reservation.openrouterGenerationId,
        provider: provider || reservation.provider,
        modelName: modelName || reservation.modelName,
      });
      console.log("[adjustCreditReservation] Updated reservation with generation ID for step 3:", {
        reservationId,
        openrouterGenerationId: openrouterGenerationId || reservation.openrouterGenerationId,
        tokenUsageBasedCost: validatedTokenUsageCost,
      });
    } else {
      // For non-OpenRouter providers, delete reservation after step 2 (no step 3 needed)
      await db["credit-reservations"].delete(reservationPk);
      console.log("[adjustCreditReservation] Successfully deleted reservation (non-OpenRouter):", {
        reservationId,
      });
    }

    console.log("[adjustCreditReservation] Step 2 completed successfully:", {
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

        // Refund the reserved amount (all values in millionths, so simple addition)
        const newBalance = current.creditBalance + reservation.reservedAmount;

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
    await db["credit-reservations"].delete(reservationPk);
    console.log("[refundReservation] Successfully deleted reservation:", {
      reservationId,
    });

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

        // Calculate actual cost from token usage (always in USD)
        const actualCost = calculateActualCost(
          provider,
          modelName,
          tokenUsage
        );

        // Validate actual cost is non-negative (pricing info may be wrong)
        // calculateActualCost already validates, but double-check for safety
        if (actualCost < 0) {
          console.warn("[debitCredits] Negative actual cost detected, clamping to 0:", {
            workspaceId,
            provider,
            modelName,
            actualCost,
          });
        }
        const validatedActualCost = actualCost < 0 ? 0 : actualCost;

        console.log("[debitCredits] Cost calculation:", {
          workspaceId,
          provider,
          modelName,
          promptTokens: tokenUsage.promptTokens || 0,
          cachedPromptTokens: tokenUsage.cachedPromptTokens || 0,
          completionTokens: tokenUsage.completionTokens || 0,
          reasoningTokens: tokenUsage.reasoningTokens || 0,
          currency: current.currency,
          actualCost: validatedActualCost,
          originalActualCost: actualCost !== validatedActualCost ? actualCost : undefined,
          oldBalance: current.creditBalance,
        });

        // Update credit balance (negative balances are allowed)
        // All values in millionths, so simple subtraction
        const newBalance = current.creditBalance - validatedActualCost;

        console.log("[debitCredits] Deducting credits:", {
          workspaceId,
          actualCost: validatedActualCost,
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
 * Finalize credit reservation based on OpenRouter API cost (Step 3 of 3-step pricing)
 * Makes final adjustment between OpenRouter cost and token usage-based cost
 * Deletes reservation record after finalization
 *
 * @param db - Database instance
 * @param reservationId - Reservation ID
 * @param openrouterCost - Cost from OpenRouter API in millionths
 * @param maxRetries - Maximum number of retries (default: 3)
 * @returns Updated workspace record
 */
export async function finalizeCreditReservation(
  db: DatabaseSchema,
  reservationId: string,
  openrouterCost: number,
  maxRetries: number = 3
): Promise<WorkspaceRecord> {
  // Get reservation to find token usage-based cost
  const reservationPk = `credit-reservations/${reservationId}`;
  const reservation = await db["credit-reservations"].get(reservationPk);

  if (!reservation) {
    console.warn(
      "[finalizeCreditReservation] Reservation not found, assuming already processed:",
      { reservationId }
    );
    // Reservation might have been cleaned up, throw error
    throw new Error(`Reservation ${reservationId} not found`);
  }

  const workspaceId = reservation.workspaceId;
  const workspacePk = `workspaces/${workspaceId}`;

  // Validate OpenRouter cost is non-negative (pricing info may be wrong)
  if (openrouterCost < 0) {
    console.warn("[finalizeCreditReservation] Negative OpenRouter cost detected, clamping to 0:", {
      reservationId,
      workspaceId,
      openrouterCost,
    });
  }
  const validatedOpenrouterCost = openrouterCost < 0 ? 0 : openrouterCost;

  // Get token usage-based cost from reservation (step 2)
  const tokenUsageBasedCost = reservation.tokenUsageBasedCost;
  if (tokenUsageBasedCost === undefined) {
    console.warn(
      "[finalizeCreditReservation] Token usage-based cost not found, using OpenRouter cost directly:",
      { reservationId, workspaceId, openrouterCost: validatedOpenrouterCost }
    );
    // If token usage cost is missing, just use OpenRouter cost
    // This shouldn't happen, but handle gracefully
    const updated = await db.workspace.atomicUpdate(
      workspacePk,
      "workspace",
      async (current) => {
        if (!current) {
          throw new Error(`Workspace ${workspaceId} not found`);
        }
        // Adjust based on OpenRouter cost vs reserved amount
        const difference = validatedOpenrouterCost - reservation.reservedAmount;
        const newBalance = current.creditBalance - difference;
        return {
          pk: workspacePk,
          sk: "workspace",
          creditBalance: newBalance,
        };
      },
      { maxRetries }
    );
    await db["credit-reservations"].delete(reservationPk);
    return updated;
  }

  // Calculate difference between OpenRouter cost and token usage-based cost
  const difference = validatedOpenrouterCost - tokenUsageBasedCost;

  try {
    const updated = await db.workspace.atomicUpdate(
      workspacePk,
      "workspace",
      async (current) => {
        if (!current) {
          throw new Error(`Workspace ${workspaceId} not found`);
        }

        // Adjust balance based on difference between OpenRouter cost and token usage cost
        // If OpenRouter > token usage, deduct more (difference is positive)
        // If OpenRouter < token usage, refund difference (difference is negative)
        // All values in millionths, so simple subtraction
        const newBalance = current.creditBalance - difference;

        console.log("[finalizeCreditReservation] Step 3: Final adjustment based on OpenRouter cost:", {
          workspaceId,
          reservationId,
          tokenUsageBasedCost,
          openrouterCost: validatedOpenrouterCost,
          originalOpenrouterCost: openrouterCost !== validatedOpenrouterCost ? openrouterCost : undefined,
          difference,
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

    // Update reservation with OpenRouter cost for tracking, then delete
    await db["credit-reservations"].update({
      pk: reservationPk,
      openrouterCost: validatedOpenrouterCost,
    });

    // Delete reservation record
    await db["credit-reservations"].delete(reservationPk);
    console.log("[finalizeCreditReservation] Successfully deleted reservation:", {
      reservationId,
    });

    console.log("[finalizeCreditReservation] Step 3 completed successfully:", {
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
        `Failed to finalize credit reservation after ${maxRetries} retries: ${lastError.message}`
      );
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

      // Update credit balance (all values in millionths, so simple addition)
      const newBalance = current.creditBalance + amount;

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
