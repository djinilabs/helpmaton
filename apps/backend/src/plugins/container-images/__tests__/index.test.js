import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  routeToFunctionId,
  routeToHandlerPath,
  queueToFunctionId,
  scheduledToFunctionId,
  queueToHandlerPath,
  scheduledToHandlerPath,
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

    it("should handle wildcard routes (catchall)", () => {
      const route = "any /api/workspaces/*";
      const result = routeToFunctionId(route);
      expect(result).toBe("AnyApiWorkspacesCatchallHTTPLambda");
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

    it("should handle wildcard routes (catchall)", () => {
      const route = "any /api/workspaces/*";
      const result = routeToHandlerPath(route);
      expect(result).toBe("http/any-api-workspaces-catchall/index.handler");
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

  describe("queueToFunctionId", () => {
    it("should convert a queue name to a function ID", () => {
      const result = queueToFunctionId("agent-temporal-grain-queue");
      expect(result).toBe("AgentTemporalGrainQueueQueueLambda");
    });

    it("should handle single-word queue names", () => {
      const result = queueToFunctionId("my-queue");
      expect(result).toBe("MyQueueQueueLambda");
    });

    it("should handle queue names with multiple segments", () => {
      const result = queueToFunctionId("workspace-agent-queue");
      expect(result).toBe("WorkspaceAgentQueueQueueLambda");
    });

    it("should return null for empty queue name", () => {
      expect(queueToFunctionId("")).toBeNull();
      expect(queueToFunctionId("   ")).toBeNull();
    });

    it("should return null for invalid input", () => {
      expect(queueToFunctionId(null)).toBeNull();
      expect(queueToFunctionId(undefined)).toBeNull();
    });
  });

  describe("scheduledToFunctionId", () => {
    it("should convert a scheduled name to a function ID", () => {
      const result = scheduledToFunctionId("aggregate-token-usage");
      expect(result).toBe("AggregateTokenUsageScheduledLambda");
    });

    it("should handle single-word scheduled names", () => {
      const result = scheduledToFunctionId("daily-task");
      expect(result).toBe("DailyTaskScheduledLambda");
    });

    it("should handle scheduled names with multiple segments", () => {
      const result = scheduledToFunctionId("summarize-memory-daily");
      expect(result).toBe("SummarizeMemoryDailyScheduledLambda");
    });

    it("should return null for empty scheduled name", () => {
      expect(scheduledToFunctionId("")).toBeNull();
      expect(scheduledToFunctionId("   ")).toBeNull();
    });

    it("should return null for invalid input", () => {
      expect(scheduledToFunctionId(null)).toBeNull();
      expect(scheduledToFunctionId(undefined)).toBeNull();
    });
  });

  describe("queueToHandlerPath", () => {
    it("should convert a queue name to handler path", () => {
      const result = queueToHandlerPath("agent-temporal-grain-queue");
      expect(result).toBe("queues/agent-temporal-grain-queue/index.handler");
    });

    it("should handle single-word queue names", () => {
      const result = queueToHandlerPath("my-queue");
      expect(result).toBe("queues/my-queue/index.handler");
    });

    it("should return null for empty queue name", () => {
      expect(queueToHandlerPath("")).toBeNull();
      expect(queueToHandlerPath("   ")).toBeNull();
    });

    it("should return null for invalid input", () => {
      expect(queueToHandlerPath(null)).toBeNull();
      expect(queueToHandlerPath(undefined)).toBeNull();
    });
  });

  describe("scheduledToHandlerPath", () => {
    it("should convert a scheduled name to handler path", () => {
      const result = scheduledToHandlerPath("aggregate-token-usage");
      expect(result).toBe("scheduled/aggregate-token-usage/index.handler");
    });

    it("should handle single-word scheduled names", () => {
      const result = scheduledToHandlerPath("daily-task");
      expect(result).toBe("scheduled/daily-task/index.handler");
    });

    it("should return null for empty scheduled name", () => {
      expect(scheduledToHandlerPath("")).toBeNull();
      expect(scheduledToHandlerPath("   ")).toBeNull();
    });

    it("should return null for invalid input", () => {
      expect(scheduledToHandlerPath(null)).toBeNull();
      expect(scheduledToHandlerPath(undefined)).toBeNull();
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
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toEqual(
        { imageName: "lancedb" }
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
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toEqual(
        { imageName: "lancedb" }
      );
      expect(result.get("GetApiUsageHTTPLambda")).toEqual({
        imageName: "custom-image",
      });
    });

    it("should handle string format pragma", () => {
      const arc = {
        "container-images": [
          "any /api/streams/:workspaceId/:agentId/:secret lancedb",
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(1);
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toEqual(
        { imageName: "lancedb" }
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
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toEqual(
        { imageName: "lancedb" }
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
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toEqual(
        { imageName: "lancedb" }
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
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toEqual(
        { imageName: "lancedb" }
      );
    });

    it("should parse group name in array format", () => {
      const arc = {
        "container-images": [
          ["any", "/api/streams/:workspaceId/:agentId/:secret", "lancedb", "llm-shared"],
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toEqual(
        { imageName: "lancedb", group: "llm-shared" }
      );
    });

    it("should parse group name in string format", () => {
      const arc = {
        "container-images": [
          "any /api/streams/:workspaceId/:agentId/:secret lancedb llm-shared",
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toEqual(
        { imageName: "lancedb", group: "llm-shared" }
      );
    });

    it("should parse queue entries in array format", () => {
      const arc = {
        "container-images": [
          ["queue", "agent-temporal-grain-queue", "lancedb"],
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(1);
      expect(result.get("AgentTemporalGrainQueueQueueLambda")).toEqual({
        imageName: "lancedb",
      });
    });

    it("should parse scheduled entries in array format", () => {
      const arc = {
        "container-images": [
          ["scheduled", "aggregate-token-usage", "lancedb"],
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(1);
      expect(result.get("AggregateTokenUsageScheduledLambda")).toEqual({
        imageName: "lancedb",
      });
    });

    it("should parse queue entries in string format", () => {
      const arc = {
        "container-images": [
          "queue agent-temporal-grain-queue lancedb",
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(1);
      expect(result.get("AgentTemporalGrainQueueQueueLambda")).toEqual({
        imageName: "lancedb",
      });
    });

    it("should parse scheduled entries in string format", () => {
      const arc = {
        "container-images": [
          "scheduled aggregate-token-usage lancedb",
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(1);
      expect(result.get("AggregateTokenUsageScheduledLambda")).toEqual({
        imageName: "lancedb",
      });
    });

    it("should parse mixed HTTP, queue, and scheduled entries", () => {
      const arc = {
        "container-images": [
          ["any", "/api/streams/:workspaceId/:agentId/:secret", "lancedb"],
          ["queue", "agent-temporal-grain-queue", "lancedb"],
          ["scheduled", "aggregate-token-usage", "lancedb"],
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(3);
      expect(result.get("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda")).toEqual({
        imageName: "lancedb",
      });
      expect(result.get("AgentTemporalGrainQueueQueueLambda")).toEqual({
        imageName: "lancedb",
      });
      expect(result.get("AggregateTokenUsageScheduledLambda")).toEqual({
        imageName: "lancedb",
      });
    });

    it("should handle case-insensitive type detection", () => {
      const arc = {
        "container-images": [
          ["QUEUE", "agent-temporal-grain-queue", "lancedb"],
          ["SCHEDULED", "aggregate-token-usage", "lancedb"],
        ],
      };
      const result = parseContainerImagesPragma(arc);
      expect(result.size).toBe(2);
      expect(result.get("AgentTemporalGrainQueueQueueLambda")).toEqual({
        imageName: "lancedb",
      });
      expect(result.get("AggregateTokenUsageScheduledLambda")).toEqual({
        imageName: "lancedb",
      });
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
      // Phase 3: Using ImageConfig.Command to point directly to handler path
      expect(functionResource.Properties.ImageConfig.Command).toEqual(["http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"]);
      // EntryPoint must be set when ImageConfig is present (Lambda requires all properties to be non-empty)
      expect(functionResource.Properties.ImageConfig.EntryPoint).toEqual(["/lambda-entrypoint.sh"]);
      expect(functionResource.Properties.ImageConfig.WorkingDirectory).toBe("/var/task");
      expect(functionResource.Properties.Environment.Variables.LAMBDA_HANDLER_PATH).toBe(
        "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
      );
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
      expect(functionResource.Properties.Environment.Variables.LAMBDA_HANDLER_PATH).toBe(
        "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
      );
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
      // Phase 3: Using ImageConfig.Command to point directly to handler path
      expect(functionResource.Properties.ImageConfig.Command).toEqual(["http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"]);
      // EntryPoint must be set when ImageConfig is present (Lambda requires all properties to be non-empty)
      expect(functionResource.Properties.ImageConfig.EntryPoint).toEqual(["/lambda-entrypoint.sh"]);
      expect(functionResource.Properties.ImageConfig.WorkingDirectory).toBe("/var/task");
      expect(functionResource.Properties.Environment.Variables.LAMBDA_HANDLER_PATH).toBe(
        "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
      );
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
      // Phase 3: Using ImageConfig.Command to point directly to handler path
      expect(functionResource.Properties.ImageConfig.Command).toEqual(["http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"]);
      // EntryPoint must be set when ImageConfig is present (Lambda requires all properties to be non-empty)
      expect(functionResource.Properties.ImageConfig.EntryPoint).toEqual(["/lambda-entrypoint.sh"]);
      expect(functionResource.Properties.ImageConfig.WorkingDirectory).toBe("/var/task");
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

    it("should throw error when function not found", async () => {
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

      process.env.LAMBDA_IMAGES_ECR_REPOSITORY = "test-repo";
      process.env.LAMBDA_IMAGE_TAG = "test-tag";
      process.env.AWS_REGION = "eu-west-2";

      // Verify error is thrown and contains expected information
      try {
        await configureContainerImages({
          cloudformation,
          arc,
        });
        expect.fail("Expected error to be thrown");
      } catch (error) {
        expect(error.message).toContain("Lambda function(s) not found in CloudFormation resources");
        expect(error.message).toContain("AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda");
        expect(error.message).toContain("Available function IDs");
        expect(error.message).toContain("OtherFunction");
      }

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

    it("should handle wildcard routes correctly", async () => {
      const cloudformation = {
        Resources: {
          AnyApiWorkspacesCatchallHTTPLambda: {
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
          ["any", "/api/workspaces/*", "lancedb"],
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
        result.Resources.AnyApiWorkspacesCatchallHTTPLambda;
      expect(functionResource.Properties.PackageType).toBe("Image");
      // Verify handler path correctly converts * to catchall
      expect(functionResource.Properties.ImageConfig.Command).toEqual([
        "http/any-api-workspaces-catchall/index.handler",
      ]);
      expect(functionResource.Properties.ImageConfig.EntryPoint).toEqual([
        "/lambda-entrypoint.sh",
      ]);
      expect(functionResource.Properties.ImageConfig.WorkingDirectory).toBe(
        "/var/task"
      );

      delete process.env.LAMBDA_IMAGES_ECR_REPOSITORY;
      delete process.env.LAMBDA_IMAGE_TAG;
      delete process.env.AWS_REGION;
    });

    it("should convert queue function to container image", async () => {
      const cloudformation = {
        Resources: {
          AgentTemporalGrainQueueQueueLambda: {
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
          ["queue", "agent-temporal-grain-queue", "lancedb"],
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
        result.Resources.AgentTemporalGrainQueueQueueLambda;
      expect(functionResource.Properties.PackageType).toBe("Image");
      expect(functionResource.Properties.ImageUri).toBeDefined();
      expect(functionResource.Properties.Handler).toBeUndefined();
      expect(functionResource.Properties.ImageConfig.Command).toEqual([
        "queues/agent-temporal-grain-queue/index.handler",
      ]);
      expect(functionResource.Properties.ImageConfig.EntryPoint).toEqual([
        "/lambda-entrypoint.sh",
      ]);
      expect(functionResource.Properties.ImageConfig.WorkingDirectory).toBe(
        "/var/task"
      );

      delete process.env.LAMBDA_IMAGES_ECR_REPOSITORY;
      delete process.env.LAMBDA_IMAGE_TAG;
      delete process.env.AWS_REGION;
    });

    it("should convert scheduled function to container image", async () => {
      const cloudformation = {
        Resources: {
          AggregateTokenUsageScheduledLambda: {
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
          ["scheduled", "aggregate-token-usage", "lancedb"],
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
        result.Resources.AggregateTokenUsageScheduledLambda;
      expect(functionResource.Properties.PackageType).toBe("Image");
      expect(functionResource.Properties.ImageUri).toBeDefined();
      expect(functionResource.Properties.Handler).toBeUndefined();
      expect(functionResource.Properties.ImageConfig.Command).toEqual([
        "scheduled/aggregate-token-usage/index.handler",
      ]);
      expect(functionResource.Properties.ImageConfig.EntryPoint).toEqual([
        "/lambda-entrypoint.sh",
      ]);
      expect(functionResource.Properties.ImageConfig.WorkingDirectory).toBe(
        "/var/task"
      );

      delete process.env.LAMBDA_IMAGES_ECR_REPOSITORY;
      delete process.env.LAMBDA_IMAGE_TAG;
      delete process.env.AWS_REGION;
    });

    it("should handle mixed HTTP, queue, and scheduled functions", async () => {
      const cloudformation = {
        Resources: {
          AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda: {
            Type: "AWS::Serverless::Function",
            Properties: {
              Handler: "index.handler",
              Runtime: "nodejs20.x",
            },
          },
          AgentTemporalGrainQueueQueueLambda: {
            Type: "AWS::Serverless::Function",
            Properties: {
              Handler: "index.handler",
              Runtime: "nodejs20.x",
            },
          },
          AggregateTokenUsageScheduledLambda: {
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
          ["queue", "agent-temporal-grain-queue", "lancedb"],
          ["scheduled", "aggregate-token-usage", "lancedb"],
        ],
      };

      process.env.LAMBDA_IMAGES_ECR_REPOSITORY = "test-repo";
      process.env.LAMBDA_IMAGE_TAG = "test-tag";
      process.env.AWS_REGION = "eu-west-2";

      const result = await configureContainerImages({
        cloudformation,
        arc,
      });

      // Verify HTTP function
      const httpFunction =
        result.Resources.AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda;
      expect(httpFunction.Properties.PackageType).toBe("Image");
      expect(httpFunction.Properties.ImageConfig.Command).toEqual([
        "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler",
      ]);

      // Verify queue function
      const queueFunction =
        result.Resources.AgentTemporalGrainQueueQueueLambda;
      expect(queueFunction.Properties.PackageType).toBe("Image");
      expect(queueFunction.Properties.ImageConfig.Command).toEqual([
        "queues/agent-temporal-grain-queue/index.handler",
      ]);

      // Verify scheduled function
      const scheduledFunction =
        result.Resources.AggregateTokenUsageScheduledLambda;
      expect(scheduledFunction.Properties.PackageType).toBe("Image");
      expect(scheduledFunction.Properties.ImageConfig.Command).toEqual([
        "scheduled/aggregate-token-usage/index.handler",
      ]);

      delete process.env.LAMBDA_IMAGES_ECR_REPOSITORY;
      delete process.env.LAMBDA_IMAGE_TAG;
      delete process.env.AWS_REGION;
    });

    it("should merge grouped functions into a single Lambda", async () => {
      const cloudformation = {
        Resources: {
          AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda: {
            Type: "AWS::Serverless::Function",
            Properties: {
              Handler: "index.handler",
              Runtime: "nodejs20.x",
              Events: {
                StreamEvent: {
                  Type: "Api",
                  Properties: {
                    Path: "/api/streams/{proxy+}",
                    Method: "ANY",
                  },
                },
              },
            },
          },
          PostApiWebhookWorkspaceIdAgentIdKeyHTTPLambda: {
            Type: "AWS::Serverless::Function",
            Properties: {
              Handler: "index.handler",
              Runtime: "nodejs20.x",
              Timeout: 900,
              Events: {
                WebhookEvent: {
                  Type: "Api",
                  Properties: {
                    Path: "/api/webhook/{workspaceId}/{agentId}/{key}",
                    Method: "POST",
                  },
                },
              },
            },
          },
          PostApiWebhookPermission: {
            Type: "AWS::Lambda::Permission",
            Properties: {
              FunctionName: {
                "Fn::GetAtt": [
                  "PostApiWebhookWorkspaceIdAgentIdKeyHTTPLambda",
                  "Arn",
                ],
              },
              Action: "lambda:InvokeFunction",
              Principal: "apigateway.amazonaws.com",
            },
          },
        },
        Outputs: {},
      };

      const arc = {
        "container-images": [
          [
            "any",
            "/api/streams/:workspaceId/:agentId/:secret",
            "lancedb",
            "llm-shared",
          ],
          [
            "post",
            "/api/webhook/:workspaceId/:agentId/:key",
            "lancedb",
            "llm-shared",
          ],
        ],
      };

      process.env.LAMBDA_IMAGES_ECR_REPOSITORY = "test-repo";
      process.env.LAMBDA_IMAGE_TAG = "test-tag";
      process.env.AWS_REGION = "eu-west-2";

      const result = await configureContainerImages({
        cloudformation,
        arc,
      });

      const primary =
        result.Resources.AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda;
      expect(primary).toBeDefined();
      expect(primary.Properties.Timeout).toBe(900);
      expect(primary.Properties.Events.StreamEvent).toBeDefined();
      expect(primary.Properties.Events.WebhookEvent).toBeDefined();
      expect(primary.Properties.ImageConfig.Command).toEqual([
        "http/llm-shared/index.handler",
      ]);

      expect(
        result.Resources.PostApiWebhookWorkspaceIdAgentIdKeyHTTPLambda
      ).toBeUndefined();

      const permission = result.Resources.PostApiWebhookPermission;
      expect(permission.Properties.FunctionName["Fn::GetAtt"][0]).toBe(
        "AnyApiStreamsWorkspaceIdAgentIdSecretHTTPLambda"
      );

      delete process.env.LAMBDA_IMAGES_ECR_REPOSITORY;
      delete process.env.LAMBDA_IMAGE_TAG;
      delete process.env.AWS_REGION;
    });
  });
});


