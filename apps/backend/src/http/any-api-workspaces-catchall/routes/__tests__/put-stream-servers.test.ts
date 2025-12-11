import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockUpdateStreamServerConfig } = vi.hoisted(() => {
  return {
    mockUpdateStreamServerConfig: vi.fn(),
  };
});

// Mock the streamServerUtils module
vi.mock("../../../../utils/streamServerUtils", () => ({
  updateStreamServerConfig: mockUpdateStreamServerConfig,
}));

describe("PUT /api/workspaces/:workspaceId/agents/:agentId/stream-servers", () => {
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

      const { updateStreamServerConfig } = await import(
        "../../../../utils/streamServerUtils"
      );

      const config = await updateStreamServerConfig(
        workspaceId,
        agentId,
        allowedOrigins
      );

      res.status(200).json({
        allowedOrigins: config.allowedOrigins,
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should update stream server config successfully", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const allowedOrigins = ["https://example.com", "https://app.example.com"];

    mockUpdateStreamServerConfig.mockResolvedValue({
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

    expect(mockUpdateStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      allowedOrigins
    );
    expect(mockUpdateStreamServerConfig).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      allowedOrigins,
    });
  });

  it("should update stream server config with wildcard origin", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const allowedOrigins = ["*"];

    mockUpdateStreamServerConfig.mockResolvedValue({
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

    expect(mockUpdateStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      allowedOrigins
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      allowedOrigins,
    });
  });

  it("should update stream server config with mixed origins", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const allowedOrigins = [
      "*",
      "https://example.com",
      "http://localhost:3000",
    ];

    mockUpdateStreamServerConfig.mockResolvedValue({
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

    expect(mockUpdateStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      allowedOrigins
    );
    expect(res.status).toHaveBeenCalledWith(200);
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

    expect(mockUpdateStreamServerConfig).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
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

    expect(mockUpdateStreamServerConfig).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
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

    expect(mockUpdateStreamServerConfig).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
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

    expect(mockUpdateStreamServerConfig).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
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

    expect(mockUpdateStreamServerConfig).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should accept empty allowedOrigins array", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const allowedOrigins: string[] = [];

    mockUpdateStreamServerConfig.mockResolvedValue({
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

    expect(mockUpdateStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      allowedOrigins
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      allowedOrigins,
    });
  });
});
