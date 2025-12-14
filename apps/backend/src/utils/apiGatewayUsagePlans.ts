import {
  APIGatewayClient,
  GetApiKeysCommand,
  CreateApiKeyCommand,
  CreateUsagePlanKeyCommand,
  DeleteUsagePlanKeyCommand,
  GetUsagePlansCommand,
} from "@aws-sdk/client-api-gateway";

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
 * @returns API key ID
 */
export async function getOrCreateApiKeyForSubscription(
  subscriptionId: string
): Promise<string> {
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
        console.log(
          `[apiGatewayUsagePlans] Found existing API key for subscription ${subscriptionId}: ${matchingKey.id}`
        );
        return matchingKey.id;
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
 * Associate a subscription with a usage plan
 * This creates/updates the mapping between the subscription's API key and the usage plan
 * @param subscriptionId - Subscription ID (without "subscriptions/" prefix)
 * @param plan - Subscription plan name
 */
export async function associateSubscriptionWithPlan(
  subscriptionId: string,
  plan: "free" | "starter" | "pro"
): Promise<string> {
  const apiGateway = getApiGatewayClient();

  try {
    // Get or create API key for subscription
    const apiKeyId = await getOrCreateApiKeyForSubscription(subscriptionId);

    // Get usage plan ID (now async - may look up by stack-specific name)
    const usagePlanId = await getUsagePlanId(plan);

    // First, try to delete any existing usage plan key associations
    // We need to check all usage plans to find existing associations
    const plansToCheck: Array<"free" | "starter" | "pro"> = [
      "free",
      "starter",
      "pro",
    ];

    for (const checkPlan of plansToCheck) {
      try {
        const checkPlanId = await getUsagePlanId(checkPlan);

        // Try to delete the association (will fail silently if it doesn't exist)
        try {
          const deleteCommand = new DeleteUsagePlanKeyCommand({
            usagePlanId: checkPlanId,
            keyId: apiKeyId,
          });
          await apiGateway.send(deleteCommand);

          console.log(
            `[apiGatewayUsagePlans] Removed API key ${apiKeyId} from usage plan ${checkPlan}`
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

    // Create new association with the correct usage plan
    const createKeyCommand = new CreateUsagePlanKeyCommand({
      usagePlanId,
      keyId: apiKeyId,
      keyType: "API_KEY",
    });
    await apiGateway.send(createKeyCommand);

    console.log(
      `[apiGatewayUsagePlans] Associated subscription ${subscriptionId} (API key ${apiKeyId}) with ${plan} plan (${usagePlanId})`
    );

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
