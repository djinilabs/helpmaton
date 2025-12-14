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
    if (segment.startsWith(":")) {
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
        const path = item[1];
        const imageName = item[2];
        const route = `${method} ${path}`.trim();
        
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
          const path = parts.slice(1, -1).join(" "); // Everything except first and last
          const imageName = parts[parts.length - 1];
          const route = `${method} ${path}`.trim();
          
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
 * Converts a Lambda function to use container images
 * @param {Object} functionResource - Lambda function CloudFormation resource
 * @param {string} imageUri - ECR image URI (string or CloudFormation reference)
 * @param {string} functionId - Lambda function logical ID
 */
function convertToContainerImage(functionResource, imageUri, functionId) {
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

  const properties = functionResource.Properties || {};

  // Set PackageType to Image
  properties.PackageType = "Image";

  // Set ImageUri
  // For AWS::Serverless::Function (SAM), we use ImageUri directly in Properties
  // For AWS::Lambda::Function, we use Code with ImageUri
  if (functionResource.Type === "AWS::Serverless::Function") {
    // SAM functions use ImageUri directly in Properties for container images
    properties.ImageUri = imageUri;
    // Remove CodeUri (used for ZIP packages)
    delete properties.CodeUri;
    delete properties.Code;
  } else {
    // Standard Lambda functions use Code with ImageUri
    properties.Code = {
      ImageUri: imageUri,
    };
  }

  // Remove Runtime (not used for container images)
  // Note: We keep it as null or remove it, but AWS requires it to be omitted
  delete properties.Runtime;

  // Ensure Handler is not set (container images use CMD in Dockerfile)
  delete properties.Handler;

  console.log(
    `[container-images] Converted Lambda function ${functionId} to use container image: ${typeof imageUri === "string" ? imageUri : "CloudFormation reference"}`
  );
}

/**
 * Main plugin function that converts Lambda functions to container images
 */
async function configureContainerImages({ cloudformation, inventory, arc, stage }) {
  const resources = cloudformation.Resources || {};
  const outputs = cloudformation.Outputs || {};

  // Get stage from parameter or environment variable
  const deploymentStage = stage || process.env.ARC_ENV || process.env.ARC_STAGE || "staging";

  // Parse @container-images pragma
  // Try multiple sources for the arc data (same pattern as other plugins)
  const arcData = arc || inventory?.arc || inventory?.app?.arc || {};

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
    process.env.LAMBDA_IMAGES_ECR_REPOSITORY || "helpmaton-lambda-images";

  // Get image tag from environment (commit SHA) or use "latest"
  // This should be set in the deployment workflow
  const imageTag = process.env.LAMBDA_IMAGE_TAG || process.env.GITHUB_SHA || "latest";

  // Get AWS region
  const region = process.env.AWS_REGION || "eu-west-2";

  // Note: ECR repository is created by build-and-push-lambda-images.sh script
  // We don't create it in CloudFormation to avoid conflicts

  // Process each function that needs container images
  for (const [functionId, imageName] of imageMap.entries()) {
    const functionResource = resources[functionId];

    if (!functionResource) {
      console.warn(
        `[container-images] Lambda function ${functionId} not found in CloudFormation resources. Available function IDs:`,
        Object.keys(resources)
          .filter((id) => {
            const type = resources[id]?.Type;
            return type === "AWS::Lambda::Function" || type === "AWS::Serverless::Function";
          })
          .slice(0, 10)
      );
      continue;
    }

    // Get ECR image URI
    const imageUri = getEcrImageUri(imageName, region, null, repositoryName, imageTag);

    // Convert function to use container image
    convertToContainerImage(functionResource, imageUri, functionId);
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
}

module.exports = {
  deploy: {
    start: configureContainerImages,
  },
  package: configureContainerImages,
};

// Export for testing
module.exports.configureContainerImages = configureContainerImages;
module.exports.routeToFunctionId = routeToFunctionId;
module.exports.parseContainerImagesPragma = parseContainerImagesPragma;
module.exports.getEcrImageUri = getEcrImageUri;
module.exports.ensureEcrRepository = ensureEcrRepository;
module.exports.convertToContainerImage = convertToContainerImage;



