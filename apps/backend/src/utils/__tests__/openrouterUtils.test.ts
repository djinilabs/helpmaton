import { describe, expect, it } from "vitest";

import { extractOpenRouterGenerationId } from "../openrouterUtils";

describe("extractOpenRouterGenerationId", () => {
  it("should extract generation ID from result.raw.id", () => {
    const result = {
      raw: {
        id: "gen-12345",
      },
    };
    expect(extractOpenRouterGenerationId(result)).toBe("gen-12345");
  });

  it("should extract generation ID from result.raw.generation_id", () => {
    const result = {
      raw: {
        generation_id: "gen-67890",
      },
    };
    expect(extractOpenRouterGenerationId(result)).toBe("gen-67890");
  });

  it("should extract generation ID from experimental_providerMetadata.generationId", () => {
    const result = {
      experimental_providerMetadata: {
        generationId: "gen-abc123",
      },
    };
    expect(extractOpenRouterGenerationId(result)).toBe("gen-abc123");
  });

  it("should extract generation ID from experimental_providerMetadata.id", () => {
    const result = {
      experimental_providerMetadata: {
        id: "gen-xyz789",
      },
    };
    expect(extractOpenRouterGenerationId(result)).toBe("gen-xyz789");
  });

  it("should extract generation ID from response headers", () => {
    const result = {
      response: {
        headers: {
          "x-openrouter-generation-id": "gen-header-123",
        },
      },
    };
    expect(extractOpenRouterGenerationId(result)).toBe("gen-header-123");
  });

  it("should extract generation ID from result.id", () => {
    const result = {
      id: "gen-direct-456",
    };
    expect(extractOpenRouterGenerationId(result)).toBe("gen-direct-456");
  });

  it("should return undefined if no generation ID is found", () => {
    const result = {
      text: "some text",
      usage: {
        promptTokens: 10,
        completionTokens: 20,
      },
    };
    expect(extractOpenRouterGenerationId(result)).toBeUndefined();
  });

  it("should return undefined for empty object", () => {
    expect(extractOpenRouterGenerationId({})).toBeUndefined();
  });

  it("should handle errors gracefully", () => {
    // Create an object that will throw when accessed
    const result = {
      get raw() {
        throw new Error("Access error");
      },
    };
    // Should not throw, should return undefined
    expect(extractOpenRouterGenerationId(result)).toBeUndefined();
  });
});

