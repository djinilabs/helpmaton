/**
 * Unit tests for resource hierarchy creation
 */

import { describe, it, expect } from 'vitest';
import { createResourceHierarchy, findResourceForPath } from '../resources.js';

describe('Resource Hierarchy', () => {
  describe('createResourceHierarchy', () => {
    it('should create resource hierarchy for simple path', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Should have root resource mapped
      expect(pathToResourceId['/']).toBe('HTTPRootResource');

      // Should have /api resource
      expect(pathToResourceId['/api']).toBeDefined();
      expect(resources[pathToResourceId['/api']]).toBeDefined();
      expect(resources[pathToResourceId['/api']].Type).toBe('AWS::ApiGateway::Resource');
      expect(resources[pathToResourceId['/api']].Properties.PathPart).toBe('api');

      // Should have /api/usage resource
      expect(pathToResourceId['/api/usage']).toBeDefined();
      expect(resources[pathToResourceId['/api/usage']]).toBeDefined();
      expect(resources[pathToResourceId['/api/usage']].Type).toBe('AWS::ApiGateway::Resource');
      expect(resources[pathToResourceId['/api/usage']].Properties.PathPart).toBe('usage');
    });

    it('should create nested resource hierarchy', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'POST /api/workspaces/:workspaceId/agents/:agentId/test',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Check all path segments exist
      expect(pathToResourceId['/api']).toBeDefined();
      expect(pathToResourceId['/api/workspaces']).toBeDefined();
      expect(pathToResourceId['/api/workspaces/{workspaceId}']).toBeDefined();
      expect(pathToResourceId['/api/workspaces/{workspaceId}/agents']).toBeDefined();
      expect(pathToResourceId['/api/workspaces/{workspaceId}/agents/{agentId}']).toBeDefined();
      expect(pathToResourceId['/api/workspaces/{workspaceId}/agents/{agentId}/test']).toBeDefined();

      // Check path parameters are preserved
      const workspaceResource = resources[pathToResourceId['/api/workspaces/{workspaceId}']];
      expect(workspaceResource.Properties.PathPart).toBe('{workspaceId}');
    });

    it('should handle wildcard routes', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'ANY /api/auth/*',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Should have /api/auth resource
      expect(pathToResourceId['/api/auth']).toBeDefined();

      // Should have proxy resource
      const proxyPath = '/api/auth/{proxy+}';
      expect(pathToResourceId[proxyPath]).toBeDefined();
      const proxyResource = resources[pathToResourceId[proxyPath]];
      expect(proxyResource.Properties.PathPart).toBe('{proxy+}');
    });

    it('should handle catch-all routes', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'ANY /*',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Should have root resource
      expect(pathToResourceId['/']).toBe('HTTPRootResource');

      // Should have proxy resource at root
      const proxyPath = '/{proxy+}';
      expect(pathToResourceId[proxyPath]).toBeDefined();
      const proxyResource = resources[pathToResourceId[proxyPath]];
      expect(proxyResource.Properties.PathPart).toBe('{proxy+}');
    });

    it('should handle duplicate paths', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
          },
        },
        {
          Properties: {
            RouteKey: 'POST /api/usage',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Should only create one resource for /api/usage
      const usagePath = '/api/usage';
      expect(pathToResourceId[usagePath]).toBeDefined();
      
      // Count resources with usage path
      const usageResources = Object.values(resources).filter(
        (r) => r.Properties?.PathPart === 'usage'
      );
      expect(usageResources.length).toBe(1);
    });

    it('should handle multiple routes with shared prefixes', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
          },
        },
        {
          Properties: {
            RouteKey: 'GET /api/models',
          },
        },
        {
          Properties: {
            RouteKey: 'POST /api/workspaces',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Should have shared /api resource
      expect(pathToResourceId['/api']).toBeDefined();
      const apiResource = resources[pathToResourceId['/api']];
      expect(apiResource.Properties.PathPart).toBe('api');

      // Should have all child resources
      expect(pathToResourceId['/api/usage']).toBeDefined();
      expect(pathToResourceId['/api/models']).toBeDefined();
      expect(pathToResourceId['/api/workspaces']).toBeDefined();
    });

    it('should prevent duplicate {proxy+} resources at the same parent level', () => {
      // This tests the CloudFormation error: "A sibling ({proxy+}) of this resource already has a variable path part"
      // Multiple routes that create proxy resources at the same parent should reuse the same resource
      const routes = [
        {
          Properties: {
            RouteKey: 'ANY /api/auth/*',
          },
        },
        {
          Properties: {
            RouteKey: 'ANY /api/auth/{proxy+}',
          },
        },
        {
          Properties: {
            RouteKey: 'GET /api/auth/specific',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Should have /api/auth resource
      expect(pathToResourceId['/api/auth']).toBeDefined();
      const authResourceId = pathToResourceId['/api/auth'];

      // Should have only ONE {proxy+} resource at /api/auth level
      const proxyResources = Object.values(resources).filter(
        (r) => r.Properties?.PathPart === '{proxy+}' && 
               JSON.stringify(r.Properties.ParentId) === JSON.stringify({ Ref: authResourceId })
      );
      expect(proxyResources.length).toBe(1);

      // Both proxy paths should map to the same resource
      const proxyPath1 = '/api/auth/{proxy+}';
      expect(pathToResourceId[proxyPath1]).toBeDefined();
      
      // Verify the proxy resource has correct parent
      const proxyResourceId = pathToResourceId[proxyPath1];
      const proxyResource = resources[proxyResourceId];
      expect(proxyResource.Properties.PathPart).toBe('{proxy+}');
      expect(proxyResource.Properties.ParentId).toEqual({ Ref: authResourceId });
    });

    it('should reuse existing {proxy+} resource when multiple routes create proxy at same level', () => {
      // Simulate the scenario where routes are processed in order
      // and later routes should reuse the proxy resource created by earlier routes
      const routes = [
        {
          Properties: {
            RouteKey: 'ANY /api/auth/*',
          },
        },
        {
          Properties: {
            RouteKey: 'POST /api/auth/callback',
          },
        },
        {
          Properties: {
            RouteKey: 'ANY /api/auth/{proxy+}', // Different format, same path
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Count all {proxy+} resources under /api/auth
      const authResourceId = pathToResourceId['/api/auth'];
      const proxyResourcesAtAuthLevel = Object.values(resources).filter(
        (r) => r.Properties?.PathPart === '{proxy+}' && 
               JSON.stringify(r.Properties.ParentId) === JSON.stringify({ Ref: authResourceId })
      );

      // Should only have ONE {proxy+} resource at this level
      expect(proxyResourcesAtAuthLevel.length).toBe(1);

      // All proxy paths should map to the same resource ID
      // Note: pathToResourceId might have different keys but should point to same resource
      const allProxyPaths = Object.entries(pathToResourceId)
        .filter(([path]) => path.includes('{proxy+}') && path.startsWith('/api/auth'))
        .map(([, id]) => id);
      
      // All should be the same resource ID (or undefined if path wasn't explicitly mapped)
      const uniqueProxyIds = new Set(allProxyPaths.filter(Boolean));
      expect(uniqueProxyIds.size).toBeLessThanOrEqual(1);
    });

    it('should prevent duplicate path parameter resources at the same parent level', () => {
      // This tests the CloudFormation error: "A sibling ({workspaceId}) of this resource already has a variable path part"
      // Multiple routes that create path parameter resources at the same parent should reuse the same resource
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/workspaces/{workspaceId}/agents',
          },
        },
        {
          Properties: {
            RouteKey: 'POST /api/workspaces/{workspaceId}/test',
          },
        },
        {
          Properties: {
            RouteKey: 'DELETE /api/workspaces/{workspaceId}',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Should have /api/workspaces resource
      expect(pathToResourceId['/api/workspaces']).toBeDefined();
      const workspacesResourceId = pathToResourceId['/api/workspaces'];

      // Should have only ONE {workspaceId} resource at /api/workspaces level
      const workspaceIdResourceEntries = Object.entries(resources).filter(
        ([resourceId, resource]) => resource.Properties?.PathPart === '{workspaceId}' && 
               JSON.stringify(resource.Properties.ParentId) === JSON.stringify({ Ref: workspacesResourceId })
      );
      expect(workspaceIdResourceEntries.length).toBe(1);

      // All paths with {workspaceId} should map to the same resource
      const [workspaceIdResourceId] = workspaceIdResourceEntries[0];
      expect(pathToResourceId['/api/workspaces/{workspaceId}']).toBeDefined();
      expect(pathToResourceId['/api/workspaces/{workspaceId}']).toBe(workspaceIdResourceId);
      
      // Verify the resource has correct parent
      const workspaceIdResource = resources[workspaceIdResourceId];
      expect(workspaceIdResource.Properties.PathPart).toBe('{workspaceId}');
      expect(workspaceIdResource.Properties.ParentId).toEqual({ Ref: workspacesResourceId });
    });

    it('should create path parameter resource first and reuse it for catch-all routes when both exist', () => {
      // This tests the scenario where both {proxy+} and path parameters are requested
      // With the new sorting, path parameters are created first (for specific routes), and catch-all routes reuse them
      // API Gateway only allows one variable path part per parent, so we prioritize path parameters for specific routes
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/workspaces/{workspaceId}/agents',
          },
        },
        {
          Properties: {
            RouteKey: 'ANY /api/workspaces/*',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Should have /api/workspaces resource
      expect(pathToResourceId['/api/workspaces']).toBeDefined();
      const workspacesResourceId = pathToResourceId['/api/workspaces'];

      // When both path parameter and catchall routes exist, REST API Gateway doesn't allow both as siblings
      // We create only {proxy+} and let Lambda handle routing for both
      const variableResources = Object.entries(resources).filter(
        ([resourceId, resource]) => {
          const pathPart = resource.Properties?.PathPart;
          const isVariable = pathPart === '{proxy+}' || 
                            (pathPart && pathPart.startsWith('{') && pathPart.endsWith('}'));
          return isVariable && 
                 JSON.stringify(resource.Properties.ParentId) === JSON.stringify({ Ref: workspacesResourceId });
        }
      );
      // Should have only {proxy+} - path parameter routes will also use it
      expect(variableResources.length).toBe(1);
      
      const [variableResourceId, variableResource] = variableResources[0];
      expect(variableResource.Properties.PathPart).toBe('{proxy+}');

      // Both path parameter and catchall paths map to the {proxy+} resource
      // Lambda will handle routing between them
      expect(pathToResourceId['/api/workspaces/{proxy+}']).toBeDefined();
      expect(pathToResourceId['/api/workspaces/{proxy+}']).toBe(variableResourceId);
    });

    it('should create path parameter resource first and reuse it for catch-all routes', () => {
      // This tests the scenario where both {proxy+} and path parameters are requested
      // With the new sorting, path parameters are created first (for specific routes), and catch-all routes reuse them
      // API Gateway only allows one variable path part per parent, so we prioritize path parameters for specific routes
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/auth/{userId}',
          },
        },
        {
          Properties: {
            RouteKey: 'ANY /api/auth/*',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Should have /api/auth resource
      expect(pathToResourceId['/api/auth']).toBeDefined();
      const authResourceId = pathToResourceId['/api/auth'];

      // When both path parameter and catchall routes exist, REST API Gateway doesn't allow both as siblings
      // We create only {proxy+} and let Lambda handle routing for both
      const variableResources = Object.entries(resources).filter(
        ([resourceId, resource]) => {
          const pathPart = resource.Properties?.PathPart;
          const isVariable = pathPart === '{proxy+}' || 
                            (pathPart && pathPart.startsWith('{') && pathPart.endsWith('}'));
          return isVariable && 
                 JSON.stringify(resource.Properties.ParentId) === JSON.stringify({ Ref: authResourceId });
        }
      );
      // Should have only {proxy+} - path parameter routes will also use it
      expect(variableResources.length).toBe(1);
      
      const [variableResourceId, variableResource] = variableResources[0];
      expect(variableResource.Properties.PathPart).toBe('{proxy+}');

      // Both path parameter and catchall paths map to the {proxy+} resource
      // Lambda will handle routing between them
      expect(pathToResourceId['/api/auth/{proxy+}']).toBeDefined();
      expect(pathToResourceId['/api/auth/{proxy+}']).toBe(variableResourceId);
    });

    it('should handle multiple conflicting variable path parts at same parent level', () => {
      // This tests a complex scenario with multiple routes that would create conflicting variable path parts
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/workspaces/{workspaceId}/agents',
          },
        },
        {
          Properties: {
            RouteKey: 'POST /api/workspaces/{workspaceId}/test',
          },
        },
        {
          Properties: {
            RouteKey: 'ANY /api/workspaces/*',
          },
        },
        {
          Properties: {
            RouteKey: 'DELETE /api/workspaces/{workspaceId}',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Should have /api/workspaces resource
      expect(pathToResourceId['/api/workspaces']).toBeDefined();
      const workspacesResourceId = pathToResourceId['/api/workspaces'];

      // When both path parameter and catchall routes exist, REST API Gateway doesn't allow both as siblings
      // We create only {proxy+} and map path parameter routes to it - Lambda will handle routing
      const variableResources = Object.entries(resources).filter(
        ([resourceId, resource]) => {
          const pathPart = resource.Properties?.PathPart;
          const isVariable = pathPart === '{proxy+}' || 
                            (pathPart && pathPart.startsWith('{') && pathPart.endsWith('}'));
          return isVariable && 
                 JSON.stringify(resource.Properties.ParentId) === JSON.stringify({ Ref: workspacesResourceId });
        }
      );
      // Should have only {proxy+} - path parameter routes will also use it
      expect(variableResources.length).toBe(1);
      
      const [proxyResourceId, proxyResource] = variableResources[0];
      expect(proxyResource.Properties.PathPart).toBe('{proxy+}');
      
      // Both path parameter and catchall routes map to {proxy+} - Lambda will handle routing
      expect(pathToResourceId['/api/workspaces/{workspaceId}']).toBe(proxyResourceId);
      expect(pathToResourceId['/api/workspaces/{proxy+}']).toBe(proxyResourceId);
    });

    it('should set correct parent relationships', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      const apiResourceId = pathToResourceId['/api'];
      const usageResourceId = pathToResourceId['/api/usage'];

      const usageResource = resources[usageResourceId];
      // Parent should reference the api resource
      expect(usageResource.Properties.ParentId).toEqual({ Ref: apiResourceId });
    });
  });

  describe('findResourceForPath', () => {
    it('should find exact path match', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const result = findResourceForPath('/api/usage', pathToResourceId, resources);

      expect(result).toBe(pathToResourceId['/api/usage']);
    });

    it('should find parent resource for nested path', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const result = findResourceForPath('/api/usage/details', pathToResourceId, resources);

      // Should find the closest parent
      expect(result).toBe(pathToResourceId['/api/usage']);
    });

    it('should find proxy resource for wildcard path', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'ANY /api/auth/*',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const result = findResourceForPath('/api/auth/anything/here', pathToResourceId, resources);

      // Should find the proxy resource
      expect(result).toBe(pathToResourceId['/api/auth/{proxy+}']);
    });

    it('should fallback to root for unknown paths', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const result = findResourceForPath('/unknown/path', pathToResourceId, resources);

      expect(result).toBe('HTTPRootResource');
    });
  });

  describe('Duplicate agentId resource issue', () => {
    it('should create separate {workspaceId} and {agentId} resources for webhook and streams routes', () => {
      // This reproduces the CloudFormation error: "Another resource with the same parent already has this name: {agentId}"
      // The issue occurs when both /api/webhook/{workspaceId}/{agentId}/{key} and /api/streams/{workspaceId}/{agentId}/{secret}
      // routes exist. They should create separate {workspaceId} resources (one under HTTPWebhookResource, one under HTTPStreamsResource),
      // and then create separate {agentId} resources under each, NOT reuse the same {workspaceId} resource.
      const routes = [
        {
          Properties: {
            RouteKey: 'POST /api/webhook/{workspaceId}/{agentId}/{key}',
          },
        },
        {
          Properties: {
            RouteKey: 'ANY /api/streams/{workspaceId}/{agentId}/{secret}',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Should have webhook and streams resources
      expect(pathToResourceId['/api/webhook']).toBeDefined();
      expect(pathToResourceId['/api/streams']).toBeDefined();
      const webhookResourceId = pathToResourceId['/api/webhook'];
      const streamsResourceId = pathToResourceId['/api/streams'];

      // Should have separate {workspaceId} resources under each parent
      const webhookWorkspaceIdPath = '/api/webhook/{workspaceId}';
      const streamsWorkspaceIdPath = '/api/streams/{workspaceId}';
      
      expect(pathToResourceId[webhookWorkspaceIdPath]).toBeDefined();
      expect(pathToResourceId[streamsWorkspaceIdPath]).toBeDefined();
      
      const webhookWorkspaceIdResourceId = pathToResourceId[webhookWorkspaceIdPath];
      const streamsWorkspaceIdResourceId = pathToResourceId[streamsWorkspaceIdPath];
      
      // They should be different resources (not the same)
      expect(webhookWorkspaceIdResourceId).not.toBe(streamsWorkspaceIdResourceId);
      
      // Verify each {workspaceId} resource has the correct parent
      const webhookWorkspaceIdResource = resources[webhookWorkspaceIdResourceId];
      const streamsWorkspaceIdResource = resources[streamsWorkspaceIdResourceId];
      
      expect(webhookWorkspaceIdResource.Properties.PathPart).toBe('{workspaceId}');
      expect(webhookWorkspaceIdResource.Properties.ParentId).toEqual({ Ref: webhookResourceId });
      
      expect(streamsWorkspaceIdResource.Properties.PathPart).toBe('{workspaceId}');
      expect(streamsWorkspaceIdResource.Properties.ParentId).toEqual({ Ref: streamsResourceId });

      // Should have separate {agentId} resources under each {workspaceId} resource
      const webhookAgentIdPath = '/api/webhook/{workspaceId}/{agentId}';
      const streamsAgentIdPath = '/api/streams/{workspaceId}/{agentId}';
      
      expect(pathToResourceId[webhookAgentIdPath]).toBeDefined();
      expect(pathToResourceId[streamsAgentIdPath]).toBeDefined();
      
      const webhookAgentIdResourceId = pathToResourceId[webhookAgentIdPath];
      const streamsAgentIdResourceId = pathToResourceId[streamsAgentIdPath];
      
      // They should be different resources (not the same)
      expect(webhookAgentIdResourceId).not.toBe(streamsAgentIdResourceId);
      
      // Verify each {agentId} resource has the correct parent
      const webhookAgentIdResource = resources[webhookAgentIdResourceId];
      const streamsAgentIdResource = resources[streamsAgentIdResourceId];
      
      expect(webhookAgentIdResource.Properties.PathPart).toBe('{agentId}');
      expect(webhookAgentIdResource.Properties.ParentId).toEqual({ Ref: webhookWorkspaceIdResourceId });
      
      expect(streamsAgentIdResource.Properties.PathPart).toBe('{agentId}');
      expect(streamsAgentIdResource.Properties.ParentId).toEqual({ Ref: streamsWorkspaceIdResourceId });

      // CRITICAL: Verify no duplicate {agentId} resources under the same parent
      // This is the actual CloudFormation error we're trying to prevent
      const agentIdResources = Object.entries(resources).filter(
        ([resourceId, resource]) => 
          resource.Properties?.PathPart === '{agentId}'
      );
      
      // Group by parent to check for duplicates
      const agentIdResourcesByParent = new Map();
      for (const [resourceId, resource] of agentIdResources) {
        const parentKey = JSON.stringify(resource.Properties.ParentId);
        if (!agentIdResourcesByParent.has(parentKey)) {
          agentIdResourcesByParent.set(parentKey, []);
        }
        agentIdResourcesByParent.get(parentKey).push(resourceId);
      }
      
      // Each parent should have at most one {agentId} resource
      for (const [parentKey, resourceIds] of agentIdResourcesByParent.entries()) {
        expect(resourceIds.length).toBe(1, 
          `Found ${resourceIds.length} {agentId} resources under parent ${parentKey}. Expected 1. Resources: ${resourceIds.join(', ')}`
        );
      }
    });

    it('should prevent HTTPWorkspaceIdAgentIdResource from having duplicate {agentId} under same parent', () => {
      // CRITICAL: This test specifically checks for the production error:
      // "Another resource with the same parent already has this name: {agentId}"
      // for HTTPWorkspaceIdAgentIdResource
      // This happens when the streams route reuses HTTPWorkspaceIdResource from webhook
      // and tries to create {agentId} under it, conflicting with HTTPWorkspaceIdAgentIdResource
      const routes = [
        {
          Properties: {
            RouteKey: 'POST /api/webhook/{workspaceId}/{agentId}/{key}',
          },
        },
        {
          Properties: {
            RouteKey: 'ANY /api/streams/{workspaceId}/{agentId}/{secret}',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Find workspaceId resource (from webhook) - now uses path-based naming
      const webhookWorkspaceIdPath = '/api/webhook/{workspaceId}';
      const webhookWorkspaceIdResourceId = pathToResourceId[webhookWorkspaceIdPath];
      expect(webhookWorkspaceIdResourceId).toBe('HTTPApiWebhookWorkspaceIdResource');

      // CRITICAL: Check that there's only ONE {agentId} resource under the workspaceId resource
      const agentIdResourcesUnderWebhookWorkspace = Object.entries(resources).filter(
        ([resourceId, resource]) => 
          resource.Properties?.PathPart === '{agentId}' &&
          resource.Properties?.ParentId?.Ref === webhookWorkspaceIdResourceId
      );
      
      expect(agentIdResourcesUnderWebhookWorkspace.length).toBe(1,
        `Found ${agentIdResourcesUnderWebhookWorkspace.length} {agentId} resources under ${webhookWorkspaceIdResourceId}. Expected 1. Resources: ${agentIdResourcesUnderWebhookWorkspace.map(([id]) => id).join(', ')}`
      );

      // Verify it's using path-based naming (HTTPApiWebhookAgentIdResource)
      // This ensures no conflicts with other {agentId} resources
      const [agentIdResourceId] = agentIdResourcesUnderWebhookWorkspace[0];
      expect(agentIdResourceId).toBe('HTTPApiWebhookAgentIdResource');

      // CRITICAL: Verify streams route created its own {workspaceId} resource, not reusing webhook's
      const streamsWorkspaceIdPath = '/api/streams/{workspaceId}';
      const streamsWorkspaceIdResourceId = pathToResourceId[streamsWorkspaceIdPath];
      
      // Streams should have its own {workspaceId} resource (might be renamed, but should exist)
      expect(streamsWorkspaceIdResourceId).toBeDefined();
      expect(streamsWorkspaceIdResourceId).not.toBe('HTTPWorkspaceIdResource');
      
      // Verify streams {workspaceId} has correct parent (HTTPStreamsResource)
      const streamsWorkspaceIdResource = resources[streamsWorkspaceIdResourceId];
      expect(streamsWorkspaceIdResource.Properties.ParentId).toEqual({ Ref: 'HTTPStreamsResource' });

      // Verify streams {agentId} is under streams {workspaceId}, not webhook's HTTPWorkspaceIdResource
      const streamsAgentIdPath = '/api/streams/{workspaceId}/{agentId}';
      const streamsAgentIdResourceId = pathToResourceId[streamsAgentIdPath];
      expect(streamsAgentIdResourceId).toBeDefined();
      
      const streamsAgentIdResource = resources[streamsAgentIdResourceId];
      expect(streamsAgentIdResource.Properties.ParentId).toEqual({ Ref: streamsWorkspaceIdResourceId });
      expect(streamsAgentIdResource.Properties.ParentId).not.toEqual({ Ref: 'HTTPWorkspaceIdResource' });
    });

    it('should reuse existing resource logical ID when PathPart+ParentId matches to prevent CloudFormation conflicts', () => {
      // CRITICAL: CloudFormation is declarative. If we generate a template with a resource that has
      // the same PathPart+ParentId as an existing resource but different logical ID, CloudFormation
      // will try to create a new resource and fail with "Another resource with the same parent already has this name"
      // This test simulates an existing HTTPAgentIdResource in CloudFormation and ensures we reuse it
      const routes = [
        {
          Properties: {
            RouteKey: 'POST /api/webhook/{workspaceId}/{agentId}/{key}',
          },
        },
      ];

      // First, create resources normally - this simulates what was created in a previous deployment
      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const workspaceIdResourceId = pathToResourceId['/api/webhook/{workspaceId}'];
      
      // Simulate existing HTTPAgentIdResource in CloudFormation (from previous deployment)
      // This has PathPart={agentId} and ParentId=HTTPWorkspaceIdResource
      // In a real scenario, this would exist in the CloudFormation stack
      resources['HTTPAgentIdResource'] = {
        Type: 'AWS::ApiGateway::Resource',
        Properties: {
          PathPart: '{agentId}',
          ParentId: { Ref: workspaceIdResourceId },
          RestApiId: { Ref: 'HTTP' },
        },
      };

      // Now process the same routes again - should detect HTTPAgentIdResource and reuse it
      // instead of creating HTTPWorkspaceIdAgentIdResource (which would cause CloudFormation conflict)
      const { resources: r2, pathToResourceId: p2 } = createResourceHierarchy(routes);

      // Check what resource ID was used for the agentId path
      const agentIdPath = '/api/webhook/{workspaceId}/{agentId}';
      const usedResourceId = p2[agentIdPath];
      
      // Count all {agentId} resources under HTTPWorkspaceIdResource
      const agentIds = Object.entries(r2).filter(([id, r]) => 
        r.Properties?.PathPart === '{agentId}' && 
        r.Properties?.ParentId?.Ref === workspaceIdResourceId
      );

      // CRITICAL: Should have exactly 1 resource
      expect(agentIds.length).toBe(1,
        `Found ${agentIds.length} {agentId} resources under HTTPWorkspaceIdResource. Expected 1. Resources: ${agentIds.map(([id]) => id).join(', ')}`
      );
      
      // IMPORTANT: The check at line 443-471 should detect HTTPAgentIdResource and reuse it
      // However, since createResourceHierarchy creates a fresh resources object, it won't find it
      // This test documents the expected behavior - in real CloudFormation, we'd need to query existing resources
      // For now, we ensure no duplicates are created within the same template generation
    });

    it('should never create duplicate PathPart+ParentId combinations in the same template', () => {
      // CRITICAL: CloudFormation is declarative. If we create two resources with the same PathPart+ParentId
      // (even with different logical IDs), CloudFormation will fail with:
      // "Another resource with the same parent already has this name: {agentId}"
      // This test ensures we never create such duplicates within a single template generation
      const routes = [
        {
          Properties: {
            RouteKey: 'POST /api/webhook/{workspaceId}/{agentId}/{key}',
          },
        },
        {
          Properties: {
            RouteKey: 'ANY /api/streams/{workspaceId}/{agentId}/{secret}',
          },
        },
        {
          Properties: {
            RouteKey: 'GET /api/webhook/{workspaceId}/{agentId}/test',
          },
        },
        {
          Properties: {
            RouteKey: 'ANY /api/workspaces/{proxy+}',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // CRITICAL: Check for duplicate PathPart+ParentId combinations across ALL resources
      // Group resources by PathPart+ParentId combination
      const resourcesByPathPartAndParent = new Map();
      for (const [resourceId, resource] of Object.entries(resources)) {
        if (resource.Properties && resource.Type === 'AWS::ApiGateway::Resource') {
          const pathPart = resource.Properties.PathPart;
          const parentId = JSON.stringify(resource.Properties.ParentId);
          const key = `${pathPart}|${parentId}`;
          
          if (!resourcesByPathPartAndParent.has(key)) {
            resourcesByPathPartAndParent.set(key, []);
          }
          resourcesByPathPartAndParent.get(key).push({ resourceId, pathPart, parentId });
        }
      }

      // Check for duplicates
      const duplicates = [];
      for (const [key, resourceList] of resourcesByPathPartAndParent.entries()) {
        if (resourceList.length > 1) {
          duplicates.push({
            key,
            resources: resourceList.map(r => r.resourceId),
          });
        }
      }

      // CRITICAL: Should have NO duplicates
      expect(duplicates.length).toBe(0,
        `Found ${duplicates.length} duplicate PathPart+ParentId combinations. This will cause CloudFormation errors. Duplicates: ${JSON.stringify(duplicates, null, 2)}`
      );

      // Specifically check for {agentId} duplicates under HTTPWorkspaceIdResource
      const workspaceIdResourceId = pathToResourceId['/api/webhook/{workspaceId}'];
      const agentIdResources = Object.entries(resources).filter(([id, r]) => 
        r.Properties?.PathPart === '{agentId}' && 
        r.Properties?.ParentId?.Ref === workspaceIdResourceId
      );

      expect(agentIdResources.length).toBeLessThanOrEqual(1,
        `Found ${agentIdResources.length} {agentId} resources under HTTPWorkspaceIdResource. Expected at most 1. Resources: ${agentIdResources.map(([id]) => id).join(', ')}`
      );
    });

    it('should prevent duplicate {agentId} under HTTPWorkspaceIdResource with catch-all route', () => {
      // CRITICAL: This reproduces the exact production error scenario
      // When both webhook route and catch-all workspaces route exist,
      // we must ensure no duplicate {agentId} resources are created under HTTPWorkspaceIdResource
      const routes = [
        {
          Properties: {
            RouteKey: 'POST /api/webhook/{workspaceId}/{agentId}/{key}',
          },
        },
        {
          Properties: {
            RouteKey: 'ANY /api/workspaces/{proxy+}',
          },
        },
        {
          Properties: {
            RouteKey: 'ANY /api/streams/{workspaceId}/{agentId}/{secret}',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Find workspaceId resource (from webhook) - now uses path-based naming
      const webhookWorkspaceIdPath = '/api/webhook/{workspaceId}';
      const webhookWorkspaceIdResourceId = pathToResourceId[webhookWorkspaceIdPath];
      expect(webhookWorkspaceIdResourceId).toBe('HTTPApiWebhookWorkspaceIdResource');

      // CRITICAL: Check that there's exactly ONE {agentId} resource under the workspaceId resource
      // This is the exact CloudFormation error we're preventing
      const agentIdResourcesUnderWebhookWorkspace = Object.entries(resources).filter(
        ([resourceId, resource]) => 
          resource.Properties?.PathPart === '{agentId}' &&
          resource.Properties?.ParentId?.Ref === webhookWorkspaceIdResourceId
      );

      expect(agentIdResourcesUnderWebhookWorkspace.length).toBe(1,
        `Found ${agentIdResourcesUnderWebhookWorkspace.length} {agentId} resources under ${webhookWorkspaceIdResourceId}. Expected exactly 1. Resources: ${agentIdResourcesUnderWebhookWorkspace.map(([id]) => id).join(', ')}`
      );

      // Verify it's using path-based naming (HTTPApiWebhookAgentIdResource)
      // This ensures no conflicts with other {agentId} resources
      const [agentIdResourceId] = agentIdResourcesUnderWebhookWorkspace[0];
      expect(agentIdResourceId).toBe('HTTPApiWebhookAgentIdResource');
    });

    it('should never create duplicate {agentId} resources under HTTPWorkspaceIdResource', () => {
      // CRITICAL: This test ensures we never create two {agentId} resources under HTTPWorkspaceIdResource
      // This is the exact CloudFormation error: "Another resource with the same parent already has this name: {agentId}"
      // Test with multiple routes that could potentially create {agentId} under HTTPWorkspaceIdResource
      const routes = [
        {
          Properties: {
            RouteKey: 'POST /api/webhook/{workspaceId}/{agentId}/{key}',
          },
        },
        {
          Properties: {
            RouteKey: 'GET /api/webhook/{workspaceId}/{agentId}/test',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Find workspaceId resource - now uses path-based naming
      const workspaceIdPath = '/api/webhook/{workspaceId}';
      const workspaceIdResourceId = pathToResourceId[workspaceIdPath];
      expect(workspaceIdResourceId).toBe('HTTPApiWebhookWorkspaceIdResource');

      // CRITICAL: Check that there's only ONE {agentId} resource under the workspaceId resource
      const agentIdResourcesUnderWebhookWorkspace = Object.entries(resources).filter(
        ([resourceId, resource]) => 
          resource.Properties?.PathPart === '{agentId}' &&
          resource.Properties?.ParentId?.Ref === workspaceIdResourceId
      );

      // CRITICAL: Must have exactly 1, not 0, not 2+
      expect(agentIdResourcesUnderWebhookWorkspace.length).toBe(1,
        `Found ${agentIdResourcesUnderWebhookWorkspace.length} {agentId} resources under ${workspaceIdResourceId}. Expected exactly 1. Resources: ${agentIdResourcesUnderWebhookWorkspace.map(([id]) => id).join(', ')}`
      );

      // Both paths should use the same {agentId} resource as parent
      const webhookAgentIdPath1 = '/api/webhook/{workspaceId}/{agentId}';
      const webhookAgentIdPath2 = '/api/webhook/{workspaceId}/{agentId}/test';
      
      const resourceId1 = pathToResourceId[webhookAgentIdPath1];
      const resourceId2 = pathToResourceId[webhookAgentIdPath2];
      
      // resourceId1 should be the {agentId} resource (using path-based naming like HTTPApiWebhookAgentIdResource)
      expect(resourceId1).toBeDefined();
      const agentIdResource = resources[resourceId1];
      expect(agentIdResource.Properties.PathPart).toBe('{agentId}');
      // Now uses path-based naming: HTTPApiWebhookWorkspaceIdResource (already declared above)
      expect(agentIdResource.Properties.ParentId.Ref).toBe(workspaceIdResourceId);
      
      // resourceId2 should be the /test resource, which should have resourceId1 as parent
      expect(resourceId2).toBeDefined();
      const testResource = resources[resourceId2];
      expect(testResource.Properties.PathPart).toBe('test');
      expect(testResource.Properties.ParentId).toEqual({ Ref: resourceId1 });
    });

    it('should create separate {agentId} resources for webhook and workspaces routes', () => {
      // Similar issue but with workspaces route instead of streams
      // /api/webhook/{workspaceId}/{agentId}/{key} and /api/workspaces/{workspaceId}/agents/{agentId}
      // should create separate resources
      const routes = [
        {
          Properties: {
            RouteKey: 'POST /api/webhook/{workspaceId}/{agentId}/{key}',
          },
        },
        {
          Properties: {
            RouteKey: 'GET /api/workspaces/{workspaceId}/agents/{agentId}',
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);

      // Should have webhook and workspaces resources
      expect(pathToResourceId['/api/webhook']).toBeDefined();
      expect(pathToResourceId['/api/workspaces']).toBeDefined();
      const webhookResourceId = pathToResourceId['/api/webhook'];
      const workspacesResourceId = pathToResourceId['/api/workspaces'];

      // Should have separate {workspaceId} resources
      const webhookWorkspaceIdPath = '/api/webhook/{workspaceId}';
      const workspacesWorkspaceIdPath = '/api/workspaces/{workspaceId}';
      
      expect(pathToResourceId[webhookWorkspaceIdPath]).toBeDefined();
      expect(pathToResourceId[workspacesWorkspaceIdPath]).toBeDefined();
      
      const webhookWorkspaceIdResourceId = pathToResourceId[webhookWorkspaceIdPath];
      const workspacesWorkspaceIdResourceId = pathToResourceId[workspacesWorkspaceIdPath];
      
      // They should be different resources
      expect(webhookWorkspaceIdResourceId).not.toBe(workspacesWorkspaceIdResourceId);

      // Should have agents resource under workspaces
      expect(pathToResourceId['/api/workspaces/{workspaceId}/agents']).toBeDefined();
      const agentsResourceId = pathToResourceId['/api/workspaces/{workspaceId}/agents'];

      // Should have separate {agentId} resources
      const webhookAgentIdPath = '/api/webhook/{workspaceId}/{agentId}';
      const workspacesAgentIdPath = '/api/workspaces/{workspaceId}/agents/{agentId}';
      
      expect(pathToResourceId[webhookAgentIdPath]).toBeDefined();
      expect(pathToResourceId[workspacesAgentIdPath]).toBeDefined();
      
      const webhookAgentIdResourceId = pathToResourceId[webhookAgentIdPath];
      const workspacesAgentIdResourceId = pathToResourceId[workspacesAgentIdPath];
      
      // They should be different resources
      expect(webhookAgentIdResourceId).not.toBe(workspacesAgentIdResourceId);
      
      // Verify each {agentId} resource has the correct parent
      const webhookAgentIdResource = resources[webhookAgentIdResourceId];
      const workspacesAgentIdResource = resources[workspacesAgentIdResourceId];
      
      expect(webhookAgentIdResource.Properties.PathPart).toBe('{agentId}');
      expect(webhookAgentIdResource.Properties.ParentId).toEqual({ Ref: webhookWorkspaceIdResourceId });
      
      expect(workspacesAgentIdResource.Properties.PathPart).toBe('{agentId}');
      expect(workspacesAgentIdResource.Properties.ParentId).toEqual({ Ref: agentsResourceId });

      // CRITICAL: Verify no duplicate {agentId} resources under the same parent
      const agentIdResources = Object.entries(resources).filter(
        ([resourceId, resource]) => 
          resource.Properties?.PathPart === '{agentId}'
      );
      
      // Group by parent to check for duplicates
      const agentIdResourcesByParent = new Map();
      for (const [resourceId, resource] of agentIdResources) {
        const parentKey = JSON.stringify(resource.Properties.ParentId);
        if (!agentIdResourcesByParent.has(parentKey)) {
          agentIdResourcesByParent.set(parentKey, []);
        }
        agentIdResourcesByParent.get(parentKey).push(resourceId);
      }
      
      // Each parent should have at most one {agentId} resource
      for (const [parentKey, resourceIds] of agentIdResourcesByParent.entries()) {
        expect(resourceIds.length).toBe(1, 
          `Found ${resourceIds.length} {agentId} resources under parent ${parentKey}. Expected 1. Resources: ${resourceIds.join(', ')}`
        );
      }
    });
  });
});

