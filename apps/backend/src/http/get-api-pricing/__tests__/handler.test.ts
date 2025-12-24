import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line import/order
import {
  createAPIGatewayEventV2,
  createMockCallback,
  createMockContext,
} from "../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockLoadPricingConfig } = vi.hoisted(() => {
  return {
    mockLoadPricingConfig: vi.fn(),
  };
});

// Mock the utility modules
vi.mock("../../../utils/pricing", () => ({
  loadPricingConfig: mockLoadPricingConfig,
}));

// Import the handler after mocks are set up
import { handler } from "../index";

describe("get-api-pricing handler", () => {
  const mockContext = createMockContext();
  const mockCallback = createMockCallback();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return OpenRouter pricing for all models", async () => {
    const mockPricingConfig = {
      providers: {
        openrouter: {
          models: {
            "google/gemini-2.5-flash": {
              usd: { input: 0.075, output: 0.3, cachedInput: 0.0075 },
            },
            "anthropic/claude-3.5-sonnet": {
              usd: { input: 3, output: 15, cachedInput: 0.3 },
            },
            "auto": {
              usd: { input: 2, output: 10, cachedInput: 0.2 },
            },
          },
        },
      },
      lastUpdated: "2024-01-01",
    };

    mockLoadPricingConfig.mockReturnValue(mockPricingConfig);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/pricing",
      rawPath: "/api/pricing",
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({
      "Content-Type": "application/json",
    });
    const body = JSON.parse(result.body || "{}");
    expect(body.openrouter).toBeDefined();
    expect(Object.keys(body.openrouter)).toHaveLength(3);
    expect(body.openrouter["google/gemini-2.5-flash"]).toEqual({
      input: 0.075,
      output: 0.3,
      cachedInput: 0.0075,
    });
    expect(body.openrouter["anthropic/claude-3.5-sonnet"]).toEqual({
      input: 3,
      output: 15,
      cachedInput: 0.3,
    });
    expect(body.openrouter["auto"]).toEqual({
      input: 2,
      output: 10,
      cachedInput: 0.2,
    });
    expect(mockLoadPricingConfig).toHaveBeenCalled();
  });

  it("should return empty object when no OpenRouter provider in pricing config", async () => {
    const mockPricingConfig = {
      providers: {
        google: {
          models: {
            "gemini-2.5-flash": {
              usd: { input: 0.075, output: 0.3, cachedInput: 0.0075 },
            },
          },
        },
      },
      lastUpdated: "2024-01-01",
    };

    mockLoadPricingConfig.mockReturnValue(mockPricingConfig);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/pricing",
      rawPath: "/api/pricing",
    });

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toEqual({
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ openrouter: {} }),
    });

    expect(mockLoadPricingConfig).toHaveBeenCalledTimes(1);
  });

  it("should return empty object when OpenRouter provider has no models", async () => {
    const mockPricingConfig = {
      providers: {
        openrouter: {
          models: {},
        },
      },
      lastUpdated: "2024-01-01",
    };

    mockLoadPricingConfig.mockReturnValue(mockPricingConfig);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/pricing",
      rawPath: "/api/pricing",
    });

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toEqual({
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ openrouter: {} }),
    });

    expect(mockLoadPricingConfig).toHaveBeenCalledTimes(1);
  });

  it("should handle tiered pricing models", async () => {
    const mockPricingConfig = {
      providers: {
        openrouter: {
          models: {
            "openai/gpt-4": {
              usd: {
                tiers: [
                  {
                    threshold: 200000,
                    input: 1.25,
                    output: 10,
                    cachedInput: 0.125,
                  },
                  {
                    input: 2.5,
                    output: 15,
                    cachedInput: 0.25,
                  },
                ],
              },
            },
            "google/gemini-2.5-flash": {
              usd: { input: 0.075, output: 0.3, cachedInput: 0.0075 },
            },
          },
        },
      },
      lastUpdated: "2024-01-01",
    };

    mockLoadPricingConfig.mockReturnValue(mockPricingConfig);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/pricing",
      rawPath: "/api/pricing",
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || "{}");
    expect(body.openrouter["openai/gpt-4"]).toEqual({
      tiers: [
        {
          threshold: 200000,
          input: 1.25,
          output: 10,
          cachedInput: 0.125,
        },
        {
          input: 2.5,
          output: 15,
          cachedInput: 0.25,
        },
      ],
    });
    expect(body.openrouter["google/gemini-2.5-flash"]).toEqual({
      input: 0.075,
      output: 0.3,
      cachedInput: 0.0075,
    });
  });

  it("should handle models with optional pricing fields", async () => {
    const mockPricingConfig = {
      providers: {
        openrouter: {
          models: {
            "test/model": {
              usd: {
                input: 1,
                output: 2,
                // cachedInput and reasoning are optional
              },
            },
            "test/model-with-reasoning": {
              usd: {
                input: 1,
                output: 2,
                reasoning: 3,
                cachedInput: 0.1,
              },
            },
          },
        },
      },
      lastUpdated: "2024-01-01",
    };

    mockLoadPricingConfig.mockReturnValue(mockPricingConfig);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/pricing",
      rawPath: "/api/pricing",
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || "{}");
    expect(body.openrouter["test/model"]).toEqual({
      input: 1,
      output: 2,
    });
    expect(body.openrouter["test/model-with-reasoning"]).toEqual({
      input: 1,
      output: 2,
      reasoning: 3,
      cachedInput: 0.1,
    });
  });

  it("should handle errors from loadPricingConfig", async () => {
    const error = new Error("Failed to load pricing config");
    mockLoadPricingConfig.mockImplementation(() => {
      throw error;
    });

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/pricing",
      rawPath: "/api/pricing",
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body || "{}");
    // Error handler sanitizes error messages for server errors
    expect(body.message).toBeDefined();
    expect(mockLoadPricingConfig).toHaveBeenCalledTimes(1);
  });

  it("should sort models alphabetically", async () => {
    const mockPricingConfig = {
      providers: {
        openrouter: {
          models: {
            "z-model": {
              usd: { input: 1, output: 2 },
            },
            "a-model": {
              usd: { input: 1, output: 2 },
            },
            "m-model": {
              usd: { input: 1, output: 2 },
            },
          },
        },
      },
      lastUpdated: "2024-01-01",
    };

    mockLoadPricingConfig.mockReturnValue(mockPricingConfig);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/pricing",
      rawPath: "/api/pricing",
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || "{}");
    const modelNames = Object.keys(body.openrouter);
    expect(modelNames).toEqual(["a-model", "m-model", "z-model"]);
  });
});


