import { describe, it, expect } from "vitest";

import {
  buildAgentEvalJudgePk,
  buildEvalJudgeRecordForCreate,
  buildEvalJudgeUpdatePayload,
  type ExistingEvalJudgeForUpdate,
} from "../agentEvalJudge";

describe("agentEvalJudge", () => {
  describe("buildAgentEvalJudgePk", () => {
    it("returns pk in agent-eval-judges/{workspaceId}/{agentId}/{judgeId} format", () => {
      expect(
        buildAgentEvalJudgePk("ws-1", "agent-2", "judge-3")
      ).toBe("agent-eval-judges/ws-1/agent-2/judge-3");
    });
  });

  describe("buildEvalJudgeRecordForCreate", () => {
    it("builds full record with defaults (enabled true, samplingProbability 100, provider openrouter)", () => {
      const record = buildEvalJudgeRecordForCreate(
        "ws-1",
        "agent-2",
        "judge-3",
        {
          name: "Accuracy",
          modelName: "gpt-4o",
          evalPrompt: "Evaluate accuracy",
        }
      );

      expect(record.pk).toBe("agent-eval-judges/ws-1/agent-2/judge-3");
      expect(record.sk).toBe("judge");
      expect(record.workspaceId).toBe("ws-1");
      expect(record.agentId).toBe("agent-2");
      expect(record.judgeId).toBe("judge-3");
      expect(record.name).toBe("Accuracy");
      expect(record.enabled).toBe(true);
      expect(record.samplingProbability).toBe(100);
      expect(record.provider).toBe("openrouter");
      expect(record.modelName).toBe("gpt-4o");
      expect(record.evalPrompt).toBe("Evaluate accuracy");
      expect(record.version).toBe(1);
      expect(record.createdAt).toBeDefined();
    });

    it("uses provided enabled, samplingProbability, provider when set", () => {
      const record = buildEvalJudgeRecordForCreate(
        "ws-1",
        "agent-2",
        "judge-3",
        {
          name: "Custom",
          enabled: false,
          samplingProbability: 50,
          provider: "openrouter",
          modelName: "gpt-4o",
          evalPrompt: "Prompt",
        }
      );

      expect(record.enabled).toBe(false);
      expect(record.samplingProbability).toBe(50);
      expect(record.provider).toBe("openrouter");
    });
  });

  describe("buildEvalJudgeUpdatePayload", () => {
    const existing: ExistingEvalJudgeForUpdate = {
      pk: "agent-eval-judges/ws-1/agent-2/judge-1",
      sk: "judge",
      workspaceId: "ws-1",
      agentId: "agent-2",
      judgeId: "judge-1",
      name: "Old name",
      enabled: true,
      samplingProbability: 100,
      provider: "openrouter",
      modelName: "gpt-4o",
      evalPrompt: "Old prompt",
    };

    it("merges partial name and evalPrompt update and sets updatedAt", () => {
      const payload = buildEvalJudgeUpdatePayload(existing, {
        name: "New name",
        evalPrompt: "New prompt",
      });

      expect(payload.name).toBe("New name");
      expect(payload.evalPrompt).toBe("New prompt");
      expect(payload.modelName).toBe("gpt-4o");
      expect(payload.updatedAt).toBeDefined();
    });

    it("updates enabled and samplingProbability", () => {
      const payload = buildEvalJudgeUpdatePayload(existing, {
        enabled: false,
        samplingProbability: 25,
      });

      expect(payload.enabled).toBe(false);
      expect(payload.samplingProbability).toBe(25);
    });

    it("updates modelName and provider", () => {
      const payload = buildEvalJudgeUpdatePayload(existing, {
        modelName: "claude-3-5-sonnet",
        provider: "openrouter",
      });

      expect(payload.modelName).toBe("claude-3-5-sonnet");
      expect(payload.provider).toBe("openrouter");
    });
  });
});
