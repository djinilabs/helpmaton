import type { SQSEvent, SQSRecord } from "aws-lambda";
import { z } from "zod";

import type { UIMessage } from "../../http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import { database } from "../../tables";
import { getDefined } from "../../utils";
import { finalizeCreditReservation } from "../../utils/creditManagement";
import { handlingSQSErrors } from "../../utils/handlingSQSErrors";
import { calculateConversationCosts } from "../../utils/tokenAccounting";

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
  const {
    reservationId,
    openrouterGenerationId,
    workspaceId,
    conversationId,
    agentId,
  } = message;

  console.log("[Cost Verification] Processing cost verification:", {
    reservationId,
    openrouterGenerationId,
    workspaceId,
    conversationId,
    agentId,
  });

  // Fetch cost from OpenRouter API
  const openrouterCost = await fetchOpenRouterCost(openrouterGenerationId);

  if (openrouterCost === null) {
    console.warn(
      "[Cost Verification] Could not fetch cost from OpenRouter, skipping:",
      { reservationId, openrouterGenerationId, workspaceId }
    );
    // Don't throw error - just log and skip
    // The reservation will expire via TTL if it exists
    return;
  }

  const db = await database();

  // Finalize credit reservation with OpenRouter cost (only if reservationId is provided)
  if (reservationId) {
    await finalizeCreditReservation(db, reservationId, openrouterCost, 3);
    console.log("[Cost Verification] Successfully finalized credit reservation:", {
      reservationId,
      openrouterGenerationId,
      workspaceId,
      openrouterCost,
    });
  } else {
    console.log("[Cost Verification] Cost verified (no reservation to finalize):", {
      openrouterGenerationId,
      workspaceId,
      openrouterCost,
      reason: "No reservationId provided (likely BYOK or cost verification only)",
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
              // Prefer finalCostUsd if available, otherwise calculate from tokenUsage
              if ("finalCostUsd" in msg && typeof msg.finalCostUsd === "number") {
                totalCostUsd += msg.finalCostUsd;
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

