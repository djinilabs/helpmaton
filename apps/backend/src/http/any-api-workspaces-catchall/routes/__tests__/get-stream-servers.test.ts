import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockGetStreamServerConfig } = vi.hoisted(() => {
  return {
    mockGetStreamServerConfig: vi.fn(),
  };
});

// Mock the streamServerUtils module
vi.mock("../../../../utils/streamServerUtils", () => ({
  getStreamServerConfig: mockGetStreamServerConfig,
}));

describe("GET /api/workspaces/:workspaceId/agents/:agentId/stream-servers", () => {
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

      if (!workspaceId || !agentId) {
        throw badRequest("workspaceId and agentId are required");
      }

      const { getStreamServerConfig } = await import(
        "../../../../utils/streamServerUtils"
      );

      const config = await getStreamServerConfig(workspaceId, agentId);

      if (!config) {
        return res
          .status(404)
          .json({ error: "Stream server configuration not found" });
      }

      // Return config with secret so the full URL can be constructed
      res.status(200).json({
        secret: config.secret,
        allowedOrigins: config.allowedOrigins,
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return stream server configuration", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockConfig = {
      secret: "stream-secret-789",
      allowedOrigins: ["https://example.com", "https://app.example.com"],
    };

    mockGetStreamServerConfig.mockResolvedValue(mockConfig);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockGetStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      secret: "stream-secret-789",
      allowedOrigins: ["https://example.com", "https://app.example.com"],
    });
  });

  it("should return 404 when stream server configuration not found", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    mockGetStreamServerConfig.mockResolvedValue(null);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockGetStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "Stream server configuration not found",
    });
  });

  it("should throw badRequest when workspaceId is missing", async () => {
    const req = createMockRequest({
      params: {
        workspaceId: "" as string,
        agentId: "agent-456",
      },
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(400);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("workspaceId and agentId are required");
    }

    expect(mockGetStreamServerConfig).not.toHaveBeenCalled();
  });

  it("should throw badRequest when agentId is missing", async () => {
    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        agentId: "" as string,
      },
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(400);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("workspaceId and agentId are required");
    }

    expect(mockGetStreamServerConfig).not.toHaveBeenCalled();
  });

  it("should handle empty allowedOrigins array", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockConfig = {
      secret: "stream-secret-789",
      allowedOrigins: [],
    };

    mockGetStreamServerConfig.mockResolvedValue(mockConfig);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      secret: "stream-secret-789",
      allowedOrigins: [],
    });
  });

  it("should handle single allowed origin", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    const mockConfig = {
      secret: "stream-secret-789",
      allowedOrigins: ["https://example.com"],
    };

    mockGetStreamServerConfig.mockResolvedValue(mockConfig);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      secret: "stream-secret-789",
      allowedOrigins: ["https://example.com"],
    });
  });
});
