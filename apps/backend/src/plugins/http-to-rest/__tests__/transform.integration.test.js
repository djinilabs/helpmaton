/**
 * Integration tests for CloudFormation template transformation
 */

import { describe, it, expect } from 'vitest';
import { transformToRestApi } from '../transform.js';

describe('Template Transformation Integration', () => {
  // Clean up migration env vars before each test to ensure clean state
  beforeEach(() => {
    delete process.env.HTTP_TO_REST_MIGRATION;
    delete process.env.HTTP_TO_REST_MIGRATION_PHASE;
    delete process.env.ARC_STACK_NAME;
    delete process.env.AWS_STACK_NAME;
  });
  
  describe('transformToRestApi', () => {
    it('should transform AWS::Serverless::HttpApi (SAM format) to REST API', () => {
      // Set stack name to match expected test value
      process.env.ARC_STACK_NAME = 'helpmaton-api';
      
      // This is the actual format that Architect generates
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::Serverless::HttpApi',
            Properties: {
              StageName: 'staging',
              DefinitionBody: {
                openapi: '3.0.1',
                info: {
                  title: {
                    Ref: 'AWS::StackName'
                  }
                },
                paths: {
                  '/api/usage': {
                    get: {
                      'x-amazon-apigateway-integration': {
                        payloadFormatVersion: '2.0',
                        type: 'aws_proxy',
                        httpMethod: 'POST',
                        uri: {
                          'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetApiUsageHTTPLambda.Arn}/invocations'
                        },
                        connectionType: 'INTERNET'
                      }
                    }
                  }
                }
              }
            }
          },
          GetApiUsageHTTPLambda: {
            Type: 'AWS::Serverless::Function',
            Properties: {
              FunctionName: 'GetApiUsageHTTPLambda'
            }
          }
        },
        Outputs: {
          ApiUrl: {
            Value: 'https://api-id.execute-api.region.amazonaws.com',
          },
        },
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Should have REST API resource
      expect(result.Resources.HTTP).toBeDefined();
      expect(result.Resources.HTTP.Type).toBe('AWS::ApiGateway::RestApi');
      expect(result.Resources.HTTP.Properties.Name).toBe('helpmaton-api');

      // Should have REST API resources
      expect(result.Resources.HTTPDeployment).toBeDefined();
      expect(result.Resources.HTTPStagingStage).toBeDefined();
      expect(result.Resources.HTTPStagingStage.Type).toBe('AWS::ApiGateway::Stage');
      
      // Should have created resources and methods
      const resources = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::ApiGateway::Resource'
      );
      expect(resources.length).toBeGreaterThan(0);
      
      const methods = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::ApiGateway::Method'
      );
      expect(methods.length).toBeGreaterThan(0);
      
      // Verify no HTTP v2 resources remain
      const httpV2Resources = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::Serverless::HttpApi' || r.Type === 'AWS::ApiGatewayV2::Api'
      );
      expect(httpV2Resources.length).toBe(0);
    });

    it('should handle $default stage name correctly (sanitize for resource ID)', () => {
      // Test the actual case that causes the CloudFormation error
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::Serverless::HttpApi',
            Properties: {
              StageName: '$default', // This is what Architect uses
              DefinitionBody: {
                openapi: '3.0.1',
                info: {
                  title: {
                    Ref: 'AWS::StackName'
                  }
                },
                paths: {
                  '/api/usage': {
                    get: {
                      'x-amazon-apigateway-integration': {
                        payloadFormatVersion: '2.0',
                        type: 'aws_proxy',
                        httpMethod: 'POST',
                        uri: {
                          'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetApiUsageHTTPLambda.Arn}/invocations'
                        },
                        connectionType: 'INTERNET'
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Should have REST API resource
      expect(result.Resources.HTTP).toBeDefined();
      expect(result.Resources.HTTP.Type).toBe('AWS::ApiGateway::RestApi');

      // Should have stage with sanitized resource ID (no $ character)
      expect(result.Resources.HTTPDefaultStage).toBeDefined();
      expect(result.Resources.HTTPDefaultStage.Type).toBe('AWS::ApiGateway::Stage');
      
      // Stage name property should be sanitized (API Gateway only allows a-zA-Z0-9_)
      // $default -> default (removes $ character)
      expect(result.Resources.HTTPDefaultStage.Properties.StageName).toBe('default');
      
      // Verify resource ID is alphanumeric (no special characters)
      const stageResourceId = Object.keys(result.Resources).find(
        (key) => result.Resources[key].Type === 'AWS::ApiGateway::Stage'
      );
      expect(stageResourceId).toBe('HTTPDefaultStage');
      expect(/^[a-zA-Z0-9]+$/.test(stageResourceId)).toBe(true);
    });

    it('should transform AWS::ApiGatewayV2::Api (legacy format) to REST API', () => {
      // Set stack name to match expected test value
      process.env.ARC_STACK_NAME = 'test-api';
      
      // Keep this test for backward compatibility with the old format
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::ApiGatewayV2::Api',
            Properties: {
              Name: 'test-api',
              Description: 'Test API',
              ProtocolType: 'HTTP',
            },
          },
          GetApiUsageHTTPRoute: {
            Type: 'AWS::ApiGatewayV2::Route',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              RouteKey: 'GET /api/usage',
              Target: 'integrations/GetApiUsageHTTPIntegration',
            },
          },
          GetApiUsageHTTPIntegration: {
            Type: 'AWS::ApiGatewayV2::Integration',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              IntegrationType: 'AWS_PROXY',
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
          HTTPStagingStage: {
            Type: 'AWS::ApiGatewayV2::Stage',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              StageName: 'staging',
              AutoDeploy: true,
            },
          },
        },
        Outputs: {
          ApiUrl: {
            Value: 'https://api-id.execute-api.region.amazonaws.com',
          },
        },
      };

      // Save original stage type before transformation (function mutates the object)
      const originalStageType = cloudformation.Resources.HTTPStagingStage.Type;
      expect(originalStageType).toBe('AWS::ApiGatewayV2::Stage');

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Should have REST API resource
      expect(result.Resources.HTTP).toBeDefined();
      expect(result.Resources.HTTP.Type).toBe('AWS::ApiGateway::RestApi');
      expect(result.Resources.HTTP.Properties.Name).toBe('test-api');

      // Should have removed HTTP v2 resources
      expect(result.Resources.GetApiUsageHTTPRoute).toBeUndefined();
      expect(result.Resources.GetApiUsageHTTPIntegration).toBeUndefined();
      
      // Should have REST API resources
      expect(result.Resources.HTTPDeployment).toBeDefined();
      expect(result.Resources.HTTPStagingStage).toBeDefined();
      expect(result.Resources.HTTPStagingStage.Type).toBe('AWS::ApiGateway::Stage');
      
      // Verify no HTTP v2 stage remains in result
      const httpV2Stages = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::ApiGatewayV2::Stage'
      );
      expect(httpV2Stages.length).toBe(0);
    });

    it('should validate resource references', () => {
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::ApiGatewayV2::Api',
            Properties: {
              Name: 'test-api',
            },
          },
          GetApiUsageHTTPRoute: {
            Type: 'AWS::ApiGatewayV2::Route',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              RouteKey: 'GET /api/usage',
              Target: 'integrations/GetApiUsageHTTPIntegration',
            },
          },
          GetApiUsageHTTPIntegration: {
            Type: 'AWS::ApiGatewayV2::Integration',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              IntegrationType: 'AWS_PROXY',
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
          HTTPStagingStage: {
            Type: 'AWS::ApiGatewayV2::Stage',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              StageName: 'staging',
            },
          },
        },
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Check that all resource references are valid
      const deployment = result.Resources.HTTPDeployment;
      expect(deployment.Properties.RestApiId).toEqual({ Ref: 'HTTP' });

      const stage = result.Resources.HTTPStagingStage;
      expect(stage.Properties.RestApiId).toEqual({ Ref: 'HTTP' });
      expect(stage.Properties.DeploymentId).toEqual({ Ref: 'HTTPDeployment' });

      // Check method references
      const methods = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::ApiGateway::Method'
      );
      for (const method of methods) {
        expect(method.Properties.RestApiId).toEqual({ Ref: 'HTTP' });
        expect(method.Properties.ResourceId).toBeDefined();
      }
    });

    it('should check for missing dependencies', () => {
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::ApiGatewayV2::Api',
            Properties: {
              Name: 'test-api',
            },
          },
          GetApiUsageHTTPRoute: {
            Type: 'AWS::ApiGatewayV2::Route',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              RouteKey: 'GET /api/usage',
              Target: 'integrations/GetApiUsageHTTPIntegration',
            },
          },
          GetApiUsageHTTPIntegration: {
            Type: 'AWS::ApiGatewayV2::Integration',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              IntegrationType: 'AWS_PROXY',
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
          HTTPStagingStage: {
            Type: 'AWS::ApiGatewayV2::Stage',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              StageName: 'staging',
            },
          },
        },
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Deployment should depend on all methods
      const deployment = result.Resources.HTTPDeployment;
      expect(deployment.DependsOn).toBeDefined();
      expect(Array.isArray(deployment.DependsOn)).toBe(true);
      expect(deployment.DependsOn.length).toBeGreaterThan(0);

      // Stage should depend on deployment
      const stage = result.Resources.HTTPStagingStage;
      expect(stage.DependsOn).toBeDefined();
      expect(stage.DependsOn).toContain('HTTPDeployment');
    });

    it('should handle multiple routes with SAM format', () => {
      // Realistic test using actual Architect format
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::Serverless::HttpApi',
            Properties: {
              StageName: 'staging',
              DefinitionBody: {
                openapi: '3.0.1',
                info: {
                  title: {
                    Ref: 'AWS::StackName'
                  }
                },
                paths: {
                  '/api/usage': {
                    get: {
                      'x-amazon-apigateway-integration': {
                        payloadFormatVersion: '2.0',
                        type: 'aws_proxy',
                        httpMethod: 'POST',
                        uri: {
                          'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetApiUsageHTTPLambda.Arn}/invocations'
                        },
                        connectionType: 'INTERNET'
                      }
                    }
                  },
                  '/api/webhook/{workspaceId}/{agentId}/{key}': {
                    post: {
                      'x-amazon-apigateway-integration': {
                        payloadFormatVersion: '2.0',
                        type: 'aws_proxy',
                        httpMethod: 'POST',
                        uri: {
                          'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${PostApiWebhookWorkspaceIdAgentIdKeyHTTPLambda.Arn}/invocations'
                        },
                        connectionType: 'INTERNET'
                      }
                    }
                  },
                  '/api/auth/{proxy+}': {
                    'x-amazon-apigateway-any-method': {
                      'x-amazon-apigateway-integration': {
                        payloadFormatVersion: '2.0',
                        type: 'aws_proxy',
                        httpMethod: 'POST',
                        uri: {
                          'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${AnyApiAuthCatchallHTTPLambda.Arn}/invocations'
                        },
                        connectionType: 'INTERNET'
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Should have methods for all routes
      const methods = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::ApiGateway::Method'
      );
      expect(methods.length).toBeGreaterThanOrEqual(3); // GET /api/usage, POST /api/webhook, and 7 methods for ANY /api/auth/{proxy+}

      // Should have resources for all paths
      const resources = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::ApiGateway::Resource'
      );
      expect(resources.length).toBeGreaterThan(0);
      
      // Should have proxy resource for {proxy+}
      const proxyResource = Object.values(result.Resources).find(
        (r) => r.Type === 'AWS::ApiGateway::Resource' && r.Properties?.PathPart === '{proxy+}'
      );
      expect(proxyResource).toBeDefined();
    });

    it('should handle multiple routes with legacy format', () => {
      // Keep this test for backward compatibility
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::ApiGatewayV2::Api',
            Properties: {
              Name: 'test-api',
            },
          },
          GetApiUsageHTTPRoute: {
            Type: 'AWS::ApiGatewayV2::Route',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              RouteKey: 'GET /api/usage',
              Target: 'integrations/GetApiUsageHTTPIntegration',
            },
          },
          GetApiUsageHTTPIntegration: {
            Type: 'AWS::ApiGatewayV2::Integration',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              IntegrationType: 'AWS_PROXY',
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
          PostApiWebhookHTTPRoute: {
            Type: 'AWS::ApiGatewayV2::Route',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              RouteKey: 'POST /api/webhook/:workspaceId/:agentId/:key',
              Target: 'integrations/PostApiWebhookHTTPIntegration',
            },
          },
          PostApiWebhookHTTPIntegration: {
            Type: 'AWS::ApiGatewayV2::Integration',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              IntegrationType: 'AWS_PROXY',
              IntegrationUri: {
                'Fn::Sub': [
                  'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${FunctionArn}/invocations',
                  {
                    FunctionArn: { 'Fn::GetAtt': ['PostApiWebhookHTTPLambda', 'Arn'] },
                  },
                ],
              },
            },
          },
          HTTPStagingStage: {
            Type: 'AWS::ApiGatewayV2::Stage',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              StageName: 'staging',
            },
          },
        },
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Should have methods for both routes
      const methods = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::ApiGateway::Method'
      );
      expect(methods.length).toBeGreaterThanOrEqual(2);

      // Should have resources for both paths
      const resources = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::ApiGateway::Resource'
      );
      expect(resources.length).toBeGreaterThan(0);
    });

    it('should preserve Lambda function references', () => {
      const integrationUri = {
        'Fn::Sub': [
          'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${FunctionArn}/invocations',
          {
            FunctionArn: { 'Fn::GetAtt': ['GetApiUsageHTTPLambda', 'Arn'] },
          },
        ],
      };

      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::ApiGatewayV2::Api',
            Properties: {
              Name: 'test-api',
            },
          },
          GetApiUsageHTTPRoute: {
            Type: 'AWS::ApiGatewayV2::Route',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              RouteKey: 'GET /api/usage',
              Target: 'integrations/GetApiUsageHTTPIntegration',
            },
          },
          GetApiUsageHTTPIntegration: {
            Type: 'AWS::ApiGatewayV2::Integration',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              IntegrationType: 'AWS_PROXY',
              IntegrationUri: integrationUri,
            },
          },
          HTTPStagingStage: {
            Type: 'AWS::ApiGatewayV2::Stage',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              StageName: 'staging',
            },
          },
        },
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Find the method and verify it has the same integration URI
      const methods = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::ApiGateway::Method'
      );
      const method = methods.find((m) => m.Properties.HttpMethod === 'GET');
      expect(method).toBeDefined();
      expect(method.Properties.Integration.Uri).toEqual(integrationUri);
    });

    it('should skip transformation if HTTP API v2 is not present', () => {
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::ApiGateway::RestApi',
            Properties: {
              Name: 'already-rest-api',
            },
          },
        },
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Should return unchanged
      expect(result.Resources.HTTP.Type).toBe('AWS::ApiGateway::RestApi');
      expect(result.Resources.HTTP.Properties.Name).toBe('already-rest-api');
    });

    it('should update outputs correctly', () => {
      // Clear migration env vars to test normal transformation
      delete process.env.HTTP_TO_REST_MIGRATION;
      delete process.env.HTTP_TO_REST_MIGRATION_PHASE;
      
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::ApiGatewayV2::Api',
            Properties: {
              Name: 'test-api',
            },
          },
          GetApiUsageHTTPRoute: {
            Type: 'AWS::ApiGatewayV2::Route',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              RouteKey: 'GET /api/usage',
              Target: 'integrations/GetApiUsageHTTPIntegration',
            },
          },
          GetApiUsageHTTPIntegration: {
            Type: 'AWS::ApiGatewayV2::Integration',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              IntegrationType: 'AWS_PROXY',
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
          HTTPStagingStage: {
            Type: 'AWS::ApiGatewayV2::Stage',
            Properties: {
              ApiId: { Ref: 'HTTP' },
              StageName: 'staging',
            },
          },
        },
        Outputs: {
          ApiUrl: {
            Value: 'https://old-url',
          },
          ApiId: {
            Value: 'old-id',
          },
        },
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Should update ApiUrl output
      expect(result.Outputs.ApiUrl).toBeDefined();
      expect(result.Outputs.ApiUrl.Value).toBeDefined();
      expect(result.Outputs.ApiUrl.Value['Fn::Join']).toBeDefined();

      // Should update ApiId output
      expect(result.Outputs.ApiId).toBeDefined();
      expect(result.Outputs.ApiId.Value).toEqual({ Ref: 'HTTP' });

      // Should add RestApiUrl output
      expect(result.Outputs.RestApiUrl).toBeDefined();
    });
  });

  describe('2-Phase Migration', () => {
    beforeEach(() => {
      // Clear environment variables before each test
      delete process.env.HTTP_TO_REST_MIGRATION;
      delete process.env.HTTP_TO_REST_MIGRATION_PHASE;
    });

    afterEach(() => {
      // Clean up environment variables after each test
      delete process.env.HTTP_TO_REST_MIGRATION;
      delete process.env.HTTP_TO_REST_MIGRATION_PHASE;
    });

    it('should create HTTPRestApi in Phase 1 migration mode', () => {
      process.env.HTTP_TO_REST_MIGRATION = 'true';
      
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::Serverless::HttpApi',
            Properties: {
              StageName: 'staging',
              DefinitionBody: {
                openapi: '3.0.1',
                info: {
                  title: {
                    Ref: 'AWS::StackName'
                  }
                },
                paths: {
                  '/api/usage': {
                    get: {
                      'x-amazon-apigateway-integration': {
                        payloadFormatVersion: '2.0',
                        type: 'aws_proxy',
                        httpMethod: 'POST',
                        uri: {
                          'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetApiUsageHTTPLambda.Arn}/invocations'
                        },
                        connectionType: 'INTERNET'
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Should create HTTPRestApi (not HTTP)
      expect(result.Resources.HTTPRestApi).toBeDefined();
      expect(result.Resources.HTTPRestApi.Type).toBe('AWS::ApiGateway::RestApi');
      
      // Old HTTP should still exist (HTTP API v2)
      expect(result.Resources.HTTP).toBeDefined();
      expect(result.Resources.HTTP.Type).toBe('AWS::Serverless::HttpApi');
      
      // All new resources should reference HTTPRestApi
      const deployment = result.Resources.HTTPDeployment;
      expect(deployment.Properties.RestApiId).toEqual({ Ref: 'HTTPRestApi' });
      
      const stage = result.Resources.HTTPStagingStage;
      expect(stage.Properties.RestApiId).toEqual({ Ref: 'HTTPRestApi' });
      
      // Methods should reference HTTPRestApi
      const methods = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::ApiGateway::Method'
      );
      for (const method of methods) {
        expect(method.Properties.RestApiId).toEqual({ Ref: 'HTTPRestApi' });
      }
      
      // Resources should reference HTTPRestApi
      const resources = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::ApiGateway::Resource'
      );
      for (const resource of resources) {
        expect(resource.Properties.RestApiId).toEqual({ Ref: 'HTTPRestApi' });
      }
    });

    it('should complete Phase 2 migration when HTTPRestApi exists', () => {
      // Set stack name to match expected test value
      process.env.ARC_STACK_NAME = 'helpmaton-api';
      
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::Serverless::HttpApi',
            Properties: {
              StageName: 'staging',
              DefinitionBody: {
                openapi: '3.0.1',
                info: {
                  title: {
                    Ref: 'AWS::StackName'
                  }
                },
                paths: {
                  '/api/usage': {
                    get: {
                      'x-amazon-apigateway-integration': {
                        payloadFormatVersion: '2.0',
                        type: 'aws_proxy',
                        httpMethod: 'POST',
                        uri: {
                          'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetApiUsageHTTPLambda.Arn}/invocations'
                        },
                        connectionType: 'INTERNET'
                      }
                    }
                  }
                }
              }
            }
          },
          // Simulate Phase 2: HTTPRestApi already exists from Phase 1
          HTTPRestApi: {
            Type: 'AWS::ApiGateway::RestApi',
            Properties: {
              Name: 'helpmaton-api',
              Description: 'REST API for Helpmaton',
              EndpointConfiguration: {
                Types: ['REGIONAL'],
              },
            },
          },
          HTTPDeployment: {
            Type: 'AWS::ApiGateway::Deployment',
            Properties: {
              RestApiId: { Ref: 'HTTPRestApi' },
            },
          },
          HTTPStagingStage: {
            Type: 'AWS::ApiGateway::Stage',
            Properties: {
              RestApiId: { Ref: 'HTTPRestApi' },
              DeploymentId: { Ref: 'HTTPDeployment' },
              StageName: 'staging',
            },
          },
        }
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // HTTPRestApi should remain (not renamed to HTTP to avoid CloudFormation type change error)
      expect(result.Resources.HTTPRestApi).toBeDefined();
      expect(result.Resources.HTTPRestApi.Type).toBe('AWS::ApiGateway::RestApi');
      expect(result.Resources.HTTPRestApi.Properties.Name).toBe('helpmaton-api');
      
      // HTTP should be deleted (old HTTP API v2)
      expect(result.Resources.HTTP).toBeUndefined();
      
      // Old HTTP API v2 should be removed
      const httpV2Resources = Object.values(result.Resources).filter(
        (r) => r.Type === 'AWS::Serverless::HttpApi' || r.Type === 'AWS::ApiGatewayV2::Api'
      );
      expect(httpV2Resources.length).toBe(0);
      
      // All references should be updated to HTTPRestApi (we keep HTTPRestApi, don't rename it)
      const deployment = result.Resources.HTTPDeployment;
      expect(deployment.Properties.RestApiId).toEqual({ Ref: 'HTTPRestApi' });
      
      const stage = result.Resources.HTTPStagingStage;
      expect(stage.Properties.RestApiId).toEqual({ Ref: 'HTTPRestApi' });
    });

    it('should update all resource references in Phase 1', () => {
      process.env.HTTP_TO_REST_MIGRATION = 'true';
      
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::Serverless::HttpApi',
            Properties: {
              StageName: 'staging',
              DefinitionBody: {
                openapi: '3.0.1',
                info: {
                  title: {
                    Ref: 'AWS::StackName'
                  }
                },
                paths: {
                  '/api/usage': {
                    get: {
                      'x-amazon-apigateway-integration': {
                        payloadFormatVersion: '2.0',
                        type: 'aws_proxy',
                        httpMethod: 'POST',
                        uri: {
                          'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetApiUsageHTTPLambda.Arn}/invocations'
                        },
                        connectionType: 'INTERNET'
                      }
                    }
                  }
                }
              }
            }
          }
        },
        Outputs: {
          ApiId: {
            Value: { Ref: 'HTTP' },
          },
          ApiUrl: {
            Value: {
              'Fn::Join': [
                '',
                [
                  'https://',
                  { Ref: 'HTTP' },
                  '.execute-api.',
                  { Ref: 'AWS::Region' },
                  '.amazonaws.com/staging',
                ],
              ],
            },
          },
        },
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Outputs should reference HTTPRestApi
      expect(result.Outputs.ApiId.Value).toEqual({ Ref: 'HTTPRestApi' });
      expect(result.Outputs.ApiUrl.Value['Fn::Join'][1][1]).toEqual({ Ref: 'HTTPRestApi' });
    });

    it('should handle Phase 1 with explicit HTTP_TO_REST_MIGRATION_PHASE=1', () => {
      process.env.HTTP_TO_REST_MIGRATION_PHASE = '1';
      
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::Serverless::HttpApi',
            Properties: {
              StageName: 'staging',
              DefinitionBody: {
                openapi: '3.0.1',
                info: {
                  title: {
                    Ref: 'AWS::StackName'
                  }
                },
                paths: {
                  '/api/usage': {
                    get: {
                      'x-amazon-apigateway-integration': {
                        payloadFormatVersion: '2.0',
                        type: 'aws_proxy',
                        httpMethod: 'POST',
                        uri: {
                          'Fn::Sub': 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetApiUsageHTTPLambda.Arn}/invocations'
                        },
                        connectionType: 'INTERNET'
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Should create HTTPRestApi
      expect(result.Resources.HTTPRestApi).toBeDefined();
      expect(result.Resources.HTTPRestApi.Type).toBe('AWS::ApiGateway::RestApi');
      
      // Old HTTP should still exist
      expect(result.Resources.HTTP).toBeDefined();
      expect(result.Resources.HTTP.Type).toBe('AWS::Serverless::HttpApi');
    });

    it('should skip transformation if HTTP is already REST API', () => {
      const cloudformation = {
        Resources: {
          HTTP: {
            Type: 'AWS::ApiGateway::RestApi',
            Properties: {
              Name: 'already-rest-api',
            },
          },
        },
      };

      const result = transformToRestApi(cloudformation, {}, 'staging');

      // Should return unchanged
      expect(result.Resources.HTTP.Type).toBe('AWS::ApiGateway::RestApi');
      expect(result.Resources.HTTP.Properties.Name).toBe('already-rest-api');
    });
  });
});

