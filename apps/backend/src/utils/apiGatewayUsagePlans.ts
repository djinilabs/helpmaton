import {
  APIGatewayClient,
  GetApiKeysCommand,
  CreateApiKeyCommand,
  CreateUsagePlanKeyCommand,
  DeleteUsagePlanKeyCommand,
  GetUsagePlansCommand,
  GetUsagePlanCommand,
  UpdateUsagePlanCommand,
  GetApiKeyCommand,
  UpdateApiKeyCommand,
} from "@aws-sdk/client-api-gateway";

import { database } from "../tables/database";

import { Sentry, ensureError } from "./sentry";

/**
 * Global cache for usage plan IDs to avoid repeated API calls within the same Lambda execution context
 * Key format: `${stackName}-${planName}` (e.g., "HelpmatonStagingPR22-free")
 * This cache persists across multiple function calls within the same Lambda container
 */
const usagePlanIdCache: Record<string, string> = {};

/**
 * Get cache key for a usage plan
 */
function getUsagePlanCacheKey(plan: "free" | "starter" | "pro"): string {
  const stackName =
    process.env.ARC_STACK_NAME || process.env.AWS_STACK_NAME || "default";
  return `${stackName}-${plan}`;
}

/**
 * Get API Gateway REST API client using AWS SDK
 * Note: @aws-lite/apigatewayv2 is for HTTP API v2, not REST API
 * We need to use AWS SDK directly for REST API operations
 */
function getApiGatewayClient(): APIGatewayClient {
  const region = process.env.AWS_REGION || "eu-west-2";
  return new APIGatewayClient({ region });
}

/**
 * Get REST API ID from environment variable or CloudFormation stack
 * @returns REST API ID
 */
async function getRestApiId(): Promise<string> {
  // First check environment variable
  const restApiId = process.env.API_GATEWAY_REST_API_ID;
  if (restApiId) {
    console.log(
      `[apiGatewayUsagePlans] Using REST API ID from environment variable: ${restApiId}`
    );
    return restApiId;
  }

  // Fallback: Try to get from CloudFormation stack
  // This would require CloudFormation client, but for now we'll throw an error
  // The environment variable should be set by the plugin
  throw new Error(
    "REST_API_ID not found. Set API_GATEWAY_REST_API_ID environment variable."
  );
}

/**
 * Get API stage name from environment variable
 * @returns Stage name (e.g., "staging", "production")
 */
function getApiStageName(): string {
  // Check environment variables in order of preference
  const stageName =
    process.env.ARC_ENV ||
    process.env.ARC_STAGE ||
    process.env.ARC_DEPLOY ||
    process.env.API_STAGE_NAME ||
    "staging";

  console.log(`[apiGatewayUsagePlans] Using API stage name: ${stageName}`);
  return stageName;
}

/**
 * Get usage plan ID from environment variable, cache, or by looking up by stack-specific name
 * @param plan - Subscription plan name
 * @returns Usage plan ID
 */
async function getUsagePlanId(
  plan: "free" | "starter" | "pro"
): Promise<string> {
  const envVarName = `USAGE_PLAN_${plan.toUpperCase()}_ID`;
  const planId = process.env[envVarName];

  // First check environment variable
  if (planId) {
    console.log(
      `[apiGatewayUsagePlans] Using usage plan ID for ${plan} from environment variable ${envVarName}: ${planId}`
    );
    return planId;
  }

  // Check cache
  const cacheKey = getUsagePlanCacheKey(plan);
  const cachedPlanId = usagePlanIdCache[cacheKey];

  if (cachedPlanId) {
    console.log(
      `[apiGatewayUsagePlans] Using cached usage plan ID for ${plan} (${cacheKey}): ${cachedPlanId}`
    );
    return cachedPlanId;
  }

  // Fallback: Look up usage plan by stack-specific name
  // This avoids needing environment variables and prevents circular dependencies
  // Usage plans are account-global, so we need stack-specific names to avoid conflicts
  const stackName =
    process.env.ARC_STACK_NAME || process.env.AWS_STACK_NAME || "default";
  const uniquePlanName = `${stackName}-${plan}`;

  console.log(
    `[apiGatewayUsagePlans] Usage plan ID not in env var ${envVarName} and not in cache, looking up by name: ${uniquePlanName}`
  );

  const apiGateway = getApiGatewayClient();

  try {
    // Use AWS SDK to get usage plans
    const command = new GetUsagePlansCommand({});
    const response = await apiGateway.send(command);

    if (response.items) {
      const matchingPlan = response.items.find(
        (p) => p.name === uniquePlanName
      );

      if (matchingPlan?.id) {
        // Store in cache for future use
        usagePlanIdCache[cacheKey] = matchingPlan.id;

        console.log(
          `[apiGatewayUsagePlans] Found usage plan ${uniquePlanName} with ID: ${matchingPlan.id} (cached for future use)`
        );
        return matchingPlan.id;
      }
    }

    throw new Error(
      `Usage plan with name "${uniquePlanName}" not found. Set ${envVarName} environment variable or ensure the usage plan exists.`
    );
  } catch (error) {
    console.error(
      `[apiGatewayUsagePlans] Error looking up usage plan ${uniquePlanName}:`,
      error
    );
    throw new Error(
      `Failed to get usage plan ID for ${plan}. Set ${envVarName} environment variable or ensure the usage plan "${uniquePlanName}" exists. Original error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Get or create API key for a subscription
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @param includeValue - Whether to return the API key value (only available on creation or with includeValue: true)
 * @returns API key ID, or object with both ID and value if includeValue is true
 */
export async function getOrCreateApiKeyForSubscription(
  subscriptionId: string,
  includeValue: boolean = false
): Promise<string | { id: string; value: string | undefined }> {
  // Get stack name to make API key names unique per stack
  // This prevents conflicts when multiple stacks run in the same AWS account
  const stackName =
    process.env.ARC_STACK_NAME || process.env.AWS_STACK_NAME || "default";
  const apiKeyName = `${stackName}-subscription-${subscriptionId}`;
  const apiGateway = getApiGatewayClient();

  try {
    // Try to find existing API key by name
    // Use AWS SDK GetApiKeysCommand with nameQuery parameter
    const getKeysCommand = new GetApiKeysCommand({
      nameQuery: apiKeyName,
      includeValues: false,
    });
    const response = await apiGateway.send(getKeysCommand);

    // Check if we found a matching key
    if (response.items && response.items.length > 0) {
      const matchingKey = response.items.find((key) => key.name === apiKeyName);

      if (matchingKey?.id) {
        // Verify the key is enabled by fetching its details
        try {
          const getKeyCommand = new GetApiKeyCommand({
            apiKey: matchingKey.id,
            includeValue: false,
          });
          const keyDetails = await apiGateway.send(getKeyCommand);

          if (keyDetails.enabled === true) {
            console.log(
              `[apiGatewayUsagePlans] Found existing enabled API key for subscription ${subscriptionId}: ${matchingKey.id}`
            );
            if (includeValue) {
              // Try to get the value (may not be available for existing keys)
              try {
                const getKeyWithValueCommand = new GetApiKeyCommand({
                  apiKey: matchingKey.id,
                  includeValue: true,
                });
                const keyWithValue = await apiGateway.send(
                  getKeyWithValueCommand
                );
                return {
                  id: matchingKey.id,
                  value: keyWithValue.value || undefined,
                };
              } catch {
                // Value not available for existing keys (only on creation)
                console.warn(
                  `[apiGatewayUsagePlans] Could not retrieve API key value for existing key ${matchingKey.id}`
                );
                return {
                  id: matchingKey.id,
                  value: undefined,
                };
              }
            }
            return matchingKey.id;
          } else {
            // Key exists but is disabled - enable it
            console.log(
              `[apiGatewayUsagePlans] Found existing disabled API key for subscription ${subscriptionId}: ${matchingKey.id}. Enabling it...`
            );

            const updateCommand = new UpdateApiKeyCommand({
              apiKey: matchingKey.id,
              patchOperations: [
                {
                  op: "replace",
                  path: "/enabled",
                  value: "true",
                },
              ],
            });
            await apiGateway.send(updateCommand);

            console.log(
              `[apiGatewayUsagePlans] Successfully enabled API key ${matchingKey.id} for subscription ${subscriptionId}`
            );
            if (includeValue) {
              // Try to get the value (may not be available)
              try {
                const getKeyWithValueCommand = new GetApiKeyCommand({
                  apiKey: matchingKey.id,
                  includeValue: true,
                });
                const keyWithValue = await apiGateway.send(
                  getKeyWithValueCommand
                );
                return {
                  id: matchingKey.id,
                  value: keyWithValue.value || undefined,
                };
              } catch {
                return {
                  id: matchingKey.id,
                  value: undefined,
                };
              }
            }
            return matchingKey.id;
          }
        } catch (keyError) {
          // If we can't fetch key details, log warning and create a new key
          console.warn(
            `[apiGatewayUsagePlans] Could not verify API key ${matchingKey.id} status for subscription ${subscriptionId}, will create new key:`,
            keyError instanceof Error ? keyError.message : String(keyError)
          );
          Sentry.captureException(ensureError(keyError), {
            tags: {
              context: "api-gateway",
              operation: "verify-api-key",
            },
          });
          // Fall through to create a new key
        }
      }
    }

    // Create new API key if not found
    console.log(
      `[apiGatewayUsagePlans] Creating new API key for subscription ${subscriptionId}`
    );

    const createCommand = new CreateApiKeyCommand({
      name: apiKeyName,
      description: `API key for subscription ${subscriptionId}`,
      enabled: true,
    });
    const createResponse = await apiGateway.send(createCommand);

    if (!createResponse.id) {
      throw new Error(
        `Failed to create API key for subscription ${subscriptionId}`
      );
    }

    console.log(
      `[apiGatewayUsagePlans] Created API key ${createResponse.id} for subscription ${subscriptionId}`
    );

    if (includeValue) {
      return {
        id: createResponse.id,
        value: createResponse.value || undefined,
      };
    }
    return createResponse.id;
  } catch (error) {
    console.error(
      `[apiGatewayUsagePlans] Error getting/creating API key for subscription ${subscriptionId}:`,
      error
    );
    throw error;
  }
}

/**
 * Ensure usage plan is associated with the API stage
 * @param usagePlanId - Usage plan ID
 * @param restApiId - REST API ID
 * @param stageName - API stage name
 */
async function ensureUsagePlanHasApiStage(
  usagePlanId: string,
  restApiId: string,
  stageName: string
): Promise<void> {
  const apiGateway = getApiGatewayClient();

  try {
    // Get the usage plan to check its current API stages
    const getPlanCommand = new GetUsagePlanCommand({
      usagePlanId,
    });
    const usagePlan = await apiGateway.send(getPlanCommand);

    // Check if the API stage is already associated
    const apiStages = usagePlan.apiStages || [];
    const hasStage = apiStages.some(
      (stage) => stage.apiId === restApiId && stage.stage === stageName
    );

    if (hasStage) {
      console.log(
        `[apiGatewayUsagePlans] Usage plan ${usagePlanId} already has API stage ${restApiId}/${stageName}`
      );
      return;
    }

    // Add the API stage to the usage plan
    console.log(
      `[apiGatewayUsagePlans] Adding API stage ${restApiId}/${stageName} to usage plan ${usagePlanId}`
    );

    // AWS API Gateway requires the format "apiId:stageName" (colon-separated string) for add operations
    const stageValue = `${restApiId}:${stageName}`;

    const updateCommand = new UpdateUsagePlanCommand({
      usagePlanId,
      patchOperations: [
        {
          op: "add",
          path: "/apiStages",
          value: stageValue,
        },
      ],
    });

    await apiGateway.send(updateCommand);

    console.log(
      `[apiGatewayUsagePlans] Successfully associated usage plan ${usagePlanId} with API stage ${restApiId}/${stageName}`
    );
  } catch (error) {
    console.error(
      `[apiGatewayUsagePlans] Error ensuring usage plan ${usagePlanId} has API stage:`,
      error
    );
    // Log warning but don't fail - this is defense in depth
    console.warn(
      `[apiGatewayUsagePlans] Continuing despite error (usage plan may already be associated)`
    );
  }
}

/**
 * Verify API key works by making a canary request
 * @param subscriptionId - Subscription ID (for getting user info)
 * @returns true if request succeeds, false otherwise
 */
async function verifyApiKeyWithCanaryRequest(
  subscriptionId: string
): Promise<boolean> {
  // Skip in local/test environments
  const isLocal =
    process.env.ARC_ENV === "testing" || process.env.NODE_ENV === "test";
  if (isLocal) {
    console.log(
      `[apiGatewayUsagePlans] Skipping canary request in local/test environment`
    );
    return true;
  }

  try {
    // Get subscription to get userId for generating JWT token
    const { getSubscriptionById } = await import("./subscriptionUtils");
    const subscription = await getSubscriptionById(subscriptionId);

    if (!subscription || !subscription.userId) {
      console.warn(
        `[apiGatewayUsagePlans] Cannot verify API key: subscription ${subscriptionId} not found or has no userId`
      );
      return false;
    }

    // Get user email for JWT token
    const { getUserEmailById } = await import("./subscriptionUtils");
    const userEmail = await getUserEmailById(subscription.userId);

    if (!userEmail) {
      console.warn(
        `[apiGatewayUsagePlans] Cannot verify API key: user ${subscription.userId} has no email`
      );
      return false;
    }

    // Generate a temporary JWT token for the canary request
    const { generateAccessToken } = await import("./tokenUtils");
    const bearerToken = await generateAccessToken(
      subscription.userId,
      userEmail
    );

    // Get base URL
    const baseUrl = process.env.BASE_URL || "https://app.helpmaton.com";
    const url = `${baseUrl.replace(/\/+$/, "")}/api/workspaces`;

    console.log(
      `[apiGatewayUsagePlans] Making canary request to ${url} to verify API key for subscription ${subscriptionId}`
    );

    // Make the canary request
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
    });

    const statusCode = response.status;

    if (statusCode >= 200 && statusCode < 300) {
      console.log(
        `[apiGatewayUsagePlans] Canary request succeeded (${statusCode}) - API key is properly associated`
      );
      return true;
    } else if (statusCode === 403) {
      console.warn(
        `[apiGatewayUsagePlans] Canary request returned 403 - API key may not be properly associated with usage plan/stage`
      );
      return false;
    } else {
      console.warn(
        `[apiGatewayUsagePlans] Canary request returned ${statusCode} - unexpected status`
      );
      return false;
    }
  } catch (error) {
    console.error(
      `[apiGatewayUsagePlans] Error making canary request for subscription ${subscriptionId}:`,
      error instanceof Error ? error.message : String(error)
    );
    // Return false on error, but don't throw - this is defense in depth
    return false;
  }
}

/**
 * Associate a subscription with a usage plan
 * This creates/updates the mapping between the subscription's API key and the usage plan
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @param plan - Subscription plan name
 */
export async function associateSubscriptionWithPlan(
  subscriptionId: string,
  plan: "free" | "starter" | "pro"
): Promise<string> {
  // Skip API Gateway operations in local development/testing
  // API Gateway doesn't exist in the Architect sandbox
  const isLocal =
    process.env.ARC_ENV === "testing" || process.env.NODE_ENV === "test";
  if (isLocal) {
    console.log(
      `[apiGatewayUsagePlans] Skipping API Gateway usage plan association in local/test environment`
    );
    // Return a mock API key ID for local development
    return `mock-api-key-${subscriptionId}`;
  }

  const apiGateway = getApiGatewayClient();

  try {
    // Get or create API key for subscription
    const apiKeyResult = await getOrCreateApiKeyForSubscription(
      subscriptionId,
      false
    );
    const apiKeyId =
      typeof apiKeyResult === "string" ? apiKeyResult : apiKeyResult.id;

    // Get usage plan ID for the target plan
    const usagePlanId = await getUsagePlanId(plan);

    // Ensure usage plan is associated with the API stage
    try {
      const restApiId = await getRestApiId();
      const stageName = getApiStageName();
      await ensureUsagePlanHasApiStage(usagePlanId, restApiId, stageName);
    } catch (stageError) {
      // Log warning but don't fail - this is defense in depth
      console.warn(
        `[apiGatewayUsagePlans] Could not ensure usage plan has API stage:`,
        stageError instanceof Error ? stageError.message : String(stageError)
      );
    }

    // STEP 1: Create new association FIRST (before deleting old ones)
    // This ensures the key is always associated with at least one plan
    console.log(
      `[apiGatewayUsagePlans] Associating API key ${apiKeyId} with ${plan} plan (${usagePlanId})`
    );

    try {
      const createKeyCommand = new CreateUsagePlanKeyCommand({
        usagePlanId,
        keyId: apiKeyId,
        keyType: "API_KEY",
      });
      await apiGateway.send(createKeyCommand);

      console.log(
        `[apiGatewayUsagePlans] Successfully associated API key ${apiKeyId} with ${plan} plan`
      );
    } catch (createError: unknown) {
      // If creation fails with ConflictException, it means the key is already
      // associated with this plan - this is fine, we can proceed
      if (
        createError instanceof Error &&
        createError.name === "ConflictException"
      ) {
        console.log(
          `[apiGatewayUsagePlans] API key ${apiKeyId} already associated with ${plan} plan`
        );
      } else {
        // Other errors should be thrown
        throw createError;
      }
    }

    // STEP 2: Remove from OLD plans (all except the target plan)
    // At this point, the key is guaranteed to be in the new plan
    const plansToCheck: Array<"free" | "starter" | "pro"> = [
      "free",
      "starter",
      "pro",
    ];

    for (const checkPlan of plansToCheck) {
      // Skip the target plan - we just associated with it
      if (checkPlan === plan) {
        continue;
      }

      try {
        const checkPlanId = await getUsagePlanId(checkPlan);

        // Try to delete the association from old plan
        try {
          const deleteCommand = new DeleteUsagePlanKeyCommand({
            usagePlanId: checkPlanId,
            keyId: apiKeyId,
          });
          await apiGateway.send(deleteCommand);

          console.log(
            `[apiGatewayUsagePlans] Removed API key ${apiKeyId} from ${checkPlan} plan`
          );
        } catch (deleteError: unknown) {
          // Ignore errors if the association doesn't exist
          if (
            deleteError instanceof Error &&
            deleteError.name !== "NotFoundException"
          ) {
            console.warn(
              `[apiGatewayUsagePlans] Error removing API key from ${checkPlan} plan:`,
              deleteError
            );
          }
        }
      } catch (planError) {
        // Ignore errors if usage plan doesn't exist
        console.warn(
          `[apiGatewayUsagePlans] Could not check usage plan ${checkPlan}:`,
          planError
        );
      }
    }

    console.log(
      `[apiGatewayUsagePlans] Successfully updated subscription ${subscriptionId} (API key ${apiKeyId}) to ${plan} plan (${usagePlanId})`
    );

    // Verify the API key works with a canary request
    try {
      const canarySuccess = await verifyApiKeyWithCanaryRequest(subscriptionId);
      if (!canarySuccess) {
        console.warn(
          `[apiGatewayUsagePlans] Canary request failed for subscription ${subscriptionId} - API key may need time to propagate`
        );
      }
    } catch (canaryError) {
      // Log warning but don't fail - this is defense in depth
      console.warn(
        `[apiGatewayUsagePlans] Error during canary request verification:`,
        canaryError instanceof Error ? canaryError.message : String(canaryError)
      );
    }

    // Wait 3 seconds for API Gateway propagation (only in non-local environments)
    if (!isLocal) {
      console.log(
        `[apiGatewayUsagePlans] Waiting 3 seconds for API Gateway propagation...`
      );
      await new Promise((resolve) => setTimeout(resolve, 3000));
      console.log(
        `[apiGatewayUsagePlans] Finished waiting for API Gateway propagation`
      );
    }

    // Return the API key ID so it can be stored in the subscription record
    return apiKeyId;
  } catch (error) {
    console.error(
      `[apiGatewayUsagePlans] Error associating subscription ${subscriptionId} with plan ${plan}:`,
      error
    );
    throw error;
  }
}

/**
 * Verify that an API key exists and is enabled in API Gateway
 * @param apiKeyId - API key ID to verify
 * @returns true if key exists and is enabled, false otherwise
 */
export async function verifyApiKeyIsEnabled(
  apiKeyId: string
): Promise<boolean> {
  // Skip API Gateway operations in local development/testing
  const isLocal =
    process.env.ARC_ENV === "testing" || process.env.NODE_ENV === "test";
  if (isLocal) {
    console.log(
      `[apiGatewayUsagePlans] Skipping API key verification in local/test environment`
    );
    return true;
  }

  const apiGateway = getApiGatewayClient();

  try {
    const getKeyCommand = new GetApiKeyCommand({
      apiKey: apiKeyId,
      includeValue: false,
    });
    const response = await apiGateway.send(getKeyCommand);

    if (response.enabled === true) {
      console.log(
        `[apiGatewayUsagePlans] API key ${apiKeyId} exists and is enabled`
      );
      return true;
    } else {
      console.warn(
        `[apiGatewayUsagePlans] API key ${apiKeyId} exists but is disabled`
      );
      return false;
    }
  } catch (error) {
    // If key doesn't exist or any other error occurs, return false
    console.error(
      `[apiGatewayUsagePlans] Error verifying API key ${apiKeyId}:`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

/**
 * Ensure subscription has an active API key in API Gateway
 * Verifies the API key exists and is enabled, creates/updates if needed
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @param plan - Subscription plan name
 * @throws Error if API key cannot be verified or created after retries
 */
export async function ensureSubscriptionApiKeyActive(
  subscriptionId: string,
  plan: "free" | "starter" | "pro"
): Promise<void> {
  // Skip API Gateway operations in local development/testing
  const isLocal =
    process.env.ARC_ENV === "testing" || process.env.NODE_ENV === "test";
  if (isLocal) {
    console.log(
      `[apiGatewayUsagePlans] Skipping API key verification in local/test environment`
    );
    return;
  }

  const db = await database();
  const subscriptionPk = `subscriptions/${subscriptionId}`;
  const subscriptionSk = "subscription";

  // Get subscription record
  const subscription = await db.subscription.get(
    subscriptionPk,
    subscriptionSk
  );

  if (!subscription) {
    throw new Error(
      `Subscription ${subscriptionId} not found when verifying API key`
    );
  }

  // Check if apiKeyId exists
  let apiKeyId = subscription.apiKeyId;

  // If apiKeyId exists, verify it's enabled
  if (apiKeyId) {
    const isEnabled = await verifyApiKeyIsEnabled(apiKeyId);
    if (isEnabled) {
      console.log(
        `[apiGatewayUsagePlans] Subscription ${subscriptionId} has active API key ${apiKeyId}`
      );
      return;
    } else {
      console.warn(
        `[apiGatewayUsagePlans] Subscription ${subscriptionId} API key ${apiKeyId} is disabled or missing, creating new one`
      );
      // Key is disabled or missing, create a new one
      apiKeyId = undefined;
    }
  }

  // If no apiKeyId or key is disabled, create/update it
  console.log(
    `[apiGatewayUsagePlans] Creating/updating API key for subscription ${subscriptionId}`
  );

  try {
    // This will create a new API key and associate it with the usage plan
    const newApiKeyId = await associateSubscriptionWithPlan(
      subscriptionId,
      plan
    );

    // Update subscription record with the new API key ID
    await db.subscription.update({
      ...subscription,
      apiKeyId: newApiKeyId,
    });

    console.log(
      `[apiGatewayUsagePlans] Successfully ensured API key ${newApiKeyId} is active for subscription ${subscriptionId}`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[apiGatewayUsagePlans] Failed to create/update API key for subscription ${subscriptionId}:`,
      errorMessage
    );
    throw new Error(
      `Failed to ensure API key is active for subscription ${subscriptionId}: ${errorMessage}`
    );
  }
}

/**
 * Remove subscription association from usage plans
 * This removes the API key from all usage plans (but doesn't delete the API key itself)
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 */
export async function removeSubscriptionAssociation(
  subscriptionId: string
): Promise<void> {
  const apiGateway = getApiGatewayClient();

  try {
    // Get stack name to find the correct API key
    const stackName =
      process.env.ARC_STACK_NAME || process.env.AWS_STACK_NAME || "default";
    const apiKeyName = `${stackName}-subscription-${subscriptionId}`;

    // Find the API key
    const getKeysCommand = new GetApiKeysCommand({
      nameQuery: apiKeyName,
      includeValues: false,
    });
    const response = await apiGateway.send(getKeysCommand);

    const apiKey = response.items?.find((key) => key.name === apiKeyName);

    if (!apiKey?.id) {
      console.log(
        `[apiGatewayUsagePlans] API key not found for subscription ${subscriptionId}, nothing to remove`
      );
      return;
    }

    const apiKeyId = apiKey.id;

    // Remove from all usage plans
    const plans: Array<"free" | "starter" | "pro"> = ["free", "starter", "pro"];

    for (const plan of plans) {
      try {
        const usagePlanId = await getUsagePlanId(plan);

        const deleteCommand = new DeleteUsagePlanKeyCommand({
          usagePlanId,
          keyId: apiKeyId,
        });
        await apiGateway.send(deleteCommand);

        console.log(
          `[apiGatewayUsagePlans] Removed API key ${apiKeyId} from ${plan} plan`
        );
      } catch (error) {
        // Ignore errors if association doesn't exist
        if (error instanceof Error && error.name !== "NotFoundException") {
          console.warn(
            `[apiGatewayUsagePlans] Error removing API key from ${plan} plan:`,
            error
          );
        }
      }
    }

    console.log(
      `[apiGatewayUsagePlans] Removed all usage plan associations for subscription ${subscriptionId}`
    );
  } catch (error) {
    console.error(
      `[apiGatewayUsagePlans] Error removing subscription association for ${subscriptionId}:`,
      error
    );
    throw error;
  }
}
