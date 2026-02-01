import type { ModelMessage } from "ai";

import type { DatabaseSchema, AgentRecord } from "../tables/schema";

import {
  InsufficientCreditsError,
  SpendingLimitExceededError,
} from "./creditErrors";
import type { CreditReservation } from "./creditManagement";
import { reserveCredits } from "./creditManagement";
import {
  isCreditValidationEnabled,
  isCreditDeductionEnabled,
  isSpendingLimitChecksEnabled,
} from "./featureFlags";
import { checkSpendingLimits } from "./spendingLimits";
import { estimateTokenCost } from "./tokenEstimation";
import type { AugmentedContext } from "./workspaceCreditContext";

/**
 * Combined validation before LLM call
 * Checks credit balance and all spending limits
 *
 * @param db - Database instance
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID (optional)
 * @param provider - LLM provider name
 * @param modelName - Model name
 * @param messages - Messages to send
 * @param systemPrompt - Optional system prompt
 * @param toolDefinitions - Optional tool definitions
 * @throws InsufficientCreditsError if credit balance is insufficient
 * @throws SpendingLimitExceededError if any spending limit is exceeded
 */
/**
 * Combined validation before LLM call
 * Checks credit balance and all spending limits
 *
 * TEMPORARY: This function respects feature flags to allow disabling checks during deployment.
 * Set ENABLE_CREDIT_VALIDATION=false and/or ENABLE_SPENDING_LIMIT_CHECKS=false to disable.
 * These should be re-enabled after deployment is complete.
 *
 * @param db - Database instance
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID (optional)
 * @param provider - LLM provider name
 * @param modelName - Model name
 * @param messages - Messages to send
 * @param systemPrompt - Optional system prompt
 * @param toolDefinitions - Optional tool definitions
 * @throws InsufficientCreditsError if credit balance is insufficient
 * @throws SpendingLimitExceededError if any spending limit is exceeded
 */
export async function validateCreditsAndLimits(
  db: DatabaseSchema,
  workspaceId: string,
  agentId: string | undefined,
  provider: string,
  modelName: string,
  messages: ModelMessage[],
  systemPrompt?: string,
  toolDefinitions?: unknown[],
  usesByok?: boolean
): Promise<void> {
  // For BYOK requests, skip credit balance check but still check spending limits
  const isByok = usesByok === true;
  
  if (isByok) {
    console.log(
      "[validateCreditsAndLimits] Request made with user key (BYOK), skipping credit balance check but will check spending limits",
      { workspaceId, agentId }
    );
  }

  // Check if credit validation is disabled via feature flag
  if (!isCreditValidationEnabled()) {
    console.log(
      "[validateCreditsAndLimits] Credit validation disabled via feature flag, skipping validation",
      { workspaceId, agentId }
    );
    // Still check spending limits if enabled
    if (!isSpendingLimitChecksEnabled()) {
      console.log(
        "[validateCreditsAndLimits] Spending limit checks also disabled, returning early",
        { workspaceId, agentId }
      );
      return;
    }
  }

  // Check if spending limit checks are disabled via feature flag
  const spendingLimitsEnabled = isSpendingLimitChecksEnabled();
  if (!spendingLimitsEnabled) {
    console.log(
      "[validateCreditsAndLimits] Spending limit checks disabled via feature flag",
      { workspaceId, agentId }
    );
  }

  // Load workspace and agent
  const workspacePk = `workspaces/${workspaceId}`;
  const workspace = await db.workspace.get(workspacePk, "workspace");
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  let agent: AgentRecord | undefined;
  if (agentId) {
    const agentPk = `agents/${workspaceId}/${agentId}`;
    agent = await db.agent.get(agentPk, "agent");
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
  }

  // Estimate cost using token estimation (always in USD)
  const estimatedCost = estimateTokenCost(
    provider,
    modelName,
    messages,
    systemPrompt,
    toolDefinitions
  );

  // Check credit balance (only if validation is enabled and NOT BYOK)
  if (!isByok && isCreditValidationEnabled()) {
    if (workspace.creditBalance < estimatedCost) {
      throw new InsufficientCreditsError(
        workspaceId,
        estimatedCost,
        workspace.creditBalance,
        "usd",
        agentId
      );
    }
  }

  // Check all spending limits (only if checks are enabled)
  // This applies to both regular requests and BYOK requests
  if (spendingLimitsEnabled) {
    const limitCheck = await checkSpendingLimits(
      db,
      workspace,
      agent,
      estimatedCost
    );

    if (!limitCheck.passed) {
      throw new SpendingLimitExceededError(
        workspaceId,
        limitCheck.failedLimits,
        agentId
      );
    }
  }
}

/**
 * Combined validation and credit reservation before LLM call
 * Checks spending limits, then atomically reserves credits
 *
 * @param db - Database instance
 * @param workspaceId - Workspace ID
 * @param agentId - Agent ID (optional)
 * @param provider - LLM provider name
 * @param modelName - Model name
 * @param messages - Messages to send
 * @param systemPrompt - Optional system prompt
 * @param toolDefinitions - Optional tool definitions
 * @param usesByok - Whether request was made with user key (BYOK)
 * @returns Credit reservation info (reservationId, reservedAmount, workspace)
 * @throws InsufficientCreditsError if credit balance is insufficient
 * @throws SpendingLimitExceededError if any spending limit is exceeded
 */
export async function validateCreditsAndLimitsAndReserve(
  db: DatabaseSchema,
  workspaceId: string,
  agentId: string | undefined,
  provider: string,
  modelName: string,
  messages: ModelMessage[],
  systemPrompt?: string,
  toolDefinitions?: unknown[],
  usesByok?: boolean,
  context?: AugmentedContext,
  conversationId?: string
): Promise<CreditReservation | null> {
  // For BYOK requests, skip credit reservation but still check spending limits
  const isByok = usesByok === true;
  
  if (isByok) {
    console.log(
      "[validateCreditsAndLimitsAndReserve] Request made with user key (BYOK), skipping credit reservation but will check spending limits",
      { workspaceId, agentId }
    );
  }

  // Check if credit validation is disabled via feature flag
  // If disabled, skip credit balance check but still check spending limits
  const creditValidationEnabled = isCreditValidationEnabled();
  if (!creditValidationEnabled) {
    console.log(
      "[validateCreditsAndLimitsAndReserve] Credit validation disabled via feature flag, skipping credit balance check",
      { workspaceId, agentId }
    );
    // Still check spending limits if enabled
    if (!isSpendingLimitChecksEnabled()) {
      console.log(
        "[validateCreditsAndLimitsAndReserve] Spending limit checks also disabled, returning early",
        { workspaceId, agentId }
      );
      return null;
    }
  }

  // Check if spending limit checks are disabled via feature flag
  const spendingLimitsEnabled = isSpendingLimitChecksEnabled();
  if (!spendingLimitsEnabled) {
    console.log(
      "[validateCreditsAndLimitsAndReserve] Spending limit checks disabled via feature flag",
      { workspaceId, agentId }
    );
  }

  // Load workspace and agent
  const workspacePk = `workspaces/${workspaceId}`;
  const workspace = await db.workspace.get(workspacePk, "workspace");
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  let agent: AgentRecord | undefined;
  if (agentId) {
    const agentPk = `agents/${workspaceId}/${agentId}`;
    agent = await db.agent.get(agentPk, "agent");
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
  }

  // Estimate cost using token estimation (always in USD)
  const estimatedCost = estimateTokenCost(
    provider,
    modelName,
    messages,
    systemPrompt,
    toolDefinitions
  );

  // Check credit balance (only if validation is enabled and NOT BYOK)
  if (!isByok && creditValidationEnabled) {
    if (workspace.creditBalance < estimatedCost) {
      throw new InsufficientCreditsError(
        workspaceId,
        estimatedCost,
        workspace.creditBalance,
        "usd",
        agentId
      );
    }
  }

  // Check all spending limits (only if checks are enabled)
  // This applies to both regular requests and BYOK requests
  if (spendingLimitsEnabled) {
    const limitCheck = await checkSpendingLimits(
      db,
      workspace,
      agent,
      estimatedCost
    );

    if (!limitCheck.passed) {
      throw new SpendingLimitExceededError(
        workspaceId,
        limitCheck.failedLimits,
        agentId
      );
    }
  }

  // Reserve credits atomically (only if deduction is enabled and NOT BYOK)
  // ENABLE_CREDIT_DEDUCTION controls whether we actually charge the workspace
  if (!isByok && isCreditDeductionEnabled()) {
    const reservation = await reserveCredits(
      db,
      workspaceId,
      estimatedCost,
      3, // maxRetries
      usesByok,
      context,
      provider,
      modelName,
      agentId,
      conversationId
    );
    return reservation;
  }

  // If BYOK or deduction is disabled, return null (no reservation, no charge)
  if (isByok) {
    console.log(
      "[validateCreditsAndLimitsAndReserve] BYOK request - no credit reservation created, but spending limits were checked",
      { workspaceId, agentId, estimatedCost }
    );
  } else {
    console.log(
      "[validateCreditsAndLimitsAndReserve] Credit deduction disabled via feature flag, skipping reservation creation",
      { workspaceId, agentId, estimatedCost }
    );
  }
  return null;
}
