import type { ModelMessage } from "ai";

import type { TokenUsage } from "../../utils/conversationLogger";
import {
  adjustCreditReservation,
  enqueueCostVerification,
  refundReservation,
} from "../../utils/creditManagement";
import { validateCreditsAndLimitsAndReserve } from "../../utils/creditValidation";
import { isCreditDeductionEnabled } from "../../utils/featureFlags";
import { Sentry, ensureError } from "../../utils/sentry";
import type { AugmentedContext } from "../../utils/workspaceCreditContext";

import type { GenerationEndpoint } from "./generationErrorHandling";

/**
 * Converts AI SDK tools to definition format for credit estimation
 */
export function convertToolsToDefinitions(
  tools: Record<string, unknown> | undefined
): Array<{
  name: string;
  description: string;
  parameters: unknown;
}> | undefined {
  if (!tools) {
    return undefined;
  }

  return Object.entries(tools).map(([name, tool]) => {
    const typedTool = tool as {
      description?: string;
      inputSchema?: unknown;
    };
    return {
      name,
      description: typedTool.description || "",
      parameters: typedTool.inputSchema || {},
    };
  });
}

/**
 * Validates credits, spending limits, and reserves credits before LLM call
 */
export async function validateAndReserveCredits(
  db: Awaited<ReturnType<typeof import("../../tables").database>>,
  workspaceId: string,
  agentId: string,
  provider: string,
  modelName: string,
  modelMessages: ModelMessage[],
  systemPrompt: string,
  tools: Record<string, unknown> | undefined,
  usesByok: boolean,
  endpoint: GenerationEndpoint,
  context?: AugmentedContext,
  conversationId?: string
): Promise<string | undefined> {
  const toolDefinitions = convertToolsToDefinitions(tools);

  const reservation = await validateCreditsAndLimitsAndReserve(
    db,
    workspaceId,
    agentId,
    provider,
    modelName,
    modelMessages,
    systemPrompt,
    toolDefinitions,
    usesByok,
    context,
    conversationId
  );

  if (reservation) {
    console.log(`[${endpoint} Handler] Credits reserved:`, {
      workspaceId,
      reservationId: reservation.reservationId,
      reservedAmount: reservation.reservedAmount,
    });
    return reservation.reservationId;
  }

  console.log(
    `[${endpoint} Handler] No credit reservation created (see validateCreditsAndLimitsAndReserve logs above for reason):`,
    {
      workspaceId,
      agentId,
      usesByok,
      note: "This is expected if BYOK is used or credit validation is disabled. Cost verification will still run but won't finalize a reservation.",
    }
  );

  return undefined;
}

/**
 * Adjusts credit reservation after successful LLM call (Step 2 of 3-step pricing)
 */
export async function adjustCreditsAfterLLMCall(
  db: Awaited<ReturnType<typeof import("../../tables").database>>,
  workspaceId: string,
  agentId: string,
  reservationId: string | undefined,
  provider: string,
  modelName: string,
  tokenUsage: TokenUsage | undefined,
  usesByok: boolean,
  openrouterGenerationId: string | undefined,
  openrouterGenerationIds: string[] | undefined, // New parameter
  endpoint: GenerationEndpoint,
  context: AugmentedContext,
  conversationId?: string
): Promise<void> {
  // TEMPORARY: This can be disabled via ENABLE_CREDIT_DEDUCTION env var
  if (
    !isCreditDeductionEnabled() ||
    !reservationId ||
    reservationId === "byok" ||
    !tokenUsage ||
    (tokenUsage.promptTokens === 0 && tokenUsage.completionTokens === 0)
  ) {
    if (!isCreditDeductionEnabled()) {
      console.log(
        `[${endpoint} Handler] Credit deduction disabled via feature flag, skipping adjustment:`,
        {
          workspaceId,
          agentId,
          reservationId,
          tokenUsage,
        }
      );
    } else if (!reservationId || reservationId === "byok") {
      console.log(
        `[${endpoint} Handler] No reservation (BYOK), skipping adjustment:`,
        {
          workspaceId,
          agentId,
          reservationId,
        }
      );
    }
    return;
  }

  try {
    console.log(`[${endpoint} Handler] Step 2: Adjusting credit reservation:`, {
      workspaceId,
      reservationId,
      provider,
      modelName,
      tokenUsage,
      openrouterGenerationId,
      openrouterGenerationIds,
      generationCount: openrouterGenerationIds?.length || 0,
    });
    await adjustCreditReservation(
      db,
      reservationId,
      workspaceId,
      provider,
      modelName,
      tokenUsage,
      context,
      3, // maxRetries
      usesByok,
      openrouterGenerationId,
      openrouterGenerationIds,
      agentId,
      conversationId
    );
    console.log(
      `[${endpoint} Handler] Step 2: Credit reservation adjusted successfully`
    );
  } catch (error) {
    // Log error but don't fail the request
    console.error(
      `[${endpoint} Handler] Error adjusting credit reservation:`,
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        workspaceId,
        agentId,
        reservationId,
        tokenUsage,
      }
    );
    // Report to Sentry
    Sentry.captureException(ensureError(error), {
      tags: {
        endpoint,
        operation: "credit_adjustment",
      },
      extra: {
        workspaceId,
        agentId,
        reservationId,
        tokenUsage,
      },
    });
  }
}

/**
 * Handles reservation cleanup when no token usage is available after successful call
 * Deletes reservation without refund (estimated cost remains deducted)
 */
export async function cleanupReservationWithoutTokenUsage(
  db: Awaited<ReturnType<typeof import("../../tables").database>>,
  reservationId: string,
  workspaceId: string,
  agentId: string,
  endpoint: GenerationEndpoint
): Promise<void> {
  console.warn(
    `[${endpoint} Handler] No token usage available after successful call, keeping estimated cost:`,
    {
      workspaceId,
      agentId,
      reservationId,
    }
  );
  // Delete reservation without refund (estimated cost remains deducted)
  try {
    const reservationPk = `credit-reservations/${reservationId}`;
    await db["credit-reservations"].delete(reservationPk);
  } catch (deleteError) {
    console.warn(
      `[${endpoint} Handler] Error deleting reservation:`,
      deleteError
    );
  }
}

/**
 * Handles reservation cleanup on errors
 * Refunds if error occurred before LLM call, adjusts if error occurred after with token usage
 */
export async function cleanupReservationOnError(
  db: Awaited<ReturnType<typeof import("../../tables").database>>,
  reservationId: string,
  workspaceId: string,
  agentId: string,
  provider: string,
  modelName: string,
  error: unknown,
  llmCallAttempted: boolean,
  usesByok: boolean,
  endpoint: GenerationEndpoint,
  context: AugmentedContext
): Promise<void> {
  if (usesByok || reservationId === "byok") {
    return;
  }

  // LLM failures should refund the reservation regardless of call stage
  try {
    console.log(`[${endpoint} Handler] LLM call failed, refunding reservation:`, {
      workspaceId,
      reservationId,
      provider,
      modelName,
      llmCallAttempted,
      error: error instanceof Error ? error.message : String(error),
    });
    await refundReservation(db, reservationId, context, {
      endpoint,
      error,
      provider,
      modelName,
      reason: "llm call failure",
    });
  } catch (refundError) {
    // Log but don't fail - refund is best effort
    console.error(`[${endpoint} Handler] Error refunding reservation:`, {
      reservationId,
      error:
        refundError instanceof Error ? refundError.message : String(refundError),
    });
  }
}

/**
 * Enqueues cost verification (Step 3 of 3-step pricing) if generation ID is available
 */
export async function enqueueCostVerificationIfNeeded(
  openrouterGenerationId: string | undefined, // Keep for backward compatibility
  openrouterGenerationIds: string[] | undefined, // New parameter
  workspaceId: string,
  reservationId: string | undefined,
  conversationId: string | undefined,
  agentId: string | undefined,
  endpoint: GenerationEndpoint
): Promise<void> {
  // Determine which IDs to verify
  const idsToVerify =
    openrouterGenerationIds && openrouterGenerationIds.length > 0
      ? openrouterGenerationIds
      : openrouterGenerationId
        ? [openrouterGenerationId]
        : [];

  if (idsToVerify.length === 0) {
    console.warn(
      `[${endpoint} Handler] No OpenRouter generation IDs found, skipping cost verification`
    );
    return;
  }

  // Enqueue cost verification for each generation ID
  for (const generationId of idsToVerify) {
    try {
      await enqueueCostVerification(
        generationId,
        workspaceId,
        reservationId && reservationId !== "byok" ? reservationId : undefined,
        conversationId,
        agentId
      );
      console.log(`[${endpoint} Handler] Enqueued cost verification for generation:`, {
        generationId,
        reservationId:
          reservationId && reservationId !== "byok" ? reservationId : undefined,
      });
    } catch (error) {
      // Log but continue with other IDs
      console.error(
        `[${endpoint} Handler] Error enqueueing cost verification for ${generationId}:`,
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  console.log(
    `[${endpoint} Handler] Step 3: Cost verification enqueued for ${idsToVerify.length} generation(s)`,
    {
      generationIds: idsToVerify,
      reservationId:
        reservationId && reservationId !== "byok" ? reservationId : undefined,
      hasReservation: !!(reservationId && reservationId !== "byok"),
    }
  );
}

