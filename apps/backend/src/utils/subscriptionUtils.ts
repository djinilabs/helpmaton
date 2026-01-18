import { randomUUID } from "crypto";

import { badRequest, boomify } from "@hapi/boom";

import { userRef } from "../http/utils/session";
import { database } from "../tables/database";
import { isUserAuthorized } from "../tables/permissions";
import {
  PERMISSION_LEVELS,
  type SubscriptionRecord,
  type WorkspaceRecord,
} from "../tables/schema";

import { associateSubscriptionWithPlan } from "./apiGatewayUsagePlans";
import { ensureError } from "./sentry";
import { getPlanLimits, isFreePlanExpired } from "./subscriptionPlans";

/**
 * Get or create a subscription for a user
 * If no subscription exists, automatically creates a free subscription (auto-migration)
 * @param userId - User ID
 * @returns Subscription record. May throw an error if subscription creation fails; never returns null/undefined.
 */
export async function getUserSubscription(
  userId: string
): Promise<SubscriptionRecord> {
  const db = await database();

  // Query subscriptions by userId using GSI
  const subscriptions = await db.subscription.query({
    IndexName: "byUserId",
    KeyConditionExpression: "userId = :userId",
    ExpressionAttributeValues: {
      ":userId": userId,
    },
  });

  // Get the first subscription (user should only have one)
  let subscription = subscriptions.items[0];

  if (!subscription) {
    // Auto-migration: create free subscription for existing users
    console.log(
      `[getUserSubscription] No subscription found for user ${userId}, creating free subscription`
    );
    subscription = await createFreeSubscription(userId);

    // Verify subscription was created
    if (!subscription) {
      throw new Error(`Failed to create subscription for user ${userId}`);
    }

    console.log(
      `[getUserSubscription] Created free subscription ${subscription.pk} for user ${userId}`
    );
  }

  return subscription;
}

/**
 * Get subscription by subscription ID
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @returns Subscription record or undefined if not found
 */
export async function getSubscriptionById(
  subscriptionId: string
): Promise<SubscriptionRecord | undefined> {
  console.log(
    `[getSubscriptionById] Getting subscription by subscriptionId: ${subscriptionId}`
  );
  const db = await database();
  const subscriptionPk = `subscriptions/${subscriptionId}`;
  const subscriptionSk = "subscription";
  return await db.subscription.get(subscriptionPk, subscriptionSk);
}

/**
 * Create a free subscription for a user (never expires)
 * @param userId - User ID
 * @returns Created subscription record
 */
export async function createFreeSubscription(
  userId: string
): Promise<SubscriptionRecord> {
  const db = await database();
  const subscriptionId = randomUUID();
  const subscriptionPk = `subscriptions/${subscriptionId}`;
  const subscriptionSk = "subscription";
  const userRefStr = userRef(userId);

  console.log(
    `[createFreeSubscription] Creating subscription for user ${userId}, subscriptionId: ${subscriptionId}`
  );

  // Step 1: Associate subscription with usage plan in API Gateway BEFORE creating subscription
  // This ensures the API key exists before the subscription record is created
  console.log(
    `[createFreeSubscription] Associating subscription ${subscriptionId} with free usage plan`
  );
  const apiKeyId = await associateSubscriptionWithPlan(subscriptionId, "free");
  console.log(
    `[createFreeSubscription] API key ${apiKeyId} created and associated with free plan`
  );

  // Step 2: Create subscription record with apiKeyId already populated
  const subscription = await db.subscription.create({
    pk: subscriptionPk,
    sk: subscriptionSk,
    userId,
    plan: "free",
    status: "active", // Free subscriptions are always active
    expiresAt: undefined, // Free subscriptions never expire
    createdBy: userRefStr,
    apiKeyId, // Include the API key ID from step 1
  });

  if (!subscription) {
    throw new Error(`Failed to create subscription record for user ${userId}`);
  }

  console.log(
    `[createFreeSubscription] Subscription created: ${subscription.pk} with API key ${apiKeyId}`
  );

  // Step 3: Grant creator OWNER permission
  // Note: We need to manually create the permission with resourceType "subscriptions"
  const { permission } = await database();
  await permission.create({
    pk: subscriptionPk,
    sk: userRefStr,
    resourceType: "subscriptions",
    type: PERMISSION_LEVELS.OWNER,
    createdBy: userRefStr,
  });

  console.log(
    `[createFreeSubscription] Manager permission created for user ${userId}`
  );

  return subscription;
}

/**
 * Get all workspaces for a subscription
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @returns Array of workspace records
 */
export async function getSubscriptionWorkspaces(
  subscriptionId: string
): Promise<WorkspaceRecord[]> {
  const db = await database();

  // Query workspaces using the bySubscriptionId GSI for efficient lookup
  const workspacesQuery = await db.workspace.query({
    IndexName: "bySubscriptionId",
    KeyConditionExpression: "subscriptionId = :subscriptionId",
    ExpressionAttributeValues: {
      ":subscriptionId": subscriptionId,
    },
  });

  return workspacesQuery.items;
}

/**
 * Get all documents for a subscription with total size
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @returns Object with documents array and totalSize in bytes
 */
export async function getSubscriptionDocuments(
  subscriptionId: string
): Promise<{
  documents: Array<{ workspaceId: string; documentId: string; size: number }>;
  totalSize: number;
}> {
  const db = await database();
  const workspaces = await getSubscriptionWorkspaces(subscriptionId);

  const allDocuments: Array<{
    workspaceId: string;
    documentId: string;
    size: number;
  }> = [];
  let totalSize = 0;

  for (const workspace of workspaces) {
    const workspaceId = workspace.pk.replace("workspaces/", "");
    const documents = await db["workspace-document"].query({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });

    for (const doc of documents.items) {
      const documentId = doc.pk.replace(
        `workspace-documents/${workspaceId}/`,
        ""
      );
      allDocuments.push({
        workspaceId,
        documentId,
        size: doc.size,
      });
      totalSize += doc.size;
    }
  }

  return { documents: allDocuments, totalSize };
}

/**
 * Get total agent count across all workspaces in a subscription
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @returns Total number of agents
 */
export async function getSubscriptionAgents(
  subscriptionId: string
): Promise<number> {
  const db = await database();
  const workspaces = await getSubscriptionWorkspaces(subscriptionId);

  let totalAgents = 0;

  for (const workspace of workspaces) {
    const workspaceId = workspace.pk.replace("workspaces/", "");
    const agents = await db.agent.query({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });
    totalAgents += agents.items.length;
  }

  return totalAgents;
}

/**
 * Get total agent key count across all agents in a subscription
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @returns Total number of agent keys
 */
export async function getSubscriptionAgentKeys(
  subscriptionId: string
): Promise<number> {
  const db = await database();
  const workspaces = await getSubscriptionWorkspaces(subscriptionId);

  let totalAgentKeys = 0;

  for (const workspace of workspaces) {
    const workspaceId = workspace.pk.replace("workspaces/", "");
    const agents = await db.agent.query({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });

    for (const agent of agents.items) {
      const agentId = agent.pk.replace(`agents/${workspaceId}/`, "");
      const keys = await db["agent-key"].query({
        IndexName: "byAgentId",
        KeyConditionExpression: "agentId = :agentId",
        ExpressionAttributeValues: {
          ":agentId": agentId,
        },
      });
      // Filter to only keys for this workspace
      const workspaceKeys = keys.items.filter(
        (k) => k.workspaceId === workspaceId
      );
      totalAgentKeys += workspaceKeys.length;
    }
  }

  return totalAgentKeys;
}

/**
 * Get total output channel count across all workspaces in a subscription
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @returns Total number of output channels
 */
export async function getSubscriptionChannels(
  subscriptionId: string
): Promise<number> {
  const db = await database();
  const workspaces = await getSubscriptionWorkspaces(subscriptionId);

  let totalChannels = 0;

  for (const workspace of workspaces) {
    const workspaceId = workspace.pk.replace("workspaces/", "");
    const channels = await db["output_channel"].query({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });
    totalChannels += channels.items.length;
  }

  return totalChannels;
}

/**
 * Get total MCP server count across all workspaces in a subscription
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @returns Total number of MCP servers
 */
export async function getSubscriptionMcpServers(
  subscriptionId: string
): Promise<number> {
  const db = await database();
  const workspaces = await getSubscriptionWorkspaces(subscriptionId);

  let totalMcpServers = 0;

  for (const workspace of workspaces) {
    const workspaceId = workspace.pk.replace("workspaces/", "");
    const servers = await db["mcp-server"].query({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });
    totalMcpServers += servers.items.length;
  }

  return totalMcpServers;
}

/**
 * Check subscription limits before performing an action
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @param checkType - Type of limit to check
 * @param additionalCount - Additional count to add (for checking if action would exceed limit)
 * @param additionalSize - Additional size in bytes (for document checks)
 * @throws badRequest if limit would be exceeded
 */
export async function checkSubscriptionLimits(
  subscriptionId: string,
  checkType:
    | "workspace"
    | "document"
    | "agent"
    | "agentKey"
    | "channel"
    | "mcpServer",
  additionalCount: number = 0,
  additionalSize: number = 0
): Promise<void> {
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw badRequest("Subscription not found");
  }

  const limits = getPlanLimits(subscription.plan);
  if (!limits) {
    throw badRequest(`Invalid subscription plan: ${subscription.plan}`);
  }

  if (checkType === "workspace") {
    const workspaces = await getSubscriptionWorkspaces(subscriptionId);
    const currentCount = workspaces.length;
    if (currentCount + additionalCount > limits.maxWorkspaces) {
      throw badRequest(
        `Workspace limit exceeded. Maximum ${limits.maxWorkspaces} workspace(s) allowed for ${subscription.plan} plan.`
      );
    }
  } else if (checkType === "document") {
    const { documents, totalSize } = await getSubscriptionDocuments(
      subscriptionId
    );
    const currentCount = documents.length;
    const currentSize = totalSize;

    if (currentCount + additionalCount > limits.maxDocuments) {
      throw badRequest(
        `Document count limit exceeded. Maximum ${limits.maxDocuments} document(s) allowed for ${subscription.plan} plan.`
      );
    }

    if (currentSize + additionalSize > limits.maxDocumentSizeBytes) {
      const maxSizeMB = limits.maxDocumentSizeBytes / (1024 * 1024);
      throw badRequest(
        `Document size limit exceeded. Maximum ${maxSizeMB} MB total size allowed for ${subscription.plan} plan.`
      );
    }
  } else if (checkType === "agent") {
    const currentCount = await getSubscriptionAgents(subscriptionId);
    if (currentCount + additionalCount > limits.maxAgents) {
      throw badRequest(
        `Agent limit exceeded. Maximum ${limits.maxAgents} agent(s) allowed for ${subscription.plan} plan.`
      );
    }
  } else if (checkType === "agentKey") {
    const currentCount = await getSubscriptionAgentKeys(subscriptionId);
    if (currentCount + additionalCount > limits.maxAgentKeys) {
      throw badRequest(
        `Agent key limit exceeded. Maximum ${limits.maxAgentKeys} agent key(s) allowed for ${subscription.plan} plan.`
      );
    }
  } else if (checkType === "channel") {
    const currentCount = await getSubscriptionChannels(subscriptionId);
    if (currentCount + additionalCount > limits.maxChannels) {
      throw badRequest(
        `Channel limit exceeded. Maximum ${limits.maxChannels} channel(s) allowed for ${subscription.plan} plan.`
      );
    }
  } else if (checkType === "mcpServer") {
    const currentCount = await getSubscriptionMcpServers(subscriptionId);
    if (currentCount + additionalCount > limits.maxMcpServers) {
      throw badRequest(
        `MCP server limit exceeded. Maximum ${limits.maxMcpServers} MCP server(s) allowed for ${subscription.plan} plan.`
      );
    }
  }
}

async function countByAgentId(options: {
  tableName: "agent-eval-judge" | "agent-schedule";
  agentId: string;
  workspaceId: string;
}): Promise<number> {
  const { tableName, agentId, workspaceId } = options;
  const db = await database();
  let count = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = (db as any)[tableName];
  for await (const item of table.queryAsync({
    IndexName: "byAgentId",
    KeyConditionExpression: "agentId = :agentId",
    ExpressionAttributeValues: {
      ":agentId": agentId,
    },
  })) {
    if (item.workspaceId === workspaceId) {
      count += 1;
    }
  }
  return count;
}

export async function checkAgentEvalJudgeLimit(
  subscriptionId: string,
  workspaceId: string,
  agentId: string
): Promise<void> {
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw badRequest("Subscription not found");
  }

  const limits = getPlanLimits(subscription.plan);
  if (!limits) {
    throw badRequest(`Invalid subscription plan: ${subscription.plan}`);
  }

  const currentCount = await countByAgentId({
    tableName: "agent-eval-judge",
    agentId,
    workspaceId,
  });
  if (currentCount >= limits.maxEvalJudgesPerAgent) {
    throw badRequest(
      `Eval judge limit exceeded. Maximum ${limits.maxEvalJudgesPerAgent} eval judge(s) allowed per agent for ${subscription.plan} plan.`
    );
  }
}

export async function checkAgentScheduleLimit(
  subscriptionId: string,
  workspaceId: string,
  agentId: string
): Promise<void> {
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw badRequest("Subscription not found");
  }

  const limits = getPlanLimits(subscription.plan);
  if (!limits) {
    throw badRequest(`Invalid subscription plan: ${subscription.plan}`);
  }

  const currentCount = await countByAgentId({
    tableName: "agent-schedule",
    agentId,
    workspaceId,
  });
  if (currentCount >= limits.maxAgentSchedulesPerAgent) {
    throw badRequest(
      `Agent schedule limit exceeded. Maximum ${limits.maxAgentSchedulesPerAgent} schedule(s) allowed per agent for ${subscription.plan} plan.`
    );
  }
}

/**
 * Check if a user is a manager of a subscription
 * @param userId - User ID
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @returns true if user is a manager, false otherwise
 */
export async function isSubscriptionManager(
  userId: string,
  subscriptionId: string
): Promise<boolean> {
  const subscriptionPk = `subscriptions/${subscriptionId}`;
  const userRefStr = userRef(userId);
  const [isAuthorized] = await isUserAuthorized(
    userRefStr,
    subscriptionPk,
    PERMISSION_LEVELS.READ
  );
  return isAuthorized;
}

/**
 * Get all managers of a subscription
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @returns Array of user IDs who are managers
 */
export async function getSubscriptionManagers(
  subscriptionId: string
): Promise<string[]> {
  const db = await database();
  const subscriptionPk = `subscriptions/${subscriptionId}`;

  // Query permissions by resourceType and sk (user reference)
  // Since we need all permissions for this subscription, we query by resourceType
  const permissions = await db.permission.query({
    IndexName: "byResourceTypeAndEntityId",
    KeyConditionExpression: "resourceType = :resourceType",
    FilterExpression: "pk = :pk",
    ExpressionAttributeValues: {
      ":resourceType": "subscriptions",
      ":pk": subscriptionPk,
    },
  });

  return permissions.items
    .filter((p) => p.type >= PERMISSION_LEVELS.READ)
    .map((p) => p.sk.replace("users/", ""));
}

/**
 * Remove a user's subscription (only free subscriptions can be removed)
 * This deletes the subscription record and all associated permissions
 * @param userId - User ID whose subscription should be removed
 * @throws badRequest if subscription is not free
 */
export async function removeUserSubscription(userId: string): Promise<void> {
  const db = await database();

  // Query subscriptions by userId using GSI (don't use getUserSubscription as it auto-creates)
  const subscriptions = await db.subscription.query({
    IndexName: "byUserId",
    KeyConditionExpression: "userId = :userId",
    ExpressionAttributeValues: {
      ":userId": userId,
    },
  });

  // Get the first subscription (user should only have one)
  const userSubscription = subscriptions.items[0];

  if (!userSubscription) {
    // No subscription to remove - that's fine
    return;
  }

  // Only free subscriptions can be removed
  if (userSubscription.plan !== "free") {
    throw badRequest(
      "Cannot remove non-free subscription. Only free subscriptions can be removed."
    );
  }

  const subscriptionPk = userSubscription.pk;
  const subscriptionId = subscriptionPk.replace("subscriptions/", "");

  // Delete all permissions associated with this subscription
  const permissions = await db.permission.query({
    IndexName: "byResourceTypeAndEntityId",
    KeyConditionExpression: "resourceType = :resourceType",
    FilterExpression: "pk = :pk",
    ExpressionAttributeValues: {
      ":resourceType": "subscriptions",
      ":pk": subscriptionPk,
    },
  });

  // Delete all permission records
  for (const permission of permissions.items) {
    await db.permission.delete(permission.pk, permission.sk);
  }

  // Delete the subscription record
  await db.subscription.delete(subscriptionPk, "subscription");

  console.log(
    `[removeUserSubscription] Removed free subscription ${subscriptionId} for user ${userId}`
  );
}

/**
 * Add a manager to a subscription
 * Before adding, removes the user's current subscription (if free) since one user can only have one subscription
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @param userId - User ID to add as manager
 * @param addedBy - User ID who is adding the manager
 */
export async function addSubscriptionManager(
  subscriptionId: string,
  userId: string,
  addedBy: string
): Promise<void> {
  const db = await database();
  const subscriptionPk = `subscriptions/${subscriptionId}`;
  const userRefStr = userRef(userId);
  const addedByRef = userRef(addedBy);

  // Check if user is already a manager
  const isAlreadyManager = await isSubscriptionManager(userId, subscriptionId);
  if (isAlreadyManager) {
    throw badRequest("User is already a manager of this subscription.");
  }

  // Remove user's current subscription before adding them as a manager
  // This ensures one user can only have one subscription
  // Non-free subscriptions cannot be removed and will throw an error
  await removeUserSubscription(userId);

  // Grant manager permission (OWNER level) with resourceType "subscriptions"
  await db.permission.create({
    pk: subscriptionPk,
    sk: userRefStr,
    resourceType: "subscriptions",
    type: PERMISSION_LEVELS.OWNER,
    createdBy: addedByRef,
  });
}

/**
 * Remove a manager from a subscription
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @param userId - User ID to remove as manager
 */
export async function removeSubscriptionManager(
  subscriptionId: string,
  userId: string
): Promise<void> {
  const db = await database();
  const subscriptionPk = `subscriptions/${subscriptionId}`;
  const userRefStr = userRef(userId);

  // Note: We don't check manager count here because validateCanRemoveManager
  // should be called before this function. This is intentional defense-in-depth,
  // but the primary validation happens in validateCanRemoveManager.
  // This prevents orphaned subscriptions.

  // Remove permission
  await db.permission.delete(subscriptionPk, userRefStr);
}

/**
 * Validate if a user can be added as a manager
 * User must not have a subscription OR be in a free subscription
 * Also checks if the target subscription has reached its manager limit
 * @param userId - User ID to validate
 * @param subscriptionId - Subscription ID to check manager limit for
 * @throws badRequest if user cannot be added as manager
 */
export async function validateCanAddAsManager(
  userId: string,
  subscriptionId: string
): Promise<void> {
  // Check manager limit for the target subscription
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw badRequest("Subscription not found");
  }

  const limits = getPlanLimits(subscription.plan);
  if (limits && limits.maxManagers !== undefined) {
    const currentManagers = await getSubscriptionManagers(subscriptionId);
    if (currentManagers.length >= limits.maxManagers) {
      throw badRequest(
        `Free and starter plans can only have one manager. This subscription already has the maximum number of managers.`
      );
    }
  }

  // Check if target user can be added (must not have subscription OR be in free subscription)
  try {
    const targetUserSubscription = await getUserSubscription(userId);
    // If user has a subscription that is not free, they cannot be added
    if (targetUserSubscription.plan !== "free") {
      throw badRequest(
        "User already has a non-free subscription and cannot be added as a manager."
      );
    }
    // If user has a free subscription, they can be added (they'll leave their free subscription)
  } catch (error) {
    // Boomify the error to normalize it
    const boomError = boomify(ensureError(error));

    // Only ignore if it's a Boom "not found" error (user has no subscription)
    if (boomError.output.statusCode === 404) {
      // User has no subscription, can be added as manager
      return;
    }
    // Otherwise, propagate the error (including other Boom errors like badRequest)
    throw boomError;
  }
}

/**
 * Validate if a manager can be removed from a subscription
 * Subscription must have more than one manager
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @throws badRequest if manager cannot be removed
 */
export async function validateCanRemoveManager(
  subscriptionId: string
): Promise<void> {
  const managers = await getSubscriptionManagers(subscriptionId);
  if (managers.length <= 1) {
    throw badRequest(
      "Cannot remove the last manager. A subscription must have at least one manager."
    );
  }
}

/**
 * Check if a workspace's free plan has expired and throw an error if so
 * This is a shared utility to avoid code duplication across endpoints
 * @param workspaceId - Workspace ID (without "workspaces/" prefix)
 * @throws badRequest if the free plan has expired
 */
export async function checkFreePlanExpiration(
  workspaceId: string
): Promise<void> {
  const subscription = await getWorkspaceSubscription(workspaceId);
  if (subscription && subscription.plan === "free") {
    if (isFreePlanExpired(subscription.expiresAt)) {
      throw badRequest(
        "Your free plan has expired. Agents are no longer available. Please upgrade your subscription to continue using agents."
      );
    }
  }
}

/**
 * Ensure a workspace has a subscription, auto-associating with user's subscription if needed
 * This helper function reduces code duplication in agent creation and document upload endpoints
 * @param workspaceId - Workspace ID (without "workspaces/" prefix)
 * @param userId - User ID
 * @returns Subscription ID (without "subscriptions/" prefix)
 * @throws badRequest if subscription association fails
 */
export async function ensureWorkspaceSubscription(
  workspaceId: string,
  userId: string
): Promise<string> {
  let subscription = await getWorkspaceSubscription(workspaceId);

  if (!subscription) {
    const userSubscription = await getUserSubscription(userId);
    const subscriptionId = userSubscription.pk.replace("subscriptions/", "");
    await associateWorkspaceWithSubscription(workspaceId, subscriptionId);

    subscription = await getWorkspaceSubscription(workspaceId);
    if (!subscription) {
      throw badRequest("Failed to associate workspace with subscription");
    }
  }

  return subscription.pk.replace("subscriptions/", "");
}

/**
 * Get subscription for a workspace
 * @param workspaceId - Workspace ID (without "workspaces/" prefix)
 * @returns Subscription record or undefined if workspace has no subscription
 */
export async function getWorkspaceSubscription(
  workspaceId: string
): Promise<SubscriptionRecord | undefined> {
  const db = await database();
  console.log(
    `[getWorkspaceSubscription] Getting workspace subscription for workspaceId: ${workspaceId}`
  );
  const workspacePk = `workspaces/${workspaceId}`;
  console.log(`[getWorkspaceSubscription] Workspace PK: ${workspacePk}`);
  const workspace = await db.workspace.get(workspacePk, "workspace");

  if (!workspace || !workspace.subscriptionId) {
    return undefined;
  }

  return await getSubscriptionById(workspace.subscriptionId);
}

/**
 * Associate a workspace with a subscription
 * Also handles migration of existing workspaces without subscriptionId
 * @param workspaceId - Workspace ID (without "workspaces/" prefix)
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 */
export async function associateWorkspaceWithSubscription(
  workspaceId: string,
  subscriptionId: string
): Promise<void> {
  const db = await database();
  const workspacePk = `workspaces/${workspaceId}`;
  const workspace = await db.workspace.get(workspacePk, "workspace");

  if (!workspace) {
    throw badRequest("Workspace not found");
  }

  workspace.subscriptionId = subscriptionId;
  await db.workspace.update(workspace);
}

/**
 * Get user email by user ID
 * @param userId - User ID
 * @returns User email or undefined if not found or on any error
 */
export async function getUserEmailById(
  userId: string
): Promise<string | undefined> {
  try {
    // DynamoDBAdapter stores users with:
    // - pk = USER#{userId}
    // - sk = USER#{userId}
    // - type = "USER"
    // - email field (required for user records)
    // See: @auth/dynamodb-adapter/src/index.ts createUser() and getUser() methods
    const userPk = `USER#${userId}`;
    const userSk = `USER#${userId}`;

    // Use low-level table directly to avoid Zod validation errors
    // Account records don't have email field and will fail schema validation
    const db = await database();

    const lowLevelTable = db["next-auth"];

    try {
      // Use the same key pattern as DynamoDBAdapter.getUser()
      const rawItem = await lowLevelTable.get(userPk, userSk);

      // Validate it's a user record (not an account record):
      // - User records: pk = USER#{userId}, sk = USER#{userId}, type = "USER", has email
      // - Account records: pk = USER#{userId}, sk = ACCOUNT#{provider}#{providerAccountId}, no email
      // Note: The 'type' field is set by DynamoDBAdapter but may not be in the schema
      if (
        rawItem &&
        rawItem.sk === userSk && // Must match USER#{userId} (not ACCOUNT#...)
        rawItem.email // User records have email, account records don't
      ) {
        // Check type field if available (DynamoDBAdapter sets type: "USER")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const item = rawItem as any;
        if (item.type === undefined || item.type === "USER") {
          return rawItem.email;
        }
      }
    } catch (err) {
      console.error("[getUserEmailById] Error getting user email:", err);
      // If get fails, user record doesn't exist
    }

    return undefined;
  } catch (error) {
    console.error("[getUserEmailById] Error getting user email:", error);
    return undefined;
  }
}

/**
 * Get user by email address
 * @param email - Email address
 * @returns User ID and email, or undefined if not found
 */
export async function getUserByEmail(
  email: string
): Promise<{ userId: string; email: string } | undefined> {
  try {
    const normalizedEmail = email.toLowerCase().trim();

    // DynamoDBAdapter stores users with email in the record.
    // This function queries the "GSI2" index, which must be configured as follows:
    //   - GSI1PK: partition key, value should be "USER#{email}"
    //   - GSI1SK: sort key, value should be "USER#{email}"
    // Ensure that the "next-auth" table has a GSI named "GSI2" with these keys.

    const client = await database();
    const table = client["next-auth"];
    const gsi1Pk = `USER#${normalizedEmail}`;
    const gsi1Sk = `USER#${normalizedEmail}`;

    // Query GSI1 for users with matching email
    let result;
    try {
      result = await table.query({
        IndexName: "GSI2",
        KeyConditionExpression: "gsi1pk = :gsi1Pk AND gsi1sk = :gsi1Sk",
        ExpressionAttributeValues: {
          ":gsi1Pk": gsi1Pk,
          ":gsi1Sk": gsi1Sk,
        },
      });
    } catch (gsiError) {
      // Likely cause: GSI1 is not configured correctly
      console.error(
        "[getUserByEmail] Failed to query GSI2. Ensure the 'next-auth' table has a GSI named 'GSI2' with GSI1PK and GSI1SK as keys.",
        gsiError
      );
      throw badRequest(
        "User lookup failed: GSI2 is not configured correctly on the 'next-auth' table."
      );
    }

    const user = result.items[0];
    if (!user) {
      return undefined;
    }
    return { userId: user.id ?? "", email: user.email ?? "" };
  } catch (error) {
    console.error("[getUserByEmail] Error getting user by email:", error);
    // If it's already a Boom error (intentional error like badRequest), throw it
    if (
      error &&
      typeof error === "object" &&
      "isBoom" in error &&
      (error as { isBoom: boolean }).isBoom
    ) {
      throw error;
    }
    // For unexpected errors, boomify to normalize them
    // Server errors (5xx) should be thrown, client errors (4xx) can be returned as undefined
    const boomError = boomify(ensureError(error));
    if (boomError.output.statusCode >= 500) {
      throw boomError;
    }
    return undefined;
  }
}

/**
 * Get unique users (by email) across all workspaces in a subscription
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @returns Object with count and array of unique email addresses
 */
export async function getSubscriptionUniqueUsers(
  subscriptionId: string
): Promise<{ count: number; emails: string[] }> {
  const db = await database();
  const workspaces = await getSubscriptionWorkspaces(subscriptionId);

  const uniqueEmails = new Set<string>();

  for (const workspace of workspaces) {
    const workspacePk = workspace.pk;
    // Query all permissions for this workspace
    const permissions = await db.permission.query({
      IndexName: "byResourceTypeAndEntityId",
      KeyConditionExpression: "resourceType = :resourceType",
      FilterExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":resourceType": "workspaces",
        ":pk": workspacePk,
      },
    });

    // Extract user emails from permissions
    for (const permission of permissions.items) {
      const userId = permission.sk.replace("users/", "");
      const email = await getUserEmailById(userId);
      if (email) {
        uniqueEmails.add(email.toLowerCase());
      }
    }
  }

  return {
    count: uniqueEmails.size,
    emails: Array.from(uniqueEmails),
  };
}

/**
 * Check if adding a user would exceed the subscription's user limit
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @param additionalUserEmail - Email of user to be added (optional, for checking if already counted)
 * @throws badRequest if limit would be exceeded
 */
export async function checkUserLimit(
  subscriptionId: string,
  additionalUserEmail?: string
): Promise<void> {
  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription) {
    throw badRequest("Subscription not found");
  }

  const limits = getPlanLimits(subscription.plan);
  if (!limits) {
    throw badRequest(`Invalid subscription plan: ${subscription.plan}`);
  }

  const { count, emails } = await getSubscriptionUniqueUsers(subscriptionId);

  // If additionalUserEmail is provided, check if already counted
  let effectiveCount = count;
  if (additionalUserEmail) {
    const normalizedEmail = additionalUserEmail.toLowerCase();
    if (!emails.includes(normalizedEmail)) {
      effectiveCount = count + 1;
    }
  }

  if (effectiveCount > limits.maxUsers) {
    throw badRequest(
      `User limit exceeded. Maximum ${limits.maxUsers} user(s) allowed for ${subscription.plan} plan.`
    );
  }
}
