import { describe, it, expect, vi, beforeEach } from "vitest";

import { extractEntitiesFromPrompt } from "../entityExtraction";

const mockGenerateText = vi.fn();
const mockCreateModel = vi.fn();
const mockGetDefaultModel = vi.fn();
const mockGetWorkspaceApiKey = vi.fn();
const mockValidateCreditsAndLimits = vi.fn();
const mockCreateRequestTimeout = vi.fn();
const mockCleanupRequestTimeout = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

vi.mock("../../../http/utils/modelFactory", () => ({
  createModel: (...args: unknown[]) => mockCreateModel(...args),
  getDefaultModel: () => mockGetDefaultModel(),
}));

vi.mock("../../../http/utils/agent-keys", () => ({
  getWorkspaceApiKey: (...args: unknown[]) => mockGetWorkspaceApiKey(...args),
}));

vi.mock("../../../http/utils/requestTimeout", () => ({
  createRequestTimeout: () => mockCreateRequestTimeout(),
  cleanupRequestTimeout: (...args: unknown[]) =>
    mockCleanupRequestTimeout(...args),
}));

vi.mock("../../../tables", () => ({
  database: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../creditValidation", () => ({
  validateCreditsAndLimits: (...args: unknown[]) =>
    mockValidateCreditsAndLimits(...args),
}));

describe("extractEntitiesFromPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultModel.mockReturnValue("gpt-4o-mini");
    mockCreateRequestTimeout.mockReturnValue({ signal: {} });
  });

  it("returns empty array when prompt is empty", async () => {
    const result = await extractEntitiesFromPrompt({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      prompt: "   ",
    });

    expect(result).toEqual([]);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns parsed entities from response", async () => {
    mockCreateModel.mockResolvedValue({});
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({ entities: ["User", "TypeScript"] }),
    });

    const result = await extractEntitiesFromPrompt({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      prompt: "User prefers TypeScript",
    });

    expect(result).toEqual(["User", "TypeScript"]);
    expect(mockValidateCreditsAndLimits).toHaveBeenCalled();
    expect(mockGenerateText).toHaveBeenCalled();
  });
});
