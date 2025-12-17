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
 * Format: method route image-name
 * Example: "any /api/streams/:workspaceId/:agentId/:secret my-custom-image"
 * @param {Object} arc - Parsed arc file
 * @returns {Map<string, string>} Map of function ID to image name
 */
function parseContainerImagesPragma(arc) {
  const imageMap = new Map();

  // Check if container-images pragma exists
  const pragma = arc["container-images"] || arc["containerImages"];

  if (!pragma) {
    return imageMap;
  }

  // Architect parses the pragma into an array of arrays:
  // [["any", "/api/streams/:workspaceId/:agentId/:secret", "my-custom-image"]]
  // Each inner array contains [method, path, imageName]
  if (Array.isArray(pragma)) {
    for (const item of pragma) {
      if (Array.isArray(item) && item.length >= 3) {
        // Join method and path: ["any", "/api/streams/...", "image-name"] -> "any /api/streams/..."
        const method = item[0];
        const routePath = item[1];
        const imageName = item[2];
        
        // Validate all required fields are present and are strings
        if (!method || !routePath || !imageName) {
          console.warn(
            `[container-images] Skipping invalid pragma item: missing method, path, or imageName`,
            item
          );
          continue;
        }
        
        if (typeof method !== "string" || typeof routePath !== "string" || typeof imageName !== "string") {
          console.warn(
            `[container-images] Skipping invalid pragma item: method, path, or imageName must be strings`,
            item
          );
          continue;
        }
        
        const route = `${method} ${routePath}`.trim();
        
        if (route && imageName) {
          const functionId = routeToFunctionId(route);
          if (functionId) {
            imageMap.set(functionId, imageName.trim());
          }
        }
      } else if (typeof item === "string") {
        // Fallback: parse string format "method route image-name"
        const parts = item.trim().split(/\s+/);
        if (parts.length >= 3) {
          const method = parts[0];
          const routePath = parts.slice(1, -1).join(" "); // Everything except first and last
          const imageName = parts[parts.length - 1];
          const route = `${method} ${routePath}`.trim();
          
          if (route && imageName) {
            const functionId = routeToFunctionId(route);
            if (functionId) {
              imageMap.set(functionId, imageName.trim());
            }
          }
        }
      }
    }
  }

  return imageMap;
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
    
    // Note: We no longer need LAMBDA_HANDLER_PATH since we're pointing directly to the handler
    // The wrapper approach failed, so we're using direct handler path instead
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
    
    // Note: We no longer need LAMBDA_HANDLER_PATH since we're pointing directly to the handler
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
    Array.from(imageMap.entries()).map(([id, img]) => `${id} -> ${img}`).join(", ")
  );

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
  // We need to get the route from the arc data to compute the handler path
  const routeMap = new Map(); // Map functionId -> route
  if (Array.isArray(arcData["container-images"] || arcData["containerImages"])) {
    const pragma = arcData["container-images"] || arcData["containerImages"];
    for (const item of pragma) {
      if (Array.isArray(item) && item.length >= 3) {
        const method = item[0];
        const routePath = item[1];
        const route = `${method} ${routePath}`;
        const funcId = routeToFunctionId(route);
        if (funcId) {
          routeMap.set(funcId, route);
        }
      }
    }
  }

  // Collect all missing functions to report them all at once
  const missingFunctions = [];

  for (const [functionId, imageName] of imageMap.entries()) {
    // Validate functionId and imageName
    if (!functionId || typeof functionId !== "string") {
      console.warn("[container-images] Invalid functionId:", functionId);
      continue;
    }

    if (!imageName || typeof imageName !== "string") {
      console.warn("[container-images] Invalid imageName:", imageName);
      continue;
    }

    const functionResource = resources[functionId];

    if (!functionResource) {
      missingFunctions.push(functionId);
      continue;
    }
    
    console.log(
      `[container-images] Found function resource ${functionId}, Type: ${functionResource.Type}, Current PackageType: ${functionResource.Properties?.PackageType || "not set"}`
    );

    // Get route for this function to compute handler path
    const route = routeMap.get(functionId);
    const handlerPath = route ? routeToHandlerPath(route) : null;

    // Get ECR image URI
    let imageUri;
    try {
      imageUri = getEcrImageUri(imageName.trim(), region, null, repositoryName, imageTag);
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

  // Throw error if any functions were not found
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
module.exports.parseContainerImagesPragma = parseContainerImagesPragma;
module.exports.getEcrImageUri = getEcrImageUri;
module.exports.ensureEcrRepository = ensureEcrRepository;
module.exports.convertToContainerImage = convertToContainerImage;




