import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetWorkspaceApiKey } = vi.hoisted(() => ({
  mockGetWorkspaceApiKey: vi.fn(),
}));

vi.mock("../../http/utils/agent-keys", () => ({
  getWorkspaceApiKey: (...args: unknown[]) => mockGetWorkspaceApiKey(...args),
}));

import { resolveEmbeddingApiKey } from "../embedding";

describe("resolveEmbeddingApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "system-key";
    mockGetWorkspaceApiKey.mockResolvedValue(null);
  });

  it("returns workspace key when available", async () => {
    mockGetWorkspaceApiKey.mockResolvedValueOnce("workspace-key");

    const result = await resolveEmbeddingApiKey("workspace-123");

    expect(result).toEqual({ apiKey: "workspace-key", usesByok: true });
    expect(mockGetWorkspaceApiKey).toHaveBeenCalledWith(
      "workspace-123",
      "openrouter",
    );
  });

  it("falls back to system key when workspace key is missing", async () => {
    const result = await resolveEmbeddingApiKey("workspace-123");

    expect(result).toEqual({ apiKey: "system-key", usesByok: false });
    expect(mockGetWorkspaceApiKey).toHaveBeenCalledWith(
      "workspace-123",
      "openrouter",
    );
  });

  it("uses system key when workspaceId is omitted", async () => {
    const result = await resolveEmbeddingApiKey();

    expect(result).toEqual({ apiKey: "system-key", usesByok: false });
    expect(mockGetWorkspaceApiKey).not.toHaveBeenCalled();
  });

  it("throws when no system key is available", async () => {
    delete process.env.OPENROUTER_API_KEY;

    await expect(resolveEmbeddingApiKey("workspace-123")).rejects.toThrow(
      "OPENROUTER_API_KEY is not set",
    );
  });
});
