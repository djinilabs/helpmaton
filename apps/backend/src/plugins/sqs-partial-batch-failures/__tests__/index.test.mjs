import { describe, it, expect } from "vitest";

import {
  queueNameToFunctionId,
  queueNameToResourceId,
  queueNameToEventSourceMappingId,
  parseQueuesPragma,
  configureSqsPartialBatchFailures,
} from "../index.js";

describe("sqs-partial-batch-failures plugin", () => {
  describe("queueNameToFunctionId", () => {
    it("should convert kebab-case queue name to function ID", () => {
      expect(queueNameToFunctionId("agent-temporal-grain-queue")).toBe(
        "AgentTemporalGrainQueueLambda"
      );
    });

    it("should handle single word queue names", () => {
      expect(queueNameToFunctionId("myqueue")).toBe("MyqueueLambda");
    });

    it("should return null for empty input", () => {
      expect(queueNameToFunctionId("")).toBeNull();
      expect(queueNameToFunctionId(null)).toBeNull();
      expect(queueNameToFunctionId(undefined)).toBeNull();
    });
  });

  describe("queueNameToResourceId", () => {
    it("should convert kebab-case queue name to resource ID", () => {
      expect(queueNameToResourceId("agent-temporal-grain-queue")).toBe(
        "AgentTemporalGrainQueue"
      );
    });

    it("should handle single word queue names", () => {
      expect(queueNameToResourceId("myqueue")).toBe("Myqueue");
    });

    it("should return null for empty input", () => {
      expect(queueNameToResourceId("")).toBeNull();
      expect(queueNameToResourceId(null)).toBeNull();
      expect(queueNameToResourceId(undefined)).toBeNull();
    });
  });

  describe("queueNameToEventSourceMappingId", () => {
    it("should convert queue name to event source mapping ID", () => {
      expect(
        queueNameToEventSourceMappingId("agent-temporal-grain-queue")
      ).toBe("AgentTemporalGrainQueueLambdaEventSourceMapping");
    });

    it("should return null for empty input", () => {
      expect(queueNameToEventSourceMappingId("")).toBeNull();
      expect(queueNameToEventSourceMappingId(null)).toBeNull();
      expect(queueNameToEventSourceMappingId(undefined)).toBeNull();
    });
  });

  describe("parseQueuesPragma", () => {
    it("should parse queue pragma with options", () => {
      const arc = {
        queues: [
          ["agent-temporal-grain-queue"],
          ["fifo", "true"],
          ["visibilityTimeout", "60"],
          ["messageRetentionPeriod", "1209600"],
        ],
      };

      const result = parseQueuesPragma(arc);

      expect(result).toEqual([
        {
          name: "agent-temporal-grain-queue",
          options: {
            fifo: "true",
            visibilityTimeout: "60",
            messageRetentionPeriod: "1209600",
          },
        },
      ]);
    });

    it("should parse multiple queues", () => {
      const arc = {
        queues: [
          ["queue-one"],
          ["fifo", "true"],
          ["queue-two"],
          ["visibilityTimeout", "30"],
        ],
      };

      const result = parseQueuesPragma(arc);

      expect(result).toEqual([
        {
          name: "queue-one",
          options: {
            fifo: "true",
          },
        },
        {
          name: "queue-two",
          options: {
            visibilityTimeout: "30",
          },
        },
      ]);
    });

    it("should return empty array when no queues pragma", () => {
      const arc = {};
      const result = parseQueuesPragma(arc);
      expect(result).toEqual([]);
    });

    it("should handle queue with no options", () => {
      const arc = {
        queues: [["simple-queue"]],
      };

      const result = parseQueuesPragma(arc);

      expect(result).toEqual([
        {
          name: "simple-queue",
          options: {},
        },
      ]);
    });
  });

  describe("configureSqsPartialBatchFailures", () => {
    it("should configure FunctionResponseTypes for event source mapping", async () => {
      const cloudformation = {
        Resources: {
          AgentTemporalGrainQueueLambdaEventSourceMapping: {
            Type: "AWS::Lambda::EventSourceMapping",
            Properties: {
              FunctionName: { Ref: "AgentTemporalGrainQueueLambda" },
              EventSourceArn: {
                "Fn::GetAtt": ["AgentTemporalGrainQueue", "Arn"],
              },
            },
          },
        },
      };

      const arc = {
        queues: [["agent-temporal-grain-queue"]],
      };

      const result = await configureSqsPartialBatchFailures({
        cloudformation,
        inventory: null,
        arc,
      });

      expect(
        result.Resources.AgentTemporalGrainQueueLambdaEventSourceMapping
          .Properties.FunctionResponseTypes
      ).toEqual(["ReportBatchItemFailures"]);
    });

    it("should not override existing FunctionResponseTypes", async () => {
      const cloudformation = {
        Resources: {
          AgentTemporalGrainQueueLambdaEventSourceMapping: {
            Type: "AWS::Lambda::EventSourceMapping",
            Properties: {
              FunctionName: { Ref: "AgentTemporalGrainQueueLambda" },
              EventSourceArn: {
                "Fn::GetAtt": ["AgentTemporalGrainQueue", "Arn"],
              },
              FunctionResponseTypes: ["ReportBatchItemFailures"],
            },
          },
        },
      };

      const arc = {
        queues: [["agent-temporal-grain-queue"]],
      };

      const result = await configureSqsPartialBatchFailures({
        cloudformation,
        inventory: null,
        arc,
      });

      // Should not create a duplicate
      expect(
        result.Resources.AgentTemporalGrainQueueLambdaEventSourceMapping
          .Properties.FunctionResponseTypes
      ).toEqual(["ReportBatchItemFailures"]);
    });

    it("should handle multiple queues", async () => {
      const cloudformation = {
        Resources: {
          QueueOneLambdaEventSourceMapping: {
            Type: "AWS::Lambda::EventSourceMapping",
            Properties: {
              FunctionName: { Ref: "QueueOneLambda" },
            },
          },
          QueueTwoLambdaEventSourceMapping: {
            Type: "AWS::Lambda::EventSourceMapping",
            Properties: {
              FunctionName: { Ref: "QueueTwoLambda" },
            },
          },
        },
      };

      const arc = {
        queues: [["queue-one"], ["queue-two"]],
      };

      const result = await configureSqsPartialBatchFailures({
        cloudformation,
        inventory: null,
        arc,
      });

      expect(
        result.Resources.QueueOneLambdaEventSourceMapping.Properties
          .FunctionResponseTypes
      ).toEqual(["ReportBatchItemFailures"]);
      expect(
        result.Resources.QueueTwoLambdaEventSourceMapping.Properties
          .FunctionResponseTypes
      ).toEqual(["ReportBatchItemFailures"]);
    });

    it("should handle missing event source mapping gracefully", async () => {
      const cloudformation = {
        Resources: {},
      };

      const arc = {
        queues: [["non-existent-queue"]],
      };

      // Should not throw
      await expect(
        configureSqsPartialBatchFailures({
          cloudformation,
          inventory: null,
          arc,
        })
      ).resolves.toBeDefined();
    });

    it("should skip when no queues pragma", async () => {
      const cloudformation = {
        Resources: {},
      };

      const arc = {};

      const result = await configureSqsPartialBatchFailures({
        cloudformation,
        inventory: null,
        arc,
      });

      expect(result).toBe(cloudformation);
    });
  });
});

