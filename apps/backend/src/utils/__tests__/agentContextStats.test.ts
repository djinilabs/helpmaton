import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDefaultModel = vi.hoisted(() => vi.fn());
const mockGetModelContextLength = vi.hoisted(() => vi.fn());
const mockGetMaxSafeInputTokens = vi.hoisted(() => vi.fn());
const mockGetModelPricing = vi.hoisted(() => vi.fn());
const mockBuildSystemPromptWithSkills = vi.hoisted(() => vi.fn());

vi.mock("../../http/utils/modelFactory", () => ({
  getDefaultModel: () => mockGetDefaultModel(),
}));

vi.mock("../pricing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pricing")>();
  return {
    ...actual,
    getModelContextLength: (provider: string, modelName: string) =>
      mockGetModelContextLength(provider, modelName),
    getMaxSafeInputTokens: (provider: string, modelName: string) =>
      mockGetMaxSafeInputTokens(provider, modelName),
    getModelPricing: (provider: string, modelName: string) =>
      mockGetModelPricing(provider, modelName),
  };
});

vi.mock("../agentSkills", () => ({
  buildSystemPromptWithSkills: (
    systemPrompt: string,
    _skillIds: string[],
  ): Promise<string> => mockBuildSystemPromptWithSkills(systemPrompt, _skillIds),
}));

import {
  computeContextStats,
  getModelInfoForResponse,
} from "../agentContextStats";

const DEFAULT_CONTEXT = 128_000;
const DEFAULT_SAFE = Math.floor(DEFAULT_CONTEXT * 0.9);

describe("agentContextStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultModel.mockReturnValue("openrouter/default-model");
    mockGetModelContextLength.mockImplementation(() => DEFAULT_CONTEXT);
    mockGetMaxSafeInputTokens.mockImplementation(() => DEFAULT_SAFE);
    mockGetModelPricing.mockReturnValue({
      context_length: DEFAULT_CONTEXT,
      usd: { input: 0.1, output: 0.3 },
      capabilities: { tool_calling: true, text_generation: true },
    });
    mockBuildSystemPromptWithSkills.mockResolvedValue("Base prompt\n\nSkill A");
  });

  describe("computeContextStats", () => {
    it("uses instructions-only length when includeSkills is false", async () => {
      const agent = {
        systemPrompt: "Hello world",
        modelName: "openrouter/some-model",
      };
      const result = await computeContextStats(agent, { includeSkills: false });
      expect(mockBuildSystemPromptWithSkills).not.toHaveBeenCalled();
      expect(result.estimatedSystemPromptTokens).toBe(Math.ceil(11 / 4)); // 3
      expect(result.contextLength).toBe(DEFAULT_CONTEXT);
      expect(result.ratio).toBe(3 / DEFAULT_CONTEXT);
      expect(result.modelName).toBe("openrouter/some-model");
    });

    it("uses instructions-only when includeSkills is true but no enabledSkillIds", async () => {
      const agent = { systemPrompt: "Hi", enabledSkillIds: [] };
      const result = await computeContextStats(agent, { includeSkills: true });
      expect(mockBuildSystemPromptWithSkills).not.toHaveBeenCalled();
      expect(result.estimatedSystemPromptTokens).toBe(Math.ceil(2 / 4));
    });

    it("calls buildSystemPromptWithSkills when includeSkills is true and has skill ids", async () => {
      const agent = {
        systemPrompt: "Base",
        enabledSkillIds: ["skill-1"],
      };
      mockBuildSystemPromptWithSkills.mockResolvedValue("Base\n\nSkill 1 content");
      const result = await computeContextStats(agent, { includeSkills: true });
      expect(mockBuildSystemPromptWithSkills).toHaveBeenCalledWith(
        "Base",
        ["skill-1"],
      );
      expect(result.estimatedSystemPromptTokens).toBe(
        Math.ceil("Base\n\nSkill 1 content".length / 4),
      );
    });

    it("uses default model when modelName is null", async () => {
      const agent = { systemPrompt: "x", modelName: null };
      await computeContextStats(agent, { includeSkills: false });
      expect(mockGetModelContextLength).toHaveBeenCalledWith(
        "openrouter",
        "openrouter/default-model",
      );
    });

    it("uses default model when modelName is empty string", async () => {
      const agent = { systemPrompt: "x", modelName: "" };
      await computeContextStats(agent, { includeSkills: false });
      expect(mockGetModelContextLength).toHaveBeenCalledWith(
        "openrouter",
        "openrouter/default-model",
      );
    });

    it("caps ratio at 1 when estimated tokens exceed context length", async () => {
      mockGetModelContextLength.mockReturnValue(10);
      mockGetMaxSafeInputTokens.mockReturnValue(9);
      const agent = { systemPrompt: "x".repeat(100) }; // 100 chars -> 25 tokens
      const result = await computeContextStats(agent, { includeSkills: false });
      expect(result.ratio).toBe(1);
      expect(result.contextLength).toBe(10);
    });
  });

  describe("getModelInfoForResponse", () => {
    it("returns modelName, contextLength, pricing, capabilities for given model", () => {
      mockGetModelPricing.mockReturnValue({
        context_length: 200_000,
        usd: { input: 0.5, output: 1.5, cachedInput: 0.05 },
        capabilities: { tool_calling: true, text_generation: true },
      });
      const result = getModelInfoForResponse("openrouter/my-model");
      expect(result.modelName).toBe("openrouter/my-model");
      expect(result.contextLength).toBe(200_000);
      expect(result.pricing).toEqual({
        input: 0.5,
        output: 1.5,
        cachedInput: 0.05,
      });
      expect(result.capabilities).toEqual({
        tool_calling: true,
        text_generation: true,
      });
    });

    it("uses default model when modelName is null", () => {
      const result = getModelInfoForResponse(null);
      expect(result.modelName).toBe("openrouter/default-model");
      expect(mockGetModelPricing).toHaveBeenCalledWith(
        "openrouter",
        "openrouter/default-model",
      );
    });

    it("falls back to getModelContextLength when pricing has no context_length", () => {
      mockGetModelPricing.mockReturnValue({
        usd: { input: 1 },
        capabilities: {},
      });
      mockGetModelContextLength.mockReturnValue(100_000);
      const result = getModelInfoForResponse("openrouter/legacy");
      expect(result.contextLength).toBe(100_000);
    });
  });
});
