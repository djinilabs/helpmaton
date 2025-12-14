/**
 * Resource hierarchy creation utilities
 */

const {
  splitPath,
  generateResourceId,
  convertPathParameters,
  convertWildcardPath,
  hasWildcard,
} = require('./utils');

/**
 * Create REST API resource hierarchy from routes
 * @param {Array} routes - Array of route definitions from HTTP v2
 * @param {string} restApiId - REST API resource ID (default: 'HTTP')
 * @returns {Object} Map of path to resource logical IDs and resource definitions
 */
function createResourceHierarchy(routes, restApiId = 'HTTP') {
  const resourceMap = new Map(); // path -> resource logical ID
  const resources = {}; // resource logical ID -> resource definition
  const pathToResourceId = {}; // normalized path -> resource logical ID

  // Root resource already exists in REST API (we'll reference it via GetAtt)
  // No need to create it, just map it
  const rootResourceId = 'HTTPRootResource';
  pathToResourceId['/'] = rootResourceId;

  // First pass: Process all routes to collect paths and identify catch-all routes
  // This helps us identify proxy resources before creating them
  const allPaths = [];
  const catchAllRoutesByParent = new Map(); // parent path -> catch-all route info
  for (const route of routes) {
    const routeKey = route.Properties?.RouteKey || route.RouteKey;
    if (!routeKey) continue;

    const path = routeKey.split(' ')[1];
    if (!path) continue;

    // Convert path parameters and wildcards
    let normalizedPath = convertPathParameters(path);
    const isCatchAll = hasWildcard(normalizedPath);
    if (isCatchAll) {
      normalizedPath = convertWildcardPath(normalizedPath);
      // Track catch-all routes by their parent path
      const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/{proxy+}'));
      if (parentPath) {
        catchAllRoutesByParent.set(parentPath, { path: normalizedPath, routeKey });
      }
    }

    allPaths.push({ path: normalizedPath, isCatchAll });
  }

  // Sort paths to ensure path parameters are processed before catch-all routes
  // This ensures path parameter resources are created first, and catch-all routes reuse them
  // With deterministic naming, we don't need to worry about existing CloudFormation resources
  allPaths.sort((a, b) => {
    const aHasProxy = a.path.includes('{proxy+}');
    const bHasProxy = b.path.includes('{proxy+}');
    const aHasPathParam = /\{[^+]+\}/.test(a.path) && !aHasProxy;
    const bHasPathParam = /\{[^+]+\}/.test(b.path) && !bHasProxy;
    
    // Extract parent paths to check for conflicts
    const aParentPath = a.path.substring(0, a.path.lastIndexOf('/'));
    const bParentPath = b.path.substring(0, b.path.lastIndexOf('/'));
    const aIsCatchAllForB = aHasProxy && bHasPathParam && aParentPath === bParentPath;
    const bIsCatchAllForA = bHasProxy && aHasPathParam && bParentPath === aParentPath;
    
    // If one is a catch-all for the other's parent, process path parameter first
    // This ensures the path parameter resource is created before the catch-all route reuses it
    if (aIsCatchAllForB) return 1; // Process path parameter first (b comes before a)
    if (bIsCatchAllForA) return -1; // Process path parameter first (a comes before b)
    
    // Specific routes with path parameters come first (before catch-all) when no conflict
    if (aHasPathParam && !bHasPathParam) return -1;
    if (!aHasPathParam && bHasPathParam) return 1;
    
    // Catch-all routes with {proxy+} come after specific routes
    if (aHasProxy && !bHasProxy) return 1;
    if (!aHasProxy && bHasProxy) return -1;
    
    // If both have path parameters or both don't, sort by path (deeper paths first for specificity)
    const depthA = a.path.split('/').length;
    const depthB = b.path.split('/').length;
    if (depthA !== depthB) {
      return depthB - depthA; // Deeper paths first
    }
    return a.path.localeCompare(b.path);
  });

  // Second pass: Build resource hierarchy for each path
  for (const { path: normalizedPath } of allPaths) {
    buildResourcePath(normalizedPath, resources, resourceMap, pathToResourceId, restApiId, catchAllRoutesByParent, routes);
  }

  return {
    resources,
    pathToResourceId,
  };
}

/**
 * Build resource path hierarchy
 * @param {string} path - Normalized path
 * @param {Object} resources - Resources object to populate
 * @param {Map} resourceMap - Map of paths to resource IDs
 * @param {Object} pathToResourceId - Object mapping normalized paths to resource IDs
 * @param {string} restApiId - REST API resource ID (default: 'HTTP')
 */
function buildResourcePath(path, resources, resourceMap, pathToResourceId, restApiId = 'HTTP', catchAllRoutesByParent = new Map(), allRoutes = []) {
  // If already processed, skip
  if (pathToResourceId[path]) {
    return;
  }

  const segments = splitPath(path);
  if (segments.length === 0) {
    return; // Root is already handled
  }

  // Build parent path and current segment
  let currentPath = '';
  let parentResourceId = 'HTTPRootResource';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    currentPath += '/' + segment;

    // Check if resource already exists
    if (pathToResourceId[currentPath]) {
      parentResourceId = pathToResourceId[currentPath];
      continue;
    }

    // Determine path part
    let pathPart = segment;
    const isProxy = segment.startsWith('{') && segment.endsWith('+}');
    const isPathParameter = !isProxy && segment.startsWith('{') && segment.endsWith('}');
    const isVariablePathPart = isProxy || isPathParameter;
    
    // CRITICAL: API Gateway REST API only allows ONE variable path part per parent resource
    // This can be EITHER a path parameter (e.g., {workspaceId}) OR a {proxy+}, but NOT both
    // We need to check if ANY variable path part already exists at this parent level
    const currentParentId = parentResourceId === 'HTTPRootResource' 
      ? { 'Fn::GetAtt': [restApiId, 'RootResourceId'] }
      : { Ref: parentResourceId };
    
    // Track if we found an existing variable resource (used both inside and outside the isVariablePathPart block)
    let foundExistingVariable = null;
    let foundExistingResourceId = null;
    
    if (isVariablePathPart) {
      // Check if ANY variable path part already exists at this parent level
      // First, check in the resources object (resources already created in this iteration)
      for (const [existingResourceId, existingResource] of Object.entries(resources)) {
        if (existingResource.Properties) {
          const existingPathPart = existingResource.Properties.PathPart;
          const existingIsVariable = existingPathPart === '{proxy+}' || 
                                     (existingPathPart && existingPathPart.startsWith('{') && existingPathPart.endsWith('}'));
          
          if (existingIsVariable) {
            // Check if this resource has the same parent
            const existingParentId = existingResource.Properties.ParentId;
            
            // Compare parent IDs (they should be the same object structure)
            const parentsMatch = JSON.stringify(existingParentId) === JSON.stringify(currentParentId);
            
            if (parentsMatch) {
              foundExistingVariable = existingPathPart;
              foundExistingResourceId = existingResourceId;
              break;
            }
          }
        }
      }
      
      // Also check in pathToResourceId for resources created in previous path iterations
      // This is critical because resources are created as we process paths, and a previous path
      // might have already created a variable resource at this parent level
      if (!foundExistingVariable) {
        const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
        for (const [existingPath, existingResourceId] of Object.entries(pathToResourceId)) {
          // Check if this path is a sibling (same parent path)
          if (existingPath.startsWith(parentPath + '/') && existingPath !== currentPath) {
            const existingResource = resources[existingResourceId];
            if (existingResource && existingResource.Properties) {
              const existingPathPart = existingResource.Properties.PathPart;
              const existingIsVariable = existingPathPart === '{proxy+}' || 
                                         (existingPathPart && existingPathPart.startsWith('{') && existingPathPart.endsWith('}'));
              
              if (existingIsVariable) {
                // Check if this resource has the same parent
                const existingParentId = existingResource.Properties.ParentId;
                if (JSON.stringify(existingParentId) === JSON.stringify(currentParentId)) {
                  foundExistingVariable = existingPathPart;
                  foundExistingResourceId = existingResourceId;
                  console.log(`[http-to-rest] Found existing variable resource ${existingResourceId} (${existingPathPart}) at parent level via pathToResourceId check`);
                  break;
                }
              }
            }
          }
        }
      }
      
      if (foundExistingVariable) {
        if (isProxy) {
          // Normalize to {proxy+}
          pathPart = '{proxy+}';
          
          if (foundExistingVariable === '{proxy+}') {
            // Found an existing {proxy+} at this parent level - reuse it
            console.log(`[http-to-rest] Reusing existing {proxy+} resource ${foundExistingResourceId} at parent level for ${currentPath}`);
            pathToResourceId[currentPath] = foundExistingResourceId;
            parentResourceId = foundExistingResourceId;
            // Skip creating a new resource - we'll check pathToResourceId[currentPath] after this block
          } else {
            // Found a path parameter at this parent level, but we're trying to create {proxy+}
            // CRITICAL: REST API Gateway doesn't allow both {proxy+} and path parameters as siblings
            // We MUST create a {proxy+} resource for the catchall route to work in REST API Gateway.
            // Since REST API Gateway doesn't allow both, we create {proxy+} and map path parameter routes to it.
            // The Lambda function (Express app) will handle routing between path parameters and catchall paths.
            console.log(`[http-to-rest] Found path parameter ${foundExistingVariable} at parent level for catch-all route ${currentPath}. Creating {proxy+} resource - Lambda will handle routing for both path parameters and catchall.`);
            // Map the path parameter path to the {proxy+} resource we're about to create
            const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/{proxy+}'));
            const pathParamPath = parentPath + '/{' + foundExistingVariable.replace(/[{}]/g, '') + '}';
            // We'll update this mapping after creating the {proxy+} resource
            // Continue to create the {proxy+} resource below - don't skip, just continue with creation
            // Don't set pathToResourceId[currentPath] here - let it be created below
          }
        } else if (isPathParameter) {
          // Path parameter - keep as is
          pathPart = segment;
          
          // Check if a catchall route exists for this parent
          const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/{' + pathPart.replace(/[{}]/g, '') + '}'));
          const catchallPath = parentPath + '/{proxy+}';
          const catchallExists = catchAllRoutesByParent.has(parentPath);
          
          if (catchallExists) {
            // A catchall route exists - we'll create {proxy+} instead of path parameter
            // Map this path parameter route to the {proxy+} resource (which will be created later)
            // Lambda will handle routing between path parameters and catchall
            console.log(`[http-to-rest] Catchall route exists for parent ${parentPath}, path parameter ${pathPart} will use {proxy+} resource. Lambda will handle routing.`);
            // Don't create the path parameter resource - it will be handled by {proxy+}
            // Map to a placeholder that will be resolved when {proxy+} is created
            pathToResourceId[currentPath] = `__PENDING_PROXY_${parentPath.replace(/\//g, '_')}__`;
            // Continue to next segment, but use the parent as the parent for child resources
            // This allows child resources to be created under the parent, not under the path parameter
            continue;
          }
          
          if (foundExistingVariable === pathPart) {
            // Found an existing path parameter with the same PathPart at this parent level - reuse it
            console.log(`[http-to-rest] Reusing existing ${pathPart} resource ${foundExistingResourceId} at parent level for ${currentPath}`);
            pathToResourceId[currentPath] = foundExistingResourceId;
            parentResourceId = foundExistingResourceId;
            // Skip creating a new resource and move to next segment
            continue;
          } else if (foundExistingVariable === '{proxy+}') {
            // Found a {proxy+} at this parent level, but we're trying to create a path parameter
            // CRITICAL: When reusing {proxy+} for a path parameter, we need to be careful about child resources
            // The {proxy+} resource can match the path parameter, but we still need to create child resources
            // under the SAME parent as the {proxy+}, not under the {proxy+} itself
            // This is because REST API Gateway doesn't allow children of {proxy+} resources
            console.log(`[http-to-rest] Reusing existing {proxy+} resource ${foundExistingResourceId} for path parameter ${pathPart} at ${currentPath}`);
            // Map the path parameter path to the {proxy+} resource
            pathToResourceId[currentPath] = foundExistingResourceId;
            // CRITICAL: Keep the parent as the parent of the {proxy+} resource, not the {proxy+} itself
            // This allows us to create child resources at the correct level
            const proxyResource = resources[foundExistingResourceId];
            if (proxyResource && proxyResource.Properties && proxyResource.Properties.ParentId) {
              // Get the parent of the {proxy+} resource
              const proxyParentId = proxyResource.Properties.ParentId;
              if (proxyParentId.Ref) {
                parentResourceId = proxyParentId.Ref;
              } else if (proxyParentId['Fn::GetAtt']) {
                // If parent is root, keep HTTPRootResource
                if (proxyParentId['Fn::GetAtt'][1] === 'RootResourceId') {
                  parentResourceId = 'HTTPRootResource';
                }
              }
            }
            // Skip creating a new resource for the path parameter
            // Continue to next segment to build child resources under the correct parent
            continue;
          } else {
            // Found a different path parameter - this is a conflict
            console.warn(`[http-to-rest] WARNING: Cannot create path parameter ${pathPart} resource at ${currentPath} because path parameter ${foundExistingVariable} already exists at parent level. This may cause a CloudFormation error.`);
            // We'll still try to create it, but it will likely fail in CloudFormation
          }
        }
      }
      
      // If no existing variable found but this is a path parameter, check for catch-all routes
      if (!foundExistingVariable && isPathParameter) {
        // No existing variable found in our resources, but check if a catch-all route will create {proxy+} at this parent
        // Since REST API Gateway doesn't allow both {proxy+} and path parameters as siblings,
        // if a catchall route exists, we should create {proxy+} instead and let Lambda handle routing
        const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
        if (catchAllRoutesByParent.has(parentPath)) {
          // A catch-all route exists - we'll create {proxy+} instead of path parameter
          // Map this path parameter route to use {proxy+} (which will be created when processing the catchall route)
          console.log(`[http-to-rest] Catchall route exists for parent ${parentPath}, path parameter ${pathPart} will use {proxy+} resource. Lambda will handle routing.`);
          // Don't create the path parameter resource - skip it and continue to next segment
          // The catchall route will create {proxy+} later, and we'll map path parameter routes to it
          continue;
        }
      }
    }

    // If we found and reused an existing resource (proxy or path parameter), skip to next segment
    if (pathToResourceId[currentPath]) {
      parentResourceId = pathToResourceId[currentPath];
      continue;
    }

    // CRITICAL: Before creating a new resource, check if we should reuse an existing variable resource
    // This handles the case where a variable resource was created in a previous path iteration
    // We need to check pathToResourceId for any variable path at this parent level
    // This check runs for ALL variable path parts to catch resources created in previous iterations
    // EXCEPTION: If we're creating {proxy+} and a path parameter exists, we still need to create {proxy+}
    // because REST API Gateway requires {proxy+} to match catchall routes
    if (isVariablePathPart && !pathToResourceId[currentPath] && !(isProxy && foundExistingVariable && foundExistingVariable !== '{proxy+}')) {
      // Look for any variable resource (proxy or path parameter) that was already created at this parent
      // CRITICAL: We must check BOTH the path AND the parent resource ID to avoid reusing resources
      // from different parent resources (e.g., /api/streams/{workspaceId} vs /api/webhook/{workspaceId})
      const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
      for (const [existingPath, existingResourceId] of Object.entries(pathToResourceId)) {
        // First check if the path structure matches (same parent path)
        if (existingPath.startsWith(parentPath + '/')) {
          const existingResource = resources[existingResourceId];
          if (existingResource && existingResource.Properties) {
            const existingPathPart = existingResource.Properties.PathPart;
            const existingIsVariable = existingPathPart === '{proxy+}' || 
                                       (existingPathPart && existingPathPart.startsWith('{') && existingPathPart.endsWith('}'));
            
            if (existingIsVariable) {
              // CRITICAL: Check if this resource has the same parent resource ID
              // This prevents reusing resources from different parent resources
              // (e.g., HTTPWorkspaceIdResource from /api/webhook should not be reused for /api/streams)
              const existingParentId = existingResource.Properties.ParentId;
              const parentsMatch = JSON.stringify(existingParentId) === JSON.stringify(currentParentId);
              
              if (parentsMatch) {
                // Found an existing variable resource at this parent level
                // If we're creating {proxy+} and a path parameter exists, create {proxy+} anyway
                if (isProxy && existingPathPart !== '{proxy+}') {
                  console.log(`[http-to-rest] Found path parameter ${existingPathPart} at parent level, but creating {proxy+} resource anyway for catchall route ${currentPath}. Lambda will handle routing.`);
                  // Don't reuse, continue to create the {proxy+} resource
                  break;
                }
                // Otherwise, reuse it
                console.log(`[http-to-rest] Reusing existing variable resource ${existingResourceId} (${existingPathPart}) for ${currentPath} (${pathPart})`);
                pathToResourceId[currentPath] = existingResourceId;
                parentResourceId = existingResourceId;
                foundExistingVariable = existingPathPart;
                foundExistingResourceId = existingResourceId;
                break;
              } else {
                // Path matches but parent doesn't - this is a different resource, don't reuse
                // This prevents /api/streams/{workspaceId} from reusing /api/webhook/{workspaceId} resource
                console.log(`[http-to-rest] Found variable resource ${existingResourceId} (${existingPathPart}) with matching path but different parent. Not reusing.`);
              }
            }
          }
        }
      }
    }

    // If we found and reused an existing variable resource, skip creating a new one
    // EXCEPTION: If we're creating {proxy+} and a path parameter exists, we still need to create {proxy+}
    // because REST API Gateway requires {proxy+} to match catchall routes
    if (pathToResourceId[currentPath] && !(isProxy && foundExistingVariable && foundExistingVariable !== '{proxy+}')) {
      continue;
    }

    // FINAL SAFETY CHECK: Before creating a variable resource, do one more comprehensive check
    // This catches any edge cases where we might have missed an existing variable resource
    if (isVariablePathPart) {
      // Check ALL resources (including those we just created) for any variable resource at this parent
      for (const [checkResourceId, checkResource] of Object.entries(resources)) {
        if (checkResource.Properties) {
          const checkPathPart = checkResource.Properties.PathPart;
          const checkIsVariable = checkPathPart === '{proxy+}' || 
                                 (checkPathPart && checkPathPart.startsWith('{') && checkPathPart.endsWith('}'));
          
          if (checkIsVariable) {
            // Check if this resource has the same parent
            const checkParentId = checkResource.Properties.ParentId;
            if (JSON.stringify(checkParentId) === JSON.stringify(currentParentId)) {
              // Found a variable resource at the same parent
              if (checkPathPart === pathPart) {
                // Same pathPart - reuse it (this prevents duplicate resources with same name)
                console.log(`[http-to-rest] FINAL CHECK: Found existing variable resource ${checkResourceId} (${checkPathPart}) at parent level when trying to create same ${pathPart} for ${currentPath}. Reusing existing resource.`);
                pathToResourceId[currentPath] = checkResourceId;
                parentResourceId = checkResourceId;
                foundExistingVariable = checkPathPart;
                foundExistingResourceId = checkResourceId;
                break;
              } else {
                // Different pathPart - this is a conflict (e.g., {workspaceId} vs {proxy+})
                // REST API Gateway doesn't allow both, but we need {proxy+} for catchall routes to work
                // If we're trying to create {proxy+} and a path parameter exists, create {proxy+} anyway
                // The Lambda will handle routing. If we're trying to create a path parameter and {proxy+}
                // exists, reuse {proxy+} (the Lambda can handle both).
                if (pathPart === '{proxy+}') {
                  // We're creating {proxy+} but a path parameter exists - create {proxy+} anyway
                  // Don't reuse, continue to create the {proxy+} resource
                  console.log(`[http-to-rest] FINAL CHECK: Found path parameter ${checkPathPart} at parent level, but creating {proxy+} resource anyway for catchall route ${currentPath}. Lambda will handle routing.`);
                  // Clear the foundExistingVariable so we don't skip resource creation
                  foundExistingVariable = null;
                  foundExistingResourceId = null;
                  break; // Break out of the loop, but don't set pathToResourceId - continue to create the resource
                } else {
                  // We're creating a path parameter but {proxy+} exists - reuse {proxy+}
                  // This avoids CloudFormation conflicts - both path parameter and catchall routes use {proxy+}
                  console.log(`[http-to-rest] FINAL CHECK: Found {proxy+} resource ${checkResourceId} at parent level when trying to create ${pathPart} for ${currentPath}. Reusing {proxy+} resource - Lambda will handle routing.`);
                  pathToResourceId[currentPath] = checkResourceId;
                  parentResourceId = checkResourceId;
                  foundExistingVariable = checkPathPart;
                  foundExistingResourceId = checkResourceId;
                  break;
                }
              }
            }
          }
        }
      }
      
      // If we found an existing variable resource in the final check, reuse it
      if (foundExistingVariable && foundExistingResourceId && pathToResourceId[currentPath]) {
        continue;
      }
    }

    // For root resource, use GetAtt to get the actual root resource ID
    const parentId = parentResourceId === 'HTTPRootResource' 
      ? { 'Fn::GetAtt': [restApiId, 'RootResourceId'] }
      : { Ref: parentResourceId };

    // CRITICAL: Check if a resource with the same PathPart and ParentId already exists
    // This prevents CloudFormation errors when updating existing stacks
    // We need to check both the logical ID AND the PathPart+ParentId combination
    // IMPORTANT: We must check ParentId first to avoid reusing resources from different parent paths
    let existingResourceWithSamePathPart = null;
    for (const [existingResourceId, existingResource] of Object.entries(resources)) {
      if (existingResource.Properties) {
        const existingPathPart = existingResource.Properties.PathPart;
        const existingParentId = existingResource.Properties.ParentId;
        
        // CRITICAL: Check ParentId FIRST - resources with same PathPart but different parents must be separate
        // This prevents conflicts like /api/streams/{workspaceId} reusing /api/webhook/{workspaceId} resource
        const parentsMatch = JSON.stringify(existingParentId) === JSON.stringify(parentId);
        
        // Check if this resource has the same PathPart and ParentId
        if (existingPathPart === pathPart && parentsMatch) {
          existingResourceWithSamePathPart = existingResourceId;
          console.log(`[http-to-rest] Found existing resource ${existingResourceId} with same PathPart (${pathPart}) and ParentId. Reusing it for ${currentPath}.`);
          break;
        }
      }
    }

    // If we found an existing resource with the same PathPart and ParentId, reuse it
    if (existingResourceWithSamePathPart) {
      pathToResourceId[currentPath] = existingResourceWithSamePathPart;
      parentResourceId = existingResourceWithSamePathPart;
      continue;
    }

    // CRITICAL SAFETY CHECK: Before creating a new resource, verify no duplicate PathPart+ParentId exists
    // This is a final check to prevent CloudFormation errors like:
    // "Another resource with the same parent already has this name: {agentId}"
    // This can happen if the resource was created in a previous iteration but not found in the check above
    const duplicateCheck = Object.entries(resources).find(
      ([existingResourceId, existingResource]) => {
        if (!existingResource.Properties) return false;
        const existingPathPart = existingResource.Properties.PathPart;
        const existingParentId = existingResource.Properties.ParentId;
        return existingPathPart === pathPart && 
               JSON.stringify(existingParentId) === JSON.stringify(parentId);
      }
    );

    if (duplicateCheck) {
      const [existingResourceId] = duplicateCheck;
      console.warn(`[http-to-rest] WARNING: Found duplicate resource ${existingResourceId} with PathPart ${pathPart} and same ParentId. Reusing it instead of creating a new one for ${currentPath}.`);
      pathToResourceId[currentPath] = existingResourceId;
      parentResourceId = existingResourceId;
      continue;
    }

    // Generate resource ID - make it deterministic based on PathPart + ParentId
    // This ensures the same PathPart+ParentId combination always gets the same logical ID,
    // which is critical for CloudFormation updates to work correctly
    const segmentId = generateResourceId(segment, i);
    
    // Generate base resource ID
    let baseResourceId = `HTTP${segmentId}Resource`;
    
    // Extract parent resource name
    let parentName = '';
    if (parentId.Ref) {
      // Remove "HTTP" prefix and "Resource" suffix to get the parent name
      parentName = parentId.Ref.replace(/^HTTP/, '').replace(/Resource$/, '');
    } else if (parentId['Fn::GetAtt']) {
      // Root resource
      parentName = 'Root';
    }
    
    // CRITICAL: Before generating a new resource ID, check if ANY existing resource
    // (regardless of logical ID) has the same PathPart+ParentId combination.
    // CloudFormation is declarative - if we try to create a new resource with the same
    // PathPart+ParentId as an existing one (even with different logical ID), it will fail.
    // We MUST reuse the existing logical ID to avoid CloudFormation errors.
    // This check happens BEFORE we generate any resource ID to ensure we catch all cases.
    let existingResourceWithSamePathPartAndParent = null;
    for (const [existingResourceId, existingResource] of Object.entries(resources)) {
      if (existingResource.Properties) {
        const existingPathPart = existingResource.Properties.PathPart;
        const existingParentId = existingResource.Properties.ParentId;
        
        // Check if this resource has the same PathPart AND ParentId
        if (existingPathPart === pathPart && 
            JSON.stringify(existingParentId) === JSON.stringify(parentId)) {
          // Found an existing resource with same PathPart+ParentId - MUST reuse it
          // This prevents CloudFormation errors when updating existing stacks
          existingResourceWithSamePathPartAndParent = existingResourceId;
          console.log(`[http-to-rest] CRITICAL: Found existing resource ${existingResourceId} with same PathPart (${pathPart}) and ParentId. Must reuse it to avoid CloudFormation conflict. Path: ${currentPath}`);
          break;
        }
      }
    }
    
    // If we found an existing resource with the same PathPart+ParentId, we MUST reuse it
    // This is critical for CloudFormation - we cannot create a new resource with the same
    // PathPart+ParentId, even with a different logical ID
    if (existingResourceWithSamePathPartAndParent) {
      pathToResourceId[currentPath] = existingResourceWithSamePathPartAndParent;
      parentResourceId = existingResourceWithSamePathPartAndParent;
      console.log(`[http-to-rest] Reusing existing logical ID ${existingResourceWithSamePathPartAndParent} for PathPart ${pathPart} under parent ${JSON.stringify(parentId)}. Skipping resource creation.`);
      continue;
    }
    
    // CRITICAL: Check if we've already created a resource with this PathPart but different parent
    // If so, we need to differentiate to avoid CloudFormation conflicts
    // IMPORTANT: To preserve compatibility with existing CloudFormation stacks, we need to ensure
    // that resources get the same logical ID they had before. In the original deployment,
    // the webhook route (/api/webhook/:workspaceId/...) was processed and created HTTPWorkspaceIdResource
    // under HTTPWebhookResource. So we need to preserve that naming.
    let needsParentSuffix = false;
    let firstOccurrenceParent = null;
    for (const [existingResourceId, existingResource] of Object.entries(resources)) {
      if (existingResource.Properties && existingResource.Properties.PathPart === pathPart) {
        const existingParentId = existingResource.Properties.ParentId;
        if (JSON.stringify(existingParentId) !== JSON.stringify(parentId)) {
          // Same PathPart, different parent - we need to differentiate
          needsParentSuffix = true;
          // Track which parent got the base name first
          if (existingResourceId === baseResourceId) {
            // Extract parent name from the existing resource
            if (existingParentId.Ref) {
              firstOccurrenceParent = existingParentId.Ref.replace(/^HTTP/, '').replace(/Resource$/, '');
            }
          }
          break;
        }
      }
    }
    
    // Determine the resource ID
    // CRITICAL: Use path-based naming to ensure uniqueness and avoid conflicts with existing CloudFormation resources
    // CloudFormation only cares about PathPart+ParentId uniqueness, not logical ID, so we can use any logical ID
    // By using the full path context, we ensure each resource gets a truly unique logical ID
    // This prevents conflicts when existing resources in CloudFormation have different logical IDs
    let resourceId = baseResourceId;
    
    // Generate a unique resource ID based on the full path context
    // This ensures each PathPart+ParentId combination gets a deterministic but unique logical ID
    // Format: HTTP{PathContext}{SegmentId}Resource
    // PathContext is derived from the parent path to ensure uniqueness
    const pathSegments = currentPath.split('/').filter(Boolean);
    const pathContext = pathSegments
      .slice(0, -1) // Exclude the current segment
      .filter(seg => !seg.startsWith('{')) // Exclude path parameters
      .map(seg => {
        // CRITICAL: CloudFormation resource logical IDs must be alphanumeric
        // Remove all non-alphanumeric characters (including hyphens and underscores)
        // then convert to PascalCase
        const cleaned = seg.replace(/[^a-zA-Z0-9]/g, ' '); // Replace non-alphanumeric with space
        return cleaned
          .split(/\s+/) // Split on whitespace (from replaced chars)
          .filter(Boolean) // Remove empty strings
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join('');
      })
      .join('');
    
    // For path parameters, use a more specific naming scheme based on the full path
    if (pathPart.startsWith('{') && pathPart.endsWith('}')) {
      // Path parameter - use full path context for uniqueness
      let paramName = pathPart.slice(1, -1); // Remove { }
      
      // CRITICAL: CloudFormation resource logical IDs must be alphanumeric (no special characters)
      // Convert {proxy+} to Proxy (remove + and convert to PascalCase)
      // Convert other path parameters to PascalCase
      let paramId;
      if (paramName.endsWith('+')) {
        // Handle {proxy+} - remove + and convert to Proxy
        // For {proxy+}, just use "Proxy" (not "ProxyProxy")
        paramId = 'Proxy';
      } else {
        // Regular path parameter - convert to PascalCase
        paramId = paramName.charAt(0).toUpperCase() + paramName.slice(1);
      }
      
      if (pathContext) {
        // Use path context + parameter name for maximum uniqueness
        // This ensures /api/webhook/{workspaceId}/{agentId} gets HTTPApiWebhookWorkspaceIdAgentIdResource
        // and /api/streams/{workspaceId}/{agentId} gets HTTPApiStreamsWorkspaceIdAgentIdResource
        // and /api/auth/{proxy+} gets HTTPApiAuthProxyProxyResource (or HTTPApiAuthProxyResource)
        resourceId = `HTTP${pathContext}${paramId}Resource`;
      } else {
        // Fallback to parent-based naming if no path context
        resourceId = parentName ? `HTTP${parentName}${paramId}Resource` : baseResourceId;
      }
      
      console.log(`[http-to-rest] Using path-based name ${resourceId} for ${pathPart} (path: ${currentPath}, context: ${pathContext || 'none'})`);
    } else if (needsParentSuffix && parentName) {
      // Special case: {workspaceId} under multiple parents
      // Webhook parent should always get the base name to match existing CloudFormation
      if (pathPart === '{workspaceId}' && parentName === 'Webhook') {
        // Webhook route MUST use HTTPWorkspaceIdResource to match existing stack
        // If base name is already taken by workspaces, we need to rename workspaces to parent-specific
        if (resources[baseResourceId]) {
          // Rename the existing workspaces resource to use parent-specific name
          const existingResource = resources[baseResourceId];
          const workspacesResourceId = `HTTPWorkspaces${segmentId}Resource`;
          // CRITICAL: Check if the existing resource has the wrong parent
          // If it was created under a different parent (e.g., HTTPStreamsResource), we need to update it
          const existingParentId = existingResource.Properties?.ParentId;
          
          // Move the resource to the new ID
          // Create a shallow copy to avoid reference issues
          resources[workspacesResourceId] = {
            ...existingResource,
            Properties: {
              ...existingResource.Properties,
            },
          };
          delete resources[baseResourceId];
          
          // CRITICAL: Determine the correct parent for the renamed resource
          // Check all paths that map to this resource to determine what the correct parent should be
          // The renamed resource should be under HTTPWorkspacesResource ONLY if it's used by /api/workspaces routes
          // If it's used by other routes (e.g., /api/streams), we should NOT rename it or should use a different name
          const workspacesParentId = { Ref: 'HTTPWorkspacesResource' };
          const existingParentRef = existingParentId?.Ref;
          
          // Check if any path mapped to this resource starts with /api/workspaces
          let isUsedByWorkspacesRoute = false;
          for (const [path, rid] of Object.entries(pathToResourceId)) {
            if (rid === baseResourceId && path.startsWith('/api/workspaces/')) {
              isUsedByWorkspacesRoute = true;
              break;
            }
          }
          
          // Only update parent to HTTPWorkspacesResource if it's actually used by workspaces routes
          // If it's used by other routes (e.g., /api/streams), keep the original parent
          if (isUsedByWorkspacesRoute && (!existingParentRef || existingParentRef !== 'HTTPWorkspacesResource')) {
            resources[workspacesResourceId].Properties.ParentId = workspacesParentId;
            console.log(`[http-to-rest] Updated ${workspacesResourceId} ParentId from ${JSON.stringify(existingParentId)} to ${JSON.stringify(workspacesParentId)}`);
          } else if (!isUsedByWorkspacesRoute && existingParentRef === 'HTTPWorkspacesResource') {
            // This resource is NOT used by workspaces routes but has workspaces parent - this is wrong
            // We shouldn't have renamed it in the first place, but if we did, we need to fix it
            // Actually, if it's not used by workspaces, we shouldn't rename it at all
            console.warn(`[http-to-rest] WARNING: ${workspacesResourceId} was renamed but is not used by workspaces routes. This may indicate a bug.`);
          }
          
          // Update pathToResourceId mappings that point to the old ID
          for (const [path, rid] of Object.entries(pathToResourceId)) {
            if (rid === baseResourceId) {
              pathToResourceId[path] = workspacesResourceId;
            }
          }
          // CRITICAL: Update all resources that reference the old resource ID in their ParentId
          for (const [resourceId, resource] of Object.entries(resources)) {
            if (resource.Properties && resource.Properties.ParentId) {
              const parentId = resource.Properties.ParentId;
              if (parentId.Ref === baseResourceId) {
                // Update the ParentId to reference the new resource ID
                resource.Properties.ParentId = { Ref: workspacesResourceId };
                console.log(`[http-to-rest] Updated ${resourceId} ParentId from ${baseResourceId} to ${workspacesResourceId}`);
              }
            }
          }
          console.log(`[http-to-rest] Renamed ${baseResourceId} to ${workspacesResourceId} to preserve ${baseResourceId} for webhook route`);
        }
        // Webhook gets the base name
        resourceId = baseResourceId;
      } else if (pathPart === '{workspaceId}' && parentName === 'Workspaces') {
        // Workspaces route should use parent-specific name to avoid conflict with webhook's base name
        // But only if webhook will also be processed (we can't know for sure, so use parent-specific)
        resourceId = `HTTP${parentName}${segmentId}Resource`;
      } else {
        // For other cases, use parent-specific name
        resourceId = `HTTP${parentName}${segmentId}Resource`;
      }
    }

    // CRITICAL FINAL CHECK: Before creating the resource, verify no duplicate PathPart+ParentId exists
    // This is the last line of defense against CloudFormation errors like:
    // "Another resource with the same parent already has this name: {agentId}"
    // Check ALL resources one more time, including any that might have been created/renamed in this iteration
    // This is especially important because resources might have been renamed or created in previous iterations
    const finalDuplicateCheck = Object.entries(resources).find(
      ([existingResourceId, existingResource]) => {
        if (!existingResource.Properties) return false;
        const existingPathPart = existingResource.Properties.PathPart;
        const existingParentId = existingResource.Properties.ParentId;
        // CRITICAL: Must match BOTH PathPart AND ParentId exactly
        // CloudFormation will fail if two resources have the same PathPart+ParentId, even with different logical IDs
        return existingPathPart === pathPart && 
               JSON.stringify(existingParentId) === JSON.stringify(parentId);
      }
    );

    if (finalDuplicateCheck) {
      const [existingResourceId] = finalDuplicateCheck;
      console.error(`[http-to-rest] ERROR: Attempted to create duplicate resource with PathPart ${pathPart} under parent ${JSON.stringify(parentId)}. Existing resource: ${existingResourceId}. Path: ${currentPath}. Reusing existing resource to prevent CloudFormation conflict.`);
      // CRITICAL: We MUST reuse the existing logical ID, not create a new one
      // CloudFormation is declarative - if we create a new resource with different logical ID but same PathPart+ParentId,
      // CloudFormation will see it as trying to create a duplicate and fail
      pathToResourceId[currentPath] = existingResourceId;
      parentResourceId = existingResourceId;
      continue;
    }
    
    // Ensure unique resource ID (check logical ID uniqueness)
    // With deterministic naming based on parent + segment, conflicts should be rare
    // If a conflict occurs, generate a more specific name using the full path context
    let uniqueResourceId = resourceId;
    if (resources[uniqueResourceId]) {
      // Check if existing resource has same PathPart+ParentId (shouldn't happen due to check above)
      const existingResource = resources[uniqueResourceId];
      if (existingResource.Properties) {
        const existingPathPart = existingResource.Properties.PathPart;
        const existingParentId = existingResource.Properties.ParentId;
        if (existingPathPart === pathPart && 
            JSON.stringify(existingParentId) === JSON.stringify(parentId)) {
          // Same PathPart+ParentId - reuse it (this shouldn't happen but handle gracefully)
          console.warn(`[http-to-rest] WARNING: Resource ${uniqueResourceId} already exists with same PathPart and ParentId. Reusing it.`);
          pathToResourceId[currentPath] = uniqueResourceId;
          parentResourceId = uniqueResourceId;
          continue;
        }
        
        // CRITICAL: If existing resource has different PathPart+ParentId but same logical ID,
        // we need a different logical ID. But FIRST check if ANY resource has the same PathPart+ParentId
        // CloudFormation will fail if we create a resource with same PathPart+ParentId as an existing one
        // even if the logical IDs are different
        const duplicatePathPartParentCheck = Object.entries(resources).find(
          ([checkResourceId, checkResource]) => {
            if (!checkResource.Properties) return false;
            return checkResource.Properties.PathPart === pathPart &&
                   JSON.stringify(checkResource.Properties.ParentId) === JSON.stringify(parentId);
          }
        );
        
        if (duplicatePathPartParentCheck) {
          const [duplicateResourceId] = duplicatePathPartParentCheck;
          console.error(`[http-to-rest] ERROR: Found existing resource ${duplicateResourceId} with same PathPart (${pathPart}) and ParentId. Cannot create ${uniqueResourceId}. Reusing ${duplicateResourceId}.`);
          pathToResourceId[currentPath] = duplicateResourceId;
          parentResourceId = duplicateResourceId;
          continue;
        }
      }
      
      // Different PathPart+ParentId - generate a more specific name using path context
      // Build a deterministic name from the full path segments
      const pathSegments = currentPath.split('/').filter(Boolean);
      const relevantSegments = pathSegments.slice(-3); // Use last 3 segments for context
      const contextName = relevantSegments
        .map(seg => {
          // CRITICAL: CloudFormation resource logical IDs must be alphanumeric
          // Remove all non-alphanumeric characters first
          let normalized = seg
            .replace(/^{(.+)}$/, '$1')
            .replace(/^{(.+)\+}$/, '$1Proxy')
            .replace(/[^a-zA-Z0-9]/g, ' '); // Replace non-alphanumeric with space
          
          // Convert to PascalCase by splitting on whitespace
          return normalized
            .split(/\s+/)
            .filter(Boolean)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
        })
        .join('');
      
      uniqueResourceId = `HTTP${contextName}Resource`;
      
      // If still conflicts, include parent name in the context
      if (resources[uniqueResourceId] && parentName) {
        uniqueResourceId = `HTTP${parentName}${contextName}Resource`;
      }
      
      // Final fallback: use full path hash (should never be needed with proper deterministic naming)
      if (resources[uniqueResourceId]) {
        const pathHash = currentPath
          .split('/')
          .filter(Boolean)
          .map(seg => seg.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10))
          .join('');
        uniqueResourceId = `HTTP${pathHash}Resource`;
        console.warn(`[http-to-rest] Using path hash fallback for resource ID: ${uniqueResourceId} (this should be rare)`);
      }
    }
    
    // ABSOLUTE FINAL CHECK: Before creating the resource, do one last comprehensive scan
    // This is the absolute last line of defense against CloudFormation errors
    // Check ALL resources (including any that might have been created/renamed in this iteration)
    // to ensure we're not creating a duplicate PathPart+ParentId combination
    const absoluteFinalCheck = Object.entries(resources).find(
      ([checkResourceId, checkResource]) => {
        if (!checkResource.Properties || checkResource.Type !== 'AWS::ApiGateway::Resource') {
          return false;
        }
        const checkPathPart = checkResource.Properties.PathPart;
        const checkParentId = checkResource.Properties.ParentId;
        // Must match BOTH PathPart AND ParentId exactly
        // CloudFormation will fail if two resources have the same PathPart+ParentId
        return checkPathPart === pathPart && 
               JSON.stringify(checkParentId) === JSON.stringify(parentId);
      }
    );

    if (absoluteFinalCheck) {
      const [existingResourceId] = absoluteFinalCheck;
      console.error(`[http-to-rest] ABSOLUTE FINAL CHECK: Found existing resource ${existingResourceId} with same PathPart (${pathPart}) and ParentId. Cannot create ${uniqueResourceId}. Reusing ${existingResourceId} to prevent CloudFormation conflict. Path: ${currentPath}`);
      // CRITICAL: We MUST reuse the existing logical ID
      // CloudFormation is declarative - creating a new resource with different logical ID but same PathPart+ParentId will fail
      pathToResourceId[currentPath] = existingResourceId;
      parentResourceId = existingResourceId;
      continue;
    }

    resources[uniqueResourceId] = {
      Type: 'AWS::ApiGateway::Resource',
      Properties: {
        RestApiId: { Ref: restApiId },
        ParentId: parentId,
        PathPart: pathPart,
      },
    };
    
    // Add explicit DependsOn for parent resource if it's a Ref (not GetAtt for root)
    // This ensures CloudFormation creates the parent before the child
    if (parentId && parentId.Ref && parentId.Ref !== 'HTTPRootResource') {
      // Only add DependsOn if the parent resource exists in our resources
      if (resources[parentId.Ref]) {
        resources[uniqueResourceId].DependsOn = [parentId.Ref];
      }
    }

    resourceMap.set(currentPath, uniqueResourceId);
    pathToResourceId[currentPath] = uniqueResourceId;
    
    // If this is a {proxy+} resource, map any path parameter routes to it
    // This handles the case where path parameter routes were skipped because a catchall exists
    if (pathPart === '{proxy+}') {
      const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/{proxy+}'));
      // Find all route paths that should map to this {proxy+} resource (path parameters under the same parent)
      // Check all routes to find path parameter paths under the same parent
      for (const route of allRoutes) {
        const routeKey = route.Properties?.RouteKey || route.RouteKey;
        if (!routeKey) continue;
        const routePath = routeKey.split(' ')[1];
        if (!routePath) continue;
        // Convert to normalized path
        const normalizedRoutePath = convertPathParameters(routePath);
        // Check if this route path is a path parameter path under the same parent
        if (normalizedRoutePath.startsWith(parentPath + '/{') && 
            !normalizedRoutePath.includes('{proxy+}') &&
            normalizedRoutePath !== currentPath) {
          // This is a path parameter path under the same parent - map it to {proxy+}
          pathToResourceId[normalizedRoutePath] = uniqueResourceId;
          console.log(`[http-to-rest] Mapped path parameter route ${normalizedRoutePath} to {proxy+} resource ${uniqueResourceId}. Lambda will handle routing.`);
        }
      }
      // Also check if we found a path parameter earlier in this iteration
      if (foundExistingVariable && foundExistingVariable !== '{proxy+}') {
        const pathParamPath = parentPath + '/{' + foundExistingVariable.replace(/[{}]/g, '') + '}';
        pathToResourceId[pathParamPath] = uniqueResourceId;
        console.log(`[http-to-rest] Mapped path parameter route ${pathParamPath} to {proxy+} resource ${uniqueResourceId}. Lambda will handle routing.`);
      }
    }
    
    parentResourceId = uniqueResourceId;
  }
}

/**
 * Find resource ID for a given path
 * @param {string} path - Path to find resource for
 * @param {Object} pathToResourceId - Path to resource ID mapping
 * @param {Object} resources - Resources object
 * @returns {string|null} Resource logical ID or null if not found
 */
function findResourceForPath(path, pathToResourceId, resources) {
  // Normalize path
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  
  // Direct match
  if (pathToResourceId[normalizedPath]) {
    return pathToResourceId[normalizedPath];
  }

  // Try to find parent resource for proxy paths
  const segments = splitPath(normalizedPath);
  for (let i = segments.length; i > 0; i--) {
    const testPath = '/' + segments.slice(0, i).join('/');
    if (pathToResourceId[testPath]) {
      // Check if this resource has a proxy child
      const resourceId = pathToResourceId[testPath];
      // Look for proxy resource as child
      for (const [resourcePath, id] of Object.entries(pathToResourceId)) {
        if (resourcePath.startsWith(testPath + '/') && resourcePath.includes('{proxy+}')) {
          return id;
        }
      }
      return resourceId;
    }
  }

  // Fallback to root
  return 'HTTPRootResource';
}

/**
 * Print resource hierarchy as a tree for debugging
 * @param {Object} resources - Resources object
 * @param {Object} pathToResourceId - Path to resource ID mapping
 * @param {string} restApiId - REST API resource ID
 */
function printResourceTree(resources, pathToResourceId, restApiId = 'HTTP') {
  console.log('\n[http-to-rest] ========== RESOURCE HIERARCHY TREE ==========');
  
  // Build parent-child relationships
  const childrenMap = new Map(); // parentId -> [childResourceId]
  const resourceToPath = {}; // resourceId -> path
  const resourceToPathPart = {}; // resourceId -> pathPart
  
  // Root resource
  const rootResourceId = 'HTTPRootResource';
  childrenMap.set(rootResourceId, []);
  resourceToPath[rootResourceId] = '/';
  resourceToPathPart[rootResourceId] = 'ROOT';
  
  // Process all resources
  for (const [resourceId, resource] of Object.entries(resources)) {
    if (resource.Type !== 'AWS::ApiGateway::Resource' || !resource.Properties) {
      continue;
    }
    
    const pathPart = resource.Properties.PathPart;
    const parentId = resource.Properties.ParentId;
    
    // Determine parent resource ID
    let parentResourceId = null;
    if (parentId && parentId['Fn::GetAtt']) {
      // Root resource parent
      if (parentId['Fn::GetAtt'][0] === restApiId && parentId['Fn::GetAtt'][1] === 'RootResourceId') {
        parentResourceId = rootResourceId;
      }
    } else if (parentId && parentId.Ref) {
      parentResourceId = parentId.Ref;
    }
    
    // Find path for this resource
    let resourcePath = null;
    for (const [path, rid] of Object.entries(pathToResourceId)) {
      if (rid === resourceId) {
        resourcePath = path;
        break;
      }
    }
    
    resourceToPath[resourceId] = resourcePath || `[unknown:${resourceId}]`;
    resourceToPathPart[resourceId] = pathPart;
    
    // Add to children map
    if (parentResourceId) {
      if (!childrenMap.has(parentResourceId)) {
        childrenMap.set(parentResourceId, []);
      }
      childrenMap.get(parentResourceId).push(resourceId);
    }
  }
  
  // Detect conflicts (multiple variable path parts at same parent)
  const conflicts = [];
  for (const [parentId, children] of childrenMap.entries()) {
    const variableChildren = children.filter(childId => {
      const pathPart = resourceToPathPart[childId];
      return pathPart === '{proxy+}' || (pathPart && pathPart.startsWith('{') && pathPart.endsWith('}'));
    });
    
    if (variableChildren.length > 1) {
      conflicts.push({
        parentId,
        parentPath: resourceToPath[parentId] || '[unknown]',
        children: variableChildren.map(childId => ({
          resourceId: childId,
          pathPart: resourceToPathPart[childId],
          path: resourceToPath[childId] || '[unknown]',
        })),
      });
    }
  }
  
  // Print conflicts first
  if (conflicts.length > 0) {
    console.log('\n⚠️  CONFLICTS DETECTED (multiple variable path parts at same parent):');
    for (const conflict of conflicts) {
      console.log(`\n  Parent: ${conflict.parentId} (${conflict.parentPath})`);
      for (const child of conflict.children) {
        console.log(`    ❌ ${child.resourceId}: ${child.pathPart} (${child.path})`);
      }
    }
    console.log('\n');
  }
  
  // Print tree
  function printNode(resourceId, prefix = '', isLast = true) {
    const pathPart = resourceToPathPart[resourceId] || '[unknown]';
    const path = resourceToPath[resourceId] || '[unknown]';
    const isVariable = pathPart === '{proxy+}' || (pathPart && pathPart.startsWith('{') && pathPart.endsWith('}'));
    const marker = isLast ? '└── ' : '├── ';
    const variableMarker = isVariable ? ' ⚠️' : '';
    
    // Get parent info for debugging
    const resource = resources[resourceId];
    let parentInfo = '';
    if (resource && resource.Properties && resource.Properties.ParentId) {
      const parentId = resource.Properties.ParentId;
      if (parentId['Fn::GetAtt']) {
        parentInfo = ` [parent: ${parentId['Fn::GetAtt'][0]}.${parentId['Fn::GetAtt'][1]}]`;
      } else if (parentId.Ref) {
        parentInfo = ` [parent: ${parentId.Ref}]`;
      }
    }
    
    console.log(`${prefix}${marker}${resourceId}: PathPart="${pathPart}" Path="${path}"${parentInfo}${variableMarker}`);
    
    const children = childrenMap.get(resourceId) || [];
    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    
    for (let i = 0; i < children.length; i++) {
      const isLastChild = i === children.length - 1;
      printNode(children[i], childPrefix, isLastChild);
    }
  }
  
  // Start from root
  printNode(rootResourceId);
  
  // Print summary
  const totalResources = Object.keys(resources).filter(
    id => resources[id].Type === 'AWS::ApiGateway::Resource'
  ).length;
  const variableResources = Object.keys(resources).filter(id => {
    const resource = resources[id];
    if (resource.Type !== 'AWS::ApiGateway::Resource' || !resource.Properties) {
      return false;
    }
    const pathPart = resource.Properties.PathPart;
    return pathPart === '{proxy+}' || (pathPart && pathPart.startsWith('{') && pathPart.endsWith('}'));
  }).length;
  
  console.log('\n[http-to-rest] Summary:');
  console.log(`  Total resources: ${totalResources}`);
  console.log(`  Variable resources ({proxy+} or {param}): ${variableResources}`);
  console.log(`  Conflicts: ${conflicts.length}`);
  console.log('[http-to-rest] ============================================\n');
}

module.exports = {
  createResourceHierarchy,
  findResourceForPath,
  printResourceTree,
};

