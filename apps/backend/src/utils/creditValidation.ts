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
  isSpendingLimitChecksEnabled,
} from "./featureFlags";
import { checkSpendingLimits } from "./spendingLimits";
import { estimateTokenCost } from "./tokenEstimation";

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
  // Skip validation if request was made with user key (BYOK)
  if (usesByok) {
    console.log(
      "[validateCreditsAndLimits] Request made with user key (BYOK), skipping credit validation",
      { workspaceId, agentId }
    );
    return;
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

  // Check credit balance (only if validation is enabled)
  if (isCreditValidationEnabled()) {
    if (workspace.creditBalance < estimatedCost) {
      throw new InsufficientCreditsError(
        workspaceId,
        estimatedCost,
        workspace.creditBalance,
        "usd"
      );
    }
  }

  // Check all spending limits (only if checks are enabled)
  if (spendingLimitsEnabled) {
    const limitCheck = await checkSpendingLimits(
      db,
      workspace,
      agent,
      estimatedCost
    );

    if (!limitCheck.passed) {
      throw new SpendingLimitExceededError(limitCheck.failedLimits);
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
  usesByok?: boolean
): Promise<CreditReservation | null> {
  // Skip validation if request was made with user key (BYOK)
  if (usesByok) {
    console.log(
      "[validateCreditsAndLimitsAndReserve] Request made with user key (BYOK), skipping credit validation",
      { workspaceId, agentId }
    );
    return null;
  }

  // Check if credit validation is disabled via feature flag
  if (!isCreditValidationEnabled()) {
    console.log(
      "[validateCreditsAndLimitsAndReserve] Credit validation disabled via feature flag, skipping validation",
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

  // Check all spending limits (only if checks are enabled)
  if (spendingLimitsEnabled) {
    const limitCheck = await checkSpendingLimits(
      db,
      workspace,
      agent,
      estimatedCost
    );

    if (!limitCheck.passed) {
      throw new SpendingLimitExceededError(limitCheck.failedLimits);
    }
  }

  // Reserve credits atomically (only if validation is enabled)
  if (isCreditValidationEnabled()) {
    const reservation = await reserveCredits(
      db,
      workspaceId,
      estimatedCost,
      3, // maxRetries
      usesByok
    );
    return reservation;
  }

  // If validation is disabled, return null (no reservation)
  return null;
}
