import type { SQSEvent, SQSRecord } from "aws-lambda";
import { z } from "zod";

import type { UIMessage } from "../../http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import { database } from "../../tables";
import { getDefined } from "../../utils";
import { finalizeCreditReservation } from "../../utils/creditManagement";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import { calculateConversationCosts } from "../../utils/tokenAccounting";

// Exponential backoff configuration for OpenRouter API retries
const BACKOFF_INITIAL_DELAY_MS = 500; // 0.5 seconds
const BACKOFF_MAX_RETRIES = 3;
const BACKOFF_MAX_DELAY_MS = 5000; // 5 seconds maximum
const BACKOFF_MULTIPLIER = 2;

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable
 */
function isRetryableError(status: number): boolean {
  // Retry on server errors (5xx) and rate limits (429)
  return status >= 500 || status === 429;
}

/**
 * Message schema for cost verification queue
 */
const CostVerificationMessageSchema = z.object({
  reservationId: z.string().optional(), // Optional - not required for BYOK cases or when just verifying cost
  openrouterGenerationId: z.string(),
  workspaceId: z.string(),
  conversationId: z.string().optional(), // Conversation ID for updating message (optional for backward compatibility)
  agentId: z.string().optional(), // Agent ID for updating message (optional for backward compatibility)
});

type CostVerificationMessage = z.infer<typeof CostVerificationMessageSchema>;

/**
 * Fetch cost from OpenRouter API for a generation
 * Implements exponential backoff retry for transient failures
 * @throws Error if cost cannot be computed (generation not found, missing cost field, etc.)
 */
async function fetchOpenRouterCost(
  generationId: string
): Promise<number> {
  const apiKey = getDefined(
    process.env.OPENROUTER_API_KEY,
    "OPENROUTER_API_KEY is not set"
  );

  const url = `https://openrouter.ai/api/v1/generation?id=${generationId}`;

  let lastError: Error | undefined;

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt <= BACKOFF_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        // Calculate delay with exponential backoff, capped at max delay
        const baseDelay = Math.min(
          BACKOFF_INITIAL_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1),
          BACKOFF_MAX_DELAY_MS
        );
        // Add jitter: random value between 0 and 20% of base delay
        const jitter = Math.random() * baseDelay * 0.2;
        const delay = baseDelay + jitter;

        console.log(
          `[Cost Verification] Retrying OpenRouter API call (attempt ${attempt + 1}/${BACKOFF_MAX_RETRIES + 1}) after ${Math.round(delay)}ms:`,
          {
            generationId,
            previousError:
              lastError instanceof Error ? lastError.message : String(lastError),
          }
        );

        await sleep(delay);
      }

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        // 404 is a permanent failure - generation not found, don't retry
        if (response.status === 404) {
          const errorBody = await response.text();
          const error = new Error(
            `OpenRouter generation not found: ${generationId} (status: ${response.status}) - ${errorBody}`
          );
          console.error(
            "[Cost Verification] Generation not found in OpenRouter:",
            {
              generationId,
              status: response.status,
              body: errorBody,
            }
          );
          throw error;
        }

        // Check if error is retryable
        if (isRetryableError(response.status) && attempt < BACKOFF_MAX_RETRIES) {
          const errorText = await response.text();
          lastError = new Error(
            `OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`
          );
          console.warn(
            `[Cost Verification] Retryable error from OpenRouter API:`,
            {
              generationId,
              status: response.status,
              attempt: attempt + 1,
              maxRetries: BACKOFF_MAX_RETRIES + 1,
            }
          );
          continue; // Retry
        }

        // Non-retryable error or max retries reached
        const errorText = await response.text();
        throw new Error(
          `OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as {
        data?: {
          total_cost?: number;
        };
        cost?: number; // Fallback for older API format
      };

      // OpenRouter API returns cost nested in data.data.total_cost (two levels: data.data.total_cost)
      // Try nested structure first, then fallback to top-level cost
      const cost =
        data.data?.total_cost !== undefined
          ? data.data.total_cost
          : data.cost;

      // OpenRouter returns cost in USD, convert to millionths
      if (cost !== undefined) {
        // Always use Math.ceil to round up, ensuring we never undercharge
        const baseCostInMillionths = Math.ceil(cost * 1_000_000);
        // Apply 5.5% markup to account for OpenRouter's credit purchase fee
        // OpenRouter charges 5.5% fee when adding credits to account
        const costInMillionths = Math.ceil(baseCostInMillionths * 1.055);
        console.log("[Cost Verification] Fetched cost from OpenRouter:", {
          generationId,
          cost,
          baseCostInMillionths,
          costInMillionthsWithMarkup: costInMillionths,
          markup: "5.5%",
          attempt: attempt + 1,
        });
        return costInMillionths;
      }

      // Cost field is missing - cannot compute the real value
      const error = new Error(
        `OpenRouter API response missing cost field for generation ${generationId}. Response data: ${JSON.stringify(data)}`
      );
      console.error(
        "[Cost Verification] No cost field in OpenRouter response:",
        {
          generationId,
          data,
        }
      );
      throw error;
    } catch (error) {
      // Check if it's a network/fetch error that might be retryable
      if (
        error instanceof TypeError &&
        (error.message.includes("fetch") ||
          error.message.includes("network") ||
          error.message.includes("ECONNREFUSED") ||
          error.message.includes("ETIMEDOUT"))
      ) {
        if (attempt < BACKOFF_MAX_RETRIES) {
          lastError = error as Error;
          console.warn(
            `[Cost Verification] Network error, will retry:`,
            {
              generationId,
              error: error instanceof Error ? error.message : String(error),
              attempt: attempt + 1,
              maxRetries: BACKOFF_MAX_RETRIES + 1,
            }
          );
          continue; // Retry
        }
      }

      // If we've exhausted retries or it's a non-retryable error, throw
      if (attempt === BACKOFF_MAX_RETRIES) {
        console.error(
          "[Cost Verification] Error fetching cost from OpenRouter after all retries:",
          {
            generationId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            totalAttempts: attempt + 1,
          }
        );
        throw error;
      }

      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  // If we get here, all retries were exhausted
  if (lastError) {
    throw lastError;
  }
  throw new Error(
    `Failed to fetch cost from OpenRouter for generation ${generationId}: Unknown error`
  );
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
    throw new Error(`Invalid cost verification message: ${errors.join(", ")}`);
  }

  const message: CostVerificationMessage = validationResult.data;
  const {
    reservationId,
    openrouterGenerationId,
    workspaceId,
    conversationId,
    agentId,
  } = message;

  console.log("[Cost Verification] Processing cost verification:", {
    reservationId: reservationId || undefined, // Explicitly show undefined instead of omitting
    openrouterGenerationId,
    workspaceId,
    conversationId,
    agentId,
    hasReservation: !!reservationId,
    note: reservationId
      ? "Will finalize credit reservation with OpenRouter cost"
      : "No reservation to finalize (likely BYOK or credit validation disabled)",
  });

  // Fetch cost from OpenRouter API
  // This will throw an error if cost cannot be computed, which will be caught by the handler wrapper
  const openrouterCost = await fetchOpenRouterCost(openrouterGenerationId);

  const db = await database();

  // If reservation exists, atomically add this cost
  if (reservationId) {
    const reservationPk = `credit-reservations/${reservationId}`;

    // Atomically update reservation with this generation's cost
    const reservation = await db["credit-reservations"].atomicUpdate(
      reservationPk,
      undefined,
      async (current) => {
        if (!current) {
          throw new Error(`Reservation ${reservationId} not found`);
        }

        const verifiedIds = current.verifiedGenerationIds || [];
        const verifiedCosts = current.verifiedCosts || [];
        const expectedCount = current.expectedGenerationCount || 1;

        // Check if this generation ID is already verified (idempotency)
        if (verifiedIds.includes(openrouterGenerationId)) {
          console.log(
            "[Cost Verification] Generation ID already verified, skipping:",
            { openrouterGenerationId, reservationId }
          );
          return current; // No change needed
        }

        // Add this generation's cost
        verifiedIds.push(openrouterGenerationId);
        verifiedCosts.push(openrouterCost);

        // Check if all generations are verified
        const allVerified = verifiedIds.length >= expectedCount;

        console.log("[Cost Verification] Updated reservation with verified cost:", {
          reservationId,
          openrouterGenerationId,
          cost: openrouterCost,
          verifiedCount: verifiedIds.length,
          expectedCount,
          allVerified,
        });

        return {
          ...current,
          verifiedGenerationIds: verifiedIds,
          verifiedCosts: verifiedCosts,
          // Mark for finalization if all verified
          ...(allVerified && {
            allGenerationsVerified: true,
            totalOpenrouterCost: verifiedCosts.reduce((sum, cost) => sum + cost, 0),
          }),
        };
      }
    );

    // If all generations verified, finalize now
    if (
      reservation?.allGenerationsVerified &&
      reservation.totalOpenrouterCost !== undefined
    ) {
      console.log(
        "[Cost Verification] All generations verified, finalizing reservation:",
        {
          reservationId,
          totalCost: reservation.totalOpenrouterCost,
          verifiedCount: reservation.verifiedGenerationIds?.length || 0,
        }
      );

      await finalizeCreditReservation(
        db,
        reservationId,
        reservation.totalOpenrouterCost,
        3
      );
    } else {
      console.log(
        "[Cost Verification] Reservation updated, waiting for remaining generations:",
        {
          reservationId,
          verifiedCount: reservation?.verifiedGenerationIds?.length || 0,
          expectedCount: reservation?.expectedGenerationCount || 0,
        }
      );
    }
  } else {
    // No reservation (BYOK case) - just log
    console.log("[Cost Verification] Cost verified (no reservation to finalize):", {
      openrouterGenerationId,
      workspaceId,
      openrouterCost,
      reason:
        "No reservationId provided (likely BYOK or cost verification only)",
    });
  }

  // Update message with final cost if conversation context is available
  if (conversationId && agentId) {
    try {
      const pk = `conversations/${workspaceId}/${agentId}/${conversationId}`;

      // Check if conversation exists before attempting update
      const existing = await db["agent-conversations"].get(pk);
      if (!existing) {
        console.warn(
          "[Cost Verification] Conversation not found, skipping message update:",
          { conversationId, agentId, workspaceId }
        );
        return;
      }

      await db["agent-conversations"].atomicUpdate(
        pk,
        undefined,
        async (current) => {
          if (!current) {
            // This shouldn't happen since we checked above, but handle it gracefully
            console.warn(
              "[Cost Verification] Conversation disappeared during update:",
              { conversationId, agentId, workspaceId }
            );
            // Return a minimal valid object to satisfy type requirements
            // This will cause the update to fail gracefully
            return {
              pk,
              workspaceId,
              agentId,
              conversationId,
              conversationType: "webhook" as const,
              messages: [],
              startedAt: new Date().toISOString(),
              lastMessageAt: new Date().toISOString(),
              expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            };
          }

          const messages = (current.messages || []) as UIMessage[];
          let messageUpdated = false;

          // Find and update the message with matching generation ID
          const updatedMessages = messages.map((msg) => {
            if (
              msg.role === "assistant" &&
              "openrouterGenerationId" in msg &&
              msg.openrouterGenerationId === openrouterGenerationId
            ) {
              messageUpdated = true;
              return {
                ...msg,
                finalCostUsd: openrouterCost,
              };
            }
            return msg;
          });

          if (!messageUpdated) {
            console.warn(
              "[Cost Verification] Message with generation ID not found in conversation:",
              {
                conversationId,
                agentId,
                workspaceId,
                openrouterGenerationId,
                messageCount: messages.length,
              }
            );
            return current;
          }

          // Recalculate conversation cost using finalCostUsd from messages
          let totalCostUsd = 0;
          for (const msg of updatedMessages) {
            if (msg.role === "assistant") {
              // Prefer finalCostUsd if available, then provisionalCostUsd, then calculate from tokenUsage
              if (
                "finalCostUsd" in msg &&
                typeof msg.finalCostUsd === "number"
              ) {
                totalCostUsd += msg.finalCostUsd;
              } else if (
                "provisionalCostUsd" in msg &&
                typeof msg.provisionalCostUsd === "number"
              ) {
                // Fall back to provisionalCostUsd if finalCostUsd not available
                totalCostUsd += msg.provisionalCostUsd;
              } else if (
                "tokenUsage" in msg &&
                msg.tokenUsage &&
                "modelName" in msg &&
                typeof msg.modelName === "string" &&
                "provider" in msg &&
                typeof msg.provider === "string"
              ) {
                const messageCosts = calculateConversationCosts(
                  msg.provider,
                  msg.modelName,
                  msg.tokenUsage
                );
                totalCostUsd += messageCosts.usd;
              }
            }
          }

          console.log("[Cost Verification] Updated message with final cost:", {
            conversationId,
            agentId,
            workspaceId,
            openrouterGenerationId,
            finalCostUsd: openrouterCost,
            totalCostUsd,
          });

          return {
            ...current,
            messages: updatedMessages as unknown[],
            costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
          };
        }
      );
    } catch (error) {
      // Log error but don't fail the cost verification
      // The credit reservation has already been finalized
      console.error(
        "[Cost Verification] Error updating message with final cost:",
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          conversationId,
          agentId,
          workspaceId,
          openrouterGenerationId,
          openrouterCost,
        }
      );
    }
  } else {
    console.log(
      "[Cost Verification] Conversation context not available, skipping message update:",
      { conversationId, agentId }
    );
  }
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
