import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line import/order
import {
  createAPIGatewayEventV2,
  createMockCallback,
  createMockContext,
} from "../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockCreateApp, mockServerlessExpress, mockHandlingErrors } = vi.hoisted(
  () => {
    return {
      mockCreateApp: vi.fn(),
      mockServerlessExpress: vi.fn(),
      mockHandlingErrors: vi.fn((fn) => fn),
    };
  }
);

// Mock the app creation
// Mock @architect/functions for database initialization (used by handlingErrors)
vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

vi.mock("../any-api-subscription-catchall/subscription-app", () => ({
  createApp: mockCreateApp,
}));

// Mock serverless-express
vi.mock("@vendia/serverless-express", () => ({
  default: mockServerlessExpress,
}));

// Mock handlingErrors
vi.mock("../../utils/handlingErrors", () => ({
  handlingErrors: mockHandlingErrors,
}));

// Import the handler after mocks are set up
import { handler } from "../index";

describe("any-api-subscription handler", () => {
  const mockContext = createMockContext();
  const mockCallback = createMockCallback();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks to default behavior
    mockHandlingErrors.mockImplementation((fn) => fn);
  });

  it("should process requests through Express app", async () => {
    const mockExpressApp = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      patch: vi.fn(),
    };

    const mockServerlessHandler = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subscription: { id: "sub-123" } }),
    });

    mockCreateApp.mockReturnValue(mockExpressApp);
    mockServerlessExpress.mockReturnValue(mockServerlessHandler);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/subscription",
      rawPath: "/api/subscription",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    // Verify the handler processes the request
    expect(result.statusCode).toBe(200);
    expect(result.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(result.body || "{}");
    expect(body.subscription).toBeDefined();
    expect(body.subscription.id).toBe("sub-123");
    // Verify serverless handler was called with the event
    expect(mockServerlessHandler).toHaveBeenCalledWith(
      event,
      mockContext,
      mockCallback
    );
  });
});
