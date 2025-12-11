/**
 * Generate CloudFormation resources for API Gateway usage plans
 * @param {Object} plans - Parsed plans from @api-throttling pragma
 * @param {string} restApiId - REST API resource ID
 * @param {string} stageName - Stage name (string literal)
 * @param {string} stageResourceId - Stage resource ID (optional)
 * @param {string} deploymentResourceId - Deployment resource ID (to depend on instead of Stage)
 * @returns {Object} CloudFormation resources for usage plans
 */
function generateUsagePlans(plans, restApiId, stageName, stageResourceId, deploymentResourceId) {
  const resources = {};
  const outputs = {};

  // Default plans if not specified
  const defaultPlans = {
    free: { rateLimit: 100, burstLimit: 200 },
    starter: { rateLimit: 500, burstLimit: 1000 },
    pro: { rateLimit: 2000, burstLimit: 4000 },
  };

  // Merge with provided plans
  const finalPlans = { ...defaultPlans, ...plans };

  // Get stack name to make usage plan names unique per stack
  // This prevents conflicts when multiple stacks run in the same AWS account
  const stackName = process.env.ARC_STACK_NAME || 
                    process.env.AWS_STACK_NAME || 
                    { "Ref": "AWS::StackName" }; // Use CloudFormation reference if env var not available

  // Create usage plan for each tier
  for (const [planName, limits] of Object.entries(finalPlans)) {
    const planId = `UsagePlan${planName.charAt(0).toUpperCase() + planName.slice(1)}`;
    
    // Make usage plan name unique per stack to avoid conflicts across stacks
    // Format: {stackName}-{planName} (e.g., "HelpmatonStagingPR25-free")
    const uniquePlanName = typeof stackName === "string"
      ? `${stackName}-${planName}`
      : { "Fn::Sub": "${AWS::StackName}-" + planName };
    
    // Use stage name as string literal
    // We'll use DependsOn to ensure Stage exists before Usage Plans are created
    // Since we removed usage plan ID env vars from the authorizer, there's no cycle:
    // Usage Plans → Stage → Deployment → Methods → Authorizer (no cycle back to Usage Plans)
    resources[planId] = {
      Type: "AWS::ApiGateway::UsagePlan",
      Properties: {
        UsagePlanName: uniquePlanName,
        ApiStages: [
          {
            ApiId: { Ref: restApiId },
            Stage: stageName, // Use string literal - stage name is known at template generation time
          },
        ],
        Throttle: {
          BurstLimit: limits.burstLimit || limits.burst || 200,
          RateLimit: limits.rateLimit || limits.rate || 100,
        },
      },
    };

    // Depend on Stage to ensure it exists before Usage Plans are created
    // This is safe now because we removed the authorizer's dependency on Usage Plans
    // The dependency chain is: Usage Plans → Stage → Deployment → Methods → Authorizer
    // No cycle since Authorizer doesn't depend on Usage Plans anymore
    if (stageResourceId) {
      resources[planId].DependsOn = stageResourceId;
    }

    // Add output for usage plan ID
    outputs[`UsagePlan${planName.charAt(0).toUpperCase() + planName.slice(1)}Id`] = {
      Description: `Usage plan ID for ${planName} plan`,
      Value: { Ref: planId },
      Export: {
        Name: {
          "Fn::Sub": "${AWS::StackName}-" + planName + "-usage-plan-id",
        },
      },
    };
  }

  return { resources, outputs };
}

module.exports = {
  generateUsagePlans,
};

