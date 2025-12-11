/**
 * Unit tests for Lambda URLs plugin
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import plugin from "../index.js";

const {
  configureLambdaUrls,
  routeToFunctionId,
  parseLambdaUrlsPragma,
  extractPrNumberFromStackName,
  getStreamingDnsName,
} = plugin;

describe("Lambda URLs Plugin", () => {
  let mockCloudformation;
  let mockInventory;
  let mockArc;

  beforeEach(() => {
    mockCloudformation = {
      Resources: {},
      Outputs: {},
    };
    mockInventory = {};
    mockArc = {
      "lambda-urls": ["any /api/streams/:workspaceId/:agentId/:secret"],
    };
    // Set stack name for testing (used for DNS name generation)
    process.env.ARC_STACK_NAME = "TestStack";
  });

  it("should skip if no @lambda-urls pragma is found", async () => {
    const result = await configureLambdaUrls({
      cloudformation: mockCloudformation,
      inventory: mockInventory,
      arc: {},
    });

    expect(result).toBe(mockCloudformation);
    expect(Object.keys(result.Resources)).toHaveLength(0);
    expect(Object.keys(result.Outputs)).toHaveLength(0);
  });

  it("should skip if Lambda function is not found for route", async () => {
    const result = await configureLambdaUrls({
      cloudformation: mockCloudformation,
      inventory: mockInventory,
      arc: mockArc,
    });

    expect(result).toBe(mockCloudformation);
    expect(Object.keys(result.Resources)).toHaveLength(0);
    expect(Object.keys(result.Outputs)).toHaveLength(0);
  });

  it("should create Lambda Function URL resource when streaming function exists", async () => {
    const streamingFunctionId =
      "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda";
    mockCloudformation.Resources[streamingFunctionId] = {
      Type: "AWS::Lambda::Function",
      Properties: {
        FunctionName: "test-function",
        Runtime: "nodejs20.x",
      },
    };

    const result = await configureLambdaUrls({
      cloudformation: mockCloudformation,
      inventory: mockInventory,
      arc: mockArc,
    });

    // Function URL resource ID should be prefixed with stack name
    const functionUrlId = `${streamingFunctionId}Url`;
    expect(result.Resources[functionUrlId]).toBeDefined();
    expect(result.Resources[functionUrlId].Type).toBe("AWS::Lambda::Url");
    expect(result.Resources[functionUrlId].Properties.AuthType).toBe("NONE");
    expect(result.Resources[functionUrlId].Properties.InvokeMode).toBe("RESPONSE_STREAM");
    expect(result.Resources[functionUrlId].DependsOn).toBe(streamingFunctionId);
  });

  it("should create Lambda permission for Function URL", async () => {
    const streamingFunctionId =
      "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda";
    mockCloudformation.Resources[streamingFunctionId] = {
      Type: "AWS::Lambda::Function",
      Properties: {
        FunctionName: "test-function",
        Runtime: "nodejs20.x",
      },
    };

    const result = await configureLambdaUrls({
      cloudformation: mockCloudformation,
      inventory: mockInventory,
      arc: mockArc,
    });

    // Permission resource ID should be prefixed with stack name
    const permissionId = `${streamingFunctionId}UrlPermission`;
    expect(result.Resources[permissionId]).toBeDefined();
    expect(result.Resources[permissionId].Type).toBe(
      "AWS::Lambda::Permission"
    );
    expect(result.Resources[permissionId].Properties.Action).toBe(
      "lambda:InvokeFunctionUrl"
    );
    expect(result.Resources[permissionId].Properties.Principal).toBe("*");
    expect(result.Resources[permissionId].Properties.FunctionUrlAuthType).toBe(
      "NONE"
    );
    expect(result.Resources[permissionId].DependsOn).toContain(
      streamingFunctionId
    );
  });

  it("should create CloudFormation output for Function URL", async () => {
    const streamingFunctionId =
      "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda";
    mockCloudformation.Resources[streamingFunctionId] = {
      Type: "AWS::Lambda::Function",
      Properties: {
        FunctionName: "test-function",
        Runtime: "nodejs20.x",
      },
    };

    const result = await configureLambdaUrls({
      cloudformation: mockCloudformation,
      inventory: mockInventory,
      arc: mockArc,
    });

    const outputId = "StreamingFunctionUrl";
    expect(result.Outputs[outputId]).toBeDefined();
    expect(result.Outputs[outputId].Description).toContain(
      "Lambda Function URL for route"
    );
    expect(result.Outputs[outputId].Value).toBeDefined();
    expect(result.Outputs[outputId].Export).toBeDefined();
  });

  it("should not create duplicate resources if called multiple times", async () => {
    const streamingFunctionId =
      "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda";
    mockCloudformation.Resources[streamingFunctionId] = {
      Type: "AWS::Lambda::Function",
      Properties: {
        FunctionName: "test-function",
        Runtime: "nodejs20.x",
      },
    };

    // Call twice
    const result1 = await configureLambdaUrls({
      cloudformation: mockCloudformation,
      inventory: mockInventory,
      arc: mockArc,
    });

    const result2 = await configureLambdaUrls({
      cloudformation: result1,
      inventory: mockInventory,
      arc: mockArc,
    });

    // Function URL resource ID should be prefixed with stack name
    const functionUrlId = `${streamingFunctionId}Url`;
    // Permission resource ID should be prefixed with stack name
    const permissionId = `${streamingFunctionId}UrlPermission`;

    // Should only have one of each resource
    expect(Object.keys(result2.Resources).filter((id) => id === functionUrlId))
      .toHaveLength(1);
    expect(
      Object.keys(result2.Resources).filter((id) => id === permissionId)
    ).toHaveLength(1);
    expect(
      Object.keys(result2.Outputs).filter((id) => id === "StreamingFunctionUrl")
    ).toHaveLength(1);
  });

  it("should work with package hook (dry-run)", async () => {
    expect(plugin.package).toBeDefined();
    expect(plugin.deploy).toBeDefined();
    expect(plugin.deploy.start).toBeDefined();

    const streamingFunctionId =
      "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda";
    mockCloudformation.Resources[streamingFunctionId] = {
      Type: "AWS::Lambda::Function",
      Properties: {
        FunctionName: "test-function",
        Runtime: "nodejs20.x",
      },
    };

    // Test package hook (used in dry-run)
    // Package hook should also receive arc/inventory to parse pragma
    const result = await plugin.package({
      cloudformation: mockCloudformation,
      inventory: mockInventory,
      arc: mockArc,
    });

    // Function URL resource ID should be prefixed with stack name
    const functionUrlId = `${streamingFunctionId}Url`;
    expect(result.Resources[functionUrlId]).toBeDefined();
    expect(result.Outputs.StreamingFunctionUrl).toBeDefined();
  });

  it("should work with deploy.start hook", async () => {
    const streamingFunctionId =
      "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda";
    mockCloudformation.Resources[streamingFunctionId] = {
      Type: "AWS::Lambda::Function",
      Properties: {
        FunctionName: "test-function",
        Runtime: "nodejs20.x",
      },
    };

    // Test deploy.start hook
    const result = await plugin.deploy.start({
      cloudformation: mockCloudformation,
      inventory: mockInventory,
      arc: mockArc,
    });

    // Function URL resource ID should be prefixed with stack name
    const functionUrlId = `${streamingFunctionId}Url`;
    expect(result.Resources[functionUrlId]).toBeDefined();
    expect(result.Outputs.StreamingFunctionUrl).toBeDefined();
  });

  describe("routeToFunctionId", () => {
    it("should convert streaming route correctly", () => {
      const route = "any /api/streams/:workspaceId/:agentId/:secret";
      const result = routeToFunctionId(route);
      expect(result).toBe(
        "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda"
      );
    });

    it("should handle GET method", () => {
      const route = "get /api/usage";
      const result = routeToFunctionId(route);
      expect(result).toBe("GetApiUsageHTTPLambda");
    });

    it("should handle POST method", () => {
      const route = "post /api/webhook/:workspaceId/:agentId/:key";
      const result = routeToFunctionId(route);
      expect(result).toBe(
        "PostApiWebhookWorkspaceIdAgentIdKeyHTTPLambda"
      );
    });

    it("should return null for invalid routes", () => {
      expect(routeToFunctionId("")).toBeNull();
      expect(routeToFunctionId("invalid")).toBeNull();
      expect(routeToFunctionId("/api/streams")).toBeNull();
    });
  });

  describe("parseLambdaUrlsPragma", () => {
    it("should parse array of routes", () => {
      const arc = {
        "lambda-urls": [
          "any /api/streams/:workspaceId/:agentId/:secret",
          "get /api/usage",
        ],
      };
      const result = parseLambdaUrlsPragma(arc);
      expect(result).toEqual([
        "any /api/streams/:workspaceId/:agentId/:secret",
        "get /api/usage",
      ]);
    });

    it("should parse single route string", () => {
      const arc = {
        "lambda-urls": "any /api/streams/:workspaceId/:agentId/:secret",
      };
      const result = parseLambdaUrlsPragma(arc);
      expect(result).toEqual([
        "any /api/streams/:workspaceId/:agentId/:secret",
      ]);
    });

    it("should return empty array if pragma not found", () => {
      expect(parseLambdaUrlsPragma({})).toEqual([]);
      expect(parseLambdaUrlsPragma({ http: [] })).toEqual([]);
    });

    it("should handle lambdaUrls camelCase format", () => {
      const arc = {
        lambdaUrls: ["any /api/streams/:workspaceId/:agentId/:secret"],
      };
      const result = parseLambdaUrlsPragma(arc);
      expect(result).toEqual([
        "any /api/streams/:workspaceId/:agentId/:secret",
      ]);
    });
  });

  describe("extractPrNumberFromStackName", () => {
    it("should extract PR number from HelpmatonStagingPR29", () => {
      expect(extractPrNumberFromStackName("HelpmatonStagingPR29")).toBe(29);
    });

    it("should extract PR number from PR29", () => {
      expect(extractPrNumberFromStackName("PR29")).toBe(29);
    });

    it("should extract PR number from HelpmatonStagingPR123", () => {
      expect(extractPrNumberFromStackName("HelpmatonStagingPR123")).toBe(123);
    });

    it("should return null for production stack", () => {
      expect(extractPrNumberFromStackName("HelpmatonProduction")).toBeNull();
    });

    it("should return null for stack without PR", () => {
      expect(extractPrNumberFromStackName("HelpmatonStaging")).toBeNull();
    });

    it("should return null for null input", () => {
      expect(extractPrNumberFromStackName(null)).toBeNull();
    });

    it("should return null for undefined input", () => {
      expect(extractPrNumberFromStackName(undefined)).toBeNull();
    });
  });

  describe("getStreamingDnsName", () => {
    it("should return PR-specific DNS name for PR stack", () => {
      expect(getStreamingDnsName("HelpmatonStagingPR29", "staging")).toBe(
        "29-agent-stream.helpmaton.com"
      );
    });

    it("should return production DNS name for production stack", () => {
      expect(
        getStreamingDnsName("HelpmatonProduction", "production")
      ).toBe("agent-stream.helpmaton.com");
    });

    it("should return production DNS name when stack name contains Production", () => {
      expect(
        getStreamingDnsName("HelpmatonProduction", "staging")
      ).toBe("agent-stream.helpmaton.com");
    });

    it("should return null for stack without PR and not production", () => {
      expect(getStreamingDnsName("HelpmatonStaging", "staging")).toBeNull();
    });

    it("should return CloudFormation reference for CloudFormation stack name reference", () => {
      const result = getStreamingDnsName(
        { Ref: "AWS::StackName" },
        "staging"
      );
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
      expect(result["Fn::Sub"]).toBeDefined();
    });
  });

  describe("Streaming route configuration (no CloudFront/DNS)", () => {
    beforeEach(() => {
      process.env.ARC_STACK_NAME = "HelpmatonStagingPR29";
    });

    afterEach(() => {
      process.env.ARC_STACK_NAME = "TestStack";
    });

    it("should NOT create CloudFront distribution or Route53 record for streaming route", async () => {
      const streamingFunctionId =
        "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda";
      mockCloudformation.Resources[streamingFunctionId] = {
        Type: "AWS::Lambda::Function",
        Properties: {
          FunctionName: "test-function",
          Runtime: "nodejs20.x",
        },
      };

      const result = await configureLambdaUrls({
        cloudformation: mockCloudformation,
        inventory: mockInventory,
        arc: mockArc,
        stage: "staging",
      });

      const functionUrlId = `${streamingFunctionId}Url`;
      const distributionId = `${functionUrlId}CloudFrontDistribution`;
      const route53RecordId = `${functionUrlId}Route53Record`;

      // CloudFront distribution should NOT be created
      expect(result.Resources[distributionId]).toBeUndefined();
      
      // Route53 record should NOT be created
      expect(result.Resources[route53RecordId]).toBeUndefined();
      
      // DNS name output should NOT be created
      const dnsOutputId = "StreamingFunctionDnsName";
      expect(result.Outputs[dnsOutputId]).toBeUndefined();
      
      // But Function URL output should still be created
      expect(result.Outputs["StreamingFunctionUrl"]).toBeDefined();
    });

    it("should create CloudFormation output for Function URL (not DNS name)", async () => {
      const streamingFunctionId =
        "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda";
      mockCloudformation.Resources[streamingFunctionId] = {
        Type: "AWS::Lambda::Function",
        Properties: {
          FunctionName: "test-function",
          Runtime: "nodejs20.x",
        },
      };

      const result = await configureLambdaUrls({
        cloudformation: mockCloudformation,
        inventory: mockInventory,
        arc: mockArc,
        stage: "staging",
      });

      // DNS name output should NOT exist
      const dnsOutputId = "StreamingFunctionDnsName";
      expect(result.Outputs[dnsOutputId]).toBeUndefined();
      
      // Function URL output should exist
      const functionUrlOutputId = "StreamingFunctionUrl";
      expect(result.Outputs[functionUrlOutputId]).toBeDefined();
      expect(result.Outputs[functionUrlOutputId].Description).toContain(
        "Lambda Function URL for route"
      );
      expect(result.Outputs[functionUrlOutputId].Value).toBeDefined();
      expect(result.Outputs[functionUrlOutputId].Value["Fn::GetAtt"]).toBeDefined();
    });

    it("should work the same for production stack (no CloudFront/DNS)", async () => {
      process.env.ARC_STACK_NAME = "HelpmatonProduction";

      const streamingFunctionId =
        "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda";
      mockCloudformation.Resources[streamingFunctionId] = {
        Type: "AWS::Lambda::Function",
        Properties: {
          FunctionName: "test-function",
          Runtime: "nodejs20.x",
        },
      };

      const result = await configureLambdaUrls({
        cloudformation: mockCloudformation,
        inventory: mockInventory,
        arc: mockArc,
        stage: "production",
      });

      const functionUrlId = `${streamingFunctionId}Url`;
      const distributionId = `${functionUrlId}CloudFrontDistribution`;
      const route53RecordId = `${functionUrlId}Route53Record`;

      // CloudFront distribution should NOT be created
      expect(result.Resources[distributionId]).toBeUndefined();
      
      // Route53 record should NOT be created
      expect(result.Resources[route53RecordId]).toBeUndefined();
      
      // DNS name output should NOT be created
      const dnsOutputId = "StreamingFunctionDnsName";
      expect(result.Outputs[dnsOutputId]).toBeUndefined();
      
      // But Function URL output should still be created
      expect(result.Outputs["StreamingFunctionUrl"]).toBeDefined();
    });
  });
});

