/**
 * Unit tests for method creation
 */

import { describe, it, expect } from 'vitest';
import { createMethods, convertIntegrationUri } from '../methods.js';
import { createResourceHierarchy } from '../resources.js';

describe('Method Creation', () => {
  describe('createMethods', () => {
    it('should create method for GET route', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
            Target: 'integrations/GetApiUsageHTTPIntegration',
          },
        },
      ];

      const integrations = {
        GetApiUsageHTTPIntegration: {
          Properties: {
            IntegrationUri: {
              'Fn::Sub': [
                'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${FunctionArn}/invocations',
                {
                  FunctionArn: { 'Fn::GetAtt': ['GetApiUsageHTTPLambda', 'Arn'] },
                },
              ],
            },
          },
        },
      };

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods, methodDependencies } = createMethods(
        routes,
        integrations,
        pathToResourceId,
        resources
      );

      expect(methodDependencies.length).toBeGreaterThan(0);
      
      // Find the GET method
      const method = Object.values(methods).find(
        (m) => m.Properties.HttpMethod === 'GET'
      );
      
      expect(method).toBeDefined();
      expect(method.Type).toBe('AWS::ApiGateway::Method');
      expect(method.Properties.HttpMethod).toBe('GET');
      expect(method.Properties.Integration.Type).toBe('AWS_PROXY');
      expect(method.Properties.Integration.IntegrationHttpMethod).toBe('POST');
    });

    it('should create method for POST route', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'POST /api/webhook/:workspaceId/:agentId/:key',
            Target: 'integrations/PostApiWebhookWorkspaceIdAgentIdKeyHTTPIntegration',
          },
        },
      ];

      const integrations = {
        PostApiWebhookWorkspaceIdAgentIdKeyHTTPIntegration: {
          Properties: {
            IntegrationUri: {
              'Fn::Sub': [
                'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${FunctionArn}/invocations',
                {
                  FunctionArn: { 'Fn::GetAtt': ['PostApiWebhookWorkspaceIdAgentIdKeyHTTPLambda', 'Arn'] },
                },
              ],
            },
          },
        },
      };

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, integrations, pathToResourceId, resources);

      const method = Object.values(methods).find(
        (m) => m.Properties.HttpMethod === 'POST'
      );

      expect(method).toBeDefined();
      expect(method.Properties.HttpMethod).toBe('POST');
    });

    it('should expand ANY method to all HTTP methods', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'ANY /api/discord',
            Target: 'integrations/AnyApiDiscordHTTPIntegration',
          },
        },
      ];

      const integrations = {
        AnyApiDiscordHTTPIntegration: {
          Properties: {
            IntegrationUri: {
              'Fn::Sub': [
                'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${FunctionArn}/invocations',
                {
                  FunctionArn: { 'Fn::GetAtt': ['AnyApiDiscordHTTPLambda', 'Arn'] },
                },
              ],
            },
          },
        },
      };

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, integrations, pathToResourceId, resources);

      const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
      
      for (const httpMethod of httpMethods) {
        const method = Object.values(methods).find(
          (m) => m.Properties.HttpMethod === httpMethod
        );
        expect(method).toBeDefined();
        expect(method.Properties.HttpMethod).toBe(httpMethod);
      }
    });

    it('should map integration URI correctly', () => {
      const integrationUri = {
        'Fn::Sub': [
          'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${FunctionArn}/invocations',
          {
            FunctionArn: { 'Fn::GetAtt': ['GetApiUsageHTTPLambda', 'Arn'] },
          },
        ],
      };

      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
            Target: 'integrations/GetApiUsageHTTPIntegration',
          },
        },
      ];

      const integrations = {
        GetApiUsageHTTPIntegration: {
          Properties: {
            IntegrationUri: integrationUri,
          },
        },
      };

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, integrations, pathToResourceId, resources);

      const method = Object.values(methods).find(
        (m) => m.Properties.HttpMethod === 'GET'
      );

      expect(method.Properties.Integration.Uri).toEqual(integrationUri);
    });

    it('should handle routes with string target', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
            Target: 'integrations/GetApiUsageHTTPIntegration',
          },
        },
      ];

      const integrations = {
        GetApiUsageHTTPIntegration: {
          Properties: {
            IntegrationUri: {
              'Fn::Sub': [
                'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${FunctionArn}/invocations',
                {
                  FunctionArn: { 'Fn::GetAtt': ['GetApiUsageHTTPLambda', 'Arn'] },
                },
              ],
            },
          },
        },
      };

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, integrations, pathToResourceId, resources);

      expect(Object.keys(methods).length).toBeGreaterThan(0);
    });

    it('should handle routes with Ref target', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
            Target: {
              Ref: 'GetApiUsageHTTPIntegration',
            },
          },
        },
      ];

      const integrations = {
        GetApiUsageHTTPIntegration: {
          Properties: {
            IntegrationUri: {
              'Fn::Sub': [
                'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${FunctionArn}/invocations',
                {
                  FunctionArn: { 'Fn::GetAtt': ['GetApiUsageHTTPLambda', 'Arn'] },
                },
              ],
            },
          },
        },
      };

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, integrations, pathToResourceId, resources);

      expect(Object.keys(methods).length).toBeGreaterThan(0);
    });

    it('should convert OpenAPI string Fn::Sub URI format to REST API array format for Integration resources', () => {
      // This tests the fix where Integration resources with string Fn::Sub format are converted
      // OpenAPI format: { "Fn::Sub": "arn:.../${FunctionName.Arn}/..." }
      // REST API format: { "Fn::Sub": ["arn:.../${Var}/...", { Var: { "Fn::GetAtt": ["FunctionName", "Arn"] } }] }
      const openApiFormatUri = {
        'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetApiUsageHTTPLambda.Arn}/invocations'
      };

      const expectedRestApiFormatUri = {
        'Fn::Sub': [
          'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetApiUsageHTTPLambdaArn}/invocations',
          {
            GetApiUsageHTTPLambdaArn: { 'Fn::GetAtt': ['GetApiUsageHTTPLambda', 'Arn'] }
          }
        ]
      };

      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
            Target: 'integrations/GetApiUsageHTTPIntegration',
          },
        },
      ];

      const integrations = {
        GetApiUsageHTTPIntegration: {
          Properties: {
            IntegrationUri: openApiFormatUri,
          },
        },
      };

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, integrations, pathToResourceId, resources);

      const method = Object.values(methods).find(
        (m) => m.Properties.HttpMethod === 'GET'
      );

      expect(method).toBeDefined();
      // Verify the URI was converted from OpenAPI string format to REST API array format
      expect(method.Properties.Integration.Uri).toEqual(expectedRestApiFormatUri);
      // Verify it's not the original OpenAPI format
      expect(method.Properties.Integration.Uri).not.toEqual(openApiFormatUri);
    });

    it('should convert OpenAPI string Fn::Sub URI format when using Ref target', () => {
      // Test the same conversion when route uses Ref target instead of string target
      const openApiFormatUri = {
        'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${PostApiWebhookHTTPLambda.Arn}/invocations'
      };

      const expectedRestApiFormatUri = {
        'Fn::Sub': [
          'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${PostApiWebhookHTTPLambdaArn}/invocations',
          {
            PostApiWebhookHTTPLambdaArn: { 'Fn::GetAtt': ['PostApiWebhookHTTPLambda', 'Arn'] }
          }
        ]
      };

      const routes = [
        {
          Properties: {
            RouteKey: 'POST /api/webhook',
            Target: {
              Ref: 'PostApiWebhookHTTPIntegration',
            },
          },
        },
      ];

      const integrations = {
        PostApiWebhookHTTPIntegration: {
          Properties: {
            IntegrationUri: openApiFormatUri,
          },
        },
      };

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, integrations, pathToResourceId, resources);

      const method = Object.values(methods).find(
        (m) => m.Properties.HttpMethod === 'POST'
      );

      expect(method).toBeDefined();
      // Verify the URI was converted from OpenAPI string format to REST API array format
      expect(method.Properties.Integration.Uri).toEqual(expectedRestApiFormatUri);
    });

    it('should preserve already-converted array Fn::Sub URI format', () => {
      // Test that URIs already in REST API format are not modified
      const alreadyConvertedUri = {
        'Fn::Sub': [
          'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${FunctionArn}/invocations',
          {
            FunctionArn: { 'Fn::GetAtt': ['GetApiUsageHTTPLambda', 'Arn'] },
          },
        ],
      };

      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
            Target: 'integrations/GetApiUsageHTTPIntegration',
          },
        },
      ];

      const integrations = {
        GetApiUsageHTTPIntegration: {
          Properties: {
            IntegrationUri: alreadyConvertedUri,
          },
        },
      };

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, integrations, pathToResourceId, resources);

      const method = Object.values(methods).find(
        (m) => m.Properties.HttpMethod === 'GET'
      );

      expect(method).toBeDefined();
      // Verify the URI was preserved as-is (not double-converted)
      expect(method.Properties.Integration.Uri).toEqual(alreadyConvertedUri);
    });

    it('should convert array Fn::Sub URI format that still contains .Arn patterns', () => {
      // Test the fix where URIs are already in array format but still contain .Arn patterns
      // This can happen if a previous conversion was incomplete or incorrect
      // OpenAPI format incorrectly converted: { "Fn::Sub": ["arn:.../${FunctionName.Arn}/...", {}] }
      // Should be converted to: { "Fn::Sub": ["arn:.../${Var}/...", { Var: { "Fn::GetAtt": ["FunctionName", "Arn"] } }] }
      const incorrectlyConvertedUri = {
        'Fn::Sub': [
          'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetApiUsageHTTPLambda.Arn}/invocations',
          {}, // Empty variables object - this is the bug scenario
        ],
      };

      const expectedRestApiFormatUri = {
        'Fn::Sub': [
          'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetApiUsageHTTPLambdaArn}/invocations',
          {
            GetApiUsageHTTPLambdaArn: { 'Fn::GetAtt': ['GetApiUsageHTTPLambda', 'Arn'] },
          },
        ],
      };

      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
            Target: 'integrations/GetApiUsageHTTPIntegration',
          },
        },
      ];

      const integrations = {
        GetApiUsageHTTPIntegration: {
          Properties: {
            IntegrationUri: incorrectlyConvertedUri,
          },
        },
      };

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, integrations, pathToResourceId, resources);

      const method = Object.values(methods).find(
        (m) => m.Properties.HttpMethod === 'GET'
      );

      expect(method).toBeDefined();
      // Verify the URI was converted from array format with .Arn to proper REST API format
      expect(method.Properties.Integration.Uri).toEqual(expectedRestApiFormatUri);
      // Verify .Arn pattern was removed from the string
      expect(method.Properties.Integration.Uri['Fn::Sub'][0]).not.toContain('.Arn');
      // Verify it's not the original incorrectly converted format
      expect(method.Properties.Integration.Uri).not.toEqual(incorrectlyConvertedUri);
    });

    it('should handle HTTP proxy integrations without converting URIs', () => {
      // Test that HTTP proxy integrations (e.g., S3 proxy) preserve URIs as-is
      // and use HTTP_PROXY type instead of AWS_PROXY
      const httpProxyUri = {
        'Fn::Sub': [
          'https://${bukkit}.s3.${AWS::Region}.amazonaws.com/{proxy}',
          {
            bukkit: {
              Ref: 'StaticBucket',
            },
          },
        ],
      };

      const routes = [
        {
          Properties: {
            RouteKey: 'GET /{proxy+}',
          },
          _integration: {
            type: 'http_proxy',
            uri: httpProxyUri,
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, {}, pathToResourceId, resources);

      const method = Object.values(methods).find(
        (m) => m.Properties.HttpMethod === 'GET'
      );

      expect(method).toBeDefined();
      // Verify integration type is HTTP_PROXY, not AWS_PROXY
      expect(method.Properties.Integration.Type).toBe('HTTP_PROXY');
      // Verify URI is preserved as-is (not converted as Lambda ARN)
      expect(method.Properties.Integration.Uri).toEqual(httpProxyUri);
      // Verify IntegrationHttpMethod matches the HTTP method (not hardcoded to POST)
      expect(method.Properties.Integration.IntegrationHttpMethod).toBe('GET');
    });

    it('should handle HTTP integrations (non-proxy) correctly', () => {
      // Test that HTTP integrations (not HTTP_PROXY) also preserve URIs
      const httpUri = 'https://example.com/api';

      const routes = [
        {
          Properties: {
            RouteKey: 'POST /api/external',
          },
          _integration: {
            type: 'http',
            uri: httpUri,
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, {}, pathToResourceId, resources);

      const method = Object.values(methods).find(
        (m) => m.Properties.HttpMethod === 'POST'
      );

      expect(method).toBeDefined();
      // Verify integration type is HTTP
      expect(method.Properties.Integration.Type).toBe('HTTP');
      // Verify URI is preserved as-is
      expect(method.Properties.Integration.Uri).toBe(httpUri);
      // Verify IntegrationHttpMethod matches the HTTP method
      expect(method.Properties.Integration.IntegrationHttpMethod).toBe('POST');
    });

    it('should still convert Lambda ARN URIs for AWS_PROXY integrations', () => {
      // Test that Lambda integrations still get ARN conversion
      const openApiFormatUri = {
        'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${TestLambda.Arn}/invocations',
      };

      const expectedRestApiFormatUri = {
        'Fn::Sub': [
          'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${TestLambdaArn}/invocations',
          {
            TestLambdaArn: { 'Fn::GetAtt': ['TestLambda', 'Arn'] },
          },
        ],
      };

      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/test',
          },
          _integration: {
            type: 'aws_proxy',
            uri: openApiFormatUri,
          },
        },
      ];

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, {}, pathToResourceId, resources);

      const method = Object.values(methods).find(
        (m) => m.Properties.HttpMethod === 'GET'
      );

      expect(method).toBeDefined();
      // Verify integration type is AWS_PROXY
      expect(method.Properties.Integration.Type).toBe('AWS_PROXY');
      // Verify URI was converted from string to array format
      expect(method.Properties.Integration.Uri).toEqual(expectedRestApiFormatUri);
      // Verify IntegrationHttpMethod is POST for AWS_PROXY
      expect(method.Properties.Integration.IntegrationHttpMethod).toBe('POST');
    });

    it('should set authorization type to NONE when no authorizer', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'GET /api/usage',
            Target: {
              Ref: 'GetApiUsageHTTPIntegration',
            },
          },
        },
      ];

      const integrations = {
        GetApiUsageHTTPIntegration: {
          Properties: {
            IntegrationUri: {
              'Fn::Sub': [
                'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${FunctionArn}/invocations',
                {
                  FunctionArn: { 'Fn::GetAtt': ['GetApiUsageHTTPLambda', 'Arn'] },
                },
              ],
            },
          },
        },
      };

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, integrations, pathToResourceId, resources);

      const method = Object.values(methods).find(
        (m) => m.Properties.HttpMethod === 'GET'
      );

      expect(method.Properties.AuthorizationType).toBe('NONE');
      expect(method.Properties.AuthorizerId).toBeUndefined();
    });

    it('should handle catch-all routes', () => {
      const routes = [
        {
          Properties: {
            RouteKey: 'ANY /*',
            Target: {
              Ref: 'AnyCatchallHTTPIntegration',
            },
          },
        },
      ];

      const integrations = {
        AnyCatchallHTTPIntegration: {
          Properties: {
            IntegrationUri: {
              'Fn::Sub': [
                'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${FunctionArn}/invocations',
                {
                  FunctionArn: { 'Fn::GetAtt': ['AnyCatchallHTTPLambda', 'Arn'] },
                },
              ],
            },
          },
        },
      };

      const { resources, pathToResourceId } = createResourceHierarchy(routes);
      const { methods } = createMethods(routes, integrations, pathToResourceId, resources);

      // Should create methods for all HTTP methods on the {proxy+} resource
      // AND also on the root resource (so that / is handled)
      // For ANY method, we create 7 HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
      // So we should have 7 methods on {proxy+} + 7 methods on root = 14 methods total
      expect(Object.keys(methods).length).toBe(14);

      // Verify methods are created on the {proxy+} resource
      const proxyResourceId = pathToResourceId['/{proxy+}'];
      expect(proxyResourceId).toBeDefined();
      
      const proxyMethods = Object.values(methods).filter(
        (m) => m.Properties.ResourceId?.Ref === proxyResourceId
      );
      expect(proxyMethods.length).toBe(7);
      
      // Verify all HTTP methods are present on proxy resource
      const proxyHttpMethods = proxyMethods.map((m) => m.Properties.HttpMethod);
      expect(proxyHttpMethods).toContain('GET');
      expect(proxyHttpMethods).toContain('POST');
      expect(proxyHttpMethods).toContain('PUT');
      expect(proxyHttpMethods).toContain('DELETE');
      expect(proxyHttpMethods).toContain('PATCH');
      expect(proxyHttpMethods).toContain('HEAD');
      expect(proxyHttpMethods).toContain('OPTIONS');

      // Verify methods are also created on the root resource
      const rootMethods = Object.values(methods).filter(
        (m) => m.Properties.ResourceId?.['Fn::GetAtt'] && 
               m.Properties.ResourceId['Fn::GetAtt'][0] === 'HTTP' &&
               m.Properties.ResourceId['Fn::GetAtt'][1] === 'RootResourceId'
      );
      expect(rootMethods.length).toBe(7);
      
      // Verify all HTTP methods are present on root resource
      const rootHttpMethods = rootMethods.map((m) => m.Properties.HttpMethod);
      expect(rootHttpMethods).toContain('GET');
      expect(rootHttpMethods).toContain('POST');
      expect(rootHttpMethods).toContain('PUT');
      expect(rootHttpMethods).toContain('DELETE');
      expect(rootHttpMethods).toContain('PATCH');
      expect(rootHttpMethods).toContain('HEAD');
      expect(rootHttpMethods).toContain('OPTIONS');

      // Verify both root and proxy methods use the same integration URI
      const rootMethod = rootMethods[0];
      const proxyMethod = proxyMethods[0];
      expect(rootMethod.Properties.Integration.Uri).toEqual(proxyMethod.Properties.Integration.Uri);
    });
  });

  describe('convertIntegrationUri', () => {
    it('should convert string Fn::Sub format to array format', () => {
      const stringFormatUri = {
        'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${TestLambda.Arn}/invocations',
      };

      const result = convertIntegrationUri(stringFormatUri);

      expect(result['Fn::Sub']).toBeInstanceOf(Array);
      expect(result['Fn::Sub'][0]).not.toContain('.Arn');
      expect(result['Fn::Sub'][1]).toHaveProperty('TestLambdaArn');
      expect(result['Fn::Sub'][1].TestLambdaArn).toEqual({ 'Fn::GetAtt': ['TestLambda', 'Arn'] });
    });

    it('should convert array Fn::Sub format that still contains .Arn patterns', () => {
      // This tests the fix for URIs already in array format but still containing .Arn patterns
      const arrayFormatWithArn = {
        'Fn::Sub': [
          'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${TestLambda.Arn}/invocations',
          {}, // Empty variables - this is the bug scenario
        ],
      };

      const result = convertIntegrationUri(arrayFormatWithArn);

      expect(result['Fn::Sub']).toBeInstanceOf(Array);
      expect(result['Fn::Sub'][0]).not.toContain('.Arn');
      expect(result['Fn::Sub'][1]).toHaveProperty('TestLambdaArn');
      expect(result['Fn::Sub'][1].TestLambdaArn).toEqual({ 'Fn::GetAtt': ['TestLambda', 'Arn'] });
    });

    it('should preserve already-converted array Fn::Sub format without .Arn patterns', () => {
      const alreadyConvertedUri = {
        'Fn::Sub': [
          'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${TestLambdaArn}/invocations',
          {
            TestLambdaArn: { 'Fn::GetAtt': ['TestLambda', 'Arn'] },
          },
        ],
      };

      const result = convertIntegrationUri(alreadyConvertedUri);

      // Should return as-is since it's already correctly converted
      expect(result).toEqual(alreadyConvertedUri);
    });

    it('should handle multiple .Arn patterns in the same string', () => {
      const stringFormatUri = {
        'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Lambda1.Arn}/invocations and ${Lambda1.Arn} again',
      };

      const result = convertIntegrationUri(stringFormatUri);

      expect(result['Fn::Sub']).toBeInstanceOf(Array);
      expect(result['Fn::Sub'][0]).not.toContain('.Arn');
      // Should replace all occurrences
      const occurrences = (result['Fn::Sub'][0].match(/\$\{Lambda1Arn\}/g) || []).length;
      expect(occurrences).toBe(2);
    });

    it('should handle array format with .Arn patterns and preserve existing variables', () => {
      const arrayFormatWithArnAndVars = {
        'Fn::Sub': [
          'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${TestLambda.Arn}/invocations',
          {
            ExistingVar: { 'Fn::GetAtt': ['OtherResource', 'Arn'] },
          },
        ],
      };

      const result = convertIntegrationUri(arrayFormatWithArnAndVars);

      expect(result['Fn::Sub']).toBeInstanceOf(Array);
      expect(result['Fn::Sub'][0]).not.toContain('.Arn');
      // Should preserve existing variables
      expect(result['Fn::Sub'][1]).toHaveProperty('ExistingVar');
      // Should add new variable for TestLambda
      expect(result['Fn::Sub'][1]).toHaveProperty('TestLambdaArn');
    });
  });
});

