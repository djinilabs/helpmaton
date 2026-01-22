import { badRequest, unauthorized } from "@hapi/boom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createAPIGatewayEventV2,
  createMockCallback,
  createMockContext,
} from "../../utils/__tests__/test-helpers";

const {
  mockDatabase,
  mockValidateWebhookRequest,
  mockValidateWebhookKey,
  mockValidateSubscriptionAndLimits,
  mockEnqueueWebhookTask,
} = vi.hoisted(() => ({
  mockDatabase: vi.fn(),
  mockValidateWebhookRequest: vi.fn(),
  mockValidateWebhookKey: vi.fn(),
  mockValidateSubscriptionAndLimits: vi.fn(),
  mockEnqueueWebhookTask: vi.fn(),
}));

vi.mock("../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("@architect/functions", () => ({
  tables: vi.fn().mockResolvedValue({
    reflect: vi.fn().mockResolvedValue({}),
    _client: {},
  }),
}));

vi.mock("../../utils/requestValidation", () => ({
  validateWebhookRequest: mockValidateWebhookRequest,
  validateWebhookKey: mockValidateWebhookKey,
}));

vi.mock("../../../utils/webhookQueue", () => ({
  enqueueWebhookTask: mockEnqueueWebhookTask,
}));

vi.mock("../../utils/generationRequestTracking", () => ({
  validateSubscriptionAndLimits: mockValidateSubscriptionAndLimits,
  trackSuccessfulRequest: vi.fn(),
}));

const mockRandomUUID = vi.fn();
vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomUUID: () => mockRandomUUID(),
  };
});
const getHandler = async () => {
  const { handler } = await import("../index");
  return handler;
};

describe("post-api-webhook-000workspaceId-000agentId-000key handler", () => {
  const mockContext = createMockContext();
  const mockCallback = createMockCallback();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRandomUUID.mockReturnValue("ff028639-8bb4-43f0-87fa-0618dada653c");
    mockValidateSubscriptionAndLimits.mockResolvedValue(undefined);
    mockDatabase.mockResolvedValue({
      workspace: {
        get: vi.fn().mockResolvedValue({
          creditBalance: 1,
        }),
      },
    });
  });

  it("returns 202 and enqueues webhook task", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const key = "key-789";
    const bodyText = "Hello, agent!";

    mockValidateWebhookRequest.mockReturnValue({
      workspaceId,
      agentId,
      key,
      bodyText,
    });
    mockValidateWebhookKey.mockResolvedValue(undefined);
    mockEnqueueWebhookTask.mockResolvedValue(undefined);

    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: bodyText,
      requestContext: {
        ...createAPIGatewayEventV2().requestContext,
        http: {
          ...createAPIGatewayEventV2().requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId,
        agentId,
        key,
      },
    });

    const handler = await getHandler();
    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(202);
    expect(result.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(result.body)).toEqual({
      conversationId: "ff028639-8bb4-43f0-87fa-0618dada653c",
    });
    expect(mockValidateWebhookRequest).toHaveBeenCalledWith(event);
    expect(mockValidateWebhookKey).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      key
    );
    expect(mockValidateSubscriptionAndLimits).toHaveBeenCalledWith(
      workspaceId,
      "webhook"
    );
    expect(mockEnqueueWebhookTask).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      bodyText,
      "ff028639-8bb4-43f0-87fa-0618dada653c"
    );
  });

  it("returns 402 when workspace has no credits", async () => {
    mockValidateWebhookRequest.mockReturnValue({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      key: "key-789",
      bodyText: "test",
    });
    mockValidateWebhookKey.mockResolvedValue(undefined);
    mockDatabase.mockResolvedValue({
      workspace: {
        get: vi.fn().mockResolvedValue({
          creditBalance: 0,
        }),
      },
    });

    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: "test",
      requestContext: {
        ...createAPIGatewayEventV2().requestContext,
        http: {
          ...createAPIGatewayEventV2().requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        key: "key-789",
      },
    });

    const handler = await getHandler();
    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(402);
  });

  it("returns 400 when request validation fails", async () => {
    mockValidateWebhookRequest.mockImplementation(() => {
      throw badRequest("Invalid request format");
    });

    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: "test",
      requestContext: {
        ...createAPIGatewayEventV2().requestContext,
        http: {
          ...createAPIGatewayEventV2().requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        key: "key-789",
      },
    });

    const handler = await getHandler();
    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("Invalid request format");
  });

  it("returns 401 when webhook key validation fails", async () => {
    mockValidateWebhookRequest.mockReturnValue({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      key: "key-789",
      bodyText: "test",
    });
    mockValidateWebhookKey.mockRejectedValue(unauthorized("Invalid key"));

    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: "test",
      requestContext: {
        ...createAPIGatewayEventV2().requestContext,
        http: {
          ...createAPIGatewayEventV2().requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        key: "key-789",
      },
    });

    const handler = await getHandler();
    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("Invalid key");
  });

  it("returns 500 when enqueue fails", async () => {
    mockValidateWebhookRequest.mockReturnValue({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      key: "key-789",
      bodyText: "test",
    });
    mockValidateWebhookKey.mockResolvedValue(undefined);
    mockEnqueueWebhookTask.mockRejectedValue(new Error("Queue failed"));

    const event = createAPIGatewayEventV2({
      routeKey: "POST /api/webhook/workspace-123/agent-456/key-789",
      rawPath: "/api/webhook/workspace-123/agent-456/key-789",
      body: "test",
      requestContext: {
        ...createAPIGatewayEventV2().requestContext,
        http: {
          ...createAPIGatewayEventV2().requestContext.http,
          method: "POST",
        },
      },
      pathParameters: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        key: "key-789",
      },
    });

    const handler = await getHandler();
    const result = (await handler(event, mockContext, mockCallback)) as {
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    };

    expect(result.statusCode).toBe(500);
  });
});
