import type { SQSEvent, SQSRecord } from "aws-lambda";
import { z } from "zod";

import { database } from "../../tables";
import { getDefined } from "../../utils";
import { atomicUpdateRecord, getRecord } from "../../utils/conversationRecords";
import { finalizeCreditReservation } from "../../utils/creditManagement";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import { getMessageCost } from "../../utils/messageCostCalculation";
import type { UIMessage } from "../../utils/messageTypes";
import { initSentry } from "../../utils/sentry";
import { getCurrentSQSContext } from "../../utils/workspaceCreditContext";

initSentry();

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
async function fetchOpenRouterCost(generationId: string): Promise<number> {
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
          `[Cost Verification] Retrying OpenRouter API call (attempt ${
            attempt + 1
          }/${BACKOFF_MAX_RETRIES + 1}) after ${Math.round(delay)}ms:`,
          {
            generationId,
            previousError:
              lastError instanceof Error
                ? lastError.message
                : String(lastError),
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
        if (
          isRetryableError(response.status) &&
          attempt < BACKOFF_MAX_RETRIES
        ) {
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
        data.data?.total_cost !== undefined ? data.data.total_cost : data.cost;

      // OpenRouter returns cost in USD, convert to nano-dollars
      if (cost !== undefined) {
        // Always use Math.ceil to round up, ensuring we never undercharge
        const baseCostInNanoDollars = Math.ceil(cost * 1_000_000_000);
        // Apply 5.5% markup to account for OpenRouter's credit purchase fee
        // OpenRouter charges 5.5% fee when adding credits to account
        const costInNanoDollars = Math.ceil(baseCostInNanoDollars * 1.055);
        console.log("[Cost Verification] Fetched cost from OpenRouter:", {
          generationId,
          cost,
          baseCostInNanoDollars,
          costInNanoDollarsWithMarkup: costInNanoDollars,
          markup: "5.5%",
          attempt: attempt + 1,
        });
        return costInNanoDollars;
      }

      // Cost field is missing - cannot compute the real value
      const error = new Error(
        `OpenRouter API response missing cost field for generation ${generationId}. Response data: ${JSON.stringify(
          data
        )}`
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
          console.warn(`[Cost Verification] Network error, will retry:`, {
            generationId,
            error: error instanceof Error ? error.message : String(error),
            attempt: attempt + 1,
            maxRetries: BACKOFF_MAX_RETRIES + 1,
          });
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
  // Get context for workspace credit transactions
  const messageId = record.messageId || "unknown";
  const context = getCurrentSQSContext(messageId);
  if (!context) {
    throw new Error("Context not available for workspace credit transactions");
  }

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
  // IMPORTANT: This is the ACTUAL cost from OpenRouter API (with 5.5% markup), NOT a transaction/refund amount
  const openrouterCost = await fetchOpenRouterCost(openrouterGenerationId);
  
  // Validate that the cost is positive and reasonable (defensive check)
  if (openrouterCost <= 0) {
    throw new Error(
      `Invalid OpenRouter cost: ${openrouterCost} (must be positive). This should be the actual cost, not a transaction amount.`
    );
  }

  console.log("[Cost Verification] Fetched OpenRouter cost (will be used for finalCostUsd):", {
    openrouterGenerationId,
    openrouterCost,
    workspaceId,
    conversationId,
    agentId,
    note: "This is the ACTUAL cost that will be stored in finalCostUsd, NOT a transaction/refund amount",
  });

  const db = await database();

  // Check if this is a re-ranking cost verification
  // Re-ranking reservations have provisionalCost field set and openrouterGenerationId
  let isReranking = false;
  let reservation: Awaited<
    ReturnType<typeof db["credit-reservations"]["get"]>
  > | null = null;
  if (reservationId) {
    const reservationPk = `credit-reservations/${reservationId}`;
    reservation = await db["credit-reservations"].get(reservationPk);
    // Detect re-ranking reservations:
    // - Re-ranking reservations have provisionalCost field (set in adjustRerankingCreditReservation)
    // - They have openrouterGenerationId field matching the generation ID
    // - They don't have expectedGenerationCount (which main LLM calls have)
    // NOTE: An explicit isReranking flag would be more robust, but this heuristic works for now
    if (reservation) {
      isReranking =
        reservation.provisionalCost !== undefined &&
        reservation.openrouterGenerationId === openrouterGenerationId &&
        !reservation.expectedGenerationCount;

      if (isReranking) {
        console.log(
          "[Cost Verification] Detected re-ranking cost verification:",
          {
            reservationId,
            openrouterGenerationId,
            provisionalCost: reservation.provisionalCost,
          }
        );
      }
    }
  }

  // If reservation exists, atomically add this cost
  if (reservationId && !isReranking) {
    // For main LLM calls, use the existing multi-generation verification logic
    const reservationPk = `credit-reservations/${reservationId}`;

    // Atomically update reservation with this generation's cost
    const updatedReservation = await db["credit-reservations"].atomicUpdate(
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

        console.log(
          "[Cost Verification] Updated reservation with verified cost:",
          {
            reservationId,
            openrouterGenerationId,
            cost: openrouterCost,
            verifiedCount: verifiedIds.length,
            expectedCount,
            allVerified,
          }
        );

        return {
          ...current,
          verifiedGenerationIds: verifiedIds,
          verifiedCosts: verifiedCosts,
          // Mark for finalization if all verified
          ...(allVerified && {
            allGenerationsVerified: true,
            totalOpenrouterCost: verifiedCosts.reduce(
              (sum, cost) => sum + cost,
              0
            ),
          }),
        };
      }
    );

    // If all generations verified, finalize now
    if (
      updatedReservation?.allGenerationsVerified &&
      updatedReservation.totalOpenrouterCost !== undefined
    ) {
      console.log(
        "[Cost Verification] All generations verified, finalizing reservation:",
        {
          reservationId,
          totalCost: updatedReservation.totalOpenrouterCost,
          verifiedCount: updatedReservation.verifiedGenerationIds?.length || 0,
        }
      );

      await finalizeCreditReservation(
        db,
        reservationId,
        updatedReservation.totalOpenrouterCost,
        context,
        3
      );
    } else {
      console.log(
        "[Cost Verification] Reservation updated, waiting for remaining generations:",
        {
          reservationId,
          verifiedCount: updatedReservation?.verifiedGenerationIds?.length || 0,
          expectedCount: updatedReservation?.expectedGenerationCount || 0,
        }
      );
    }
  } else if (reservationId && isReranking) {
    // For re-ranking, finalize immediately (single generation)
    console.log(
      "[Cost Verification] Re-ranking cost verification, finalizing reservation:",
      {
        reservationId,
        openrouterGenerationId,
        finalCost: openrouterCost,
        provisionalCost: reservation?.provisionalCost || undefined,
      }
    );

    await finalizeCreditReservation(db, reservationId, openrouterCost, context, 3, {
      source: "tool-execution",
      tool_call: "rerank",
    });
  } else {
    // No reservation (BYOK case) - just log
    console.log(
      "[Cost Verification] Cost verified (no reservation to finalize):",
      {
        openrouterGenerationId,
        workspaceId,
        openrouterCost,
        reason:
          "No reservationId provided (likely BYOK or cost verification only)",
      }
    );
  }

  // Update message with final cost if conversation context is available
  if (conversationId && agentId) {
    try {
      const pk = `conversations/${workspaceId}/${agentId}/${conversationId}`;

      // Check if conversation exists before attempting update
      // Retry up to 3 times with exponential backoff if conversation not found
      // This handles edge cases where the conversation might not be saved yet
      let existing = await getRecord(db, pk, undefined, { enrichFromS3: false });
      if (!existing) {
        // Retry with exponential backoff (500ms, 1000ms, 2000ms)
        for (let retry = 0; retry < 3; retry++) {
          const delay = 500 * Math.pow(2, retry);
          console.warn(
            `[Cost Verification] Conversation not found, retrying after ${delay}ms (attempt ${retry + 1}/3):`,
            { conversationId, agentId, workspaceId }
          );
          await sleep(delay);
          existing = await getRecord(db, pk, undefined, { enrichFromS3: false });
          if (existing) {
            console.log(
              `[Cost Verification] Conversation found after retry ${retry + 1}:`,
              { conversationId, agentId, workspaceId }
            );
            break;
          }
        }

        if (!existing) {
          console.warn(
            "[Cost Verification] Conversation not found after all retries, skipping message update:",
            { conversationId, agentId, workspaceId }
          );
          return;
        }
      }

      await atomicUpdateRecord(db, pk, undefined, async (current) => {
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

          if (isReranking) {
            // For re-ranking, we don't have a message to update
            // Instead, we need to add the re-ranking cost to the conversation total
            // Re-ranking costs are tracked separately and added to conversation costUsd
            console.log(
              "[Cost Verification] Re-ranking cost verification, updating conversation cost:",
              {
                conversationId,
                agentId,
                workspaceId,
                openrouterGenerationId,
                rerankingCost: openrouterCost,
                previousCostUsd: current.costUsd,
              }
            );


            // Re-ranking cost tracking:
            // 1. Re-ranking costs are NOT stored in messages (re-ranking happens before LLM call)
            // 2. Re-ranking costs are stored separately in rerankingCostUsd field
            // 3. updateConversation() adds rerankingCostUsd to totalCostUsd when calculating conversation cost
            // 4. When verifying re-ranking costs, we need to:
            //    - Calculate totalCostUsd from messages (which doesn't include re-ranking)
            //    - Replace the previous rerankingCostUsd (provisional or final) with the final cost
            //    - Add the final re-ranking cost to totalCostUsd
            // Get previous re-ranking cost from conversation (if any)
            // This could be provisional cost from Step 2 or final cost from a previous verification
            const previousRerankingCost =
              (current as { rerankingCostUsd?: number }).rerankingCostUsd || 0;
            const finalRerankingCost = openrouterCost;
            
            // Calculate conversation cost from messages first (doesn't include re-ranking)
            let totalCostUsd = 0;
            for (const msg of messages) {
              const messageCost = getMessageCost(msg);
              if (messageCost) {
                if (messageCost.costUsd !== undefined) {
                  totalCostUsd += messageCost.costUsd;
                }
                if (messageCost.toolCosts) {
                  for (const toolCost of messageCost.toolCosts) {
                    totalCostUsd += toolCost.costUsd;
                  }
                }
              }
            }
            
            // Replace previous re-ranking cost (provisional or final) with final cost
            // Remove previous cost and add final cost
            totalCostUsd = totalCostUsd - previousRerankingCost + finalRerankingCost;

            console.log(
              "[Cost Verification] Updated conversation with re-ranking cost:",
              {
                conversationId,
                agentId,
                workspaceId,
                openrouterGenerationId,
                finalRerankingCost: openrouterCost,
                previousRerankingCost,
                costAdjustment: finalRerankingCost - previousRerankingCost,
                totalCostUsd,
                previousTotalCostUsd: current.costUsd,
              }
            );

            return {
              ...current,
              costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
              rerankingCostUsd: finalRerankingCost, // Store final re-ranking cost for future reference
            };
          } else {
            // For main LLM calls, update the message with final cost
            // Find and update the message with matching generation ID
            // IMPORTANT: finalCostUsd must be the ACTUAL cost from OpenRouter API (with 5.5% markup),
            // NOT the transaction amount (difference/refund) from finalizeCreditReservation.
            // The transaction amount is only used for credit balance adjustments, not for message costs.
            let toolCostUpdated = false;
            const updatedMessages = messages.map((msg) => {
              let updatedMessage = msg as UIMessage;
              if (
                msg.role === "assistant" &&
                "openrouterGenerationId" in msg &&
                msg.openrouterGenerationId === openrouterGenerationId
              ) {
                messageUpdated = true;
                updatedMessage = {
                  ...updatedMessage,
                  // Use the actual cost fetched from OpenRouter API, not any transaction/refund amount
                  finalCostUsd: openrouterCost,
                } as UIMessage;
              }

              if (Array.isArray(updatedMessage.content)) {
                let contentUpdated = false;
                const updatedContent = (updatedMessage.content as Array<unknown>).map(
                  (item) => {
                  if (
                    item &&
                    typeof item === "object" &&
                    "type" in item &&
                    item.type === "tool-result" &&
                    "openrouterGenerationId" in item &&
                    item.openrouterGenerationId === openrouterGenerationId
                  ) {
                    contentUpdated = true;
                    toolCostUpdated = true;
                    return {
                      ...item,
                      costUsd: openrouterCost,
                    };
                  }
                  return item;
                  }
                );

                if (contentUpdated) {
                  updatedMessage = {
                    ...updatedMessage,
                    content: updatedContent,
                  } as UIMessage;
                }
              }

              return updatedMessage;
            });

            if (!messageUpdated && !toolCostUpdated) {
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

            // Recalculate conversation cost from 0 using getMessageCost() helper for ALL messages
            // IMPORTANT: Always recalculate from scratch, do NOT use current.costUsd
            // Use getMessageCost() helper to get best available cost for each message
            // This prefers finalCostUsd > provisionalCostUsd > calculated from tokenUsage
            // Also includes tool costs from tool-result content items (individual costs per tool)
            let totalCostUsd = 0;
            for (const msg of updatedMessages) {
              // Use getMessageCost() helper to get best available cost
              const messageCost = getMessageCost(msg);

              if (messageCost) {
                // For assistant messages: use costUsd
                if (messageCost.costUsd !== undefined) {
                  totalCostUsd += messageCost.costUsd;
                }

                // For tool messages: sum individual tool costs
                if (messageCost.toolCosts) {
                  for (const toolCost of messageCost.toolCosts) {
                    totalCostUsd += toolCost.costUsd;
                  }
                }
              }
            }

            // Include re-ranking cost if it exists
            // NOTE: rerankingCostUsd is already included in current.costUsd via updateConversation(),
            // so we need to preserve it when recalculating. The rerankingCostUsd field is stored
            // separately for tracking purposes, but it's already been added to the conversation cost.
            const rerankingCost =
              (current as { rerankingCostUsd?: number }).rerankingCostUsd || 0;
            totalCostUsd += rerankingCost;

            console.log("[Cost Verification] Updated message with final cost:", {
              conversationId,
              agentId,
              workspaceId,
              openrouterGenerationId,
              finalCostUsd: openrouterCost, // Actual cost from OpenRouter API (with 5.5% markup)
              totalCostUsd,
              previousCostUsd: current.costUsd,
              rerankingCost,
              messageCount: updatedMessages.length,
              toolCostsUpdated: toolCostUpdated,
              messagesWithFinalCost: updatedMessages.filter(
                (msg) =>
                  msg.role === "assistant" &&
                  "finalCostUsd" in msg &&
                  typeof msg.finalCostUsd === "number"
              ).length,
              note: "finalCostUsd is the actual cost, NOT a transaction/refund amount. Conversation costUsd is sum of all message finalCostUsd values plus re-ranking costs.",
            });

            return {
              ...current,
              messages: updatedMessages as unknown[],
              costUsd: totalCostUsd > 0 ? totalCostUsd : undefined,
            };
          }
      });
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
  },
  { handlerName: "openrouter-cost-verification-queue" }
);
