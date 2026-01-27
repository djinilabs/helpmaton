/**
 * Configure API Gateway methods to use the authorizer
 * @param {Object} cloudformation - CloudFormation template
 * @param {string} authorizerId - Authorizer resource ID
 * @returns {Object} Updated CloudFormation template
 */
function configureMethodAuthorizers(cloudformation, authorizerId) {
  const resources = cloudformation.Resources || {};
  const methods = {};

  // Find all API Gateway Method resources
  for (const [resourceId, resource] of Object.entries(resources)) {
    if (resource.Type === "AWS::ApiGateway::Method") {
      const path = resource.Properties?.ResourceId
        ? getPathFromResourceId(resources, resource.Properties.ResourceId)
        : null;

      // Skip auth routes, authorizer route, webhook route, scrape route, user routes, and OAuth callbacks
      // Webhook route has its own authentication (webhook key validation)
      // Scrape route has its own authentication (JWT token validation)
      // User routes handle their own authentication (cookie-based for migration, refresh tokens, etc.)
      if (
        path &&
        (path.startsWith("/api/auth") ||
          path.startsWith("/api/authorizer") ||
          path.startsWith("/api/email/oauth") ||
          path.startsWith("/api/mcp/oauth") ||
          path.startsWith("/api/webhook") ||
          path.startsWith("/api/scrape") ||
          path.startsWith("/api/user") ||
          path.startsWith("/api/streams"))
      ) {
        console.log(`Skipping ${path} because it's a user route`);
        continue;
      }

      // Only configure /api/* routes
      if (path && path.startsWith("/api")) {
        // Clone the method resource
        // Don't add explicit DependsOn - CloudFormation will handle implicit dependency via Ref
        // Adding explicit DependsOn creates circular dependencies with the deployment
        methods[resourceId] = {
          ...resource,
          Properties: {
            ...resource.Properties,
            AuthorizationType: "CUSTOM",
            AuthorizerId: { Ref: authorizerId },
            // For REQUEST authorizers with IdentitySource including headers,
            // REST API may require those headers to be configured as request parameters
            // Configure Authorization header as a request parameter so it's available to the authorizer
            // Note: Header names must be lowercase in request parameters
            RequestParameters: {
              ...(resource.Properties?.RequestParameters || {}),
              "method.request.header.authorization": false, // false means optional, true means required
            },
            // Do NOT set ApiKeyRequired: true
            // When using usage plans with authorizers, the authorizer returns usageIdentifierKey
            // Setting ApiKeyRequired would force clients to send x-api-key header, which defeats the purpose
            // API Gateway will use the usageIdentifierKey from the authorizer response for throttling
          },
          // Preserve existing DependsOn (e.g., on Resource), but don't add authorizer
          DependsOn: resource.DependsOn || undefined,
        };
      }
    }
  }

  // Update the resources
  for (const [methodId, method] of Object.entries(methods)) {
    resources[methodId] = method;
  }

  return cloudformation;
}

/**
 * Get path from resource ID by traversing the resource hierarchy
 * This is a simplified version - in practice, we might need to traverse the tree
 * @param {Object} resources - All CloudFormation resources
 * @param {string|Object} resourceId - Resource ID (can be Ref or string)
 * @returns {string|null} Path or null if not found
 */
function getPathFromResourceId(resources, resourceId) {
  // If resourceId is a Ref, get the actual ID
  let actualResourceId = resourceId;
  if (resourceId && typeof resourceId === "object" && resourceId.Ref) {
    actualResourceId = resourceId.Ref;
  }

  if (typeof actualResourceId !== "string") {
    return null;
  }

  const resource = resources[actualResourceId];
  if (!resource || resource.Type !== "AWS::ApiGateway::Resource") {
    return null;
  }

  // Try to extract path from resource properties
  const pathPart = resource.Properties?.PathPart;
  if (!pathPart) {
    return null;
  }

  // Build full path by traversing parent
  let fullPath = pathPart;
  let parentId = resource.Properties?.ParentId;

  while (parentId) {
    let actualParentId = parentId;
    if (typeof parentId === "object" && parentId.Ref) {
      actualParentId = parentId.Ref;
    }

    const parentResource = resources[actualParentId];
    if (!parentResource || parentResource.Type !== "AWS::ApiGateway::Resource") {
      break;
    }

    const parentPathPart = parentResource.Properties?.PathPart;
    if (parentPathPart) {
      fullPath = parentPathPart + "/" + fullPath;
    }

    parentId = parentResource.Properties?.ParentId;
    if (!parentId || parentId === actualParentId) {
      break;
    }
  }

  return fullPath.startsWith("/") ? fullPath : "/" + fullPath;
}

module.exports = {
  configureMethodAuthorizers,
};

