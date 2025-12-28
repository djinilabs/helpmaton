export type SubscriptionPlan = "free" | "starter" | "pro";

export interface PlanLimits {
  maxWorkspaces: number;
  maxDocuments: number;
  maxDocumentSizeBytes: number; // Total size across all documents
  maxAgents: number; // Total across all workspaces
  maxManagers?: number; // Maximum number of managers (undefined means unlimited)
  expiresAfterDays?: number; // Only for free plan (deprecated - free plans never expire)
  maxDailyRequests?: number; // Maximum LLM requests per 24 hours (rolling window)
  maxUsers: number; // Maximum number of unique users across all workspaces
  maxAgentKeys: number; // Maximum agent keys across all agents in subscription
  maxChannels: number; // Maximum output channels across all workspaces in subscription
  maxMcpServers: number; // Maximum MCP servers across all workspaces in subscription
}

const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free: {
    maxWorkspaces: 1,
    maxDocuments: 10,
    maxDocumentSizeBytes: 1024 * 1024, // 1 MB
    maxAgents: 1,
    maxManagers: 1,
    maxDailyRequests: 25,
    maxUsers: 1,
    maxAgentKeys: 5,
    maxChannels: 2,
    maxMcpServers: 2,
  },
  starter: {
    maxWorkspaces: 1,
    maxDocuments: 100,
    maxDocumentSizeBytes: 10 * 1024 * 1024, // 10 MB
    maxAgents: 5,
    maxManagers: 1,
    maxDailyRequests: 3000,
    maxUsers: 1,
    maxAgentKeys: 25,
    maxChannels: 10,
    maxMcpServers: 10,
  },
  pro: {
    maxWorkspaces: 5,
    maxDocuments: 1000,
    maxDocumentSizeBytes: 100 * 1024 * 1024, // 100 MB
    maxAgents: 50,
    maxDailyRequests: 10000,
    maxUsers: 5,
    // maxManagers: undefined (unlimited)
    maxAgentKeys: 250,
    maxChannels: 50,
    maxMcpServers: 50,
  },
};

/**
 * Get limits for a subscription plan
 * @param plan - Subscription plan name
 * @returns Plan limits or undefined if plan is invalid
 */
export function getPlanLimits(plan: string): PlanLimits | undefined {
  if (plan === "free" || plan === "starter" || plan === "pro") {
    const limits = { ...PLAN_LIMITS[plan] };

    // Override maxUsers for E2E tests if environment variable is set
    // This allows team invitation tests to work with free/starter plans
    if (process.env.E2E_OVERRIDE_MAX_USERS) {
      const overrideMaxUsers = parseInt(process.env.E2E_OVERRIDE_MAX_USERS, 10);
      if (!isNaN(overrideMaxUsers) && overrideMaxUsers > 0) {
        limits.maxUsers = overrideMaxUsers;
      }
    }

    return limits;
  }
  return undefined;
}

/**
 * Check if a free plan has expired
 * Free plans never expire, so this always returns false
 * @param _expiresAt - Expiration date as ISO string, or undefined if no expiration (deprecated, unused)
 * @returns false (free plans never expire)
 */
export function isFreePlanExpired(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _expiresAt: string | undefined
): boolean {
  // Free plans never expire
  return false;
}
