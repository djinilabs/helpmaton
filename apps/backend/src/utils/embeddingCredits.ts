import type { DatabaseSchema } from "../tables/schema";

import { formatCurrencyNanoDollars, fromNanoDollars } from "./creditConversions";
import { SpendingLimitExceededError } from "./creditErrors";
import type { CreditReservation } from "./creditManagement";
import { reserveCredits } from "./creditManagement";
import type { EmbeddingUsage } from "./embedding";
import { EMBEDDING_MODEL } from "./embedding";
import { isSpendingLimitChecksEnabled } from "./featureFlags";
import { calculateTokenCost } from "./pricing";
import { checkSpendingLimits } from "./spendingLimits";
import type { AugmentedContext } from "./workspaceCreditContext";

const EMBEDDING_PROVIDER = "openrouter";
const EMBEDDING_TOOL_CALL = "document-search-embedding";

export function estimateEmbeddingTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function calculateEmbeddingCostNanoFromTokens(tokens: number): number {
  if (tokens <= 0) {
    return 0;
  }
  return calculateTokenCost(EMBEDDING_PROVIDER, EMBEDDING_MODEL, tokens, 0, 0, 0);
}

export function calculateEmbeddingCostNanoFromUsage(
  usage?: EmbeddingUsage,
): number | undefined {
  if (!usage) {
    return undefined;
  }
  if (typeof usage.cost === "number") {
    const baseCost = Math.ceil(usage.cost * 1_000_000_000);
    const costWithMarkup = Math.ceil(baseCost * 1.055);
    return Math.max(0, costWithMarkup);
  }
  const usageTokens = usage.promptTokens ?? usage.totalTokens;
  if (typeof usageTokens === "number") {
    return calculateEmbeddingCostNanoFromTokens(usageTokens);
  }
  return undefined;
}

export async function reserveEmbeddingCredits(params: {
  db: DatabaseSchema;
  workspaceId: string;
  text: string;
  usesByok?: boolean;
  context?: AugmentedContext;
  agentId?: string;
  conversationId?: string;
}): Promise<CreditReservation & { estimatedTokens: number }> {
  const estimatedTokens = estimateEmbeddingTokens(params.text);
  const estimatedCost = calculateEmbeddingCostNanoFromTokens(estimatedTokens);

  if (isSpendingLimitChecksEnabled()) {
    const workspacePk = `workspaces/${params.workspaceId}`;
    const workspace = await params.db.workspace.get(workspacePk, "workspace");
    if (!workspace) {
      throw new Error(`Workspace ${params.workspaceId} not found`);
    }

    let agent:
      | Awaited<ReturnType<DatabaseSchema["agent"]["get"]>>
      | undefined;
    if (params.agentId) {
      const agentPk = `agents/${params.workspaceId}/${params.agentId}`;
      agent = await params.db.agent.get(agentPk, "agent");
      if (!agent) {
        throw new Error(`Agent ${params.agentId} not found`);
      }
    }

    const estimatedCostUsd = fromNanoDollars(estimatedCost);
    const limitCheck = await checkSpendingLimits(
      params.db,
      workspace,
      agent,
      estimatedCostUsd,
    );
    if (!limitCheck.passed) {
      throw new SpendingLimitExceededError(limitCheck.failedLimits);
    }
  }

  console.log("[reserveEmbeddingCredits] Reserving credits:", {
    workspaceId: params.workspaceId,
    estimatedTokens,
    estimatedCost,
    agentId: params.agentId,
    conversationId: params.conversationId,
  });

  const reservation = await reserveCredits(
    params.db,
    params.workspaceId,
    estimatedCost,
    3,
    params.usesByok,
    params.context,
    EMBEDDING_PROVIDER,
    EMBEDDING_MODEL,
    params.agentId,
    params.conversationId,
  );

  return { ...reservation, estimatedTokens };
}

export async function adjustEmbeddingCreditReservation(params: {
  db: DatabaseSchema;
  reservationId: string;
  workspaceId: string;
  usage?: EmbeddingUsage;
  context: AugmentedContext;
  agentId?: string;
  conversationId?: string;
}): Promise<void> {
  if (
    params.reservationId === "byok" ||
    params.reservationId === "zero-cost"
  ) {
    console.log(
      "[adjustEmbeddingCreditReservation] Skipping adjustment for non-chargeable reservation:",
      { reservationId: params.reservationId, workspaceId: params.workspaceId },
    );
    return;
  }

  const reservationPk = `credit-reservations/${params.reservationId}`;
  const reservation = await params.db["credit-reservations"].get(reservationPk);
  if (!reservation) {
    console.warn(
      "[adjustEmbeddingCreditReservation] Reservation not found, assuming already processed:",
      { reservationId: params.reservationId, workspaceId: params.workspaceId },
    );
    return;
  }

  const reservedAmount = reservation.reservedAmount;
  const usageCostNano = calculateEmbeddingCostNanoFromUsage(params.usage);
  const usageTokens =
    params.usage?.promptTokens ?? params.usage?.totalTokens ?? undefined;
  const fallbackCostNano =
    usageCostNano === undefined && typeof usageTokens === "number"
      ? calculateEmbeddingCostNanoFromTokens(usageTokens)
      : undefined;
  const actualCostNano =
    usageCostNano ?? fallbackCostNano ?? reservedAmount;

  const difference = actualCostNano - reservedAmount;
  const transactionAmount = difference === 0 ? 0 : -difference;
  const action =
    difference === 0 ? "no change" : difference > 0 ? "charged" : "refunded";

  const reservedFormatted = formatCurrencyNanoDollars(reservedAmount);
  const actualFormatted = formatCurrencyNanoDollars(actualCostNano);
  const differenceFormatted = formatCurrencyNanoDollars(Math.abs(difference));

  console.log("[adjustEmbeddingCreditReservation] Creating transaction:", {
    workspaceId: params.workspaceId,
    reservationId: params.reservationId,
    reservedAmount,
    actualCostNano,
    difference,
    transactionAmount,
    usage: params.usage,
  });

  params.context.addWorkspaceCreditTransaction({
    workspaceId: params.workspaceId,
    agentId: params.agentId || undefined,
    conversationId: params.conversationId || undefined,
    source: "tool-execution",
    supplier: "openrouter",
    tool_call: EMBEDDING_TOOL_CALL,
    description: `Document search embeddings ${action} ${differenceFormatted} (actual ${actualFormatted}, reserved ${reservedFormatted})`,
    amountNanoUsd: transactionAmount,
  });

  await params.db["credit-reservations"].delete(reservationPk);
  console.log(
    "[adjustEmbeddingCreditReservation] Successfully deleted reservation:",
    { reservationId: params.reservationId },
  );
}

export async function refundEmbeddingCredits(params: {
  db: DatabaseSchema;
  reservationId: string;
  workspaceId: string;
  context: AugmentedContext;
  agentId?: string;
  conversationId?: string;
}): Promise<void> {
  if (
    params.reservationId === "byok" ||
    params.reservationId === "zero-cost"
  ) {
    console.log(
      "[refundEmbeddingCredits] Skipping refund for non-chargeable reservation:",
      { reservationId: params.reservationId, workspaceId: params.workspaceId },
    );
    return;
  }

  const reservationPk = `credit-reservations/${params.reservationId}`;
  const reservation = await params.db["credit-reservations"].get(reservationPk);
  if (!reservation) {
    console.warn(
      "[refundEmbeddingCredits] Reservation not found, assuming already processed:",
      { reservationId: params.reservationId, workspaceId: params.workspaceId },
    );
    return;
  }

  const reservedAmount = reservation.reservedAmount;
  const reservedFormatted = formatCurrencyNanoDollars(reservedAmount);

  console.log("[refundEmbeddingCredits] Refunding credits:", {
    workspaceId: params.workspaceId,
    reservationId: params.reservationId,
    reservedAmount,
  });

  params.context.addWorkspaceCreditTransaction({
    workspaceId: params.workspaceId,
    agentId: params.agentId || undefined,
    conversationId: params.conversationId || undefined,
    source: "tool-execution",
    supplier: "openrouter",
    tool_call: EMBEDDING_TOOL_CALL,
    description: `Document search embedding refund (error occurred) - ${reservedFormatted}`,
    amountNanoUsd: reservedAmount,
  });

  await params.db["credit-reservations"].delete(reservationPk);
  console.log("[refundEmbeddingCredits] Successfully refunded reservation:", {
    reservationId: params.reservationId,
  });
}
