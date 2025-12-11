import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line import/order
import {
  createAPIGatewayEventV2,
  createMockCallback,
  createMockContext,
} from "../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockVerifyDiscordSignature,
  mockVerifyDiscordUser,
  mockHandleDiscordCommand,
  mockDiscordResponse,
  mockAdaptHttpHandler,
  mockHandlingErrors,
} = vi.hoisted(() => {
  return {
    mockVerifyDiscordSignature: vi.fn(),
    mockVerifyDiscordUser: vi.fn(),
    mockHandleDiscordCommand: vi.fn(),
    mockDiscordResponse: vi.fn(),
    mockAdaptHttpHandler: vi.fn((fn) => fn),
    mockHandlingErrors: vi.fn((fn) => fn),
  };
});

// Mock the Discord services
vi.mock("../services/discordService", () => ({
  verifyDiscordSignature: mockVerifyDiscordSignature,
  verifyDiscordUser: mockVerifyDiscordUser,
}));

vi.mock("../services/commandHandler", () => ({
  handleDiscordCommand: mockHandleDiscordCommand,
}));

vi.mock("../services/discordResponse", () => ({
  discordResponse: mockDiscordResponse,
}));

// Mock handlingErrors and adaptHttpHandler
vi.mock("../../utils/handlingErrors", () => ({
  handlingErrors: mockHandlingErrors,
}));

vi.mock("../../utils/httpEventAdapter", () => ({
  adaptHttpHandler: mockAdaptHttpHandler,
}));

// Import the handler after mocks are set up
import { handler } from "../index";

describe("any-api-discord handler", () => {
  const mockContext = createMockContext();
  const mockCallback = createMockCallback();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks to default behavior
    mockHandlingErrors.mockImplementation((fn) => fn);
    mockAdaptHttpHandler.mockImplementation((fn) => fn);
  });

  it("should handle GET request for endpoint verification", async () => {
    const baseEvent = createAPIGatewayEventV2({
      routeKey: "GET /api/discord",
      rawPath: "/api/discord",
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "GET",
        },
      },
    };

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(200);
    expect(result.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(result.body || "{}");
    expect(body.message).toBe("Discord endpoint is active");
    expect(mockVerifyDiscordSignature).not.toHaveBeenCalled();
  });

  it("should handle PING interaction (type 1)", async () => {
    const baseEvent = createAPIGatewayEventV2({
      routeKey: "POST /api/discord",
      rawPath: "/api/discord",
      body: JSON.stringify({ type: 1 }),
      headers: {
        "x-signature-ed25519": "signature",
        "x-signature-timestamp": "timestamp",
      },
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "POST",
        },
      },
    };

    mockVerifyDiscordSignature.mockReturnValue(true);

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(mockVerifyDiscordSignature).toHaveBeenCalledWith(event);
    expect(result.statusCode).toBe(200);
    expect(result.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(result.body || "{}");
    expect(body.type).toBe(1);
    expect(mockHandleDiscordCommand).not.toHaveBeenCalled();
  });

  it("should handle APPLICATION_COMMAND interaction (type 2) with authorized user", async () => {
    const baseEvent = createAPIGatewayEventV2({
      routeKey: "POST /api/discord",
      rawPath: "/api/discord",
      body: JSON.stringify({
        type: 2,
        data: {
          name: "test-command",
        },
        member: {
          user: {
            id: "user-123",
          },
        },
      }),
      headers: {
        "x-signature-ed25519": "signature",
        "x-signature-timestamp": "timestamp",
      },
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "POST",
        },
      },
    };

    mockVerifyDiscordSignature.mockReturnValue(true);
    mockVerifyDiscordUser.mockReturnValue(true);
    mockHandleDiscordCommand.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ type: 4, data: { content: "Command executed" } }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(mockVerifyDiscordSignature).toHaveBeenCalledWith(event);
    expect(mockVerifyDiscordUser).toHaveBeenCalledWith({
      user: { id: "user-123" },
    });
    expect(mockHandleDiscordCommand).toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
  });

  it("should return unauthorized message when user is not authorized", async () => {
    const baseEvent = createAPIGatewayEventV2({
      routeKey: "POST /api/discord",
      rawPath: "/api/discord",
      body: JSON.stringify({
        type: 2,
        data: {
          name: "test-command",
        },
        member: {
          user: {
            id: "user-123",
          },
        },
      }),
      headers: {
        "x-signature-ed25519": "signature",
        "x-signature-timestamp": "timestamp",
      },
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "POST",
        },
      },
    };

    mockVerifyDiscordSignature.mockReturnValue(true);
    mockVerifyDiscordUser.mockReturnValue(false);
    mockDiscordResponse.mockReturnValue({
      statusCode: 200,
      body: JSON.stringify({
        type: 4,
        data: {
          content:
            "❌ You are not authorized to use customer service commands.",
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(mockVerifyDiscordSignature).toHaveBeenCalledWith(event);
    expect(mockVerifyDiscordUser).toHaveBeenCalledWith({
      user: { id: "user-123" },
    });
    expect(mockDiscordResponse).toHaveBeenCalledWith(
      "❌ You are not authorized to use customer service commands."
    );
    expect(mockHandleDiscordCommand).not.toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
  });

  it("should return error when Discord signature verification fails", async () => {
    const baseEvent = createAPIGatewayEventV2({
      routeKey: "POST /api/discord",
      rawPath: "/api/discord",
      body: JSON.stringify({ type: 1 }),
      headers: {
        "x-signature-ed25519": "invalid-signature",
        "x-signature-timestamp": "timestamp",
      },
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "POST",
        },
      },
    };

    mockVerifyDiscordSignature.mockReturnValue(false);
    mockDiscordResponse.mockReturnValue({
      statusCode: 200,
      body: JSON.stringify({
        type: 4,
        data: {
          content:
            "❌ **Error:** Invalid Discord signature. Request could not be verified.",
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(mockVerifyDiscordSignature).toHaveBeenCalledWith(event);
    expect(mockDiscordResponse).toHaveBeenCalledWith(
      "❌ **Error:** Invalid Discord signature. Request could not be verified."
    );
    expect(result.statusCode).toBe(200);
  });

  it("should return methodNotAllowed for non-GET/POST requests", async () => {
    const baseEvent = createAPIGatewayEventV2({
      routeKey: "PUT /api/discord",
      rawPath: "/api/discord",
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "PUT",
        },
      },
    };

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    // handlingErrors catches errors and returns error responses
    expect(result.statusCode).toBe(405);
    const body = JSON.parse(result.body || "{}");
    expect(body.message || body.error).toContain("Method not allowed");
  });

  it("should return badRequest for invalid JSON payload", async () => {
    const baseEvent = createAPIGatewayEventV2({
      routeKey: "POST /api/discord",
      rawPath: "/api/discord",
      body: "invalid json{",
      headers: {
        "x-signature-ed25519": "signature",
        "x-signature-timestamp": "timestamp",
      },
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "POST",
        },
      },
    };

    mockVerifyDiscordSignature.mockReturnValue(true);

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    // handlingErrors catches errors and returns error responses
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body || "{}");
    expect(body.message || body.error).toContain("Invalid JSON payload");
  });

  it("should handle unknown interaction type", async () => {
    const baseEvent = createAPIGatewayEventV2({
      routeKey: "POST /api/discord",
      rawPath: "/api/discord",
      body: JSON.stringify({ type: 99 }),
      headers: {
        "x-signature-ed25519": "signature",
        "x-signature-timestamp": "timestamp",
      },
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "POST",
        },
      },
    };

    mockVerifyDiscordSignature.mockReturnValue(true);
    mockDiscordResponse.mockReturnValue({
      statusCode: 200,
      body: JSON.stringify({
        type: 4,
        data: {
          content: "❌ **Error:** Unknown interaction type.",
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(mockDiscordResponse).toHaveBeenCalledWith(
      "❌ **Error:** Unknown interaction type.",
      200
    );
    expect(result.statusCode).toBe(200);
  });

  it("should handle APPLICATION_COMMAND with user instead of member", async () => {
    const baseEvent = createAPIGatewayEventV2({
      routeKey: "POST /api/discord",
      rawPath: "/api/discord",
      body: JSON.stringify({
        type: 2,
        data: {
          name: "test-command",
        },
        user: {
          id: "user-456",
        },
      }),
      headers: {
        "x-signature-ed25519": "signature",
        "x-signature-timestamp": "timestamp",
      },
    });
    const event = {
      ...baseEvent,
      requestContext: {
        ...baseEvent.requestContext,
        http: {
          ...baseEvent.requestContext.http,
          method: "POST",
        },
      },
    };

    mockVerifyDiscordSignature.mockReturnValue(true);
    mockVerifyDiscordUser.mockReturnValue(true);
    mockHandleDiscordCommand.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ type: 4, data: { content: "Command executed" } }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(mockVerifyDiscordUser).toHaveBeenCalledWith({
      user: { id: "user-456" },
    });
    expect(mockHandleDiscordCommand).toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
  });
});
