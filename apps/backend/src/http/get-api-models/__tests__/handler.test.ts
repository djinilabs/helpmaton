import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line import/order
import {
  createAPIGatewayEventV2,
  createMockCallback,
  createMockContext,
} from "../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockLoadPricingConfig, mockGetDefaultModel } = vi.hoisted(() => {
  return {
    mockLoadPricingConfig: vi.fn(),
    mockGetDefaultModel: vi.fn(),
  };
});

// Mock the utility modules
vi.mock("../../../utils/pricing", () => ({
  loadPricingConfig: mockLoadPricingConfig,
}));

vi.mock("../../utils/modelFactory", () => ({
  getDefaultModel: mockGetDefaultModel,
}));

// Import the handler after mocks are set up
import { handler } from "../index";

describe("get-api-models handler", () => {
  const mockContext = createMockContext();
  const mockCallback = createMockCallback();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return OpenRouter models with default model", async () => {
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
    mockGetDefaultModel.mockReturnValue("auto");

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/models",
      rawPath: "/api/models",
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
    expect(body.openrouter.models).toHaveLength(3);
    expect(body.openrouter.models).toContain("anthropic/claude-3.5-sonnet");
    expect(body.openrouter.models).toContain("auto");
    expect(body.openrouter.models).toContain("google/gemini-2.5-flash");
    expect(body.openrouter.defaultModel).toBe("auto");
    // Verify Google models are not included
    expect(body.google).toBeUndefined();

    // getDefaultModel also calls loadPricingConfig internally, so it may be called multiple times
    expect(mockLoadPricingConfig).toHaveBeenCalled();
  });

  it("should return empty object when no OpenRouter provider in pricing config", async () => {
    const mockPricingConfig = {
      providers: {
        openai: {
          models: {
            "gpt-4": {
              usd: { input: 30, output: 60 },
              eur: { input: 28, output: 56 },
              gbp: { input: 24, output: 48 },
            },
          },
        },
      },
      lastUpdated: "2024-01-01",
    };

    mockLoadPricingConfig.mockReturnValue(mockPricingConfig);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/models",
      rawPath: "/api/models",
    });

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toEqual({
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(mockLoadPricingConfig).toHaveBeenCalledTimes(1);
    expect(mockGetDefaultModel).not.toHaveBeenCalled();
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
      routeKey: "GET /api/models",
      rawPath: "/api/models",
    });

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toEqual({
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(mockLoadPricingConfig).toHaveBeenCalledTimes(1);
    expect(mockGetDefaultModel).not.toHaveBeenCalled();
  });

  it("should return OpenRouter models from pricing config", async () => {
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
            "openai/gpt-4o": {
              usd: { input: 0, output: 0, cachedInput: 0 },
            },
          },
        },
      },
      lastUpdated: "2024-01-01",
    };

    mockLoadPricingConfig.mockReturnValue(mockPricingConfig);
    // getDefaultModel will use the mock pricing config and find "google/gemini-2.5-flash" as default
    // based on the defaultPatterns in modelFactory.ts (first pattern: p === "google/gemini-2.5-flash")
    mockGetDefaultModel.mockImplementation((provider) => {
      if (provider === "openrouter") {
        return "google/gemini-2.5-flash";
      }
      return "gemini-2.5-flash";
    });

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/models",
      rawPath: "/api/models",
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body || "{}");
    expect(body.openrouter).toBeDefined();
    expect(body.openrouter.models).toHaveLength(4);
    // Verify all models from pricing config are included (including those with 0 pricing)
    expect(body.openrouter.models).toContain("google/gemini-2.5-flash");
    expect(body.openrouter.models).toContain("anthropic/claude-3.5-sonnet");
    expect(body.openrouter.models).toContain("auto");
    expect(body.openrouter.models).toContain("openai/gpt-4o");
    // getDefaultModel mock returns "google/gemini-2.5-flash" for openrouter
    expect(body.openrouter.defaultModel).toBe("google/gemini-2.5-flash");
    // Verify models are sorted alphabetically
    expect(body.openrouter.models).toEqual([
      "anthropic/claude-3.5-sonnet",
      "auto",
      "google/gemini-2.5-flash",
      "openai/gpt-4o",
    ]);
  });

  it("should handle errors from loadPricingConfig", async () => {
    const error = new Error("Failed to load pricing config");
    mockLoadPricingConfig.mockImplementation(() => {
      throw error;
    });

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/models",
      rawPath: "/api/models",
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
});
