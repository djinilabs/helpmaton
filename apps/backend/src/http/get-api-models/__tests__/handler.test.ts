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

vi.mock("../utils/modelFactory", () => ({
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

  it("should return available models with default model", async () => {
    const mockPricingConfig = {
      providers: {
        google: {
          models: {
            "gemini-2.5-flash": {
              usd: { input: 0.075, output: 0.3 },
              eur: { input: 0.07, output: 0.28 },
              gbp: { input: 0.06, output: 0.24 },
            },
            "gemini-1.5-flash": {
              usd: { input: 0.075, output: 0.3 },
              eur: { input: 0.07, output: 0.28 },
              gbp: { input: 0.06, output: 0.24 },
            },
          },
        },
      },
      lastUpdated: "2024-01-01",
    };

    mockLoadPricingConfig.mockReturnValue(mockPricingConfig);
    mockGetDefaultModel.mockReturnValue("gemini-2.5-flash");

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
    expect(body.google).toBeDefined();
    expect(body.google.models).toHaveLength(2);
    expect(body.google.models).toContain("gemini-1.5-flash");
    expect(body.google.models).toContain("gemini-2.5-flash");
    expect(body.google.defaultModel).toBe("gemini-2.5-flash");

    // getDefaultModel also calls loadPricingConfig internally, so it may be called multiple times
    expect(mockLoadPricingConfig).toHaveBeenCalled();
  });

  it("should return empty object when no Google provider in pricing config", async () => {
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

  it("should return empty object when Google provider has no models", async () => {
    const mockPricingConfig = {
      providers: {
        google: {
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
