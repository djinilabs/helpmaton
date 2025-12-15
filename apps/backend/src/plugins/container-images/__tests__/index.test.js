import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  routeToFunctionId,
  routeToHandlerPath,
  parseContainerImagesPragma,
  getEcrImageUri,
  convertToContainerImage,
  configureContainerImages,
} from "../index.js";

describe("container-images plugin", () => {
  describe("routeToFunctionId", () => {
    it("should convert a route to a function ID", () => {
      const route = "any /api/streams/:workspaceId/:agentId/:secret";
      const result = routeToFunctionId(route);
      expect(result).toBe("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda");
    });

    it("should handle GET routes", () => {
      const route = "get /api/usage";
      const result = routeToFunctionId(route);
      expect(result).toBe("GetApiUsageHTTPLambda");
    });

    it("should handle POST routes", () => {
      const route = "post /api/webhook/:workspaceId/:agentId/:key";
      const result = routeToFunctionId(route);
      expect(result).toBe("PostApiWebhookWorkspaceIdAgentIdKeyHTTPLambda");
    });

    it("should return null for empty route", () => {
      expect(routeToFunctionId("")).toBeNull();
      expect(routeToFunctionId("   ")).toBeNull();
    });

    it("should return null for invalid route format", () => {
      expect(routeToFunctionId("invalid")).toBeNull();
      expect(routeToFunctionId("get")).toBeNull();
    });

    it("should handle routes without leading slash", () => {
      const route = "any api/streams/:workspaceId/:agentId/:secret";
      const result = routeToFunctionId(route);
      expect(result).toBe("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda");
    });
  });

  describe("routeToHandlerPath", () => {
    it("should convert a route to handler path", () => {
      const route = "any /api/streams/:workspaceId/:agentId/:secret";
      const result = routeToHandlerPath(route);
      expect(result).toBe("http/any-api-streams-000workspaceId-000agentId-000secret/index.handler");
    });

    it("should handle GET routes", () => {
      const route = "get /api/usage";
      const result = routeToHandlerPath(route);
      expect(result).toBe("http/get-api-usage/index.handler");
    });

    it("should handle POST routes", () => {
      const route = "post /api/webhook/:workspaceId/:agentId/:key";
      const result = routeToHandlerPath(route);
      expect(result).toBe("http/post-api-webhook-000workspaceId-000agentId-000key/index.handler");
    });

    it("should return null for empty route", () => {
      expect(routeToHandlerPath("")).toBeNull();
      expect(routeToHandlerPath("   ")).toBeNull();
    });

    it("should return null for invalid route format", () => {
      expect(routeToHandlerPath("invalid")).toBeNull();
      expect(routeToHandlerPath("get")).toBeNull();
    });
  });

  describe("parseContainerImagesPragma", () => {
    it("should parse array format pragma", () => {
      const arc = {
        "container-images": [
          ["any", "/api/streams/:workspaceId/:agentId/:secret", "lancedb"],
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(1);
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toBe(
        "lancedb"
      );
    });

    it("should parse multiple container images", () => {
      const arc = {
        "container-images": [
          ["any", "/api/streams/:workspaceId/:agentId/:secret", "lancedb"],
          ["get", "/api/usage", "custom-image"],
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(2);
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toBe(
        "lancedb"
      );
      expect(result.get("GetApiUsageHTTPLambda")).toBe("custom-image");
    });

    it("should handle string format pragma", () => {
      const arc = {
        "container-images": [
          "any /api/streams/:workspaceId/:agentId/:secret lancedb",
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(1);
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toBe(
        "lancedb"
      );
    });

    it("should return empty map when pragma is missing", () => {
      const arc = {};
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(0);
    });

    it("should return empty map when pragma is null", () => {
      const arc = { "container-images": null };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(0);
    });

    it("should handle camelCase pragma key", () => {
      const arc = {
        containerImages: [
          ["any", "/api/streams/:workspaceId/:agentId/:secret", "lancedb"],
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(1);
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toBe(
        "lancedb"
      );
    });

    it("should skip invalid items with missing fields", () => {
      const arc = {
        "container-images": [
          ["any", "/api/streams/:workspaceId/:agentId/:secret", "lancedb"],
          ["get"], // Missing path and imageName
          ["post", "/api/test"], // Missing imageName
          null,
          undefined,
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(1);
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toBe(
        "lancedb"
      );
    });

    it("should skip items with undefined values", () => {
      const arc = {
        "container-images": [
          [undefined, "/api/test", "image"],
          ["get", undefined, "image"],
          ["post", "/api/test", undefined],
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(0);
    });

    it("should trim image names", () => {
      const arc = {
        "container-images": [
          ["any", "/api/streams/:workspaceId/:agentId/:secret", "  lancedb  "],
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toBe(
        "lancedb"
      );
    });
  });

  describe("getEcrImageUri", () => {
    it("should construct URI with account ID", () => {
      const result = getEcrImageUri(
        "lancedb",
        "eu-west-2",
        "123456789012",
        "helpmaton-lambda-images",
        "latest"
      );
      expect(result).toBe(
        "123456789012.dkr.ecr.eu-west-2.amazonaws.com/helpmaton-lambda-images:lancedb-latest"
      );
    });

    it("should use CloudFormation reference when accountId is null", () => {
      const result = getEcrImageUri(
        "lancedb",
        "eu-west-2",
        null,
        "helpmaton-lambda-images",
        "test-tag"
      );
      expect(result).toEqual({
        "Fn::Sub": [
          "${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/${RepositoryName}:${ImageName}-${Tag}",
          {
            RepositoryName: "helpmaton-lambda-images",
            ImageName: "lancedb",
            Tag: "test-tag",
          },
        ],
      });
    });

    it("should default tag to latest", () => {
      const result = getEcrImageUri(
        "lancedb",
        "eu-west-2",
        "123456789012",
        "helpmaton-lambda-images"
      );
      expect(result).toBe(
        "123456789012.dkr.ecr.eu-west-2.amazonaws.com/helpmaton-lambda-images:lancedb-latest"
      );
    });
  });

  describe("convertToContainerImage", () => {
    it("should convert AWS::Serverless::Function to use container image", () => {
      const functionResource = {
        Type: "AWS::Serverless::Function",
        Properties: {
          Handler: "index.handler",
          Runtime: "nodejs20.x",
          CodeUri: "s3://bucket/key.zip",
        },
      };
      const imageUri = "123456789012.dkr.ecr.eu-west-2.amazonaws.com/repo:image-latest";

      convertToContainerImage(
        functionResource,
        imageUri,
        "TestFunction",
        "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
      );

      expect(functionResource.Properties.PackageType).toBe("Image");
      expect(functionResource.Properties.ImageUri).toBe(imageUri);
      expect(functionResource.Properties.CodeUri).toBe("");
      expect(functionResource.Properties.Code).toBeUndefined();
      expect(functionResource.Properties.Runtime).toBeUndefined();
      expect(functionResource.Properties.Handler).toBeUndefined();
      expect(functionResource.Properties.Environment.Variables.LAMBDA_HANDLER_PATH).toBe("http/any-api-streams-000workspaceId-000agentId-000secret/index.handler");
    });

    it("should convert AWS::Lambda::Function to use container image", () => {
      const functionResource = {
        Type: "AWS::Lambda::Function",
        Properties: {
          Handler: "index.handler",
          Runtime: "nodejs20.x",
          Code: {
            S3Bucket: "bucket",
            S3Key: "key.zip",
          },
        },
      };
      const imageUri = {
        "Fn::Sub": ["${AccountId}.dkr.ecr.${Region}.amazonaws.com/repo:image"],
      };

      convertToContainerImage(
        functionResource,
        imageUri,
        "TestFunction",
        "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
      );

      expect(functionResource.Properties.PackageType).toBe("Image");
      expect(functionResource.Properties.Code).toEqual({
        ImageUri: imageUri,
      });
      expect(functionResource.Properties.Runtime).toBeUndefined();
      expect(functionResource.Properties.Handler).toBeUndefined();
    });

    it("should skip non-Lambda resources", () => {
      const functionResource = {
        Type: "AWS::S3::Bucket",
        Properties: {},
      };
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      convertToContainerImage(
        functionResource,
        "image-uri",
        "TestBucket",
        null
      );

      expect(consoleSpy).toHaveBeenCalled();
      const warnCall = consoleSpy.mock.calls[0];
      expect(warnCall[0]).toContain("is not a Lambda function");
      expect(functionResource.Properties.PackageType).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it("should handle resources without Properties", () => {
      const functionResource = {
        Type: "AWS::Serverless::Function",
      };
      const imageUri = "image-uri";

      convertToContainerImage(
        functionResource,
        imageUri,
        "TestFunction",
        "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
      );

      expect(functionResource.Properties).toBeDefined();
      expect(functionResource.Properties.PackageType).toBe("Image");
      expect(functionResource.Properties.ImageUri).toBe(imageUri);
      expect(functionResource.Properties.Handler).toBeUndefined();
      expect(functionResource.Properties.Environment.Variables.LAMBDA_HANDLER_PATH).toBe("http/any-api-streams-000workspaceId-000agentId-000secret/index.handler");
    });
  });

  describe("configureContainerImages", () => {
    it("should convert functions to container images", async () => {
      const cloudformation = {
        Resources: {
          AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda: {
            Type: "AWS::Serverless::Function",
            Properties: {
              Handler: "index.handler",
              Runtime: "nodejs20.x",
            },
          },
        },
        Outputs: {},
      };

      const arc = {
        "container-images": [
          ["any", "/api/streams/:workspaceId/:agentId/:secret", "lancedb"],
        ],
      };

      process.env.LAMBDA_IMAGES_ECR_REPOSITORY = "test-repo";
      process.env.LAMBDA_IMAGE_TAG = "test-tag";
      process.env.AWS_REGION = "eu-west-2";

      const result = await configureContainerImages({
        cloudformation,
        arc,
      });

      const functionResource =
        result.Resources.AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda;
      expect(functionResource.Properties.PackageType).toBe("Image");
      expect(functionResource.Properties.ImageUri).toBeDefined();
      expect(functionResource.Properties.ImageUri["Fn::Sub"]).toBeDefined();
      expect(functionResource.Properties.Handler).toBeUndefined();
      expect(functionResource.Properties.Environment.Variables.LAMBDA_HANDLER_PATH).toBe("http/any-api-streams-000workspaceId-000agentId-000secret/index.handler");
      expect(result.Outputs.LambdaImagesRepositoryUri).toBeDefined();

      delete process.env.LAMBDA_IMAGES_ECR_REPOSITORY;
      delete process.env.LAMBDA_IMAGE_TAG;
      delete process.env.AWS_REGION;
    });

    it("should skip when no container-images pragma found", async () => {
      const cloudformation = {
        Resources: {},
        Outputs: {},
      };

      const arc = {};

      const result = await configureContainerImages({
        cloudformation,
        arc,
      });

      expect(result).toBe(cloudformation);
    });

    it("should warn when function not found", async () => {
      const cloudformation = {
        Resources: {
          OtherFunction: {
            Type: "AWS::Serverless::Function",
            Properties: {},
          },
        },
        Outputs: {},
      };

      const arc = {
        "container-images": [
          ["any", "/api/streams/:workspaceId/:agentId/:secret", "lancedb"],
        ],
      };

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      process.env.LAMBDA_IMAGES_ECR_REPOSITORY = "test-repo";
      process.env.LAMBDA_IMAGE_TAG = "test-tag";
      process.env.AWS_REGION = "eu-west-2";

      await configureContainerImages({
        cloudformation,
        arc,
      });

      expect(consoleSpy).toHaveBeenCalled();
      const warnCall = consoleSpy.mock.calls[0];
      expect(warnCall[0]).toContain("not found in CloudFormation resources");

      consoleSpy.mockRestore();
      delete process.env.LAMBDA_IMAGES_ECR_REPOSITORY;
      delete process.env.LAMBDA_IMAGE_TAG;
      delete process.env.AWS_REGION;
    });

    it("should use default repository name when env var not set", async () => {
      const cloudformation = {
        Resources: {
          AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda: {
            Type: "AWS::Serverless::Function",
            Properties: {},
          },
        },
        Outputs: {},
      };

      const arc = {
        "container-images": [
          ["any", "/api/streams/:workspaceId/:agentId/:secret", "lancedb"],
        ],
      };

      delete process.env.LAMBDA_IMAGES_ECR_REPOSITORY;
      process.env.LAMBDA_IMAGE_TAG = "test-tag";
      process.env.AWS_REGION = "eu-west-2";

      const result = await configureContainerImages({
        cloudformation,
        arc,
      });

      const imageUri =
        result.Resources.AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda
          .Properties.ImageUri;
      expect(imageUri["Fn::Sub"][1].RepositoryName).toBe(
        "helpmaton-lambda-images"
      );

      delete process.env.LAMBDA_IMAGE_TAG;
      delete process.env.AWS_REGION;
    });
  });
});

