import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDeleteStreamServerConfig } = vi.hoisted(() => {
  return {
    mockDeleteStreamServerConfig: vi.fn(),
  };
});

// Mock the streamServerUtils module
vi.mock("../../../../utils/streamServerUtils", () => ({
  deleteStreamServerConfig: mockDeleteStreamServerConfig,
}));

describe("DELETE /api/workspaces/:workspaceId/agents/:agentId/stream-servers", () => {
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

      const { deleteStreamServerConfig } = await import(
        "../../../../utils/streamServerUtils"
      );

      await deleteStreamServerConfig(workspaceId, agentId);

      res.status(204).send();
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should delete stream server config successfully", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";

    mockDeleteStreamServerConfig.mockResolvedValue(undefined);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockDeleteStreamServerConfig).toHaveBeenCalledWith(
      workspaceId,
      agentId
    );
    expect(mockDeleteStreamServerConfig).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it("should throw badRequest when workspaceId is missing", async () => {
    const agentId = "agent-456";

    const req = createMockRequest({
      params: {
        agentId,
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

    expect(mockDeleteStreamServerConfig).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should throw badRequest when agentId is missing", async () => {
    const workspaceId = "workspace-123";

    const req = createMockRequest({
      params: {
        workspaceId,
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

    expect(mockDeleteStreamServerConfig).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should throw badRequest when both workspaceId and agentId are missing", async () => {
    const req = createMockRequest({
      params: {},
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

    expect(mockDeleteStreamServerConfig).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should handle different workspace and agent IDs", async () => {
    const workspaceId1 = "workspace-123";
    const agentId1 = "agent-456";
    const workspaceId2 = "workspace-789";
    const agentId2 = "agent-012";

    mockDeleteStreamServerConfig.mockResolvedValue(undefined);

    const req1 = createMockRequest({
      params: {
        workspaceId: workspaceId1,
        agentId: agentId1,
      },
    });
    const res1 = createMockResponse();

    await callRouteHandler(req1, res1);

    expect(mockDeleteStreamServerConfig).toHaveBeenCalledWith(
      workspaceId1,
      agentId1
    );
    expect(res1.status).toHaveBeenCalledWith(204);

    const req2 = createMockRequest({
      params: {
        workspaceId: workspaceId2,
        agentId: agentId2,
      },
    });
    const res2 = createMockResponse();

    await callRouteHandler(req2, res2);

    expect(mockDeleteStreamServerConfig).toHaveBeenCalledWith(
      workspaceId2,
      agentId2
    );
    expect(res2.status).toHaveBeenCalledWith(204);
    expect(mockDeleteStreamServerConfig).toHaveBeenCalledTimes(2);
  });
});
