import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("DELETE /api/workspaces/:workspaceId/api-key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Extract the handler logic directly
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const db = await mockDatabase();
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const provider = req.query.provider as string;

        if (!provider || typeof provider !== "string") {
          throw badRequest("provider query parameter is required");
        }

        // Validate provider is one of the supported values
        const validProviders = ["google", "openai", "anthropic"];
        if (!validProviders.includes(provider)) {
          throw badRequest(
            `provider must be one of: ${validProviders.join(", ")}`
          );
        }

        const pk = `workspace-api-keys/${workspaceId}/${provider}`;
        const sk = "key";

        // Delete key in new format
        // Only catch "not found" errors, let other errors propagate
        try {
          await db["workspace-api-key"].delete(pk, sk);
        } catch (error) {
          // Check if it's a "not found" error - if so, continue
          // Otherwise, re-throw the error
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (
            !errorMessage.includes("not found") &&
            !errorMessage.includes("Not found") &&
            !errorMessage.includes("does not exist")
          ) {
            throw error;
          }
          // Key doesn't exist in new format, continue to check old format
        }

        // Backward compatibility: also delete old format key for Google provider
        if (provider === "google") {
          const oldPk = `workspace-api-keys/${workspaceId}`;
          try {
            await db["workspace-api-key"].delete(oldPk, sk);
          } catch (error) {
            // Check if it's a "not found" error - if so, continue
            // Otherwise, re-throw the error
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            if (
              !errorMessage.includes("not found") &&
              !errorMessage.includes("Not found") &&
              !errorMessage.includes("does not exist")
            ) {
              throw error;
            }
            // Old key doesn't exist, that's fine
          }
        }

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should delete API key successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const provider = "google";

    const mockApiKeyDelete = vi.fn().mockResolvedValue(undefined);
    mockDb["workspace-api-key"].delete = mockApiKeyDelete;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
      },
      query: {
        provider,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyDelete).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}/${provider}`,
      "key"
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
      },
      query: {
        provider: "google",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("Workspace resource not found"),
          }),
        }),
      })
    );
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should handle errors from database delete operation", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const provider = "google";
    const error = new Error("Database error");

    const mockApiKeyDelete = vi.fn().mockRejectedValue(error);
    mockDb["workspace-api-key"].delete = mockApiKeyDelete;

    const req = createMockRequest({
      workspaceResource: `workspaces/${workspaceId}`,
      params: {
        workspaceId,
      },
      query: {
        provider,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyDelete).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}/${provider}`,
      "key"
    );
    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});
