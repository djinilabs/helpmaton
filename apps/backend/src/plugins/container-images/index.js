/**
 * Container Images Plugin
 *
 * This plugin converts specified Lambda functions to use container images
 * instead of ZIP packages. It parses the @container-images pragma from app.arc
 * and modifies CloudFormation Lambda resources accordingly.
 */

/**
 * Converts an Architect route to a Lambda function logical ID
 * Reuses the same logic as lambda-urls plugin
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

  const method = parts[0]?.toUpperCase(); // "ANY", "GET", "POST", etc.
  const routePath = parts.slice(1).join(" "); // "/api/streams/:workspaceId/:agentId/:secret"

  // Validate method and path are present
  if (!method || !routePath) {
    return null;
  }

  // Convert method: "ANY" -> "Any", "GET" -> "Get", etc.
  const methodPrefix =
    method === "ANY" ? "Any" : method.charAt(0) + method.slice(1).toLowerCase();

  // Convert path to function ID pattern
  // Remove leading slash and split by '/'
  const pathSegments = routePath.replace(/^\//, "").split("/").filter(Boolean);

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
 * Parses the @container-images pragma from the arc file
 * Format: 
 *   HTTP: method route image-name (e.g., "any /api/streams/:workspaceId/:agentId/:secret my-custom-image")
 *   Queue: queue queue-name image-name (e.g., "queue agent-temporal-grain-queue lancedb")
 *   Scheduled: scheduled scheduled-name image-name (e.g., "scheduled aggregate-token-usage lancedb")
 * @param {Object} arc - Parsed arc file
 * @returns {Map<string, {imageName: string, group?: string}>} Map of function ID to image metadata
 */
function parseContainerImagesPragma(arc) {
  const imageMap = new Map();

  // Check if container-images pragma exists
  const pragma = arc["container-images"] || arc["containerImages"];

  if (!pragma) {
    return imageMap;
  }

  // Architect parses the pragma into an array of arrays:
  // HTTP: [["any", "/api/streams/:workspaceId/:agentId/:secret", "my-custom-image"]]
  // Queue: [["queue", "agent-temporal-grain-queue", "lancedb"]]
  // Scheduled: [["scheduled", "aggregate-token-usage", "lancedb"]]
  if (Array.isArray(pragma)) {
    for (const item of pragma) {
      if (Array.isArray(item) && item.length >= 3) {
        const typeOrMethod = item[0];
        const secondPart = item[1];
        const imageName = item[2];
        const groupName = item[3];
        
        // Validate all required fields are present and are strings
        if (!typeOrMethod || !secondPart || !imageName) {
          console.warn(
            `[container-images] Skipping invalid pragma item: missing type/method, name/path, or imageName`,
            item
          );
          continue;
        }
        
        if (
          typeof typeOrMethod !== "string" ||
          typeof secondPart !== "string" ||
          typeof imageName !== "string"
        ) {
          console.warn(
            `[container-images] Skipping invalid pragma item: type/method, name/path, or imageName must be strings`,
            item
          );
          continue;
        }
        
        const trimmedTypeOrMethod = typeOrMethod.trim().toLowerCase();
        let functionId = null;
        
        // Check if it's a queue or scheduled function
        if (trimmedTypeOrMethod === "queue") {
          // Queue format: ["queue", "agent-temporal-grain-queue", "lancedb"]
          functionId = queueToFunctionId(secondPart.trim());
        } else if (trimmedTypeOrMethod === "scheduled") {
          // Scheduled format: ["scheduled", "aggregate-token-usage", "lancedb"]
          functionId = scheduledToFunctionId(secondPart.trim());
        } else {
          // HTTP route format: ["any", "/api/streams/...", "image-name"]
          const route = `${typeOrMethod} ${secondPart}`.trim();
          functionId = routeToFunctionId(route);
        }
        
        if (functionId) {
          const group =
            typeof groupName === "string" && groupName.trim()
              ? groupName.trim()
              : undefined;
          imageMap.set(functionId, {
            imageName: imageName.trim(),
            ...(group ? { group } : {}),
          });
        }
      } else if (typeof item === "string") {
        // Fallback: parse string format
        // HTTP: "method route image-name"
        // Queue: "queue queue-name image-name"
        // Scheduled: "scheduled scheduled-name image-name"
        const parts = item.trim().split(/\s+/);
        if (parts.length >= 3) {
          const typeOrMethod = parts[0].toLowerCase();
          const hasGroup = parts.length >= 4;
          const imageName = parts[parts.length - (hasGroup ? 2 : 1)];
          const groupName = hasGroup ? parts[parts.length - 1] : undefined;
          let functionId = null;
          
          if (typeOrMethod === "queue") {
            // Queue: "queue agent-temporal-grain-queue lancedb"
            const queueName = parts.slice(1, hasGroup ? -2 : -1).join(" "); // Everything except type + image (+ group)
            functionId = queueToFunctionId(queueName.trim());
          } else if (typeOrMethod === "scheduled") {
            // Scheduled: "scheduled aggregate-token-usage lancedb"
            const scheduledName = parts
              .slice(1, hasGroup ? -2 : -1)
              .join(" "); // Everything except type + image (+ group)
            functionId = scheduledToFunctionId(scheduledName.trim());
          } else {
            // HTTP: "any /api/streams/:workspaceId/:agentId/:secret lancedb"
            const routePath = parts.slice(1, hasGroup ? -2 : -1).join(" "); // Everything except type + image (+ group)
            const route = `${parts[0]} ${routePath}`.trim();
            functionId = routeToFunctionId(route);
          }
          
          if (functionId) {
            const group =
              typeof groupName === "string" && groupName.trim()
                ? groupName.trim()
                : undefined;
            imageMap.set(functionId, {
              imageName: imageName.trim(),
              ...(group ? { group } : {}),
            });
          }
        }
      }
    }
  }

  return imageMap;
}

/**
 * Update all references from oldId to newId in a CloudFormation template
 * @param {Object} cloudformation - CloudFormation template
 * @param {string} oldId - Old resource ID
 * @param {string} newId - New resource ID
 */
function updateResourceReferences(cloudformation, oldId, newId) {
  const resources = cloudformation.Resources || {};
  const outputs = cloudformation.Outputs || {};

  function updateRefs(obj) {
    if (obj === null || obj === undefined) {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item) => updateRefs(item));
      return;
    }

    if (typeof obj !== "object") {
      return;
    }

    if (obj.Ref === oldId) {
      obj.Ref = newId;
    }

    if (
      obj["Fn::GetAtt"] &&
      Array.isArray(obj["Fn::GetAtt"]) &&
      obj["Fn::GetAtt"][0] === oldId
    ) {
      obj["Fn::GetAtt"][0] = newId;
    }

    Object.values(obj).forEach((value) => updateRefs(value));
  }

  Object.values(resources).forEach((resource) => {
    if (!resource || typeof resource !== "object") {
      return;
    }
    if (resource.Properties) {
      updateRefs(resource.Properties);
    }
    if (resource.DependsOn) {
      if (Array.isArray(resource.DependsOn)) {
        resource.DependsOn = resource.DependsOn.map((dep) =>
          dep === oldId ? newId : dep
        );
      } else if (resource.DependsOn === oldId) {
        resource.DependsOn = newId;
      }
    }
  });

  Object.values(outputs).forEach((output) => {
    if (!output || typeof output !== "object") {
      return;
    }
    if (output.Value) {
      updateRefs(output.Value);
    }
  });
}

function normalizeArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function mergeUniqueArray(target, source) {
  const existing = new Set(target.map((entry) => JSON.stringify(entry)));
  for (const entry of source) {
    const key = JSON.stringify(entry);
    if (!existing.has(key)) {
      target.push(entry);
      existing.add(key);
    }
  }
}

/**
 * Merge supported Lambda properties when grouping functions.
 * Note: This intentionally only merges Events, Environment Variables,
 * Policies, Layers, Timeout, and MemorySize. Other Lambda settings
 * (VPC, DLQ, EphemeralStorage, FileSystemConfigs, ReservedConcurrency, etc.)
 * are not merged and should remain consistent across grouped functions.
 */
function mergeFunctionProperties(primaryResource, secondaryResource, secondaryId) {
  if (!primaryResource.Properties) {
    primaryResource.Properties = {};
  }
  const primaryProps = primaryResource.Properties;
  const secondaryProps = secondaryResource.Properties || {};

  if (secondaryProps.Events) {
    if (!primaryProps.Events) {
      primaryProps.Events = {};
    }
    for (const [eventKey, eventValue] of Object.entries(
      secondaryProps.Events
    )) {
      let mergedKey = eventKey;
      let suffix = 0;
      while (primaryProps.Events[mergedKey]) {
        suffix += 1;
        mergedKey = `${eventKey}${secondaryId}${suffix}`;
      }
      primaryProps.Events[mergedKey] = eventValue;
    }
  }

  if (secondaryProps.Environment?.Variables) {
    if (!primaryProps.Environment) {
      primaryProps.Environment = { Variables: {} };
    }
    if (!primaryProps.Environment.Variables) {
      primaryProps.Environment.Variables = {};
    }
    for (const [key, value] of Object.entries(
      secondaryProps.Environment.Variables
    )) {
      if (primaryProps.Environment.Variables[key] === undefined) {
        primaryProps.Environment.Variables[key] = value;
      } else if (primaryProps.Environment.Variables[key] !== value) {
        console.warn(
          `[container-images] Environment variable conflict for ${key} while merging ${secondaryId}; keeping primary value`
        );
      }
    }
  }

  if (secondaryProps.Policies) {
    if (!primaryProps.Policies) {
      primaryProps.Policies = [];
    }
    const primaryPolicies = normalizeArray(primaryProps.Policies);
    const secondaryPolicies = normalizeArray(secondaryProps.Policies);
    primaryProps.Policies = primaryPolicies;
    mergeUniqueArray(primaryPolicies, secondaryPolicies);
  }

  if (secondaryProps.Layers) {
    if (!primaryProps.Layers) {
      primaryProps.Layers = [];
    }
    const primaryLayers = normalizeArray(primaryProps.Layers);
    const secondaryLayers = normalizeArray(secondaryProps.Layers);
    primaryProps.Layers = primaryLayers;
    mergeUniqueArray(primaryLayers, secondaryLayers);
  }

  if (typeof secondaryProps.Timeout === "number") {
    if (
      typeof primaryProps.Timeout !== "number" ||
      secondaryProps.Timeout > primaryProps.Timeout
    ) {
      primaryProps.Timeout = secondaryProps.Timeout;
    }
  }

  if (typeof secondaryProps.MemorySize === "number") {
    if (
      typeof primaryProps.MemorySize !== "number" ||
      secondaryProps.MemorySize > primaryProps.MemorySize
    ) {
      primaryProps.MemorySize = secondaryProps.MemorySize;
    }
  }
}

/**
 * Gets the ECR repository URI for a given image name
 * @param {string} imageName - Image name
 * @param {string} region - AWS region
 * @param {string} accountId - AWS account ID (optional, will use CloudFormation reference if not provided)
 * @param {string} repositoryName - ECR repository name
 * @param {string} tag - Image tag (default: latest)
 * @returns {string|Object} ECR image URI (string or CloudFormation reference)
 */
function getEcrImageUri(imageName, region, accountId, repositoryName, tag = "latest") {
  // Validate all parameters
  if (!imageName || typeof imageName !== "string") {
    throw new Error("imageName must be a non-empty string");
  }
  if (!region || typeof region !== "string") {
    throw new Error("region must be a non-empty string");
  }
  if (!repositoryName || typeof repositoryName !== "string") {
    throw new Error("repositoryName must be a non-empty string");
  }
  if (!tag || typeof tag !== "string") {
    throw new Error("tag must be a non-empty string");
  }

  // If accountId is provided, construct URI directly
  if (accountId) {
    return `${accountId}.dkr.ecr.${region}.amazonaws.com/${repositoryName}:${imageName}-${tag}`;
  }

  // Otherwise, use CloudFormation intrinsic functions
  return {
    "Fn::Sub": [
      "${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/${RepositoryName}:${ImageName}-${Tag}",
      {
        RepositoryName: repositoryName,
        ImageName: imageName,
        Tag: tag,
      },
    ],
  };
}

/**
 * Creates or ensures ECR repository exists in CloudFormation
 * @param {Object} resources - CloudFormation resources
 * @param {string} repositoryName - ECR repository name
 * @returns {string} Repository resource ID
 */
function ensureEcrRepository(resources, repositoryName) {
  const repositoryId = "LambdaImagesRepository";

  // Check if repository already exists
  if (resources[repositoryId]) {
    return repositoryId;
  }

  // Create ECR repository resource
  resources[repositoryId] = {
    Type: "AWS::ECR::Repository",
    Properties: {
      RepositoryName: repositoryName,
      ImageScanningConfiguration: {
        ScanOnPush: true,
      },
      LifecyclePolicy: {
        LifecyclePolicyText: JSON.stringify({
          rules: [
            {
              rulePriority: 1,
              description: "Keep last 10 images per tag",
              selection: {
                tagStatus: "tagged",
                tagPrefixList: ["latest"],
                countType: "imageCountMoreThan",
                countNumber: 10,
              },
              action: {
                type: "expire",
              },
            },
          ],
        }),
      },
    },
  };

  console.log(
    `[container-images] Created ECR repository resource: ${repositoryId} (${repositoryName})`
  );

  return repositoryId;
}

/**
 * Converts a queue name to a Lambda function logical ID
 * @param {string} queueName - Queue name (e.g., "agent-temporal-grain-queue")
 * @returns {string} Lambda function logical ID (e.g., "AgentTemporalGrainQueueQueueLambda")
 */
function queueToFunctionId(queueName) {
  if (!queueName || typeof queueName !== "string") {
    return null;
  }

  const trimmed = queueName.trim();
  if (!trimmed) {
    return null;
  }

  // Convert kebab-case to PascalCase
  // "agent-temporal-grain-queue" -> "AgentTemporalGrainQueue"
  const segments = trimmed.split("-");
  const convertedSegments = segments.map((segment) => {
    if (!segment) return "";
    return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
  });

  // Combine: converted segments + "QueueLambda"
  return `${convertedSegments.join("")}QueueLambda`;
}

/**
 * Converts a scheduled name to a Lambda function logical ID
 * @param {string} scheduledName - Scheduled name (e.g., "aggregate-token-usage")
 * @returns {string} Lambda function logical ID (e.g., "AggregateTokenUsageScheduledLambda")
 */
function scheduledToFunctionId(scheduledName) {
  if (!scheduledName || typeof scheduledName !== "string") {
    return null;
  }

  const trimmed = scheduledName.trim();
  if (!trimmed) {
    return null;
  }

  // Convert kebab-case to PascalCase
  // "aggregate-token-usage" -> "AggregateTokenUsage"
  const segments = trimmed.split("-");
  const convertedSegments = segments.map((segment) => {
    if (!segment) return "";
    return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
  });

  // Combine: converted segments + "ScheduledLambda"
  return `${convertedSegments.join("")}ScheduledLambda`;
}

/**
 * Converts a queue name to handler path for Lambda container image Command
 * Queue name format: "agent-temporal-grain-queue"
 * Handler path format: "queues/agent-temporal-grain-queue/index.handler"
 * @param {string} queueName - Queue name
 * @returns {string} Handler path for ImageConfig.Command
 */
function queueToHandlerPath(queueName) {
  if (!queueName || typeof queueName !== "string") {
    return null;
  }

  const trimmed = queueName.trim();
  if (!trimmed) {
    return null;
  }

  // Handler path: queues/{queue-name}/index.handler
  return `queues/${trimmed}/index.handler`;
}

/**
 * Converts a scheduled name to handler path for Lambda container image Command
 * Scheduled name format: "aggregate-token-usage"
 * Handler path format: "scheduled/aggregate-token-usage/index.handler"
 * @param {string} scheduledName - Scheduled name
 * @returns {string} Handler path for ImageConfig.Command
 */
function scheduledToHandlerPath(scheduledName) {
  if (!scheduledName || typeof scheduledName !== "string") {
    return null;
  }

  const trimmed = scheduledName.trim();
  if (!trimmed) {
    return null;
  }

  // Handler path: scheduled/{scheduled-name}/index.handler
  return `scheduled/${trimmed}/index.handler`;
}

/**
 * Converts a route to handler path for Lambda container image Command
 * Route format: "any /api/streams/:workspaceId/:agentId/:secret"
 * Handler path format for Command: "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
 * Note: The Command format is filename.exportname where filename is relative to LAMBDA_TASK_ROOT
 * @param {string} route - Route definition
 * @returns {string} Handler path for ImageConfig.Command
 */
function routeToHandlerPath(route) {
  const trimmed = route.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }

  const method = parts[0].toLowerCase(); // "any", "get", "post", etc.
  const path = parts.slice(1).join(" "); // "/api/streams/:workspaceId/:agentId/:secret"

  // Convert path to handler directory format
  // Remove leading slash, convert / to -, : to 000, and * to catchall
  // Keep "api" in the path (don't remove it)
  // Architect uses "catchall" for wildcard routes (e.g., /api/workspaces/* -> any-api-workspaces-catchall)
  const processedPath = path
    .replace(/^\//, "") // Remove leading slash
    .replace(/\//g, "-") // Convert / to -
    .replace(/\*/g, "catchall") // Convert * to catchall (Architect convention)
    .replace(/:/g, "000"); // Convert : to 000

  // Handler path for Command: http/{method}-{processedPath}/index.handler
  // This points directly to the handler file in the dist directory
  return `http/${method}-${processedPath}/index.handler`;
}

/**
 * Converts a Lambda function to use container images
 * @param {Object} functionResource - Lambda function CloudFormation resource
 * @param {string} imageUri - ECR image URI (string or CloudFormation reference)
 * @param {string} functionId - Lambda function logical ID
 * @param {string} handlerPath - Handler path (e.g., "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler")
 */
function convertToContainerImage(functionResource, imageUri, functionId, handlerPath) {
  // Architect uses AWS::Serverless::Function (SAM) which gets transformed to AWS::Lambda::Function
  // We need to handle both types
  const isLambdaFunction = 
    functionResource?.Type === "AWS::Lambda::Function" ||
    functionResource?.Type === "AWS::Serverless::Function";
  
  if (!functionResource || !isLambdaFunction) {
    console.warn(
      `[container-images] Resource ${functionId} is not a Lambda function (Type: ${functionResource?.Type}), skipping`
    );
    return;
  }

  // Ensure Properties exists
  if (!functionResource.Properties) {
    functionResource.Properties = {};
  }
  const properties = functionResource.Properties;

  // Set PackageType to Image
  properties.PackageType = "Image";

  // Set ImageUri and ImageConfig
  // For AWS::Serverless::Function (SAM), we use ImageUri directly in Properties
  // For AWS::Lambda::Function, we use Code with ImageUri
  if (functionResource.Type === "AWS::Serverless::Function") {
    // SAM functions use ImageUri directly in Properties for container images
    properties.ImageUri = imageUri;
    // Set CodeUri to empty string to prevent Architect from trying to resolve undefined paths
    // Architect's upload process checks CodeUri and when it's an empty string, it should skip zipping
    // An empty string is a valid path that path.resolve can handle without errors
    properties.CodeUri = "";
    // Remove Code property if it exists
    delete properties.Code;
    
    // Set ImageConfig to ensure WorkingDirectory and EntryPoint are explicitly set
    // This ensures Lambda uses /var/task as the working directory and the correct entrypoint
    // The base image sets WORKDIR and ENTRYPOINT, but explicitly setting them in ImageConfig ensures they're correct
    if (!properties.ImageConfig) {
      properties.ImageConfig = {};
    }
    // WorkingDirectory should be /var/task (LAMBDA_TASK_ROOT default)
    // This ensures Lambda looks for the handler in the correct directory
    if (!properties.ImageConfig.WorkingDirectory) {
      properties.ImageConfig.WorkingDirectory = "/var/task";
      console.log(
        `[container-images] Set ImageConfig.WorkingDirectory for ${functionId}: /var/task`
      );
    }
    // EntryPoint must be set explicitly when ImageConfig is present
    // AWS Lambda requires all ImageConfig properties (EntryPoint, Command, WorkingDirectory) to be non-empty
    // The AWS Lambda Node.js base image sets ENTRYPOINT to /lambda-entrypoint.sh
    if (!properties.ImageConfig.EntryPoint) {
      properties.ImageConfig.EntryPoint = ["/lambda-entrypoint.sh"];
      console.log(
        `[container-images] Set ImageConfig.EntryPoint for ${functionId}: /lambda-entrypoint.sh`
      );
    }
    // Command should point directly to the handler path (bypassing wrapper)
    // Format: ["path/to/handler.handler"] where path is relative to WorkingDirectory
    // This eliminates the wrapper layer and lets Lambda load the handler directly
    if (handlerPath && !properties.ImageConfig.Command) {
      // handlerPath format: "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
      // Command format: ["http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"]
      properties.ImageConfig.Command = [handlerPath];
      console.log(
        `[container-images] Set ImageConfig.Command for ${functionId} to point directly to handler: ${handlerPath}`
      );
    } else if (!properties.ImageConfig.Command) {
      // Fallback to index.handler if no handlerPath provided
      properties.ImageConfig.Command = ["index.handler"];
      console.log(
        `[container-images] Set ImageConfig.Command for ${functionId}: index.handler (fallback)`
      );
    }
    
    // Also set LAMBDA_HANDLER_PATH as a fallback if ImageConfig.Command is ignored
    if (handlerPath) {
      if (!properties.Environment) {
        properties.Environment = { Variables: {} };
      }
      if (!properties.Environment.Variables) {
        properties.Environment.Variables = {};
      }
      if (!properties.Environment.Variables.LAMBDA_HANDLER_PATH) {
        properties.Environment.Variables.LAMBDA_HANDLER_PATH = handlerPath;
      }
    }
  } else {
    // Standard Lambda functions use Code with ImageUri
    // IMPORTANT: Remove any existing Code properties (S3Bucket, S3Key, ZipFile, etc.)
    // to prevent Architect from trying to package/upload code
    delete properties.Code;
    
    // Set Code with ImageUri for container images
    properties.Code = {
      ImageUri: imageUri,
    };
    
    // Set ImageConfig for standard Lambda functions too
    if (!properties.ImageConfig) {
      properties.ImageConfig = {};
    }
    if (!properties.ImageConfig.WorkingDirectory) {
      properties.ImageConfig.WorkingDirectory = "/var/task";
    }
    // EntryPoint must be set explicitly when ImageConfig is present
    // AWS Lambda requires all ImageConfig properties (EntryPoint, Command, WorkingDirectory) to be non-empty
    if (!properties.ImageConfig.EntryPoint) {
      properties.ImageConfig.EntryPoint = ["/lambda-entrypoint.sh"];
    }
    // Command should point directly to the handler path (bypassing wrapper)
    if (handlerPath && !properties.ImageConfig.Command) {
      properties.ImageConfig.Command = [handlerPath];
    } else if (!properties.ImageConfig.Command) {
      properties.ImageConfig.Command = ["index.handler"];
    }
    
    // Also set LAMBDA_HANDLER_PATH as a fallback if ImageConfig.Command is ignored
    if (handlerPath) {
      if (!properties.Environment) {
        properties.Environment = { Variables: {} };
      }
      if (!properties.Environment.Variables) {
        properties.Environment.Variables = {};
      }
      if (!properties.Environment.Variables.LAMBDA_HANDLER_PATH) {
        properties.Environment.Variables.LAMBDA_HANDLER_PATH = handlerPath;
      }
    }
  }

  // Remove Runtime (not used for container images)
  // Note: We keep it as null or remove it, but AWS requires it to be omitted
  delete properties.Runtime;

  // Remove Handler property - SAM doesn't allow Handler when PackageType is Image
  // For container images, the handler is determined by the Dockerfile CMD
  // We use a router entrypoint that routes based on the function name
  // Explicitly delete to ensure it's not present (even if null)
  if (properties.Handler !== undefined) {
    delete properties.Handler;
  }

  // Set memory for specific functions that need more memory
  // Puppeteer needs 2048 MB for web scraping
  if (functionId.includes("PostApiScrape") || functionId.includes("Scrape")) {
    properties.MemorySize = 2048;
    console.log(
      `[container-images] Set MemorySize to 2048 MB for ${functionId}`
    );
  }

  // Note: We're using LAMBDA_HANDLER_PATH environment variable
  // The wrapper at index.js reads this and loads the correct handler

  console.log(
    `[container-images] Converted Lambda function ${functionId} to use container image: ${typeof imageUri === "string" ? imageUri : "CloudFormation reference"}`
  );
}

/**
 * Main plugin function that converts Lambda functions to container images
 */
async function configureContainerImages({ cloudformation, inventory, arc, stage }) {
  try {
    // Validate required parameters
    if (!cloudformation) {
      console.warn("[container-images] cloudformation parameter is missing, skipping");
      return cloudformation || {};
    }

    const resources = cloudformation.Resources || {};
    const outputs = cloudformation.Outputs || {};

    // Get stage from parameter or environment variable
    const deploymentStage = stage || process.env.ARC_ENV || process.env.ARC_STAGE || "staging";

    // Parse @container-images pragma
    // Try multiple sources for the arc data (same pattern as other plugins)
    const arcData = arc || inventory?.arc || inventory?.app?.arc || {};

    // Ensure arcData is an object
    if (!arcData || typeof arcData !== "object") {
      console.warn("[container-images] arcData is not a valid object, skipping");
      return cloudformation;
    }

    console.log("[container-images] Plugin execution started");
    console.log("[container-images] arc parameter:", arc ? "present" : "missing");
    console.log("[container-images] inventory?.arc:", inventory?.arc ? "present" : "missing");
    console.log("[container-images] inventory?.app?.arc:", inventory?.app?.arc ? "present" : "missing");

  const imageMap = parseContainerImagesPragma(arcData);

  if (imageMap.size === 0) {
    console.log(
      "[container-images] No @container-images pragma found, skipping container image conversion"
    );
    console.log("[container-images] arcData keys:", Object.keys(arcData));
    return cloudformation;
  }

  console.log(
    `[container-images] Found ${imageMap.size} function(s) to convert to container images:`,
    Array.from(imageMap.entries())
      .map(([id, config]) => {
        const groupLabel = config.group ? ` (group: ${config.group})` : "";
        return `${id} -> ${config.imageName}${groupLabel}`;
      })
      .join(", ")
  );

  const groupedFunctions = new Map();
  for (const [functionId, config] of imageMap.entries()) {
    if (!config.group) {
      continue;
    }
    if (!groupedFunctions.has(config.group)) {
      groupedFunctions.set(config.group, []);
    }
    groupedFunctions.get(config.group).push(functionId);
  }

  // Get ECR repository name from environment or use default
  const repositoryName =
    (process.env.LAMBDA_IMAGES_ECR_REPOSITORY || "helpmaton-lambda-images").trim();

  // Validate repository name
  if (!repositoryName || typeof repositoryName !== "string") {
    console.error("[container-images] Invalid repository name:", repositoryName);
    return cloudformation;
  }

  // Get image tag from environment (commit SHA) or use "latest"
  // This should be set in the deployment workflow
  const imageTag = (process.env.LAMBDA_IMAGE_TAG || process.env.GITHUB_SHA || "latest").trim();

  // Validate image tag
  if (!imageTag || typeof imageTag !== "string") {
    console.error("[container-images] Invalid image tag:", imageTag);
    return cloudformation;
  }

  // Get AWS region
  const region = (process.env.AWS_REGION || "eu-west-2").trim();

  // Validate region
  if (!region || typeof region !== "string") {
    console.error("[container-images] Invalid AWS region:", region);
    return cloudformation;
  }

  // Note: ECR repository is created by build-and-push-lambda-images.sh script
  // We don't create it in CloudFormation to avoid conflicts

  // Also modify inventory to prevent Architect from trying to zip code for container image functions
  // Architect's upload process checks inventory.lambdas for code paths
  if (inventory && inventory.lambdas) {
    console.log(`[container-images] Checking inventory.lambdas (${Object.keys(inventory.lambdas).length} functions)`);
    for (const [functionId] of imageMap.entries()) {
      // Find matching lambda in inventory
      // Inventory keys are typically route-based (e.g., "any-api-streams-000workspaceId-000agentId-000secret")
      // Function IDs are like "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda"
      // We need to match by converting function ID to route format or by checking all lambdas
      const lambdaKeys = Object.keys(inventory.lambdas);
      let matched = false;
      
      for (const lambdaKey of lambdaKeys) {
        const lambda = inventory.lambdas[lambdaKey];
        
        // Check if this lambda corresponds to our function ID
        // We can match by checking if the lambda's name or src path matches
        // For now, try to match by checking if the key contains parts of the function ID
        // Function ID: "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda"
        // Inventory key might be: "any-api-streams-000workspaceId-000agentId-000secret"
        const functionIdLower = functionId.toLowerCase();
        const keyLower = lambdaKey.toLowerCase();
        
        // Check if key contains significant parts of function ID
        if (keyLower.includes("streams") && keyLower.includes("workspace") && 
            keyLower.includes("agent") && keyLower.includes("secret")) {
          // This is likely our function
          if (lambda && lambda.src !== undefined) {
            console.log(`[container-images] Removing src from inventory for ${lambdaKey} (matches ${functionId}) to skip code upload`);
            delete lambda.src;
            // Also set a flag to indicate this is a container image
            lambda.containerImage = true;
            matched = true;
            break;
          }
        }
      }
      
      if (!matched) {
        console.log(`[container-images] Could not find matching lambda in inventory for ${functionId}`);
        console.log(`[container-images] Available inventory keys: ${lambdaKeys.slice(0, 5).join(", ")}`);
      }
    }
  } else {
    console.log(`[container-images] No inventory.lambdas found, skipping inventory modification`);
  }

  // Process each function that needs container images
  // We need to get the function metadata from the arc data to compute the handler path
  // Map functionId -> { type: 'http'|'queue'|'scheduled', name: string }
  const functionMetadataMap = new Map();
  if (Array.isArray(arcData["container-images"] || arcData["containerImages"])) {
    const pragma = arcData["container-images"] || arcData["containerImages"];
    for (const item of pragma) {
      if (Array.isArray(item) && item.length >= 3) {
        const typeOrMethod = item[0];
        const secondPart = item[1];
        
        if (!typeOrMethod || !secondPart || typeof typeOrMethod !== "string" || typeof secondPart !== "string") {
          continue;
        }
        
        const trimmedTypeOrMethod = typeOrMethod.trim().toLowerCase();
        let funcId = null;
        let metadata = null;
        
        if (trimmedTypeOrMethod === "queue") {
          // Queue function
          const queueName = secondPart.trim();
          funcId = queueToFunctionId(queueName);
          if (funcId) {
            metadata = { type: "queue", name: queueName };
          }
        } else if (trimmedTypeOrMethod === "scheduled") {
          // Scheduled function
          const scheduledName = secondPart.trim();
          funcId = scheduledToFunctionId(scheduledName);
          if (funcId) {
            metadata = { type: "scheduled", name: scheduledName };
          }
        } else {
          // HTTP route
          const route = `${typeOrMethod} ${secondPart}`.trim();
          funcId = routeToFunctionId(route);
          if (funcId) {
            metadata = { type: "http", name: route };
          }
        }
        
        if (funcId && metadata) {
          functionMetadataMap.set(funcId, metadata);
        }
      } else if (typeof item === "string") {
        // Fallback: parse string format
        const parts = item.trim().split(/\s+/);
        if (parts.length >= 3) {
          const typeOrMethod = parts[0].toLowerCase();
          const hasGroup = parts.length >= 4;
          let funcId = null;
          let metadata = null;
          
          if (typeOrMethod === "queue") {
            const queueName = parts.slice(1, hasGroup ? -2 : -1).join(" ").trim();
            funcId = queueToFunctionId(queueName);
            if (funcId) {
              metadata = { type: "queue", name: queueName };
            }
          } else if (typeOrMethod === "scheduled") {
            const scheduledName = parts
              .slice(1, hasGroup ? -2 : -1)
              .join(" ")
              .trim();
            funcId = scheduledToFunctionId(scheduledName);
            if (funcId) {
              metadata = { type: "scheduled", name: scheduledName };
            }
          } else {
            const routePath = parts.slice(1, hasGroup ? -2 : -1).join(" ");
            const route = `${parts[0]} ${routePath}`.trim();
            funcId = routeToFunctionId(route);
            if (funcId) {
              metadata = { type: "http", name: route };
            }
          }
          
          if (funcId && metadata) {
            functionMetadataMap.set(funcId, metadata);
          }
        }
      }
    }
  }

  const primaryFunctionByGroup = new Map();
  for (const [groupName, functionIds] of groupedFunctions.entries()) {
    const httpPrimary = functionIds.find(
      (functionId) => functionMetadataMap.get(functionId)?.type === "http"
    );
    if (!httpPrimary) {
      throw new Error(
        `[container-images] Group ${groupName} must include an HTTP function to serve as the primary handler`
      );
    }
    primaryFunctionByGroup.set(groupName, httpPrimary);
  }

  // Collect all missing functions to report them all at once
  const missingFunctions = [];

  for (const [functionId, config] of imageMap.entries()) {
    if (!functionId || typeof functionId !== "string") {
      console.warn("[container-images] Invalid functionId:", functionId);
      continue;
    }

    if (!config?.imageName || typeof config.imageName !== "string") {
      console.warn("[container-images] Invalid imageName:", config);
      continue;
    }

    const functionResource = resources[functionId];

    if (!functionResource) {
      missingFunctions.push(functionId);
    }
  }

  if (missingFunctions.length > 0) {
    const availableFunctionIds = Object.keys(resources)
      .filter((id) => {
        const type = resources[id]?.Type;
        return type === "AWS::Lambda::Function" || type === "AWS::Serverless::Function";
      })
      .sort();

    const errorMessage = `[container-images] Lambda function(s) not found in CloudFormation resources: ${missingFunctions.join(", ")}. Available function IDs: [${availableFunctionIds.join(", ")}]`;
    
    throw new Error(errorMessage);
  }

  const removedFunctionIds = new Set();

  for (const [groupName, functionIds] of groupedFunctions.entries()) {
    const primaryFunctionId = primaryFunctionByGroup.get(groupName);
    if (!primaryFunctionId || functionIds.length <= 1) {
      continue;
    }

    const primaryResource = resources[primaryFunctionId];
    if (!primaryResource) {
      continue;
    }

    for (const functionId of functionIds) {
      if (functionId === primaryFunctionId) {
        continue;
      }
      const secondaryResource = resources[functionId];
      if (!secondaryResource) {
        continue;
      }
      mergeFunctionProperties(primaryResource, secondaryResource, functionId);
      updateResourceReferences(cloudformation, functionId, primaryFunctionId);
      delete resources[functionId];
      removedFunctionIds.add(functionId);
    }
  }

  const effectiveImageMap = new Map(imageMap);
  for (const functionId of removedFunctionIds) {
    effectiveImageMap.delete(functionId);
  }

  for (const [functionId, config] of effectiveImageMap.entries()) {
    const functionResource = resources[functionId];

    if (!functionResource) {
      continue;
    }
    
    console.log(
      `[container-images] Found function resource ${functionId}, Type: ${functionResource.Type}, Current PackageType: ${functionResource.Properties?.PackageType || "not set"}`
    );

    // Get function metadata to compute handler path
    const metadata = functionMetadataMap.get(functionId);
    let handlerPath = null;
    
    if (metadata) {
      if (metadata.type === "queue") {
        handlerPath = queueToHandlerPath(metadata.name);
      } else if (metadata.type === "scheduled") {
        handlerPath = scheduledToHandlerPath(metadata.name);
      } else if (metadata.type === "http") {
        handlerPath = routeToHandlerPath(metadata.name);
      }
    }

    const groupPrimaryId = config.group
      ? primaryFunctionByGroup.get(config.group)
      : null;
    if (config.group && groupPrimaryId === functionId) {
      if (!metadata || metadata.type !== "http") {
        console.error(
          `[container-images] Group primary function ${functionId} for group ${config.group} must be an HTTP function; found type: ${metadata?.type || "unknown"}`
        );
        continue;
      }
      handlerPath = `http/${config.group}/index.handler`;
    }

    // Get ECR image URI
    let imageUri;
    try {
      imageUri = getEcrImageUri(
        config.imageName.trim(),
        region,
        null,
        repositoryName,
        imageTag
      );
    } catch (error) {
      console.error(`[container-images] Failed to generate image URI for ${functionId}:`, error);
      continue;
    }

    // Validate imageUri
    if (!imageUri) {
      console.error(`[container-images] Failed to generate image URI for ${functionId}`);
      continue;
    }

    // Convert function to use container image
    try {
      convertToContainerImage(functionResource, imageUri, functionId, handlerPath);
    } catch (error) {
      console.error(`[container-images] Failed to convert function ${functionId}:`, error);
      continue;
    }
  }

  // Add ECR repository URI to outputs for reference
  if (!outputs.LambdaImagesRepositoryUri) {
    outputs.LambdaImagesRepositoryUri = {
      Description: "ECR repository URI for Lambda container images",
      Value: {
        "Fn::Sub": [
          "${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/${RepositoryName}",
          {
            RepositoryName: repositoryName,
          },
        ],
      },
      Export: {
        Name: {
          "Fn::Sub": "${AWS::StackName}-lambda-images-repository-uri",
        },
      },
    };
  }

    return cloudformation;
  } catch (error) {
    // Re-throw configuration errors (like missing functions) - these should fail deployment
    if (error.message && error.message.includes("[container-images]")) {
      throw error;
    }
    // For unexpected errors, log and return cloudformation as-is to avoid breaking deployment
    console.error("[container-images] Unexpected error in configureContainerImages:", error);
    console.error("[container-images] Error stack:", error.stack);
    return cloudformation;
  }
}

module.exports = {
  deploy: {
    start: configureContainerImages,
    // Also run at end to ensure Handler is removed after all plugins run
    end: async ({ cloudformation }) => {
      // Post-process to ensure Handler, Runtime, and Code are correctly set for container images
      if (!cloudformation?.Resources) {
        return cloudformation;
      }

      const resources = cloudformation.Resources;
      for (const [resourceId, resource] of Object.entries(resources)) {
        if (
          resource?.Type === "AWS::Serverless::Function" ||
          resource?.Type === "AWS::Lambda::Function"
        ) {
          const properties = resource.Properties;
          if (properties?.PackageType === "Image") {
            // Ensure Handler is completely removed (not just null)
            if (properties.Handler !== undefined) {
              delete properties.Handler;
              console.log(
                `[container-images] Removed Handler property from ${resourceId} (post-processing)`
              );
            }
            // Also ensure Runtime is removed
            if (properties.Runtime !== undefined) {
              delete properties.Runtime;
            }
            
            // For AWS::Serverless::Function (SAM), ensure CodeUri is empty and Code is removed
            if (resource.Type === "AWS::Serverless::Function") {
              if (properties.CodeUri !== undefined && properties.CodeUri !== "") {
                console.log(
                  `[container-images] Setting CodeUri to empty string for ${resourceId} (post-processing)`
                );
                properties.CodeUri = "";
              }
              // Remove Code property if it exists (SAM uses ImageUri directly in Properties)
              if (properties.Code !== undefined) {
                console.log(
                  `[container-images] Removing Code property from ${resourceId} (SAM uses ImageUri directly)`
                );
                delete properties.Code;
              }
              // Ensure ImageUri is set (should already be set by convertToContainerImage)
              if (!properties.ImageUri) {
                console.warn(
                  `[container-images] WARNING: ${resourceId} has PackageType=Image but no ImageUri!`
                );
              }
            }
            
            // For AWS::Lambda::Function (transformed by SAM), ensure Code only has ImageUri (no S3 references)
            if (resource.Type === "AWS::Lambda::Function" && properties.Code) {
              // Check if Code has S3Bucket, S3Key, or ZipFile (should not be present for container images)
              if (properties.Code.S3Bucket || properties.Code.S3Key || properties.Code.ZipFile) {
                console.log(
                  `[container-images] Removing S3/ZIP Code properties from ${resourceId} (post-processing)`
                );
                // Keep only ImageUri if it exists, otherwise remove Code entirely
                if (properties.Code.ImageUri) {
                  properties.Code = {
                    ImageUri: properties.Code.ImageUri,
                  };
                  console.log(
                    `[container-images] Set Code.ImageUri for ${resourceId} (post-processing)`
                  );
                } else {
                  console.warn(
                    `[container-images] WARNING: ${resourceId} has PackageType=Image but no ImageUri in Code!`
                  );
                }
              } else if (!properties.Code.ImageUri) {
                // Code exists but has no ImageUri - this shouldn't happen for container images
                console.warn(
                  `[container-images] WARNING: ${resourceId} has PackageType=Image and Code property but no ImageUri!`
                );
              }
            } else if (resource.Type === "AWS::Lambda::Function" && !properties.Code) {
              // Code is missing but PackageType is Image - this is a problem
              console.warn(
                `[container-images] WARNING: ${resourceId} has PackageType=Image but no Code property!`
              );
            }
          }
        }
      }
      return cloudformation;
    },
  },
  package: configureContainerImages,
};

// Export for testing
module.exports.configureContainerImages = configureContainerImages;
module.exports.routeToFunctionId = routeToFunctionId;
module.exports.routeToHandlerPath = routeToHandlerPath;
module.exports.queueToFunctionId = queueToFunctionId;
module.exports.scheduledToFunctionId = scheduledToFunctionId;
module.exports.queueToHandlerPath = queueToHandlerPath;
module.exports.scheduledToHandlerPath = scheduledToHandlerPath;
module.exports.parseContainerImagesPragma = parseContainerImagesPragma;
module.exports.getEcrImageUri = getEcrImageUri;
module.exports.ensureEcrRepository = ensureEcrRepository;
module.exports.convertToContainerImage = convertToContainerImage;




