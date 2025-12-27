import type { ScheduledEvent , Context } from "aws-lambda";


import { database } from "../../tables";
import type { CreditReservationRecord } from "../../tables/schema";
import { refundReservation } from "../../utils/creditManagement";
import { handlingScheduledErrors } from "../../utils/handlingErrors";
import type { AugmentedContext } from "../../utils/workspaceCreditContext";

/**
 * Cleanup expired credit reservations
 * Queries for reservations where TTL has expired but record still exists
 * Refunds each reservation to the workspace
 *
 * Uses GSI on expiresHour to efficiently query expired reservations.
 * This handles cases where Lambda timeouts prevent normal cleanup.
 */
export async function cleanupExpiredReservations(
  context?: AugmentedContext
): Promise<void> {
  const db = await database();
  const now = Math.floor(Date.now() / 1000); // Current time in seconds

  console.log(
    "[Cleanup Expired Reservations] Starting cleanup, current timestamp:",
    now
  );

  try {
    // Query expired reservations using GSI on expiresHour
    // We query for reservations in the current hour and previous hour (to catch any that just expired)
    // Then filter for those where expires < now
    const allExpiredReservations: CreditReservationRecord[] = [];

    // Calculate hour buckets to query (current hour and previous hour)
    // This ensures we catch reservations that expired in the last hour
    const currentHour = Math.floor(now / 3600) * 3600;
    const previousHour = currentHour - 3600;
    const hourBuckets = [previousHour, currentHour];

    console.log(
      "[Cleanup Expired Reservations] Querying hour buckets:",
      hourBuckets.map((h) => new Date(h * 1000).toISOString())
    );

    // Query each hour bucket
    for (const hourBucket of hourBuckets) {
      try {
        console.log(
          `[Cleanup Expired Reservations] Querying hour bucket ${new Date(
            hourBucket * 1000
          ).toISOString()}...`
        );

        // Query GSI by expiresHour (partition key) and expires < now (sort key)
        // This is more efficient than using FilterExpression
        const queryResult = await db["credit-reservations"].query({
          IndexName: "byExpiresHour",
          KeyConditionExpression:
            "expiresHour = :hourBucket AND expires < :now",
          ExpressionAttributeValues: {
            ":hourBucket": hourBucket,
            ":now": now,
          },
        });

        // All items from query are already expired (filtered by KeyConditionExpression)
        // But we still filter to ensure type safety and handle any edge cases
        const expired = queryResult.items.filter(
          (r): r is CreditReservationRecord =>
            r !== undefined && r.expires !== undefined && r.expires < now
        );

        allExpiredReservations.push(...expired);

        console.log(
          `[Cleanup Expired Reservations] Found ${
            expired.length
          } expired reservations in hour bucket ${new Date(
            hourBucket * 1000
          ).toISOString()}`
        );

        // Safety limit: don't process more than 1000 reservations per run
        if (allExpiredReservations.length >= 1000) {
          console.warn(
            "[Cleanup Expired Reservations] Reached safety limit of 1000 reservations, stopping queries"
          );
          break;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[Cleanup Expired Reservations] Error querying hour bucket ${hourBucket}:`,
          { error: errorMessage }
        );
        // Continue with next hour bucket - don't fail entire cleanup
      }
    }

    console.log(
      `[Cleanup Expired Reservations] Total expired reservations to process: ${allExpiredReservations.length}`
    );

    if (allExpiredReservations.length === 0) {
      console.log(
        "[Cleanup Expired Reservations] No expired reservations found, cleanup complete"
      );
      return;
    }

    // Process each expired reservation
    let refundedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const reservation of allExpiredReservations) {
      try {
        // Extract reservation ID from pk (format: "credit-reservations/{reservationId}")
        const reservationId = reservation.pk.replace(
          "credit-reservations/",
          ""
        );

        // Skip BYOK reservations (they don't need refunding)
        if (reservationId === "byok") {
          skippedCount++;
          console.log(
            "[Cleanup Expired Reservations] Skipping BYOK reservation:",
            { reservationId }
          );
          // Delete the BYOK reservation record
          try {
            await db["credit-reservations"].delete(reservation.pk);
          } catch (deleteError) {
            console.warn(
              "[Cleanup Expired Reservations] Error deleting BYOK reservation:",
              deleteError
            );
          }
          continue;
        }

        console.log(
          "[Cleanup Expired Reservations] Refunding expired reservation:",
          {
            reservationId,
            workspaceId: reservation.workspaceId,
            reservedAmount: reservation.reservedAmount,
            expires: reservation.expires,
            expiredBy: now - (reservation.expires || 0),
          }
        );

        if (!context) {
          throw new Error("Context not available for workspace credit transactions");
        }
        await refundReservation(db, reservationId, context);

        refundedCount++;
        console.log(
          "[Cleanup Expired Reservations] Successfully refunded reservation:",
          {
            reservationId,
            workspaceId: reservation.workspaceId,
          }
        );
      } catch (error) {
        errorCount++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error(
          "[Cleanup Expired Reservations] Error refunding reservation:",
          {
            reservationId: reservation.pk.replace("credit-reservations/", ""),
            workspaceId: reservation.workspaceId,
            error: errorMessage,
            stack: errorStack,
          }
        );
        // Continue with other reservations - don't fail the entire cleanup
      }
    }

    console.log(
      `[Cleanup Expired Reservations] Cleanup complete. Refunded: ${refundedCount}, Errors: ${errorCount}, Skipped: ${skippedCount}`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(
      "[Cleanup Expired Reservations] Fatal error during cleanup:",
      {
        error: errorMessage,
        stack: errorStack,
      }
    );
    throw error;
  }
}

/**
 * Lambda handler for scheduled cleanup
 */
export const handler = handlingScheduledErrors(
  async (event: ScheduledEvent, context?: AugmentedContext): Promise<void> => {
    console.log(
      "[Cleanup Expired Reservations] Scheduled event received:",
      event
    );
    await cleanupExpiredReservations(context);
  }
);
