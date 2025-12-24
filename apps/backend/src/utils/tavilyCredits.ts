/**
 * Credit management utilities for Tavily API calls
 * Handles credit reservation and adjustment based on actual usage from Tavily API
 */

import type { DatabaseSchema } from "../tables/schema";

import type { CreditReservation } from "./creditManagement";
import { reserveCredits } from "./creditManagement";

// Tavily pricing: $0.008 per API call = 8,000 millionths (1 credit = 1 call)
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
 * @returns Credit reservation info
 */
export async function reserveTavilyCredits(
  db: DatabaseSchema,
  workspaceId: string,
  estimatedCredits: number = 1,
  maxRetries: number = 3
): Promise<CreditReservation> {
  const estimatedCost = calculateTavilyCost(estimatedCredits);
  console.log("[reserveTavilyCredits] Reserving credits:", {
    workspaceId,
    estimatedCredits,
    estimatedCost,
  });

  return await reserveCredits(db, workspaceId, estimatedCost, maxRetries, false);
}

/**
 * Adjust credit reservation based on actual credits used from Tavily API response
 * @param db - Database instance
 * @param reservationId - Reservation ID
 * @param workspaceId - Workspace ID
 * @param actualCreditsUsed - Actual credits consumed from Tavily API response
 * @param maxRetries - Maximum number of retries (default: 3)
 * @returns Updated workspace record
 */
export async function adjustTavilyCreditReservation(
  db: DatabaseSchema,
  reservationId: string,
  workspaceId: string,
  actualCreditsUsed: number,
  maxRetries: number = 3
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

  const workspacePk = `workspaces/${workspaceId}`;

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
  });

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
        const newBalance = current.creditBalance - difference;

        console.log(
          "[adjustTavilyCreditReservation] Adjusting workspace balance:",
          {
            workspaceId,
            oldBalance: current.creditBalance,
            newBalance,
            difference,
            currency: current.currency,
          }
        );

        return {
          pk: workspacePk,
          creditBalance: newBalance,
        };
      },
      { maxRetries }
    );

    // Update reservation with actual cost
    await db["credit-reservations"].update({
      ...reservation,
      // Store actual cost for reference (we don't have a specific field for Tavily, but we can use existing fields)
      // For now, just update the reservation to mark it as adjusted
    });

    console.log("[adjustTavilyCreditReservation] Successfully adjusted credits:", {
      workspaceId,
      reservationId,
      newBalance: updated.creditBalance,
    });
  } catch (error) {
    console.error("[adjustTavilyCreditReservation] Error adjusting credits:", {
      workspaceId,
      reservationId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Refund reserved credits (e.g., when API call fails)
 * @param db - Database instance
 * @param reservationId - Reservation ID
 * @param workspaceId - Workspace ID
 * @param maxRetries - Maximum number of retries (default: 3)
 */
export async function refundTavilyCredits(
  db: DatabaseSchema,
  reservationId: string,
  workspaceId: string,
  maxRetries: number = 3
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

  const workspacePk = `workspaces/${workspaceId}`;
  const reservedAmount = reservation.reservedAmount;

  console.log("[refundTavilyCredits] Refunding credits:", {
    workspaceId,
    reservationId,
    reservedAmount,
  });

  try {
    const updated = await db.workspace.atomicUpdate(
      workspacePk,
      "workspace",
      async (current) => {
        if (!current) {
          throw new Error(`Workspace ${workspaceId} not found`);
        }

        // Refund the reserved amount
        const newBalance = current.creditBalance + reservedAmount;

        console.log("[refundTavilyCredits] Refunding workspace balance:", {
          workspaceId,
          oldBalance: current.creditBalance,
          newBalance,
          refundAmount: reservedAmount,
          currency: current.currency,
        });

        return {
          pk: workspacePk,
          creditBalance: newBalance,
        };
      },
      { maxRetries }
    );

    // Delete the reservation
    await db["credit-reservations"].delete(reservationPk);

    console.log("[refundTavilyCredits] Successfully refunded credits:", {
      workspaceId,
      reservationId,
      newBalance: updated.creditBalance,
    });
  } catch (error) {
    console.error("[refundTavilyCredits] Error refunding credits:", {
      workspaceId,
      reservationId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

