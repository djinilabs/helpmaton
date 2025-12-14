/**
 * Method creation utilities
 */

const {
  parseRouteKey,
  generateMethodId,
  getAllHttpMethods,
  convertPathParameters,
  convertWildcardPath,
  hasWildcard,
} = require('./utils');
const { findResourceForPath } = require('./resources');

/**
 * Convert OpenAPI URI format to REST API format
 * OpenAPI uses: { "Fn::Sub": "arn:.../${FunctionName.Arn}/..." }
 * REST API needs: { "Fn::Sub": ["arn:.../${Var}/...", { Var: { "Fn::GetAtt": ["FunctionName", "Arn"] } }] }
 * @param {Object|string} uri - URI from OpenAPI integration
 * @returns {Object} Converted URI format for REST API
 */
function convertIntegrationUri(uri) {
  if (!uri) {
    return null;
  }

  // Determine the string to process and existing variables
  let subString = null;
  let existingVariables = {};
  
  if (uri['Fn::Sub'] && Array.isArray(uri['Fn::Sub'])) {
    // Already in array format - check if it needs conversion
    subString = uri['Fn::Sub'][0];
    existingVariables = uri['Fn::Sub'][1] || {};
    
    // If the string doesn't contain .Arn patterns, it's already correctly converted
    if (!subString || typeof subString !== 'string' || !subString.includes('.Arn')) {
      return uri;
    }
    // Otherwise, fall through to conversion logic
  } else if (uri['Fn::Sub'] && typeof uri['Fn::Sub'] === 'string') {
    // String format - needs conversion
    subString = uri['Fn::Sub'];
  }
  
  if (uri['Fn::Join']) {
    return uri;
  }

  // If we have a string to process (either from array or string format), convert it
  if (subString) {
    // Extract function name from ${FunctionName.Arn} pattern
    const arnPattern = /\$\{([A-Za-z0-9_]+)\.Arn\}/g;
    const matches = [...subString.matchAll(arnPattern)];
    
    if (matches.length > 0) {
      // Build variable map, starting with existing variables
      const variables = { ...existingVariables };
      let convertedString = subString;
      
      for (const match of matches) {
        const functionName = match[1];
        // Use function name as variable name to avoid conflicts if multiple functions are referenced
        const variableName = `${functionName}Arn`;
        if (!variables[variableName]) {
          variables[variableName] = { 'Fn::GetAtt': [functionName, 'Arn'] };
        }
        // Replace ALL occurrences of ${FunctionName.Arn} with ${VariableName}
        convertedString = convertedString.replaceAll(match[0], `\${${variableName}}`);
      }
      
      return {
        'Fn::Sub': [convertedString, variables],
      };
    }
    
    // If no matches but we had a string, return as-is (might be using AWS::Region or other built-ins)
    if (uri['Fn::Sub'] && Array.isArray(uri['Fn::Sub'])) {
      // Preserve array format if it was already in that format
      return uri;
    }
    return uri;
  }

  // If it's a plain string, wrap it (shouldn't happen but handle it)
  if (typeof uri === 'string') {
    return uri;
  }

  // Return as-is for other formats
  return uri;
}

/**
 * Create API Gateway Method resources
 * @param {Array} routes - Route definitions from HTTP v2
 * @param {Object} integrations - Integration definitions from HTTP v2
 * @param {Object} pathToResourceId - Path to resource ID mapping
 * @param {Object} resources - Resources object (for dependencies)
 * @param {string} restApiId - REST API resource ID (default: 'HTTP')
 * @returns {Object} Object containing methods and method dependencies
 */
function createMethods(routes, integrations, pathToResourceId, resources, restApiId = 'HTTP') {
  const methods = {};
  const methodDependencies = [];

  for (const route of routes) {
    const routeKey = route.Properties?.RouteKey || route.RouteKey;
    if (!routeKey) continue;

    const { method, path } = parseRouteKey(routeKey);
    
    // Get integration - either embedded in route (from OpenAPI) or separate resource
    let integrationUri = null;
    
    if (route._integration) {
      // Integration embedded in route (from OpenAPI spec)
      // Check integration type - only convert Lambda ARNs, not HTTP proxy URIs
      const integrationType = route._integration.type || route._integration.integrationType || 'aws_proxy';
      const isLambdaIntegration = integrationType === 'aws_proxy' || integrationType === 'AWS_PROXY';
      
      const originalUri = route._integration.uri;
      
      // Only convert Lambda ARN URIs, not HTTP proxy URIs
      if (isLambdaIntegration) {
        integrationUri = convertIntegrationUri(originalUri);
        
        // Debug: Log if conversion changed the URI
        if (originalUri && originalUri['Fn::Sub'] && typeof originalUri['Fn::Sub'] === 'string') {
          if (integrationUri && integrationUri['Fn::Sub'] && Array.isArray(integrationUri['Fn::Sub'])) {
            console.log(`[http-to-rest] Converted URI for route ${routeKey} from string to array format`);
          } else {
            console.warn(`[http-to-rest] WARNING: URI conversion may have failed for route ${routeKey}. Original:`, JSON.stringify(originalUri).substring(0, 100));
          }
        }
      } else {
        // For HTTP/HTTP_PROXY integrations, use URI as-is (no ARN conversion needed)
        integrationUri = originalUri;
      }
      
      // Store integration type for later use
      route._integrationType = isLambdaIntegration ? 'AWS_PROXY' : (integrationType.toUpperCase() || 'HTTP_PROXY');
    } else {
      // Find integration for this route (from separate Integration resources)
      // Target can be a Ref or a string like "integrations/IntegrationId"
      let integrationId = null;
      if (route.Properties?.Target) {
        if (typeof route.Properties.Target === 'string') {
          integrationId = route.Properties.Target.split('/').pop();
        } else if (route.Properties.Target.Ref) {
          integrationId = route.Properties.Target.Ref;
        }
      } else if (route.Target) {
        if (typeof route.Target === 'string') {
          integrationId = route.Target.split('/').pop();
        } else if (route.Target.Ref) {
          integrationId = route.Target.Ref;
        }
      }
      
      const integration = integrationId ? integrations[integrationId] : null;
      
      if (!integration) {
        console.warn(`No integration found for route ${routeKey}`);
        continue;
      }

      // Get integration URI (Lambda function ARN)
      const rawIntegrationUri = integration.Properties?.IntegrationUri || 
                               integration.IntegrationUri;
      
      // Convert OpenAPI URI format to REST API format (in case it's in string Fn::Sub format)
      integrationUri = convertIntegrationUri(rawIntegrationUri);
      
      // Debug: Log if conversion changed the URI
      if (rawIntegrationUri && rawIntegrationUri['Fn::Sub'] && typeof rawIntegrationUri['Fn::Sub'] === 'string') {
        if (integrationUri && integrationUri['Fn::Sub'] && Array.isArray(integrationUri['Fn::Sub'])) {
          console.log(`[http-to-rest] Converted Integration URI for route ${routeKey} from string to array format`);
        } else {
          console.warn(`[http-to-rest] WARNING: Integration URI conversion may have failed for route ${routeKey}. Original:`, JSON.stringify(rawIntegrationUri).substring(0, 100));
        }
      }
    }
    
    if (!integrationUri) {
      console.warn(`No integration URI found for route ${routeKey}`);
      continue;
    }

    // Normalize path
    let normalizedPath = convertPathParameters(path);
    const originalPath = path;
    
    // Check if this is a catch-all route
    // Architect may represent it as /*, *, or /{proxy+} in the OpenAPI spec
    const isCatchAllWildcard = hasWildcard(normalizedPath) && (normalizedPath === '/*' || normalizedPath === '*');
    const isCatchAllProxy = normalizedPath === '/{proxy+}' || normalizedPath === '{proxy+}';
    const isCatchAll = isCatchAllWildcard || isCatchAllProxy;
    
    if (hasWildcard(normalizedPath)) {
      normalizedPath = convertWildcardPath(normalizedPath);
    }
    // For resource lookup, we need to ensure the path has a leading slash
    // findResourceForPath expects paths with leading slashes (e.g., /api/workspaces/{proxy+})
    // But for root catch-all {proxy+}, we need to handle it specially
    let lookupPath = normalizedPath;
    if (normalizedPath === '{proxy+}') {
      // Root catch-all - use /{proxy+} for lookup
      lookupPath = '/{proxy+}';
    } else if (!normalizedPath.startsWith('/')) {
      // Ensure leading slash for non-root paths
      lookupPath = '/' + normalizedPath;
    }

    // Find resource for this path
    const resourceId = findResourceForPath(lookupPath, pathToResourceId, resources);
    
    if (!resourceId) {
      console.warn(`[http-to-rest] No resource found for path ${lookupPath} (normalized from ${normalizedPath}, original: ${originalPath})`);
      // Log available paths for debugging
      const availablePaths = Object.keys(pathToResourceId).slice(0, 10);
      console.warn(`[http-to-rest] Available paths (first 10): ${availablePaths.join(', ')}`);
      continue;
    }
    
    // Debug: Log which resource was found for this route
    if (isCatchAll || originalPath.startsWith('/api/')) {
      console.log(`[http-to-rest] Route ${routeKey}: originalPath=${originalPath}, normalizedPath=${normalizedPath}, lookupPath=${lookupPath}, found resourceId=${resourceId}`);
    }

    // Determine which methods to create
    const methodsToCreate = method === 'ANY' ? getAllHttpMethods() : [method];

    // For catch-all routes at root level (ANY /* or ANY /{proxy+}), also create methods on root resource
    // This ensures that requests to / are handled (in REST API, / and /{proxy+} are separate resources)
    // Check if the original path was /*, *, or /{proxy+} (root-level catch-all)
    // Also check if the resource is at root level (parent is root resource)
    const resource = resources[resourceId];
    const isRootLevelProxy = resource && resource.Properties && 
      (JSON.stringify(resource.Properties.ParentId) === JSON.stringify({ 'Fn::GetAtt': [restApiId, 'RootResourceId'] }) ||
       (typeof resource.Properties.ParentId === 'object' && resource.Properties.ParentId['Fn::GetAtt'] && 
        resource.Properties.ParentId['Fn::GetAtt'][0] === restApiId && 
        resource.Properties.ParentId['Fn::GetAtt'][1] === 'RootResourceId'));
    
    // Check if this is a root-level catch-all route
    // Architect represents catch-all as /{proxy+} in OpenAPI, so we need to check both the path and the resource parent
    const isRootLevelCatchAll = isCatchAll && (
      originalPath === '/*' || 
      originalPath === '*' || 
      originalPath === '/{proxy+}' ||
      originalPath === '{proxy+}' ||
      isRootLevelProxy
    );
    
    // Debug: Log resource matching for catch-all routes to help diagnose routing issues
    // (after isRootLevelCatchAll is defined)
    if (isCatchAll) {
      console.log(`[http-to-rest] Route ${routeKey}: normalizedPath=${normalizedPath}, found resourceId=${resourceId}`);
      // Check if this is the root catch-all being matched for an API path
      if (isRootLevelCatchAll && normalizedPath.startsWith('/api/')) {
        console.warn(`[http-to-rest] WARNING: Root catch-all route ${routeKey} is being processed, but this might conflict with more specific /api/* routes`);
      }
    }
    
    const shouldAlsoCreateOnRoot = isRootLevelCatchAll;
    
    // Debug logging for catch-all routes
    if (isCatchAll) {
      console.log(`[http-to-rest] Catch-all route detected: routeKey=${routeKey}, originalPath=${originalPath}, normalizedPath=${normalizedPath}, resourceId=${resourceId}, isRootLevelProxy=${isRootLevelProxy}, isRootLevelCatchAll=${isRootLevelCatchAll}, shouldAlsoCreateOnRoot=${shouldAlsoCreateOnRoot}`);
    }

    // Create method for each HTTP method
    for (const httpMethod of methodsToCreate) {
      const methodId = generateMethodId(resourceId, httpMethod);
      
      // Check if a method already exists for this ResourceId + HttpMethod combination
      // CloudFormation doesn't allow duplicate methods (same RestApiId + ResourceId + HttpMethod)
      const resourceRef = resourceId === 'HTTPRootResource'
        ? { 'Fn::GetAtt': [restApiId, 'RootResourceId'] }
        : { Ref: resourceId };
      
      // Check if a method with the same ResourceId and HttpMethod already exists
      const existingMethod = Object.entries(methods).find(([_, method]) => {
        const methodProps = method.Properties || {};
        const methodResourceId = methodProps.ResourceId;
        const methodHttpMethod = methodProps.HttpMethod;
        return JSON.stringify(methodResourceId) === JSON.stringify(resourceRef) &&
               methodHttpMethod === httpMethod;
      });
      
      if (existingMethod) {
        // Method already exists for this ResourceId + HttpMethod combination
        // Skip creating a duplicate - CloudFormation doesn't allow it
        console.log(`[http-to-rest] Skipping duplicate method: ${httpMethod} on ${resourceId} (already exists as ${existingMethod[0]})`);
        continue;
      }
      
      // Ensure unique method ID (for logical ID uniqueness in CloudFormation template)
      let uniqueMethodId = methodId;
      let counter = 1;
      while (methods[uniqueMethodId]) {
        uniqueMethodId = `${methodId}${counter}`;
        counter++;
      }

      // Get authorizer if route has one
      const authorizerId = route.Properties?.AuthorizerId || route.AuthorizerId;
      // Initial authorizationType is set to CUSTOM for all authorizers;
      // IAM authorizers are detected and corrected to AWS_IAM in the transform.js authorizer reference update step (lines 82-96).
      let authorizationType = 'NONE';
      if (authorizerId) {
        authorizationType = 'CUSTOM';
      }

      // Determine integration type from route metadata or default to AWS_PROXY
      const integrationType = route._integrationType || 'AWS_PROXY';
      
      // Create method resource
      const integrationConfig = {
        Type: integrationType,
        Uri: integrationUri,
      };
      
      // AWS_PROXY integrations use POST method and don't support other properties
      if (integrationType === 'AWS_PROXY') {
        integrationConfig.IntegrationHttpMethod = 'POST';
        // Note: AWS_PROXY integrations don't support RequestTemplates or IntegrationResponses
        // These are only for HTTP and MOCK integrations
      } else if (integrationType === 'HTTP_PROXY' || integrationType === 'HTTP') {
        // HTTP_PROXY integrations use the same HTTP method as the request
        integrationConfig.IntegrationHttpMethod = httpMethod;
      }
      
      methods[uniqueMethodId] = {
        Type: 'AWS::ApiGateway::Method',
        Properties: {
          RestApiId: { Ref: restApiId },
          ResourceId: resourceRef,
          HttpMethod: httpMethod,
          AuthorizationType: authorizationType,
          AuthorizerId: authorizerId ? { Ref: authorizerId } : undefined,
          Integration: integrationConfig,
        },
        DependsOn: resourceId === 'HTTPRootResource' ? [] : [resourceId],
      };

      // Remove undefined properties
      if (!methods[uniqueMethodId].Properties.AuthorizerId) {
        delete methods[uniqueMethodId].Properties.AuthorizerId;
      }

      methodDependencies.push(uniqueMethodId);
    }

    // If this is a catch-all route at root level, also create methods on root resource
    if (shouldAlsoCreateOnRoot) {
      console.log(`[http-to-rest] Catch-all route ${routeKey} detected - also creating methods on root resource for /`);
      
      for (const httpMethod of methodsToCreate) {
        const rootMethodId = generateMethodId('HTTPRootResource', httpMethod);
        
        // Check if a method already exists for root ResourceId + HttpMethod combination
        const rootResourceRef = { 'Fn::GetAtt': [restApiId, 'RootResourceId'] };
        const existingRootMethod = Object.entries(methods).find(([_, method]) => {
          const methodProps = method.Properties || {};
          const methodResourceId = methodProps.ResourceId;
          const methodHttpMethod = methodProps.HttpMethod;
          return JSON.stringify(methodResourceId) === JSON.stringify(rootResourceRef) &&
                 methodHttpMethod === httpMethod;
        });
        
        if (existingRootMethod) {
          // Method already exists for root ResourceId + HttpMethod combination
          console.log(`[http-to-rest] Skipping duplicate root method: ${httpMethod} (already exists as ${existingRootMethod[0]})`);
          continue;
        }
        
        // Ensure unique method ID (for logical ID uniqueness in CloudFormation template)
        let uniqueRootMethodId = rootMethodId;
        let counter = 1;
        while (methods[uniqueRootMethodId]) {
          uniqueRootMethodId = `${rootMethodId}${counter}`;
          counter++;
        }

        // Get authorizer if route has one
        const authorizerId = route.Properties?.AuthorizerId || route.AuthorizerId;
        let authorizationType = 'NONE';
        if (authorizerId) {
          authorizationType = 'CUSTOM';
        }

        // Determine integration type from route metadata or default to AWS_PROXY
        const integrationType = route._integrationType || 'AWS_PROXY';
        
        // Create method resource for root
        const integrationConfig = {
          Type: integrationType,
          Uri: integrationUri,
        };
        
        // AWS_PROXY integrations use POST method and don't support other properties
        if (integrationType === 'AWS_PROXY') {
          integrationConfig.IntegrationHttpMethod = 'POST';
        } else if (integrationType === 'HTTP_PROXY' || integrationType === 'HTTP') {
          // HTTP_PROXY integrations use the same HTTP method as the request
          integrationConfig.IntegrationHttpMethod = httpMethod;
        }
        
        methods[uniqueRootMethodId] = {
          Type: 'AWS::ApiGateway::Method',
          Properties: {
            RestApiId: { Ref: restApiId },
            ResourceId: rootResourceRef,
            HttpMethod: httpMethod,
            AuthorizationType: authorizationType,
            AuthorizerId: authorizerId ? { Ref: authorizerId } : undefined,
            Integration: integrationConfig,
          },
          DependsOn: [],
        };

        // Remove undefined properties
        if (!methods[uniqueRootMethodId].Properties.AuthorizerId) {
          delete methods[uniqueRootMethodId].Properties.AuthorizerId;
        }

        methodDependencies.push(uniqueRootMethodId);
      }
    }
  }

  return {
    methods,
    methodDependencies,
  };
}

module.exports = {
  createMethods,
  convertIntegrationUri,
};

