import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetWorkspaceApiKey, mockFetch } = vi.hoisted(() => ({
  mockGetWorkspaceApiKey: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("../../http/utils/agent-keys", () => ({
  getWorkspaceApiKey: (...args: unknown[]) => mockGetWorkspaceApiKey(...args),
}));

import {
  generateEmbeddingWithUsage,
  resolveEmbeddingApiKey,
} from "../embedding";

function embeddingResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

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

describe("generateEmbeddingWithUsage (direct fetch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      mockFetch(url, init),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns embedding and passes through usage.cost when API returns it", async () => {
    const embedding = [0.1, 0.2, 0.3];
    mockFetch.mockResolvedValueOnce(
      embeddingResponse({
        data: [{ embedding }],
        usage: { prompt_tokens: 10, total_tokens: 10, cost: 0.00001 },
        id: "gen-emb-1",
        model: "thenlper/gte-base",
      }),
    );

    const result = await generateEmbeddingWithUsage(
      "hello",
      "test-key",
      undefined,
    );

    expect(result.embedding).toEqual(embedding);
    expect(result.fromCache).toBe(false);
    expect(result.usage).toEqual({
      promptTokens: 10,
      totalTokens: 10,
      cost: 0.00001,
    });
    expect(result.id).toBe("gen-emb-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          input: "hello",
          model: "thenlper/gte-base",
        }),
      }),
    );
  });

  it("returns embedding with usage when API omits cost", async () => {
    mockFetch.mockResolvedValueOnce(
      embeddingResponse({
        data: [{ embedding: [0.5, 0.6] }],
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }),
    );

    const result = await generateEmbeddingWithUsage("x", "key");

    expect(result.usage).toEqual({
      promptTokens: 1,
      totalTokens: 1,
      cost: undefined,
    });
  });

  it("throws on 200 with missing data array", async () => {
    // Return same invalid shape on every call (retries consume mock)
    mockFetch.mockImplementation(() =>
      Promise.resolve(embeddingResponse({ object: "list", model: "x" })),
    );

    await expect(
      generateEmbeddingWithUsage("text", "key", undefined),
    ).rejects.toThrow("Invalid embedding response format");
  });

  it("throws on 200 with data[0].embedding missing", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        embeddingResponse({ data: [{ notEmbedding: [] }] }),
      ),
    );

    await expect(
      generateEmbeddingWithUsage("text", "key", undefined),
    ).rejects.toThrow("Invalid embedding response format");
  });

  it("throws on non-200 with statusCode on error", async () => {
    // Use 403 (non-retryable) so the test finishes without backoff delays
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "Invalid API key" } }),
        {
          status: 403,
          statusText: "Forbidden",
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    let caught: (Error & { statusCode?: number }) | null = null;
    try {
      await generateEmbeddingWithUsage("text", "key", undefined);
    } catch (e) {
      caught = e as Error & { statusCode?: number };
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain("OpenRouter embeddings error");
    expect(caught!.statusCode).toBe(403);
  });
});
