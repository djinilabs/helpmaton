import { describe, expect, it } from "vitest";

import {
  extractOpenRouterGenerationId,
  extractAllOpenRouterGenerationIds,
} from "../openrouterUtils";

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

describe("extractAllOpenRouterGenerationIds", () => {
  it("should extract multiple generation IDs from _steps.status.value[]", () => {
    const result = {
      _steps: {
        status: {
          type: "resolved",
          value: [
            {
              response: {
                id: "gen-12345",
              },
            },
            {
              response: {
                id: "gen-67890",
              },
            },
            {
              response: {
                id: "gen-abc123",
              },
            },
          ],
        },
      },
    };
    const ids = extractAllOpenRouterGenerationIds(result);
    expect(ids).toEqual(["gen-12345", "gen-67890", "gen-abc123"]);
  });

  it("should extract single generation ID from _steps.status.value (non-array)", () => {
    const result = {
      _steps: {
        status: {
          type: "resolved",
          value: {
            response: {
              id: "gen-single",
            },
          },
        },
      },
    };
    const ids = extractAllOpenRouterGenerationIds(result);
    expect(ids).toEqual(["gen-single"]);
  });

  it("should fallback to single ID extraction when _steps not available", () => {
    const result = {
      raw: {
        id: "gen-fallback",
      },
    };
    const ids = extractAllOpenRouterGenerationIds(result);
    expect(ids).toEqual(["gen-fallback"]);
  });

  it("should return empty array when no generation IDs found", () => {
    const result = {
      text: "some text",
      usage: {
        promptTokens: 10,
        completionTokens: 20,
      },
    };
    const ids = extractAllOpenRouterGenerationIds(result);
    expect(ids).toEqual([]);
  });

  it("should filter out non-gen- IDs from _steps", () => {
    const result = {
      _steps: {
        status: {
          type: "resolved",
          value: [
            {
              response: {
                id: "gen-12345",
              },
            },
            {
              response: {
                id: "not-a-gen-id",
              },
            },
            {
              response: {
                id: "gen-67890",
              },
            },
          ],
        },
      },
    };
    const ids = extractAllOpenRouterGenerationIds(result);
    expect(ids).toEqual(["gen-12345", "gen-67890"]);
  });

  it("should handle missing response.id in steps", () => {
    const result = {
      _steps: {
        status: {
          type: "resolved",
          value: [
            {
              response: {
                id: "gen-12345",
              },
            },
            {
              response: {},
            },
            {
              noResponse: true,
            },
          ],
        },
      },
    };
    const ids = extractAllOpenRouterGenerationIds(result);
    expect(ids).toEqual(["gen-12345"]);
  });

  it("should handle errors gracefully", () => {
    // Create an object that will throw when accessed
    const result = {
      get _steps() {
        throw new Error("Access error");
      },
    };
    // Should not throw, should return empty array
    const ids = extractAllOpenRouterGenerationIds(result);
    expect(ids).toEqual([]);
  });

  it("should return empty array for empty object", () => {
    const ids = extractAllOpenRouterGenerationIds({});
    expect(ids).toEqual([]);
  });

  it("should handle _steps.status.value with null/undefined", () => {
    const result1 = {
      _steps: {
        status: {
          type: "resolved",
          value: null,
        },
      },
    };
    const result2 = {
      _steps: {
        status: {
          type: "resolved",
          value: undefined,
        },
      },
    };
    expect(extractAllOpenRouterGenerationIds(result1)).toEqual([]);
    expect(extractAllOpenRouterGenerationIds(result2)).toEqual([]);
  });
});

