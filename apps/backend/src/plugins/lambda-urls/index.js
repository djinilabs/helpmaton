/**
 * Lambda URLs Plugin
 *
 * This plugin automatically creates Lambda Function URLs for routes specified
 * in the @lambda-urls pragma in app.arc. These Function URLs bypass API Gateway
 * to enable true streaming responses.
 */

/**
 * Converts an Architect route to a Lambda function logical ID
 * @param {string} route - Route definition (e.g., "any /api/streams/:workspaceId/:agentId/:secret")
 * @returns {string} Lambda function logical ID (e.g., "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")
 */
function routeToFunctionId(route) {
  // Parse route: "any /api/streams/:workspaceId/:agentId/:secret"
  const trimmed = route.trim();
  if (!trimmed) {
    return null;
  }

  // Split into method and path
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }

  const method = parts[0].toUpperCase(); // "ANY", "GET", "POST", etc.
  const path = parts.slice(1).join(" "); // "/api/streams/:workspaceId/:agentId/:secret"

  // Convert method: "ANY" -> "Any", "GET" -> "Get", etc.
  const methodPrefix =
    method === "ANY" ? "Any" : method.charAt(0) + method.slice(1).toLowerCase();

  // Convert path to function ID pattern
  // Remove leading slash and split by '/'
  const pathSegments = path.replace(/^\//, "").split("/").filter(Boolean);

  // Convert each segment
  const convertedSegments = pathSegments.map((segment) => {
    if (segment === "*") {
      // Wildcard/catch-all: "*" -> "Catchall"
      // Architect uses "Catchall" for wildcard routes in logical resource IDs
      return "Catchall";
    } else if (segment.startsWith(":")) {
      // Path parameter: ":workspaceId" -> "WorkspaceId" (PascalCase)
      // Architect uses PascalCase for path parameters in logical resource IDs
      const paramName = segment.substring(1);
      return paramName.charAt(0).toUpperCase() + paramName.slice(1);
    } else {
      // Regular segment: "api" -> "Api", "streams" -> "Streams"
      return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
    }
  });

  // Combine: method + path segments + "HTTPLambda"
  const functionId = `${methodPrefix}${convertedSegments.join("")}HTTPLambda`;

  return functionId;
}

/**
 * Parses the @lambda-urls pragma from the arc file
 * @param {Object} arc - Parsed arc file
 * @returns {string[]} Array of route definitions
 */
function parseLambdaUrlsPragma(arc) {
  // Check if lambda-urls pragma exists
  const pragma = arc["lambda-urls"] || arc["lambdaUrls"];

  if (!pragma) {
    return [];
  }

  // Architect parses the pragma into an array of arrays:
  // [["any", "/api/streams/:workspaceId/:agentId/:secret"]]
  // Each inner array contains [method, path]
  if (Array.isArray(pragma)) {
    const routes = [];
    for (const item of pragma) {
      if (Array.isArray(item) && item.length >= 2) {
        // Join method and path: ["any", "/api/streams/..."] -> "any /api/streams/..."
        const route = item.join(" ").trim();
        if (route) {
          routes.push(route);
        }
      } else if (typeof item === "string") {
        // Fallback: if it's already a string, use it directly
        const route = item.trim();
        if (route) {
          routes.push(route);
        }
      }
    }
    return routes;
  }

  // If it's a single string, wrap it in an array
  if (typeof pragma === "string") {
    return [pragma.trim()].filter(Boolean);
  }

  return [];
}

/**
 * Extracts PR number from stack name
 * @param {string} stackName - Stack name (e.g., "HelpmatonStagingPR29" or "PR29")
 * @returns {number|null} PR number or null if not found
 */
function extractPrNumberFromStackName(stackName) {
  if (!stackName || typeof stackName !== "string") {
    return null;
  }

  // Match patterns like "PR29" or "HelpmatonStagingPR29"
  const match = stackName.match(/PR(\d+)/i);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }

  return null;
}

/**
 * Gets the DNS name for the streaming endpoint based on stack name and stage
 * @param {string|Object} stackName - Stack name (string or CloudFormation reference)
 * @param {string} stage - Deployment stage
 * @returns {string|Object|null} DNS name (string, CloudFormation reference, or null)
 */
function getStreamingDnsName(stackName, stage) {
  // If stackName is a CloudFormation reference, we need to construct DNS name dynamically
  // This is a fallback case when stack name isn't available at plugin time
  if (typeof stackName === "object" && stackName.Ref === "AWS::StackName") {
    // For CloudFormation references, we'll use string manipulation to extract PR number
    // If the stack name doesn't contain "PR", we'll use "agent-stream" (production)
    // Otherwise, we'll extract the PR number and use "{PR}-agent-stream"
    // We use Fn::Sub with conditional logic based on whether "PR" exists in the stack name
    return {
      "Fn::Sub": [
        "${PrPrefix}agent-stream.helpmaton.com",
        {
          PrPrefix: {
            "Fn::If": [
              "HasPrInStackName",
              {
                "Fn::Join": [
                  "",
                  [
                    {
                      "Fn::Select": [
                        1,
                        {
                          "Fn::Split": [
                            "PR",
                            { "Ref": "AWS::StackName" },
                          ],
                        },
                      ],
                    },
                    "-",
                  ],
                ],
              },
              "",
            ],
          },
        },
      ],
    };
  }

  // If stackName is a string, extract PR number at plugin time
  if (typeof stackName === "string") {
    const prNumber = extractPrNumberFromStackName(stackName);
    
    // Check if it's production (no PR number and stage is production or stack name contains "Production")
    const isProduction = !prNumber && (stage === "production" || stackName.includes("Production"));
    
    if (isProduction) {
      return "agent-stream.helpmaton.com";
    }
    
    if (prNumber) {
      return `${prNumber}-agent-stream.helpmaton.com`;
    }
  }

  return null;
}

/**
 * Extracts hostname from Lambda Function URL
 * Function URL format: https://{id}.lambda-url.{region}.on.aws/
 * Returns: {id}.lambda-url.{region}.on.aws
 * 
 * Uses CloudFormation intrinsic functions to extract hostname from URL
 * @param {string|Object} functionUrl - Function URL (string or CloudFormation reference)
 * @returns {string|Object} Hostname (string or CloudFormation intrinsic function)
 */
function extractHostnameFromFunctionUrl(functionUrl) {
  // If functionUrl is a CloudFormation reference (Fn::GetAtt), we need to extract hostname
  // The Function URL format is: https://{id}.lambda-url.{region}.on.aws/
  // We'll use Fn::Split to extract the hostname part
  if (typeof functionUrl === "object") {
    // Split on "//" to get the part after https://
    // Then split on "/" to get just the hostname (before any path)
    return {
      "Fn::Select": [
        0,
        {
          "Fn::Split": [
            "/",
            {
              "Fn::Select": [
                1,
                {
                  "Fn::Split": [
                    "//",
                    functionUrl,
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  // If it's already a string, extract hostname
  if (typeof functionUrl === "string") {
    try {
      const url = new URL(functionUrl);
      return url.hostname;
    } catch {
      // If URL parsing fails, try simple string manipulation
      return functionUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    }
  }

  return functionUrl;
}

/**
 * Creates Lambda Function URL resources for a given function
 * @param {Object} resources - CloudFormation resources
 * @param {Object} outputs - CloudFormation outputs
 * @param {string} functionId - Lambda function logical ID
 * @param {string} route - Route definition (for logging)
 */
function createFunctionUrl(resources, outputs, functionId, route, stage = "staging") {
  const functionResource = resources[functionId];

  if (!functionResource) {
    console.log(
      `[lambda-urls] Lambda function ${functionId} not found for route ${route}, skipping`
    );
    return;
  }

  console.log(
    `[lambda-urls] Found Lambda function ${functionId} for route: ${route}`
  );

  // Check if this is a streaming route (needed for output ID determination)
  const isStreamingRoute = route.includes("/api/streams/");
  // Check if this is a scrape route (needed for output ID determination)
  const isScrapeRoute = route.includes("/api/scrape");
  // Check if this is a test agent route (needed for output ID determination)
  const isTestAgentRoute = route.includes("/api/workspaces");

  // Create Lambda Function URL resource
  // Note: No need to prefix with stack name - CloudFormation resource IDs are already unique within a stack
  const functionUrlId = `${functionId}Url`;
  if (!resources[functionUrlId]) {
    resources[functionUrlId] = {
      Type: "AWS::Lambda::Url",
      Properties: {
        TargetFunctionArn: {
          "Fn::GetAtt": [functionId, "Arn"],
        },
        AuthType: "NONE", // Public access (secret is validated in handler)
        InvokeMode: "RESPONSE_STREAM", // All Function URLs use streaming mode
        // NOTE: CORS is NOT configured here to avoid duplication with manually set CORS headers
        // The Lambda handler sets CORS headers dynamically based on database configuration
        // This allows for per-agent CORS configuration while avoiding header duplication issues
      },
    };

    // Add dependency on the Lambda function
    resources[functionUrlId].DependsOn = functionId;

    console.log(
      `[lambda-urls] Created Lambda Function URL resource: ${functionUrlId} with RESPONSE_STREAM mode`
    );
  }

  // Create Lambda permission for public invocation
  // Note: No need to prefix with stack name - CloudFormation resource IDs are already unique within a stack
  // AWS requires both lambda:InvokeFunction and lambda:InvokeFunctionUrl permissions for public access
  const permissionId = `${functionId}UrlPermission`;
  if (!resources[permissionId]) {
    resources[permissionId] = {
      Type: "AWS::Lambda::Permission",
      Properties: {
        FunctionName: {
          "Fn::GetAtt": [functionId, "Arn"],
        },
        Action: "lambda:InvokeFunctionUrl",
        Principal: "*",
        FunctionUrlAuthType: "NONE",
      },
      DependsOn: [functionUrlId, functionId],
    };

    // Create a second permission for lambda:InvokeFunction (required for public access)
    // AWS console warning suggests both permissions are needed when AuthType is NONE
    // Note: FunctionUrlAuthType is only valid for lambda:InvokeFunctionUrl, not lambda:InvokeFunction
    const invokePermissionId = `${functionId}UrlInvokePermission`;
    if (!resources[invokePermissionId]) {
      resources[invokePermissionId] = {
        Type: "AWS::Lambda::Permission",
        Properties: {
          FunctionName: {
            "Fn::GetAtt": [functionId, "Arn"],
          },
          Action: "lambda:InvokeFunction",
          Principal: "*",
        },
        DependsOn: [functionId],
      };

      console.log(
        `[lambda-urls] Created Lambda InvokeFunction permission for Function URL: ${invokePermissionId}`
      );
    }

    console.log(
      `[lambda-urls] Created Lambda permission for Function URL: ${permissionId}`
    );
  }

  // Add output for the Function URL
  // For backward compatibility, use "StreamingFunctionUrl" for the streaming route
  // Use "ScrapeFunctionUrl" for the scrape route for consistency
  // Use "TestAgentFunctionUrl" for the test agent route (workspaces catchall)
  // Otherwise, use a sanitized route name
  const outputId = isStreamingRoute
    ? "StreamingFunctionUrl"
    : isScrapeRoute
      ? "ScrapeFunctionUrl"
      : isTestAgentRoute
        ? "TestAgentFunctionUrl"
        : `${functionId.replace(/[^a-zA-Z0-9]/g, "")}FunctionUrl`;

  if (!outputs[outputId]) {
    outputs[outputId] = {
      Description: `Lambda Function URL for route: ${route}`,
      Value: {
        "Fn::GetAtt": [functionUrlId, "FunctionUrl"],
      },
      Export: {
        Name: {
          "Fn::Sub": isStreamingRoute
            ? "${AWS::StackName}-streaming-function-url"
            : isScrapeRoute
              ? "${AWS::StackName}-scrape-function-url"
              : isTestAgentRoute
                ? "${AWS::StackName}-test-agent-function-url"
                : `\${AWS::StackName}-${functionId
                    .replace(/[^a-zA-Z0-9]/g, "")
                    .toLowerCase()}-function-url`,
        },
      },
    };

    console.log(`[lambda-urls] Added CloudFormation output: ${outputId}`);
  }

  // For streaming routes, we use the Lambda Function URL directly (no CloudFront/DNS)
  // The Function URL output is already created above, which is all we need
}

/**
 * Main plugin function that creates Lambda Function URLs
 */
async function configureLambdaUrls({ cloudformation, inventory, arc, stage }) {
  const resources = cloudformation.Resources || {};
  const outputs = cloudformation.Outputs || {};
  const conditions = cloudformation.Conditions || {};
  
  // Get stage from parameter or environment variable
  const deploymentStage = stage || process.env.ARC_ENV || process.env.ARC_STAGE || "staging";
  
  // Create CloudFormation condition to check if stack name contains "PR"
  // This is needed for dynamic DNS name generation when stack name is a CloudFormation reference
  if (!conditions.HasPrInStackName) {
    conditions.HasPrInStackName = {
      "Fn::Not": [
        {
          "Fn::Equals": [
            {
              "Fn::Select": [
                0,
                {
                  "Fn::Split": [
                    "PR",
                    { "Ref": "AWS::StackName" },
                  ],
                },
              ],
            },
            { "Ref": "AWS::StackName" },
          ],
        },
      ],
    };
    cloudformation.Conditions = conditions;
    console.log("[lambda-urls] Created CloudFormation condition: HasPrInStackName");
  }

  // Parse @lambda-urls pragma
  // Try multiple sources for the arc data (same pattern as api-throttling plugin)
  const arcData = arc || inventory?.arc || inventory?.app?.arc || {};
  
  // Debug logging to help diagnose issues
  console.log("[lambda-urls] Plugin execution started");
  console.log("[lambda-urls] arc parameter:", arc ? "present" : "missing");
  console.log("[lambda-urls] inventory?.arc:", inventory?.arc ? "present" : "missing");
  console.log("[lambda-urls] inventory?.app?.arc:", inventory?.app?.arc ? "present" : "missing");
  
  const routes = parseLambdaUrlsPragma(arcData);
  
  console.log("[lambda-urls] Parsed routes:", routes);

  if (routes.length === 0) {
    console.log(
      "[lambda-urls] No @lambda-urls pragma found, skipping Function URL creation"
    );
    console.log("[lambda-urls] arcData keys:", Object.keys(arcData));
    return cloudformation;
  }

  console.log(
    `[lambda-urls] Found ${routes.length} route(s) in @lambda-urls pragma:`,
    routes.join(", ")
  );

  // Process each route
  for (const route of routes) {
    const functionId = routeToFunctionId(route);
    
    console.log(`[lambda-urls] Processing route: ${route} -> functionId: ${functionId}`);

    if (!functionId) {
      console.warn(
        `[lambda-urls] Could not convert route to function ID: ${route}`
      );
      continue;
    }

    // Check if function exists before trying to create Function URL
    if (!resources[functionId]) {
      console.warn(
        `[lambda-urls] Lambda function ${functionId} not found in CloudFormation resources. Available function IDs:`,
        Object.keys(resources).filter(id => resources[id]?.Type === "AWS::Lambda::Function").slice(0, 10)
      );
      continue;
    }

    createFunctionUrl(resources, outputs, functionId, route, deploymentStage);
  }

  // Add IAM permissions for GetApiStreamsUrl function to query CloudFormation and Lambda APIs
  addIamPermissionsForStreamUrlLookup(resources);

  return cloudformation;
}

/**
 * Adds IAM permissions to the GetApiStreamsUrl Lambda function
 * to allow it to query CloudFormation stack outputs and Lambda function URLs
 * @param {Object} resources - CloudFormation resources
 */
function addIamPermissionsForStreamUrlLookup(resources) {
  const functionId = "GetApiStreamsUrlHTTPLambda";
  const functionResource = resources[functionId];

  if (!functionResource) {
    console.log(
      `[lambda-urls] GetApiStreamsUrl function not found, skipping IAM permissions`
    );
    return;
  }

  // Find the Lambda execution role
  // Architect uses a shared "Role" resource for all Lambda functions
  let roleId = "Role";
  let role = resources[roleId];

  // If not found, try to extract from Lambda function's Role property
  if (!role && functionResource.Properties?.Role) {
    const roleProperty = functionResource.Properties.Role;

    // Handle direct Ref: { Ref: "Role" }
    if (roleProperty && typeof roleProperty === "object" && roleProperty.Ref) {
      roleId = roleProperty.Ref;
      role = resources[roleId];
    }
    // Handle Fn::Sub with nested Ref: { "Fn::Sub": ["...", { "roleName": { "Ref": "Role" } }] }
    else if (
      roleProperty &&
      typeof roleProperty === "object" &&
      roleProperty["Fn::Sub"]
    ) {
      const subArray = roleProperty["Fn::Sub"];
      if (
        Array.isArray(subArray) &&
        subArray.length === 2 &&
        typeof subArray[1] === "object"
      ) {
        const subVars = subArray[1];
        for (const key in subVars) {
          const value = subVars[key];
          if (value && typeof value === "object" && value.Ref) {
            roleId = value.Ref;
            role = resources[roleId];
            break;
          }
        }
      }
    }
  }

  if (role && role.Type === "AWS::IAM::Role") {
    // Add inline policy to the role for CloudFormation and Lambda operations
    const policyId = `${functionId}StreamUrlLookupPolicy`;
    if (!resources[policyId]) {
      resources[policyId] = {
        Type: "AWS::IAM::Policy",
        Properties: {
          PolicyName: "StreamUrlLookupPolicy",
          Roles: [{ Ref: roleId }],
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: [
                  "cloudformation:DescribeStacks",
                  "cloudformation:DescribeStackResources",
                ],
                Resource: [
                  {
                    "Fn::Sub":
                      "arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${AWS::StackName}/*",
                  },
                  {
                    "Fn::Sub":
                      "arn:aws:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${AWS::StackName}",
                  },
                ],
              },
              {
                Effect: "Allow",
                Action: [
                  "lambda:ListFunctions",
                  "lambda:GetFunction",
                  "lambda:GetFunctionUrlConfig",
                ],
                Resource: "*",
              },
            ],
          },
        },
        DependsOn: [roleId],
      };

      console.log(
        `[lambda-urls] Added IAM permissions to GetApiStreamsUrl Lambda role ${roleId} for CloudFormation and Lambda API access`
      );
    }
  } else {
    console.warn(
      `[lambda-urls] GetApiStreamsUrl Lambda role ${roleId} not found (type: ${role?.Type}). IAM permissions may need to be added manually.`
    );
  }
}

module.exports = {
  deploy: {
    start: configureLambdaUrls,
  },
  package: configureLambdaUrls,
};

// Export for testing
module.exports.configureLambdaUrls = configureLambdaUrls;
module.exports.routeToFunctionId = routeToFunctionId;
module.exports.parseLambdaUrlsPragma = parseLambdaUrlsPragma;
module.exports.extractPrNumberFromStackName = extractPrNumberFromStackName;
module.exports.getStreamingDnsName = getStreamingDnsName;
module.exports.extractHostnameFromFunctionUrl = extractHostnameFromFunctionUrl;

