import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be defined before imports - use vi.hoisted to ensure they're set up first
const { mockRequireSession, mockUserRef, mockIsUserAuthorized } = vi.hoisted(
  () => {
    const mockReqSession = vi.fn();
    const mockURef = vi.fn((id: string) => `users/${id}`);
    const mockIsAuth = vi.fn();
    return {
      mockRequireSession: mockReqSession,
      mockUserRef: mockURef,
      mockIsUserAuthorized: mockIsAuth,
    };
  }
);

// Mock the session module - must match the import path in requestValidation.ts
// requestValidation.ts imports from "../../utils/session"
// From __tests__/requestValidation.test.ts, that's "../../../utils/session" (one more level up)
// Use the hoisted mocks directly - they're available in the closure
vi.mock("../../../utils/session", () => {
  // The hoisted variables are available here
  return {
    requireSession: mockRequireSession,
    userRef: mockUserRef,
    getSession: vi.fn(),
    getSessionFromRequest: vi.fn(),
    requireSessionFromRequest: vi.fn(),
    eventToRequest: vi.fn(),
  };
});

// Also mock auth-config and its dependencies to prevent AWS connection attempts
// Mock process.env to include AUTH_SECRET
process.env.AUTH_SECRET = "test-secret";

vi.mock("../../../auth-config", () => ({
  authConfig: vi.fn(() =>
    Promise.resolve({
      secret: "test-secret",
      trustHost: true,
    })
  ),
}));

vi.mock("@architect/functions", () => ({
  tables: vi.fn(() =>
    Promise.resolve({
      name: vi.fn(() => Promise.resolve("next-auth")),
      _doc: {},
    })
  ),
}));

// Mock @auth/express to prevent it from trying to use real auth config
vi.mock("@auth/express", () => ({
  getSession: vi.fn(() => Promise.resolve(null)),
  ExpressAuth: vi.fn(),
}));

vi.mock("../../../tables/permissions", () => ({
  isUserAuthorized: mockIsUserAuthorized,
}));

vi.mock("../../../tables/schema", () => ({
  PERMISSION_LEVELS: {
    READ: "read",
    WRITE: "write",
  },
}));

// Import after mocks are set up
import {
  validateRequest,
  authenticateAndAuthorize,
} from "../requestValidation";

describe("validateRequest", () => {
  it("should validate POST request with valid parameters", () => {
    const event = {
      requestContext: {
        http: {
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEventV2;

    const result = validateRequest(event);
    expect(result).toEqual({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("should throw error for non-POST method", () => {
    const event = {
      requestContext: {
        http: {
          method: "GET",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
    } as unknown as APIGatewayProxyEventV2;

    expect(() => validateRequest(event)).toThrow();
    try {
      validateRequest(event);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      // badRequest returns 400, not 405
      expect(
        (error as { output?: { statusCode?: number } }).output?.statusCode
      ).toBe(400);
    }
  });

  it("should throw error when workspaceId is missing", () => {
    const event = {
      requestContext: {
        http: {
          method: "POST",
        },
      },
      pathParameters: {
        agentId: "agent-456",
      },
      body: JSON.stringify({ messages: [] }),
    } as unknown as APIGatewayProxyEventV2;

    expect(() => validateRequest(event)).toThrow();
  });

  it("should throw error when agentId is missing", () => {
    const event = {
      requestContext: {
        http: {
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
      },
      body: JSON.stringify({ messages: [] }),
    } as unknown as APIGatewayProxyEventV2;

    expect(() => validateRequest(event)).toThrow();
  });

  it("should throw error when messages array is empty", () => {
    const event = {
      requestContext: {
        http: {
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: JSON.stringify({ messages: [] }),
    } as unknown as APIGatewayProxyEventV2;

    expect(() => validateRequest(event)).toThrow();
  });

  it("should handle base64 encoded body", () => {
    const messages = [{ role: "user", content: "Hello" }];
    const bodyText = JSON.stringify({ messages });
    const base64Body = Buffer.from(bodyText).toString("base64");

    const event = {
      requestContext: {
        http: {
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: base64Body,
      isBase64Encoded: true,
    } as unknown as APIGatewayProxyEventV2;

    const result = validateRequest(event);
    expect(result.messages).toEqual(messages);
  });

  it("should handle missing body", () => {
    const event = {
      requestContext: {
        http: {
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      body: undefined,
    } as unknown as APIGatewayProxyEventV2;

    expect(() => validateRequest(event)).toThrow();
  });

  it("should extract path parameters from rawPath when pathParameters is missing (Lambda URL scenario)", () => {
    const event = {
      requestContext: {
        http: {
          method: "POST",
          path: "/api/workspaces/workspace-123/agents/agent-456/test",
        },
      },
      rawPath: "/api/workspaces/workspace-123/agents/agent-456/test",
      pathParameters: undefined,
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEventV2;

    const result = validateRequest(event);
    expect(result).toEqual({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("should extract path parameters from requestContext.http.path when rawPath is missing", () => {
    const event = {
      requestContext: {
        http: {
          method: "POST",
          path: "/api/workspaces/workspace-789/agents/agent-012/test",
        },
      },
      rawPath: undefined,
      pathParameters: undefined,
      body: JSON.stringify({ messages: [{ role: "user", content: "Test" }] }),
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEventV2;

    const result = validateRequest(event);
    expect(result).toEqual({
      workspaceId: "workspace-789",
      agentId: "agent-012",
      messages: [{ role: "user", content: "Test" }],
    });
  });

  it("should prefer pathParameters over rawPath extraction", () => {
    const event = {
      requestContext: {
        http: {
          method: "POST",
          path: "/api/workspaces/wrong-workspace/agents/wrong-agent/test",
        },
      },
      rawPath: "/api/workspaces/wrong-workspace/agents/wrong-agent/test",
      pathParameters: {
        workspaceId: "correct-workspace",
        agentId: "correct-agent",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEventV2;

    const result = validateRequest(event);
    expect(result).toEqual({
      workspaceId: "correct-workspace",
      agentId: "correct-agent",
      messages: [{ role: "user", content: "Hello" }],
    });
  });
});

describe("authenticateAndAuthorize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.skip("should authorize user with valid session and permissions", async () => {
    mockRequireSession.mockResolvedValue({
      user: { id: "user-123" },
    } as unknown as Awaited<ReturnType<typeof import("../../../utils/session").requireSession>>);

    mockIsUserAuthorized.mockResolvedValue([true, "read", 1]);

    const event = {
      requestContext: {
        http: {
          method: "POST",
        },
      },
      headers: {
        host: "localhost:3000",
      },
    } as unknown as APIGatewayProxyEventV2;

    const result = await authenticateAndAuthorize(event, "workspace-123");
    expect(result).toBe("users/user-123");
    expect(mockRequireSession).toHaveBeenCalledWith(event);
    expect(mockIsUserAuthorized).toHaveBeenCalledWith(
      "users/user-123",
      "workspaces/workspace-123",
      "read"
    );
  });

  it("should throw unauthorized when session has no user", async () => {
    mockRequireSession.mockResolvedValue({
      user: null,
    } as unknown as Awaited<ReturnType<typeof import("../../../utils/session").requireSession>>);

    const event = {
      requestContext: {
        http: {
          method: "POST",
        },
      },
      headers: {
        host: "localhost:3000",
      },
    } as unknown as APIGatewayProxyEventV2;

    await expect(
      authenticateAndAuthorize(event, "workspace-123")
    ).rejects.toThrow();
  });

  it("should throw forbidden when user lacks permissions", async () => {
    mockRequireSession.mockResolvedValue({
      user: { id: "user-123" },
    } as unknown as Awaited<ReturnType<typeof import("../../../utils/session").requireSession>>);

    mockIsUserAuthorized.mockResolvedValue([false]);

    const event = {
      requestContext: {
        http: {
          method: "POST",
        },
      },
      headers: {
        host: "localhost:3000",
      },
    } as unknown as APIGatewayProxyEventV2;

    await expect(
      authenticateAndAuthorize(event, "workspace-123")
    ).rejects.toThrow();
  });
});
