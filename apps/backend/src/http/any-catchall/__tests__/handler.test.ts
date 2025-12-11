import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line import/order
import {
  createAPIGatewayEventV2,
  createMockCallback,
  createMockContext,
} from "../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockAsap, mockHandlingErrors, mockAdaptHttpHandler, mockAsapHandler } =
  vi.hoisted(() => {
    const mockHandler = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {
        "Content-Type": "text/html",
      },
      body: "<html><body>Hello</body></html>",
    });

    return {
      mockAsap: vi.fn(() => mockHandler),
      mockAsapHandler: mockHandler,
      mockHandlingErrors: vi.fn((fn) => fn),
      mockAdaptHttpHandler: vi.fn((fn) => fn),
    };
  });

// Mock @architect/asap
vi.mock("@architect/asap", () => ({
  default: mockAsap,
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

describe("any-catchall handler", () => {
  const mockContext = createMockContext();
  const mockCallback = createMockCallback();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks to default behavior
    mockHandlingErrors.mockImplementation((fn) => fn);
    mockAdaptHttpHandler.mockImplementation((fn) => fn);
  });

  it("should process requests through asap", async () => {
    const event = createAPIGatewayEventV2({
      routeKey: "GET /",
      rawPath: "/",
      headers: {
        "Content-Type": "text/html",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    // Verify the handler processes the request
    expect(result.statusCode).toBe(200);
    expect(result.headers["Content-Type"]).toBe("text/html");
    expect(result.body).toContain("Hello");
    // Verify asap handler was called with the event
    expect(mockAsapHandler).toHaveBeenCalledWith(
      event,
      mockContext,
      mockCallback
    );
  });

  it("should export a handler function", () => {
    // Verify the handler is properly exported and is a function
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });
});
