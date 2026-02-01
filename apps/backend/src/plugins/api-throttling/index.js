/**
 * API Throttling Plugin
 * 
 * This plugin configures API Gateway usage plans and a Lambda authorizer
 * for per-workspace throttling based on subscription plans.
 */

const { generateUsagePlans } = require("./usage-plans");
const { configureMethodAuthorizers } = require("./methods");
const { validateDependencies, formatCycles } = require("./validate-dependencies");

/**
 * Parse @api-throttling pragma from arc file
 * @param {Object} arc - Parsed arc file
 * @returns {Object} Parsed plans configuration
 */
function parseApiThrottlingPragma(arc) {
  const plans = {};

  // Check if api-throttling pragma exists
  if (!arc["api-throttling"] && !arc["apiThrottling"]) {
    return plans;
  }

  const pragma = arc["api-throttling"] || arc["apiThrottling"];

  if (!pragma) {
    return plans;
  }

  // Architect parses the pragma into an array of objects:
  // [{ free: { rateLimit: 100, burstLimit: 200 } }, { starter: {...} }, ...]
  if (Array.isArray(pragma)) {
    for (const item of pragma) {
      if (typeof item === "object" && item !== null) {
        // Each item is an object with plan name as key
        for (const [planName, planConfig] of Object.entries(item)) {
          if (typeof planConfig === "object" && planConfig !== null) {
            plans[planName] = planConfig;
          }
        }
      } else if (typeof item === "string") {
        // Fallback: handle string format if needed
        const trimmed = item.trim();
        if (trimmed) {
          // This would be a plan name or property line
          // For now, skip as we expect object format
        }
      }
    }
    return plans;
  }

  // If it's already an object with plan names as keys, use it directly
  if (typeof pragma === "object" && pragma !== null && !Array.isArray(pragma)) {
    // Check if it looks like an object with plan configurations
    const keys = Object.keys(pragma);
    if (keys.length > 0 && (keys.includes("free") || keys.includes("starter") || keys.includes("pro"))) {
      // It's already parsed - use it directly
      return pragma;
    }
  }

  // Fallback: treat as array of strings (legacy format)
  const pragmaLines = Array.isArray(pragma) ? pragma : [pragma];

  let currentPlan = null;

  for (const line of pragmaLines) {
    // Skip if line is not a string
    if (typeof line !== "string") {
      continue;
    }

    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      continue;
    }

    // Check if line is indented (is a property)
    if (line.startsWith(" ") || line.startsWith("\t")) {
      // This is a property of the current plan
      if (currentPlan) {
        const [key, value] = trimmed.split(/\s+/);
        if (key && value) {
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue)) {
            plans[currentPlan][key] = numValue;
          }
        }
      }
    } else {
      // This is a plan name (no indentation)
      currentPlan = trimmed;
      plans[currentPlan] = {};
    }
  }

  return plans;
}

/**
 * Main plugin function that configures usage plans and authorizer
 */
async function configureApiThrottling({ cloudformation, inventory, arc }) {
    const resources = cloudformation.Resources || {};
    const outputs = cloudformation.Outputs || {};

    // Check if REST API exists (must run after http-to-rest plugin)
    const restApi = resources.HTTP || resources.HTTPRestApi;
    const restApiId = resources.HTTPRestApi ? "HTTPRestApi" : "HTTP";

    if (!restApi || restApi.Type !== "AWS::ApiGateway::RestApi") {
      console.log(
        "[api-throttling] REST API not found, skipping throttling configuration"
      );
      return cloudformation;
    }

    // Parse @api-throttling pragma
    // Try multiple sources for the arc data
    const arcData = arc || inventory?.arc || inventory?.app?.arc || {};
    const plans = parseApiThrottlingPragma(arcData);

    if (Object.keys(plans).length === 0) {
      console.log(
        "[api-throttling] No @api-throttling pragma found, using defaults"
      );
    } else {
      console.log(
        `[api-throttling] Parsed ${Object.keys(plans).length} plan(s) from pragma:`,
        Object.keys(plans).join(", ")
      );
    }

    // Find the actual stage resource that was created
    // The http-to-rest plugin creates stages like HTTPDefaultStage, HTTPStagingStage, etc.
    let actualStageName = null;
    let stageResourceId = null;
    let deploymentResourceId = null;
    const stageResources = Object.entries(resources).find(([id, resource]) => {
      return (
        resource &&
        resource.Type === "AWS::ApiGateway::Stage" &&
        resource.Properties &&
        resource.Properties.RestApiId &&
        ((typeof resource.Properties.RestApiId === "object" &&
          resource.Properties.RestApiId.Ref === restApiId) ||
          resource.Properties.RestApiId === restApiId)
      );
    });

    if (stageResources) {
      const [id, stageResource] = stageResources;
      stageResourceId = id;
      actualStageName = stageResource.Properties?.StageName;
      
      // Get the deployment ID that the stage depends on
      // We'll depend on the deployment instead of the stage to avoid circular dependencies
      if (stageResource.Properties?.DeploymentId?.Ref) {
        deploymentResourceId = stageResource.Properties.DeploymentId.Ref;
      }
      
      console.log(
        `[api-throttling] Found stage resource ${stageResourceId} with StageName: ${actualStageName} (depends on ${deploymentResourceId || "unknown deployment"})`
      );

      // Create CloudFormation output for the stage name
      // This allows other resources (like Usage Plans) to reference the stage name
      // without creating a DependsOn dependency, avoiding circular dependencies
      const stageNameOutputId = "ApiGatewayStageName";
      if (!outputs[stageNameOutputId]) {
        outputs[stageNameOutputId] = {
          Description: "API Gateway stage name",
          Value: actualStageName, // Use string literal, not Ref to avoid dependency
          Export: {
            Name: {
              "Fn::Sub": "${AWS::StackName}-api-gateway-stage-name",
            },
          },
        };
        console.log(
          `[api-throttling] Created CloudFormation output for stage name: ${actualStageName}`
        );
      }

      // Configure API Gateway access logging
      // Create CloudWatch Log Group with name: {StackName}-APIGateway
      const logGroupId = "APIGatewayLogGroup";
      const logGroupName = {
        "Fn::Sub": "${AWS::StackName}-APIGateway"
      };

      // Create the log group if it doesn't already exist
      if (!resources[logGroupId]) {
        resources[logGroupId] = {
          Type: "AWS::Logs::LogGroup",
          Properties: {
            LogGroupName: logGroupName,
            RetentionInDays: 30, // Retain logs for 30 days
          },
        };
        console.log(
          `[api-throttling] Created CloudWatch Log Group: ${JSON.stringify(logGroupName)}`
        );
      }

      // Configure the stage to use access logging
      // Use standard API Gateway access log format
      const accessLogFormat = JSON.stringify({
        requestId: "$context.requestId",
        ip: "$context.identity.sourceIp",
        caller: "$context.identity.caller",
        user: "$context.identity.user",
        requestTime: "$context.requestTime",
        httpMethod: "$context.httpMethod",
        resourcePath: "$context.resourcePath",
        status: "$context.status",
        protocol: "$context.protocol",
        responseLength: "$context.responseLength",
        error: {
          message: "$context.error.message",
          messageString: "$context.error.messageString",
        },
        integration: {
          status: "$context.integration.status",
          latency: "$context.integration.latency",
          requestId: "$context.integration.requestId",
        },
        responseLatency: "$context.responseLatency",
      });

      // Add access log settings to the stage
      if (!stageResource.Properties.AccessLogSetting) {
        stageResource.Properties.AccessLogSetting = {
          DestinationArn: {
            "Fn::GetAtt": [logGroupId, "Arn"],
          },
          Format: accessLogFormat,
        };
        console.log(
          `[api-throttling] Configured access logging for stage ${stageResourceId}`
        );
      } else {
        console.log(
          `[api-throttling] Stage ${stageResourceId} already has access log settings, skipping`
        );
      }

      // Add IAM permissions for API Gateway to write to the log group
      // API Gateway service needs permissions to create log streams and write logs
      // Use ResourcePolicy with ARN constructed using Fn::Sub
      const logGroupPolicyId = `${logGroupId}Policy`;
      if (!resources[logGroupPolicyId]) {
        resources[logGroupPolicyId] = {
          Type: "AWS::Logs::ResourcePolicy",
          Properties: {
            PolicyName: {
              "Fn::Sub": "${AWS::StackName}-APIGatewayLogPolicy",
            },
            PolicyDocument: {
              "Fn::Sub": [
                '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"apigateway.amazonaws.com"},"Action":["logs:CreateLogStream","logs:PutLogEvents"],"Resource":"arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:${AWS::StackName}-APIGateway:*"}]}',
                {},
              ],
            },
          },
          DependsOn: [logGroupId],
        };
        console.log(
          `[api-throttling] Created IAM resource policy for API Gateway logging`
        );
      }
    }

    // Fallback to environment variable or default
    if (!actualStageName) {
      actualStageName =
        process.env.ARC_ENV ||
        process.env.ARC_STAGE ||
        process.env.ARC_DEPLOY ||
        "staging";
      console.warn(
        `[api-throttling] Stage resource not found, using fallback: ${actualStageName}`
      );
    }

    // Generate usage plans
    // Usage plans depend on Deployment instead of Stage to break the circular dependency
    // Deployment → Stage, so depending on Deployment ensures Stage exists
    // This breaks the cycle: Authorizer → Usage Plans → Deployment → Methods → Authorizer
    // (no cycle back to Stage)
    const { resources: planResources, outputs: planOutputs } =
      generateUsagePlans(plans, restApiId, actualStageName, stageResourceId, deploymentResourceId);

    // Add usage plan resources
    Object.assign(resources, planResources);

    // Add usage plan outputs
    Object.assign(outputs, planOutputs);

    // Create Lambda authorizer FIRST, before modifying methods
    // This ensures the authorizer exists before methods reference it
    // Find the authorizer Lambda function
    const authorizerFunctionId = "AnyApiAuthorizerHTTPLambda";
    const authorizerFunction = resources[authorizerFunctionId];

    if (!authorizerFunction) {
      console.warn(
        "[api-throttling] Authorizer Lambda function not found, creating authorizer resource anyway"
      );
    }

    // Create authorizer resource
    // Use REQUEST type to access full request including cookies (needed for NextAuth sessions)
    // Note: REST API does support REQUEST authorizers, but they may have limitations
    const authorizerId = "ApiAuthorizer";
    resources[authorizerId] = {
      Type: "AWS::ApiGateway::Authorizer",
      Properties: {
        RestApiId: { Ref: restApiId },
        Name: "SubscriptionAuthorizer",
        Type: "REQUEST", // REQUEST type allows access to full request including cookies
        AuthorizerUri: authorizerFunction
          ? {
              "Fn::Sub": [
                "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${AuthorizerFunctionArn}/invocations",
                {
                  AuthorizerFunctionArn: {
                    "Fn::GetAtt": [authorizerFunctionId, "Arn"],
                  },
                },
              ],
            }
          : undefined,
        // For REQUEST authorizers, IdentitySource specifies which parts of the request to pass
        // Configure to forward Authorization header so the authorizer can access Bearer tokens
        // Include resourcePath to avoid caching across different routes with empty auth headers
        // Note: Header names must be lowercase in IdentitySource
        IdentitySource:
          "method.request.header.authorization,context.resourcePath",
        AuthorizerResultTtlInSeconds: 300,
      },
    };

    // Add dependency on authorizer function
    if (authorizerFunction) {
      resources[authorizerId].DependsOn = authorizerFunctionId;

      // Create Lambda permission for API Gateway to invoke the authorizer
      // For authorizers, the SourceArn should allow invocation from any method in the API
      // Pattern: arn:aws:execute-api:region:account-id:api-id/*
      const permissionId = `${authorizerFunctionId}AuthorizerPermission`;
      resources[permissionId] = {
        Type: "AWS::Lambda::Permission",
        Properties: {
          FunctionName: {
            "Fn::GetAtt": [authorizerFunctionId, "Arn"],
          },
          Action: "lambda:InvokeFunction",
          Principal: "apigateway.amazonaws.com",
          SourceArn: {
            "Fn::Sub": [
              "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${RestApiId}/*",
              {
                RestApiId: { Ref: restApiId },
              },
            ],
          },
        },
        DependsOn: [authorizerId, authorizerFunctionId],
      };

      // Add IAM permissions for the authorizer Lambda to manage API Gateway resources
      // The authorizer needs to create/get API keys and associate them with usage plans
      // Find the Lambda execution role - check both the standard pattern and the Role property
      let authorizerRoleId = `${authorizerFunctionId}Role`;
      let authorizerRole = resources[authorizerRoleId];

      // If not found with standard pattern, try to extract from Lambda function's Role property
      // Architect may use Fn::Sub with a nested Ref, or a direct Ref
      if (!authorizerRole && authorizerFunction.Properties?.Role) {
        const roleProperty = authorizerFunction.Properties.Role;
        
        // Handle direct Ref: { Ref: "Role" }
        if (roleProperty && typeof roleProperty === "object" && roleProperty.Ref) {
          authorizerRoleId = roleProperty.Ref;
          authorizerRole = resources[authorizerRoleId];
        }
        // Handle Fn::Sub with nested Ref: { "Fn::Sub": ["...", { "roleName": { "Ref": "Role" } }] }
        else if (roleProperty && typeof roleProperty === "object" && roleProperty["Fn::Sub"]) {
          const subArray = roleProperty["Fn::Sub"];
          if (Array.isArray(subArray) && subArray.length === 2 && typeof subArray[1] === "object") {
            // Look for roleName or similar keys that contain a Ref
            const subVars = subArray[1];
            for (const key in subVars) {
              const value = subVars[key];
              if (value && typeof value === "object" && value.Ref) {
                authorizerRoleId = value.Ref;
                authorizerRole = resources[authorizerRoleId];
                break;
              }
            }
          }
        }
      }

      if (authorizerRole && authorizerRole.Type === "AWS::IAM::Role") {
        // Add inline policy to the role for API Gateway operations
        const policyId = `${authorizerRoleId}ApiGatewayPolicy`;
        resources[policyId] = {
          Type: "AWS::IAM::Policy",
          Properties: {
            PolicyName: "ApiGatewayUsagePlansPolicy",
            Roles: [{ Ref: authorizerRoleId }],
            PolicyDocument: {
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Action: [
                    "apigateway:GET",
                    "apigateway:POST",
                    "apigateway:PUT",
                    "apigateway:DELETE",
                    "apigateway:PATCH",
                  ],
                  Resource: [
                    // Allow both base paths and wildcard paths for API Gateway REST API operations
                    "arn:aws:apigateway:*::/usageplans",
                    "arn:aws:apigateway:*::/usageplans/*",
                    "arn:aws:apigateway:*::/apikeys",
                    "arn:aws:apigateway:*::/apikeys/*",
                    "arn:aws:apigateway:*::/usageplans/*/keys",
                    "arn:aws:apigateway:*::/usageplans/*/keys/*",
                  ],
                },
              ],
            },
          },
          DependsOn: [authorizerRoleId],
        };
        console.log(
          `[api-throttling] Added API Gateway IAM permissions to authorizer Lambda role ${authorizerRoleId}`
        );
      } else {
        console.warn(
          `[api-throttling] Authorizer Lambda role ${authorizerRoleId} not found (type: ${authorizerRole?.Type}). IAM permissions may need to be added manually.`
        );
      }
    }

    // Configure methods to use authorizer
    // IMPORTANT: This must happen AFTER the authorizer is created
    // but the methods will have an implicit dependency on ApiAuthorizer via Ref
    configureMethodAuthorizers(cloudformation, authorizerId);

    // Add environment variables to authorizer function
    // Note: We do NOT add usage plan IDs to avoid circular dependencies
    // The authorizer will look up usage plans by name at runtime using getUsagePlanId()
    // which has a fallback mechanism to query API Gateway if env vars are not present
    if (authorizerFunction && authorizerFunction.Properties) {
      if (!authorizerFunction.Properties.Environment) {
        authorizerFunction.Properties.Environment = { Variables: {} };
      }
      if (!authorizerFunction.Properties.Environment.Variables) {
        authorizerFunction.Properties.Environment.Variables = {};
      }

      // Add REST API ID (this doesn't create a cycle since REST API is independent)
      authorizerFunction.Properties.Environment.Variables.API_GATEWAY_REST_API_ID =
        { Ref: restApiId };

      // Do NOT add usage plan IDs here to avoid circular dependency:
      // Authorizer → Usage Plans (via Ref) → Stage → Deployment → Methods → Authorizer
      // Instead, the authorizer will look up usage plans by name at runtime
    }

    // Add usage plan IDs to all Lambda functions (except authorizer to avoid cycles)
    // These are needed by subscription management functions that call associateSubscriptionWithPlan()
    // This is safe because these functions don't depend on the deployment, so no cycle is created
    const defaultPlanNames = ["free", "starter", "pro"];
    const allPlanNames = [...new Set([...defaultPlanNames, ...Object.keys(plans)])];
    
    for (const [resourceId, resource] of Object.entries(resources)) {
      // Only process Lambda functions, skip the authorizer
      if (
        resource &&
        resource.Type === "AWS::Lambda::Function" &&
        resourceId !== authorizerFunctionId
      ) {
        if (!resource.Properties) {
          resource.Properties = {};
        }
        if (!resource.Properties.Environment) {
          resource.Properties.Environment = { Variables: {} };
        }
        if (!resource.Properties.Environment.Variables) {
          resource.Properties.Environment.Variables = {};
        }

        // Add usage plan IDs for all plans
        for (const planName of allPlanNames) {
          const planId = `UsagePlan${planName.charAt(0).toUpperCase() + planName.slice(1)}`;
          const envVarName = `USAGE_PLAN_${planName.toUpperCase()}_ID`;
          resource.Properties.Environment.Variables[envVarName] = {
            Ref: planId,
          };
        }

        // Also add REST API ID for convenience
        resource.Properties.Environment.Variables.API_GATEWAY_REST_API_ID = {
          Ref: restApiId,
        };
      }
    }

    console.log("[api-throttling] Configured usage plans and authorizer");

    // Validate for circular dependencies
    // We removed usage plan ID env vars from the authorizer to break the cycle
    // The dependency chain is now: Usage Plans → Stage (via Fn::GetAtt) → Deployment → Methods → Authorizer
    // There should be no cycle since Authorizer no longer depends on Usage Plans
    const validation = validateDependencies(cloudformation);
    if (!validation.valid) {
      const errorMessage = `[api-throttling] Circular dependency detected in CloudFormation template:\n${formatCycles(validation.cycles)}\n\nThis will cause deployment to fail. Please review the dependencies.`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    return cloudformation;
}

module.exports = {
  package: configureApiThrottling,
  deploy: {
    start: configureApiThrottling,
  },
};

