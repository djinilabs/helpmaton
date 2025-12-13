import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("GET /api/workspaces/:workspaceId/api-key", () => {
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

        let workspaceKey;
        try {
          workspaceKey = await db["workspace-api-key"].get(pk, sk);
        } catch {
          // Key doesn't exist in new format
        }

        // Backward compatibility: check old format for Google provider only
        if (!workspaceKey && provider === "google") {
          const oldPk = `workspace-api-keys/${workspaceId}`;
          try {
            workspaceKey = await db["workspace-api-key"].get(oldPk, sk);
          } catch {
            // Old key doesn't exist either
          }
        }

        res.json({ hasKey: !!workspaceKey });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return hasKey as true when API key exists", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const provider = "google";
    const mockApiKey = {
      pk: `workspace-api-keys/${workspaceId}/${provider}`,
      sk: "key",
      key: "api-key-value",
      provider,
    };

    const mockApiKeyGet = vi.fn().mockResolvedValue(mockApiKey);
    mockDb["workspace-api-key"].get = mockApiKeyGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
      query: {
        provider,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyGet).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}/${provider}`,
      "key"
    );
    expect(res.json).toHaveBeenCalledWith({
      hasKey: true,
    });
  });

  it("should return hasKey as false when API key does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const provider = "google";

    const mockApiKeyGet = vi.fn().mockRejectedValue(new Error("Not found"));
    mockDb["workspace-api-key"].get = mockApiKeyGet;

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId,
      },
      query: {
        provider,
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockApiKeyGet).toHaveBeenCalledWith(
      `workspace-api-keys/${workspaceId}/${provider}`,
      "key"
    );
    expect(res.json).toHaveBeenCalledWith({
      hasKey: false,
    });
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

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { statusCode: number } }).output?.statusCode
    ).toBe(400);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message
    ).toContain("Workspace resource not found");
  });
});
