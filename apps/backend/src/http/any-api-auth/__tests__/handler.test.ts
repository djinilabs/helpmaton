import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line import/order
import {
  createAPIGatewayEventV2,
  createMockCallback,
  createMockContext,
} from "../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockCreateApp,
  mockServerlessExpress,
  mockHandlingErrors,
  mockAdaptHttpHandler,
  mockAuthConfig,
} = vi.hoisted(() => {
  return {
    mockCreateApp: vi.fn(),
    mockServerlessExpress: vi.fn(),
    mockHandlingErrors: vi.fn((fn) => fn),
    mockAdaptHttpHandler: vi.fn((fn) => fn),
    mockAuthConfig: vi.fn(),
  };
});

// Mock @architect/functions for database initialization (used by handlingErrors)
vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

// Mock authConfig first (createApp depends on it)
vi.mock("../../../auth-config", () => ({
  authConfig: mockAuthConfig,
}));

// Mock the app creation
vi.mock("../any-api-auth-catchall/auth-app", () => ({
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

// Mock adaptHttpHandler
vi.mock("../../utils/httpEventAdapter", () => ({
  adaptHttpHandler: mockAdaptHttpHandler,
}));

// Import the handler after mocks are set up
import { handler } from "../index";

describe("any-api-auth handler", () => {
  const mockContext = createMockContext();
  const mockCallback = createMockCallback();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks to default behavior
    mockHandlingErrors.mockImplementation((fn) => fn);
    mockAdaptHttpHandler.mockImplementation((fn) => fn);
    mockAuthConfig.mockResolvedValue({} as unknown);
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
      body: JSON.stringify({ message: "Success" }),
    });

    mockCreateApp.mockResolvedValue(mockExpressApp);
    mockServerlessExpress.mockReturnValue(mockServerlessHandler);

    const event = createAPIGatewayEventV2({
      routeKey: "GET /api/auth/session",
      rawPath: "/api/auth/session",
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
    expect(body.message).toBe("Success");
    // Verify serverless handler was called with the event
    expect(mockServerlessHandler).toHaveBeenCalled();
  });
});
