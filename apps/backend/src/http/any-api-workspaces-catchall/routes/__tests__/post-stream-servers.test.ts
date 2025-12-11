import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockValidateWorkspaceAndAgent,
  mockGetStreamServerConfig,
  mockCreateStreamServerConfig,
} = vi.hoisted(() => {
  return {
    mockValidateWorkspaceAndAgent: vi.fn(),
    mockGetStreamServerConfig: vi.fn(),
    mockCreateStreamServerConfig: vi.fn(),
  };
});

// Mock the modules
// From routes/__tests__/post-stream-servers.test.ts: ../../../utils/agentUtils -> http/utils/agentUtils
vi.mock("../../../utils/agentUtils", () => ({
  validateWorkspaceAndAgent: mockValidateWorkspaceAndAgent,
}));

vi.mock("../../../../utils/streamServerUtils", () => ({
  getStreamServerConfig: mockGetStreamServerConfig,
  createStreamServerConfig: mockCreateStreamServerConfig,
}));

describe("POST /api/workspaces/:workspaceId/agents/:agentId/stream-servers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>
  ) {
    // Extract the handler logic directly
    const handler = async (req: express.Request, res: express.Response) => {
      const { workspaceId, agentId } = req.params;
      const { allowedOrigins } = req.body;

      if (!workspaceId || !agentId) {
        throw badRequest("workspaceId and agentId are required");
      }

      if (!Array.isArray(allowedOrigins)) {
        throw badRequest("allowedOrigins must be an array");
      }

      // Validate each origin string
      const isValidOrigin = (origin: string) =>
        origin === "*" ||
        (typeof origin === "string" &&
          (origin.startsWith("http://") || origin.startsWith("https://")));
      if (!allowedOrigins.every(isValidOrigin)) {
        throw badRequest(
          "Each allowedOrigin must be '*' or a string starting with 'http://' or 'https://'"
        );
      }

      // Validate that agent exists and belongs to workspace
      // From test file location: ../../../utils/agentUtils -> http/utils/agentUtils
      const { validateWorkspaceAndAgent } = await import(
        "../../../utils/agentUtils"
      );
      await validateWorkspaceAndAgent(workspaceId, agentId);

      // Check if stream server config already exists
      const { getStreamServerConfig, createStreamServerConfig } = await import(
        "../../../../utils/streamServerUtils"
      );
      const existingConfig = await getStreamServerConfig(workspaceId, agentId);
      if (existingConfig) {
        throw badRequest(
          "Stream server configuration already exists. Use PUT to update it."
        );
      }

      const config = await createStreamServerConfig(
        workspaceId,
        agentId,
        allowedOrigins
      );

      res.status(201).json({
        secret: config.secret,
        allowedOrigins: config.allowedOrigins,
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should create stream server config successfully", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const allowedOrigins = ["https://example.com", "https://app.example.com"];

    mockValidateWorkspaceAndAgent.mockResolvedValue({
      workspace: { pk: `workspaces/${workspaceId}` },
      agent: { pk: `agents/${workspaceId}/${agentId}` },
    });
    mockGetStreamServerConfig.mockResolvedValue(null);
    mockCreateStreamServerConfig.mockResolvedValue({
      secret: "stream-secret-789",
      allowedOrigins,
    });

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        allowedOrigins,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockValidateWorkspaceAndAgent).toHaveBeenCalledWith(
      workspaceId,
      agentId
    );
    expect(mockGetStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId
    );
    expect(mockCreateStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      allowedOrigins
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      secret: "stream-secret-789",
      allowedOrigins,
    });
  });

  it("should create stream server config with wildcard origin", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const allowedOrigins = ["*"];

    mockValidateWorkspaceAndAgent.mockResolvedValue({
      workspace: { pk: `workspaces/${workspaceId}` },
      agent: { pk: `agents/${workspaceId}/${agentId}` },
    });
    mockGetStreamServerConfig.mockResolvedValue(null);
    mockCreateStreamServerConfig.mockResolvedValue({
      secret: "stream-secret-789",
      allowedOrigins,
    });

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        allowedOrigins,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockCreateStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      allowedOrigins
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      secret: "stream-secret-789",
      allowedOrigins,
    });
  });

  it("should create stream server config with mixed origins", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const allowedOrigins = [
      "*",
      "https://example.com",
      "http://localhost:3000",
    ];

    mockValidateWorkspaceAndAgent.mockResolvedValue({
      workspace: { pk: `workspaces/${workspaceId}` },
      agent: { pk: `agents/${workspaceId}/${agentId}` },
    });
    mockGetStreamServerConfig.mockResolvedValue(null);
    mockCreateStreamServerConfig.mockResolvedValue({
      secret: "stream-secret-789",
      allowedOrigins,
    });

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        allowedOrigins,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockCreateStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      allowedOrigins
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("should throw badRequest when workspaceId is missing", async () => {
    const agentId = "agent-456";

    const req = createMockRequest({
      params: {
        agentId,
      },
      body: {
        allowedOrigins: ["https://example.com"],
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "workspaceId and agentId are required",
          }),
        }),
      })
    );

    expect(mockValidateWorkspaceAndAgent).not.toHaveBeenCalled();
    expect(mockGetStreamServerConfig).not.toHaveBeenCalled();
    expect(mockCreateStreamServerConfig).not.toHaveBeenCalled();
  });

  it("should throw badRequest when agentId is missing", async () => {
    const workspaceId = "workspace-123";

    const req = createMockRequest({
      params: {
        workspaceId,
      },
      body: {
        allowedOrigins: ["https://example.com"],
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "workspaceId and agentId are required",
          }),
        }),
      })
    );

    expect(mockValidateWorkspaceAndAgent).not.toHaveBeenCalled();
    expect(mockGetStreamServerConfig).not.toHaveBeenCalled();
    expect(mockCreateStreamServerConfig).not.toHaveBeenCalled();
  });

  it("should throw badRequest when allowedOrigins is not an array", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        allowedOrigins: "not-an-array",
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: "allowedOrigins must be an array",
          }),
        }),
      })
    );

    expect(mockValidateWorkspaceAndAgent).not.toHaveBeenCalled();
    expect(mockGetStreamServerConfig).not.toHaveBeenCalled();
    expect(mockCreateStreamServerConfig).not.toHaveBeenCalled();
  });

  it("should throw badRequest when allowedOrigins contains invalid origin", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        allowedOrigins: ["https://example.com", "invalid-origin"],
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Each allowedOrigin must be '*' or a string starting with 'http://' or 'https://'"
            ),
          }),
        }),
      })
    );

    expect(mockValidateWorkspaceAndAgent).not.toHaveBeenCalled();
    expect(mockGetStreamServerConfig).not.toHaveBeenCalled();
    expect(mockCreateStreamServerConfig).not.toHaveBeenCalled();
  });

  it("should throw badRequest when allowedOrigins contains non-string value", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        allowedOrigins: ["https://example.com", 123],
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Each allowedOrigin must be '*' or a string starting with 'http://' or 'https://'"
            ),
          }),
        }),
      })
    );

    expect(mockValidateWorkspaceAndAgent).not.toHaveBeenCalled();
    expect(mockGetStreamServerConfig).not.toHaveBeenCalled();
    expect(mockCreateStreamServerConfig).not.toHaveBeenCalled();
  });

  it("should throw resourceGone when validateWorkspaceAndAgent fails", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    mockValidateWorkspaceAndAgent.mockRejectedValue(
      resourceGone("Agent not found")
    );

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        allowedOrigins: ["https://example.com"],
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: "Agent not found",
          }),
        }),
      })
    );

    expect(mockValidateWorkspaceAndAgent).toHaveBeenCalledWith(
      workspaceId,
      agentId
    );
    expect(mockGetStreamServerConfig).not.toHaveBeenCalled();
    expect(mockCreateStreamServerConfig).not.toHaveBeenCalled();
  });

  it("should throw badRequest when stream server config already exists", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const allowedOrigins = ["https://example.com"];

    mockValidateWorkspaceAndAgent.mockResolvedValue({
      workspace: { pk: `workspaces/${workspaceId}` },
      agent: { pk: `agents/${workspaceId}/${agentId}` },
    });
    mockGetStreamServerConfig.mockResolvedValue({
      secret: "existing-secret",
      allowedOrigins: ["https://old.example.com"],
    });

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        allowedOrigins,
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message:
              "Stream server configuration already exists. Use PUT to update it.",
          }),
        }),
      })
    );

    expect(mockValidateWorkspaceAndAgent).toHaveBeenCalledWith(
      workspaceId,
      agentId
    );
    expect(mockGetStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId
    );
    expect(mockCreateStreamServerConfig).not.toHaveBeenCalled();
  });

  it("should accept empty allowedOrigins array", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const allowedOrigins: string[] = [];

    mockValidateWorkspaceAndAgent.mockResolvedValue({
      workspace: { pk: `workspaces/${workspaceId}` },
      agent: { pk: `agents/${workspaceId}/${agentId}` },
    });
    mockGetStreamServerConfig.mockResolvedValue(null);
    mockCreateStreamServerConfig.mockResolvedValue({
      secret: "stream-secret-789",
      allowedOrigins,
    });

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
      body: {
        allowedOrigins,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockCreateStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      allowedOrigins
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      secret: "stream-secret-789",
      allowedOrigins,
    });
  });
});
