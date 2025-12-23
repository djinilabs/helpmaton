import type { SQSEvent, SQSRecord } from "aws-lambda";
import { z } from "zod";

import { database } from "../../tables";
import { getDefined } from "../../utils";
import { finalizeCreditReservation } from "../../utils/creditManagement";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";

/**
 * Message schema for cost verification queue
 */
const CostVerificationMessageSchema = z.object({
  reservationId: z.string(),
  openrouterGenerationId: z.string(),
  workspaceId: z.string(),
});

type CostVerificationMessage = z.infer<typeof CostVerificationMessageSchema>;

/**
 * Fetch cost from OpenRouter API for a generation
 */
async function fetchOpenRouterCost(
  generationId: string
): Promise<number | null> {
  const apiKey = getDefined(
    process.env.OPENROUTER_API_KEY,
    "OPENROUTER_API_KEY is not set"
  );

  const url = `https://openrouter.ai/api/v1/generation?id=${generationId}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(
          "[Cost Verification] Generation not found in OpenRouter:",
          { generationId, status: response.status }
        );
        return null;
      }
      throw new Error(
        `OpenRouter API error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      cost?: number;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
      };
    };

    // OpenRouter returns cost in USD, convert to millionths
    if (data.cost !== undefined) {
      // Always use Math.ceil to round up, ensuring we never undercharge
      const baseCostInMillionths = Math.ceil(data.cost * 1_000_000);
      // Apply 5.5% markup to account for OpenRouter's credit purchase fee
      // OpenRouter charges 5.5% fee when adding credits to account
      const costInMillionths = Math.ceil(baseCostInMillionths * 1.055);
      console.log("[Cost Verification] Fetched cost from OpenRouter:", {
        generationId,
        cost: data.cost,
        baseCostInMillionths,
        costInMillionthsWithMarkup: costInMillionths,
        markup: "5.5%",
      });
      return costInMillionths;
    }

    console.warn(
      "[Cost Verification] No cost field in OpenRouter response:",
      { generationId, data }
    );
    return null;
  } catch (error) {
    console.error(
      "[Cost Verification] Error fetching cost from OpenRouter:",
      {
        generationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }
    );
    throw error;
  }
}

/**
 * Process a single cost verification message
 */
async function processCostVerification(record: SQSRecord): Promise<void> {
  const messageBody = JSON.parse(record.body || "{}");
  const validationResult = CostVerificationMessageSchema.safeParse(messageBody);

  if (!validationResult.success) {
    const errors = validationResult.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `${path}: ${issue.message}`;
    });
    throw new Error(
      `Invalid cost verification message: ${errors.join(", ")}`
    );
  }

  const message: CostVerificationMessage = validationResult.data;
  const { reservationId, openrouterGenerationId, workspaceId } = message;

  console.log("[Cost Verification] Processing cost verification:", {
    reservationId,
    openrouterGenerationId,
    workspaceId,
  });

  // Fetch cost from OpenRouter API
  const openrouterCost = await fetchOpenRouterCost(openrouterGenerationId);

  if (openrouterCost === null) {
    console.warn(
      "[Cost Verification] Could not fetch cost from OpenRouter, skipping finalization:",
      { reservationId, openrouterGenerationId, workspaceId }
    );
    // Don't throw error - just log and skip
    // The reservation will expire via TTL
    return;
  }

  // Finalize credit reservation with OpenRouter cost
  const db = await database();
  await finalizeCreditReservation(db, reservationId, openrouterCost, 3);

  console.log("[Cost Verification] Successfully finalized credit reservation:", {
    reservationId,
    openrouterGenerationId,
    workspaceId,
    openrouterCost,
  });
}

/**
 * Lambda handler for processing SQS messages with partial batch failure support
 * Returns array of failed message IDs so successful messages can be deleted
 * while failed ones are retried individually
 */
export const handler = handlingSQSErrors(
  async (event: SQSEvent): Promise<string[]> => {
    console.log(
      `[Cost Verification] Received ${event.Records.length} SQS message(s)`
    );

    const failedMessageIds: string[] = [];

    // Process messages in parallel (standard queue, not FIFO)
    const promises = event.Records.map(async (record) => {
      const messageId = record.messageId || "unknown";
      const receiptHandle = record.receiptHandle || "unknown";
      try {
        await processCostVerification(record);
        console.log(
          `[Cost Verification] Successfully processed message ${messageId}`
        );
      } catch (error) {
        // Log detailed error information
        console.error(
          `[Cost Verification] Failed to process message ${messageId} (receiptHandle: ${receiptHandle}):`,
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
              }
            : String(error)
        );
        console.error(
          `[Cost Verification] Message body preview: ${
            record.body?.substring(0, 500) || "no body"
          }`
        );

        // Track failed message for retry
        failedMessageIds.push(messageId);
      }
    });

    await Promise.all(promises);

    const successCount = event.Records.length - failedMessageIds.length;
    console.log(
      `[Cost Verification] Batch processing complete: ${successCount} succeeded, ${failedMessageIds.length} failed`
    );

    return failedMessageIds;
  }
);

