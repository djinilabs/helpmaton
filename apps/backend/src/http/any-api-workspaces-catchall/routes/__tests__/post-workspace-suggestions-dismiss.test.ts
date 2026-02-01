import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";
import { validateBody } from "../../../utils/bodyValidation";
import { dismissSuggestionRequestSchema } from "../../../utils/schemas/requestSchemas";
import { dismissSuggestion } from "../../../utils/suggestions";

const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("POST /api/workspaces/:workspaceId/suggestions/dismiss", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const body = validateBody(req.body, dismissSuggestionRequestSchema);
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }

        const db = await mockDatabase();
        const workspace = await db.workspace.get(workspaceResource, "workspace");
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }

        const updatedCache = dismissSuggestion(
          workspace.suggestions ?? null,
          body.suggestionId
        );

        if (updatedCache) {
          await db.workspace.update({
            pk: workspaceResource,
            sk: "workspace",
            suggestions: updatedCache,
            updatedBy: (req as { userRef?: string }).userRef || "",
          });
        }

        res.json({
          suggestions: updatedCache
            ? {
                items: updatedCache.items,
                generatedAt: updatedCache.generatedAt,
              }
            : null,
        });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("dismisses a workspace suggestion and updates cache", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const suggestions = {
      items: [
        { id: "s1", text: "Connect tools" },
        { id: "s2", text: "Upload documents" },
      ],
      generatedAt: "2024-01-01T00:00:00Z",
      dismissedIds: [],
    };

    mockDb.workspace.get = vi.fn().mockResolvedValue({
      pk: "workspaces/workspace-123",
      sk: "workspace",
      suggestions,
    });
    mockDb.workspace.update = vi.fn().mockResolvedValue({
      ...suggestions,
      dismissedIds: ["s1"],
    });

    const req = createMockRequest({
      body: { suggestionId: "s1" },
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockDb.workspace.update).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      suggestions: {
        items: [{ id: "s2", text: "Upload documents" }],
        generatedAt: "2024-01-01T00:00:00Z",
      },
    });
  });
});
