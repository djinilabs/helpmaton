/**
 * Core transformation logic
 */

const { createResourceHierarchy, printResourceTree } = require('./resources');
const { createMethods } = require('./methods');
const { transformDomain } = require('./domain');
const { transformAuthorizers } = require('./authorizers');
const { isIamAuthorizer, sanitizeResourceName } = require('./utils');

/**
 * Main transformation function
 * @param {Object} cloudformation - CloudFormation template
 * @param {Object} inventory - Architect inventory
 * @param {string} stage - Stage name
 * @returns {Object} Transformed CloudFormation template
 */
/**
 * Update all references from oldId to newId in a CloudFormation template
 * @param {Object} cloudformation - CloudFormation template
 * @param {string} oldId - Old resource ID
 * @param {string} newId - New resource ID
 */
function updateResourceReferences(cloudformation, oldId, newId) {
  const resources = cloudformation.Resources || {};
  const outputs = cloudformation.Outputs || {};

  // Helper to recursively update references in an object
  function updateRefs(obj) {
    if (obj === null || obj === undefined) {
      return;
    }
    
    if (Array.isArray(obj)) {
      obj.forEach(item => updateRefs(item));
      return;
    }
    
    if (typeof obj !== 'object') {
      return;
    }

    // Check for Ref
    if (obj.Ref === oldId) {
      obj.Ref = newId;
    }
    
    // Check for Fn::GetAtt
    if (obj['Fn::GetAtt'] && Array.isArray(obj['Fn::GetAtt']) && obj['Fn::GetAtt'][0] === oldId) {
      obj['Fn::GetAtt'][0] = newId;
    }

    // Recursively process all properties
    Object.values(obj).forEach(value => updateRefs(value));
  }

  // Update all resources
  Object.values(resources).forEach(resource => {
    // Skip undefined or null resources (can happen if resources were deleted)
    if (!resource || typeof resource !== 'object') {
      return;
    }
    if (resource.Properties) {
      updateRefs(resource.Properties);
    }
    if (resource.DependsOn) {
      if (Array.isArray(resource.DependsOn)) {
        resource.DependsOn = resource.DependsOn.map(dep => dep === oldId ? newId : dep);
      } else if (resource.DependsOn === oldId) {
        resource.DependsOn = newId;
      }
    }
  });

  // Update outputs
  Object.values(outputs).forEach(output => {
    // Skip undefined or null outputs
    if (!output || typeof output !== 'object') {
      return;
    }
    if (output.Value) {
      updateRefs(output.Value);
    }
  });
}

function transformToRestApi(cloudformation, inventory, stage) {
  const resources = cloudformation.Resources || {};
  const outputs = cloudformation.Outputs || {};

  // 1. Detect migration phase
  // Phase 1: HTTP exists as HTTP API v2, HTTPRestApi doesn't exist → Create HTTPRestApi
  // Phase 2: HTTPRestApi exists as REST API → Remove old HTTP, rename HTTPRestApi to HTTP
  const httpApi = resources.HTTP;
  const httpRestApi = resources.HTTPRestApi;
  const isServerlessHttpApi = httpApi && httpApi.Type === 'AWS::Serverless::HttpApi';
  const isApiGatewayV2Api = httpApi && httpApi.Type === 'AWS::ApiGatewayV2::Api';
  const isAlreadyRestApi = httpApi && httpApi.Type === 'AWS::ApiGateway::RestApi';
  
  // Check for explicit Phase 2 environment variable
  const explicitPhase2 = process.env.HTTP_TO_REST_MIGRATION_PHASE === '2';
  
  // Phase 2 detection: Either HTTPRestApi exists in template OR explicitly set via env var
  // Note: HTTPRestApi might exist in deployed stack but not in incoming template (Architect generates fresh template)
  // So we also check the explicit environment variable
  const isPhase2 = explicitPhase2 || (httpRestApi && httpRestApi.Type === 'AWS::ApiGateway::RestApi');
  
  // Phase 2: Migration complete - remove old HTTP API v2 and update all references to HTTPRestApi
  // Instead of renaming HTTPRestApi to HTTP (which would change HTTP's type), we:
  // 1. Extract domain information BEFORE deleting HTTP (so we can transform it)
  // 2. Delete the old HTTP resource (HTTP API v2) and all its routes/integrations
  // 3. Transform and add domain resources for HTTPRestApi
  // 4. Keep HTTPRestApi as the REST API (don't rename it)
  // 5. Update all references from HTTP to HTTPRestApi in outputs and other places
  // BUT: If HTTPRestApi doesn't exist, we need to create it first (Phase 1), then run Phase 2
  // So we'll skip Phase 2 logic here if HTTPRestApi doesn't exist, and handle it after Phase 1
  if (isPhase2 && httpRestApi) {
    console.log('[http-to-rest] Phase 2 migration detected: HTTPRestApi exists, completing migration...');
    
    // Extract domain information BEFORE deleting HTTP resource
    const httpDomain = httpApi?.Properties?.Domain;
    const httpStagesForDomain = [];
    if (isServerlessHttpApi) {
      const definitionBody = httpApi.Properties?.DefinitionBody;
      if (definitionBody && typeof definitionBody === 'object') {
        const stageName = httpApi.Properties?.StageName || stage || 'staging';
        httpStagesForDomain.push({
          Properties: {
            StageName: stageName,
          },
        });
      }
    } else {
      // Collect HTTP API v2 stages before we delete them
      for (const resource of Object.values(resources)) {
        if (resource && resource.Type === 'AWS::ApiGatewayV2::Stage') {
          httpStagesForDomain.push(resource);
        }
      }
    }
    
    // Remove old HTTP resource if it's still HTTP API v2
    if (httpApi && (isServerlessHttpApi || isApiGatewayV2Api)) {
      console.log('[http-to-rest] Removing old HTTP API v2 resource');
      delete resources.HTTP;
      
      // Also remove old HTTP API v2 related resources
      // This includes routes, integrations, stages, authorizers, and domain resources
      const resourcesToRemove = [];
      for (const [resourceId, resource] of Object.entries(resources)) {
        // Skip undefined resources
        if (!resource || typeof resource !== 'object') {
          continue;
        }
        if (resource.Type === 'AWS::ApiGatewayV2::Route' ||
            resource.Type === 'AWS::ApiGatewayV2::Integration' ||
            resource.Type === 'AWS::ApiGatewayV2::Stage' ||
            resource.Type === 'AWS::ApiGatewayV2::Authorizer') {
          resourcesToRemove.push(resourceId);
          console.log(`[http-to-rest] Marking HTTP API v2 resource for deletion: ${resourceId} (${resource.Type})`);
        }
        // NOTE: We DON'T delete AWS::ApiGatewayV2::DomainName and AWS::ApiGatewayV2::ApiMapping here.
        // We keep them in the template so CloudFormation can delete them first, then the custom-domain
        // plugin can create the new REST API domain in the same deployment. CloudFormation processes
        // deletions before creations, so this avoids the need for a 3-step deployment.
      }
      if (resourcesToRemove.length > 0) {
        console.log(`[http-to-rest] Removing ${resourcesToRemove.length} HTTP API v2 resources: ${resourcesToRemove.join(', ')}`);
        resourcesToRemove.forEach(id => delete resources[id]);
      }
      
      // Keep HTTP API v2 domain resources in template so CloudFormation deletes them first
      // The custom-domain plugin will create the new REST API domain after deletion
      const v2DomainResources = Object.keys(resources).filter(id => {
        const resource = resources[id];
        return resource && (
          resource.Type === 'AWS::ApiGatewayV2::DomainName' ||
          resource.Type === 'AWS::ApiGatewayV2::ApiMapping'
        );
      });
      if (v2DomainResources.length > 0) {
        console.log(`[http-to-rest] Keeping HTTP API v2 domain resources in template for deletion: ${v2DomainResources.join(', ')}`);
        console.log(`[http-to-rest] Custom-domain plugin will create new REST API domain after these are deleted.`);
      }
    }
    
    // Note: Domain transformation is handled by the custom-domain plugin based on environment variables
    // We don't need to transform domain here during Phase 2 because:
    // 1. The domain comes from environment variables (HELPMATON_CUSTOM_DOMAIN), not from HTTP resource
    // 2. The custom-domain plugin will create domain resources for HTTPRestApi after this plugin runs
    // 3. Creating domain resources here would conflict with custom-domain plugin creating the same resources
    // Only transform domain if it exists in HTTP resource AND custom-domain plugin is not being used
    // (This is a fallback for cases where domain is configured in HTTP resource, not via env vars)
    if (httpDomain && !process.env.HELPMATON_CUSTOM_DOMAIN) {
      console.log('[http-to-rest] Transforming custom domain for HTTPRestApi (no HELPMATON_CUSTOM_DOMAIN env var found)');
      const originalStageName = httpStagesForDomain[0]?.Properties?.StageName || stage || 'staging';
      const stageName = originalStageName.replace(/[^a-zA-Z0-9_]/g, '') || 'staging';
      const domainResources = transformDomain(httpDomain, 'HTTPRestApi', stageName);
      
      if (domainResources.domainName) {
        Object.assign(resources, domainResources.domainName);
      }
      if (domainResources.basePathMapping) {
        Object.assign(resources, domainResources.basePathMapping);
      }
      if (domainResources.recordSet) {
        Object.assign(resources, domainResources.recordSet);
      }
    } else if (httpDomain && process.env.HELPMATON_CUSTOM_DOMAIN) {
      console.log('[http-to-rest] Skipping domain transformation - custom-domain plugin will handle it from environment variables');
    }
    
    // Update all references from HTTP to HTTPRestApi (instead of renaming HTTPRestApi to HTTP)
    // This avoids the CloudFormation error "Update of resource type is not permitted"
    console.log('[http-to-rest] Updating all references from HTTP to HTTPRestApi');
    updateResourceReferences(cloudformation, 'HTTP', 'HTTPRestApi');
    
    console.log('[http-to-rest] Phase 2 migration complete! HTTPRestApi is now the primary API.');
    return cloudformation;
  }
  
  // If Phase 2 is explicitly set but HTTPRestApi doesn't exist, check if migration already complete
  if (explicitPhase2 && !httpRestApi) {
    // Check if HTTP is already a REST API (migration already complete)
    if (isAlreadyRestApi) {
      console.log('[http-to-rest] Phase 2: HTTPRestApi not found in template, but HTTP is already a REST API. Migration already complete, skipping.');
      return cloudformation;
    }
    // If HTTPRestApi doesn't exist and HTTP is still HTTP API v2, we need to create HTTPRestApi first
    // This will be handled by Phase 1 logic below, then Phase 2 will run after Phase 1 completes
    if (httpApi && (isServerlessHttpApi || isApiGatewayV2Api)) {
      console.log('[http-to-rest] Phase 2: HTTPRestApi not found in template, but Phase 2 is explicitly set.');
      console.log('[http-to-rest] HTTPRestApi may have been deleted. Will recreate it and complete migration in one step.');
    } else {
      console.log('[http-to-rest] Phase 2: HTTPRestApi not found in template and HTTP is still HTTP API v2.');
      console.log('[http-to-rest] This means Phase 1 was not completed. HTTPRestApi may have been deleted.');
      console.log('[http-to-rest] Skipping Phase 2 transformation. Please run Phase 1 first (set HTTP_TO_REST_MIGRATION_PHASE=1).');
      return cloudformation;
    }
  }
  
  // If already a REST API (not in migration), skip transformation
  if (isAlreadyRestApi && !isPhase2) {
    console.log('HTTP resource is already a REST API, skipping transformation');
    return cloudformation;
  }
  
  // Phase 1: Check if we need migration (existing stack with HTTP API v2)
  // We can't directly detect if stack exists, but we can check if HTTPRestApi already exists
  // For Phase 1, we'll create HTTPRestApi instead of HTTP
  // Also enable migration if Phase 2 is explicitly set but HTTPRestApi doesn't exist (need to create it first)
  const needsMigration = process.env.HTTP_TO_REST_MIGRATION === 'true' || 
                         process.env.HTTP_TO_REST_MIGRATION_PHASE === '1' ||
                         (explicitPhase2 && !httpRestApi && httpApi && (isServerlessHttpApi || isApiGatewayV2Api));
  
  if (!httpApi || (!isServerlessHttpApi && !isApiGatewayV2Api)) {
    console.log('No HTTP API v2 found, skipping transformation');
    return cloudformation;
  }

  if (needsMigration) {
    console.log('[http-to-rest] Phase 1 migration mode: Creating HTTPRestApi (keeping old HTTP)');
    console.log('[http-to-rest] Phase 1 will also remove domain resources so they can be recreated in Phase 2');
    console.log('[http-to-rest] After this deployment, set HTTP_TO_REST_MIGRATION_PHASE=2 for Phase 2');
    
    // Phase 1: Remove domain resources from template so CloudFormation deletes them
    // This allows Phase 2 to create new REST API domain resources without conflicts
    const domainResourcesToRemove = [];
    for (const [resourceId, resource] of Object.entries(resources)) {
      if (resource && (
        resource.Type === 'AWS::ApiGatewayV2::DomainName' ||
        resource.Type === 'AWS::ApiGatewayV2::ApiMapping' ||
        resource.Type === 'AWS::ApiGateway::DomainName' ||
        resource.Type === 'AWS::ApiGateway::BasePathMapping'
      )) {
        domainResourcesToRemove.push(resourceId);
        console.log(`[http-to-rest] Phase 1: Removing domain resource ${resourceId} (${resource.Type}) for migration`);
      }
    }
    domainResourcesToRemove.forEach(id => delete resources[id]);
    
    // Also remove domain configuration from HTTP resource if it exists
    if (httpApi && httpApi.Properties && httpApi.Properties.Domain) {
      console.log('[http-to-rest] Phase 1: Removing domain configuration from HTTP resource');
      delete httpApi.Properties.Domain;
    }
  } else {
    console.log('Transforming HTTP API v2 to REST API...');
    console.warn('[http-to-rest] WARNING: If deploying to an existing stack, CloudFormation will fail with:');
    console.warn('[http-to-rest] "Update of resource type is not permitted"');
    console.warn('[http-to-rest] Set HTTP_TO_REST_MIGRATION=true to enable 2-phase migration');
    console.warn('[http-to-rest] See MIGRATION.md for details.');
  }

  // Collect HTTP v2 resources
  const httpRoutes = [];
  const httpIntegrations = {};
  const httpStages = [];
  const httpAuthorizers = {};

  if (isServerlessHttpApi) {
    // Parse OpenAPI spec from DefinitionBody
    const definitionBody = httpApi.Properties?.DefinitionBody;
    if (definitionBody && typeof definitionBody === 'object' && definitionBody.paths) {
      const openApiPaths = definitionBody.paths;
      const stageName = httpApi.Properties?.StageName || stage || 'staging';
      
      // Convert OpenAPI paths to route format
      for (const [path, pathItem] of Object.entries(openApiPaths)) {
        // Handle each HTTP method in the path
        for (const [method, operation] of Object.entries(pathItem)) {
          if (method === 'x-amazon-apigateway-any-method') {
            // Handle ANY method
            const integration = operation['x-amazon-apigateway-integration'];
            if (integration) {
              const routeKey = `ANY ${path}`;
              console.log(`[http-to-rest] Parsed route from OpenAPI: ${routeKey}, path=${path}`);
              httpRoutes.push({
                Properties: {
                  RouteKey: routeKey,
                },
                _integration: integration,
              });
            }
          } else if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method.toLowerCase())) {
            // Handle specific HTTP methods
            const integration = operation['x-amazon-apigateway-integration'];
            if (integration) {
              const httpMethod = method.toUpperCase();
              const routeKey = `${httpMethod} ${path}`;
              console.log(`[http-to-rest] Parsed route from OpenAPI: ${routeKey}, path=${path}`);
              httpRoutes.push({
                Properties: {
                  RouteKey: routeKey,
                },
                _integration: integration,
              });
            }
          }
        }
      }
      
      // Create a stage entry
      httpStages.push({
        Properties: {
          StageName: stageName,
        },
        _originalId: 'HTTPApiGatewayDefaultStage',
      });
    }
  } else {
    // Original format: separate Route and Integration resources
    for (const [resourceId, resource] of Object.entries(resources)) {
      if (resource.Type === 'AWS::ApiGatewayV2::Route') {
        httpRoutes.push({ ...resource, _originalId: resourceId });
      } else if (resource.Type === 'AWS::ApiGatewayV2::Integration') {
        httpIntegrations[resourceId] = resource;
      } else if (resource.Type === 'AWS::ApiGatewayV2::Stage') {
        httpStages.push({ ...resource, _originalId: resourceId });
      } else if (resource.Type === 'AWS::ApiGatewayV2::Authorizer') {
        httpAuthorizers[resourceId] = resource;
      }
    }
  }

  // 2. Create REST API resource
  // Use stack name to make API Gateway names unique per stack (e.g., "HelpmatonStagingPR22")
  // This prevents conflicts when multiple stacks run in the same AWS account
  const stackName = process.env.ARC_STACK_NAME || 
                    process.env.AWS_STACK_NAME || 
                    { "Ref": "AWS::StackName" }; // Use CloudFormation reference if env var not available
  
  // Always use stack name for REST API name (ignoring any explicit name from HTTP API)
  // If stackName is a string, use it directly; otherwise use CloudFormation Fn::Sub
  let restApiName;
  if (typeof stackName === "string") {
    restApiName = stackName;
  } else {
    // Use CloudFormation intrinsic function to reference stack name
    restApiName = { "Fn::Sub": "${AWS::StackName}" };
  }
  
  const restApiDescription = httpApi.Properties?.Description || 'REST API for Helpmaton';

  // Determine the REST API resource ID based on migration phase
  // Phase 1: Use HTTPRestApi to avoid conflict with existing HTTP resource
  // Normal: Use HTTP (for new stacks)
  const restApiId = needsMigration ? 'HTTPRestApi' : 'HTTP';
  
  if (needsMigration) {
    console.log(`[http-to-rest] Creating REST API with ID: ${restApiId} (Phase 1)`);
    console.log(`[http-to-rest] Old HTTP resource will be kept until Phase 2`);
    // In migration mode, preserve the original HTTP resource
    // We'll create the REST API with a different ID
    resources[restApiId] = {
      Type: 'AWS::ApiGateway::RestApi',
      Properties: {
        Name: restApiName,
        Description: restApiDescription,
        EndpointConfiguration: {
          Types: ['REGIONAL'],
        },
        // Set API key source to AUTHORIZER so API Gateway uses usageIdentifierKey from authorizer response
        // This allows the authorizer to return the API key ID for throttling without requiring x-api-key header
        ApiKeySourceType: 'AUTHORIZER',
      },
    };
  } else {
    // Normal mode: replace HTTP with REST API
    resources.HTTP = {
      Type: 'AWS::ApiGateway::RestApi',
      Properties: {
        Name: restApiName,
        Description: restApiDescription,
        EndpointConfiguration: {
          Types: ['REGIONAL'],
        },
        // Set API key source to AUTHORIZER so API Gateway uses usageIdentifierKey from authorizer response
        // This allows the authorizer to return the API key ID for throttling without requiring x-api-key header
        ApiKeySourceType: 'AUTHORIZER',
      },
    };
  }

  // 3. Build resource hierarchy (pass restApiId so resources use correct API ID)
  const { resources: apiResources, pathToResourceId } = createResourceHierarchy(httpRoutes, restApiId);
  
  // Print resource tree for debugging (if DEBUG_TEMPLATE is enabled)
  if (process.env.DEBUG_TEMPLATE === 'true') {
    printResourceTree(apiResources, pathToResourceId, restApiId);
  }
  
  // Add API resources to CloudFormation
  Object.assign(resources, apiResources);

  // 4. Transform authorizers (before methods, as methods reference them)
  // Authorizers also need to know the REST API ID
  const { authorizers, authorizerMap } = transformAuthorizers(cloudformation, restApiId);
  Object.assign(resources, authorizers);

  // 5. Sort routes so that more specific routes are processed before catch-all routes
  // This ensures that methods are created on specific resources (e.g., /api/workspaces/{proxy+})
  // before the root catch-all (/{proxy+}), so REST API Gateway matches the more specific routes first
  httpRoutes.sort((a, b) => {
    const routeKeyA = a.Properties?.RouteKey || a.RouteKey || '';
    const routeKeyB = b.Properties?.RouteKey || b.RouteKey || '';
    
    const pathA = routeKeyA.split(' ')[1] || '';
    const pathB = routeKeyB.split(' ')[1] || '';
    
    // Check if either is a root catch-all
    const isRootCatchAllA = pathA === '/*' || pathA === '*' || pathA === '/{proxy+}' || pathA === '{proxy+}';
    const isRootCatchAllB = pathB === '/*' || pathB === '*' || pathB === '/{proxy+}' || pathB === '{proxy+}';
    
    // Root catch-all should come last
    if (isRootCatchAllA && !isRootCatchAllB) return 1;
    if (!isRootCatchAllA && isRootCatchAllB) return -1;
    
    // For non-root catch-all routes, more specific paths (longer) should come first
    // This ensures /api/workspaces/* is processed before /api/*
    if (!isRootCatchAllA && !isRootCatchAllB) {
      const depthA = pathA.split('/').length;
      const depthB = pathB.split('/').length;
      if (depthA !== depthB) {
        return depthB - depthA; // Deeper paths first
      }
    }
    
    return pathA.localeCompare(pathB);
  });

  // 5. Create methods (pass restApiId so methods use correct API ID)
  const { methods, methodDependencies } = createMethods(
    httpRoutes,
    httpIntegrations,
    pathToResourceId,
    apiResources,
    restApiId
  );

  // Update method authorizer references
  for (const method of Object.values(methods)) {
    if (method.Properties.AuthorizerId && method.Properties.AuthorizerId.Ref) {
      const oldAuthorizerId = method.Properties.AuthorizerId.Ref;
      const newAuthorizerId = authorizerMap[oldAuthorizerId];
      if (newAuthorizerId) {
        // Check if this is an IAM authorizer - if so, use AWS_IAM authorization type
        const oldAuthorizer = httpAuthorizers[oldAuthorizerId];
        if (oldAuthorizer && isIamAuthorizer(oldAuthorizer)) {
          method.Properties.AuthorizationType = 'AWS_IAM';
          delete method.Properties.AuthorizerId;
        } else {
          method.Properties.AuthorizerId = { Ref: newAuthorizerId };
        }
      }
    }
  }

  Object.assign(resources, methods);

  // Note: In migration mode, we already created resources with HTTPRestApi ID,
  // so we don't need to update references. The updateResourceReferences call
  // was only needed if we created resources with HTTP first, then renamed.
  // Since we're now creating them with the correct ID from the start, we can skip this.

  // 6. Create deployment
  const deploymentId = 'HTTPDeployment';
  const currentRestApiId = needsMigration ? 'HTTPRestApi' : 'HTTP';
  // Include a timestamp or method count in the description to force deployment updates when methods change
  // This ensures that when new methods (like root methods) are added, a new deployment is created
  const deploymentDescription = `Deployment for ${stage} stage (${methodDependencies.length} methods)`;
  resources[deploymentId] = {
    Type: 'AWS::ApiGateway::Deployment',
    Properties: {
      RestApiId: { Ref: currentRestApiId },
      Description: deploymentDescription,
    },
    DependsOn: methodDependencies,
  };

  // 7. Create stage(s)
  for (const httpStage of httpStages) {
    const originalStageName = httpStage.Properties?.StageName || httpStage._originalId.replace('HTTP', '').replace('Stage', '');
    // Sanitize stage name for CloudFormation resource ID (must be alphanumeric)
    // Convert $default -> Default, staging -> Staging, etc.
    const sanitizedStageName = sanitizeResourceName(originalStageName);

    // Ensure we have a valid sanitized name (fallback to 'Default' if empty)
    const finalSanitizedName = sanitizedStageName || 'Default';
    const capitalizedStageName = finalSanitizedName.charAt(0).toUpperCase() + finalSanitizedName.slice(1);
    const stageId = `HTTP${capitalizedStageName}Stage`;

    // Double-check that stageId is alphanumeric (safety check)
    if (!/^[a-zA-Z0-9]+$/.test(stageId)) {
      throw new Error(`Invalid stage ID generated: ${stageId}. Stage name: ${originalStageName}, Sanitized: ${sanitizedStageName}`);
    }

    // Sanitize stage name for StageName property (API Gateway only allows a-zA-Z0-9_)
    // Remove any characters that aren't alphanumeric or underscore
    const validStageName = originalStageName.replace(/[^a-zA-Z0-9_]/g, '') || 'default';

    const accessLogSettings = httpStage.Properties?.AccessLogSettings;
    const defaultRouteSettings = httpStage.Properties?.DefaultRouteSettings;

    resources[stageId] = {
      Type: 'AWS::ApiGateway::Stage',
      Properties: {
        RestApiId: { Ref: currentRestApiId },
        DeploymentId: { Ref: deploymentId },
        StageName: validStageName,
      },
      DependsOn: [deploymentId],
    };

    // Add access log settings if present
    if (accessLogSettings) {
      resources[stageId].Properties.AccessLogSetting = {
        DestinationArn: accessLogSettings.DestinationArn,
        Format: accessLogSettings.Format || '$context.requestId',
      };
    }

    // Add throttling settings if present
    if (defaultRouteSettings) {
      if (defaultRouteSettings.ThrottleBurstLimit !== undefined) {
        resources[stageId].Properties.ThrottleBurstLimit = defaultRouteSettings.ThrottleBurstLimit;
      }
      if (defaultRouteSettings.ThrottleRateLimit !== undefined) {
        resources[stageId].Properties.ThrottleRateLimit = defaultRouteSettings.ThrottleRateLimit;
      }
    }

    // Preserve stage variables if present
    if (httpStage.Properties?.Variables) {
      resources[stageId].Properties.Variables = httpStage.Properties.Variables;
    }
  }

  // 8. Transform domain (if exists)
  const httpDomain = httpApi.Properties?.Domain;
  if (httpDomain) {
    // Use sanitized stage name for domain mapping (API Gateway only allows a-zA-Z0-9_)
    const originalStageName = httpStages[0]?.Properties?.StageName || stage || 'staging';
    const stageName = originalStageName.replace(/[^a-zA-Z0-9_]/g, '') || 'staging';
    const domainResources = transformDomain(httpDomain, currentRestApiId, stageName);
    
    if (domainResources.domainName) {
      Object.assign(resources, domainResources.domainName);
    }
    if (domainResources.basePathMapping) {
      Object.assign(resources, domainResources.basePathMapping);
    }
    if (domainResources.recordSet) {
      Object.assign(resources, domainResources.recordSet);
    }
  }

  // 9. Update outputs
  if (outputs.ApiUrl) {
    // Use sanitized stage name for API URL (API Gateway only allows a-zA-Z0-9_)
    const originalStageName = httpStages[0]?.Properties?.StageName || stage || 'staging';
    const stageName = originalStageName.replace(/[^a-zA-Z0-9_]/g, '') || 'staging';
    outputs.ApiUrl.Value = {
      'Fn::Join': [
        '',
        [
          'https://',
          { Ref: currentRestApiId },
          '.execute-api.',
          { Ref: 'AWS::Region' },
          '.amazonaws.com/',
          stageName,
        ],
      ],
    };
  }

  if (outputs.ApiId) {
    outputs.ApiId.Value = { Ref: currentRestApiId };
  }

  // Add REST API root URL output if not exists
  if (!outputs.RestApiUrl) {
    // Use sanitized stage name for API URL (API Gateway only allows a-zA-Z0-9_)
    const originalStageName = httpStages[0]?.Properties?.StageName || stage || 'staging';
    const stageName = originalStageName.replace(/[^a-zA-Z0-9_]/g, '') || 'staging';
    outputs.RestApiUrl = {
      Description: 'REST API URL',
      Value: {
        'Fn::Join': [
          '',
          [
            'https://',
            { Ref: currentRestApiId },
            '.execute-api.',
            { Ref: 'AWS::Region' },
            '.amazonaws.com/',
            stageName,
          ],
        ],
      },
    };
  }
  
  // If Phase 2 was explicitly set but HTTPRestApi didn't exist in incoming template, we created it above
  // Now check if we need to run Phase 2 logic to complete the migration
  // Note: Even though HTTPRestApi exists in deployed stack, Architect generates fresh template without it
  // So we need to check if we just created it OR if Phase 2 is explicitly set
  if (explicitPhase2 && resources.HTTPRestApi && resources.HTTPRestApi.Type === 'AWS::ApiGateway::RestApi') {
    console.log('[http-to-rest] HTTPRestApi exists in template (either just created or already existed), completing Phase 2 migration...');
    
    // Extract domain information BEFORE deleting HTTP resource
    const httpDomainForPhase2 = httpApi?.Properties?.Domain;
    const httpStagesForPhase2 = [];
    if (isServerlessHttpApi) {
      const definitionBody = httpApi.Properties?.DefinitionBody;
      if (definitionBody && typeof definitionBody === 'object') {
        const stageName = httpApi.Properties?.StageName || stage || 'staging';
        httpStagesForPhase2.push({
          Properties: {
            StageName: stageName,
          },
        });
      }
    } else {
      // Collect HTTP API v2 stages before we delete them
      for (const resource of Object.values(resources)) {
        if (resource && resource.Type === 'AWS::ApiGatewayV2::Stage') {
          httpStagesForPhase2.push(resource);
        }
      }
    }
    
    // Remove old HTTP resource if it's still HTTP API v2
    if (resources.HTTP && (resources.HTTP.Type === 'AWS::Serverless::HttpApi' || resources.HTTP.Type === 'AWS::ApiGatewayV2::Api')) {
      console.log('[http-to-rest] Removing old HTTP API v2 resource');
      delete resources.HTTP;
      
      // Also remove old HTTP API v2 related resources
      // This includes routes, integrations, stages, authorizers, and domain resources
      const resourcesToRemove = [];
      for (const [resourceId, resource] of Object.entries(resources)) {
        // Skip undefined resources
        if (!resource || typeof resource !== 'object') {
          continue;
        }
        if (resource.Type === 'AWS::ApiGatewayV2::Route' ||
            resource.Type === 'AWS::ApiGatewayV2::Integration' ||
            resource.Type === 'AWS::ApiGatewayV2::Stage' ||
            resource.Type === 'AWS::ApiGatewayV2::Authorizer') {
          resourcesToRemove.push(resourceId);
          console.log(`[http-to-rest] Marking HTTP API v2 resource for deletion: ${resourceId} (${resource.Type})`);
        }
        // NOTE: We DON'T delete AWS::ApiGatewayV2::DomainName and AWS::ApiGatewayV2::ApiMapping here.
        // We keep them in the template so CloudFormation can delete them first, then the custom-domain
        // plugin can create the new REST API domain in the same deployment. CloudFormation processes
        // deletions before creations, so this avoids the need for a 3-step deployment.
      }
      if (resourcesToRemove.length > 0) {
        console.log(`[http-to-rest] Removing ${resourcesToRemove.length} HTTP API v2 resources: ${resourcesToRemove.join(', ')}`);
        resourcesToRemove.forEach(id => delete resources[id]);
      }
      
      // Keep HTTP API v2 domain resources in template so CloudFormation deletes them first
      // The custom-domain plugin will create the new REST API domain after deletion
      const v2DomainResources = Object.keys(resources).filter(id => {
        const resource = resources[id];
        return resource && (
          resource.Type === 'AWS::ApiGatewayV2::DomainName' ||
          resource.Type === 'AWS::ApiGatewayV2::ApiMapping'
        );
      });
      if (v2DomainResources.length > 0) {
        console.log(`[http-to-rest] Keeping HTTP API v2 domain resources in template for deletion: ${v2DomainResources.join(', ')}`);
        console.log(`[http-to-rest] Custom-domain plugin will create new REST API domain after these are deleted.`);
      }
    }
    
    // Note: Domain transformation is handled by the custom-domain plugin based on environment variables
    // We don't need to transform domain here during Phase 2 because:
    // 1. The domain comes from environment variables (HELPMATON_CUSTOM_DOMAIN), not from HTTP resource
    // 2. The custom-domain plugin will create domain resources for HTTPRestApi after this plugin runs
    // 3. Creating domain resources here would conflict with custom-domain plugin creating the same resources
    // Only transform domain if it exists in HTTP resource AND custom-domain plugin is not being used
    // (This is a fallback for cases where domain is configured in HTTP resource, not via env vars)
    if (httpDomainForPhase2 && !process.env.HELPMATON_CUSTOM_DOMAIN) {
      console.log('[http-to-rest] Transforming custom domain for HTTPRestApi (no HELPMATON_CUSTOM_DOMAIN env var found)');
      const originalStageName = httpStagesForPhase2[0]?.Properties?.StageName || stage || 'staging';
      const stageName = originalStageName.replace(/[^a-zA-Z0-9_]/g, '') || 'staging';
      const domainResources = transformDomain(httpDomainForPhase2, 'HTTPRestApi', stageName);
      
      if (domainResources.domainName) {
        Object.assign(resources, domainResources.domainName);
      }
      if (domainResources.basePathMapping) {
        Object.assign(resources, domainResources.basePathMapping);
      }
      if (domainResources.recordSet) {
        Object.assign(resources, domainResources.recordSet);
      }
    } else if (httpDomainForPhase2 && process.env.HELPMATON_CUSTOM_DOMAIN) {
      console.log('[http-to-rest] Skipping domain transformation - custom-domain plugin will handle it from environment variables');
    }
    
    // Update all references from HTTP to HTTPRestApi (instead of renaming HTTPRestApi to HTTP)
    // This avoids the CloudFormation error "Update of resource type is not permitted"
    // We keep HTTPRestApi as the REST API and update all references to point to it
    console.log('[http-to-rest] Updating all references from HTTP to HTTPRestApi');
    updateResourceReferences(cloudformation, 'HTTP', 'HTTPRestApi');
    
    console.log('[http-to-rest] Phase 2 migration complete! HTTPRestApi is now the primary API.');
  } else if (needsMigration) {
    console.log('[http-to-rest] Phase 1 migration complete!');
    console.log('[http-to-rest] Next steps:');
    console.log('[http-to-rest] 1. Verify the new REST API (HTTPRestApi) is working');
    console.log('[http-to-rest] 2. Update custom domains/DNS to point to HTTPRestApi if needed');
    console.log('[http-to-rest] 3. Set HTTP_TO_REST_MIGRATION_PHASE=2 and deploy again to complete migration');
  }

  // Preserve custom domain outputs if they exist
  if (httpDomain && outputs.DomainName) {
    outputs.DomainName.Value = httpDomain.DomainName;
  }
  if (httpDomain && outputs.DomainUrl) {
    // Use sanitized stage name for domain URL (API Gateway only allows a-zA-Z0-9_)
    const originalStageName = httpStages[0]?.Properties?.StageName || stage || 'staging';
    const stageName = originalStageName.replace(/[^a-zA-Z0-9_]/g, '') || 'staging';
    outputs.DomainUrl.Value = {
      'Fn::Join': [
        '',
        [
          'https://',
          httpDomain.DomainName,
          '/',
          stageName,
        ],
      ],
    };
  }

  // 10. Clean up HTTP v2 resources
  const resourcesToRemove = [];
  for (const [resourceId, resource] of Object.entries(resources)) {
    if (
      resource.Type === 'AWS::ApiGatewayV2::Route' ||
      resource.Type === 'AWS::ApiGatewayV2::Integration' ||
      resource.Type === 'AWS::ApiGatewayV2::Stage' ||
      resource.Type === 'AWS::ApiGatewayV2::Authorizer'
    ) {
      resourcesToRemove.push(resourceId);
    }
  }

  for (const resourceId of resourcesToRemove) {
    delete resources[resourceId];
  }

  console.log(`Transformation complete. Removed ${resourcesToRemove.length} HTTP v2 resources.`);

  return cloudformation;
}

module.exports = {
  transformToRestApi,
};

