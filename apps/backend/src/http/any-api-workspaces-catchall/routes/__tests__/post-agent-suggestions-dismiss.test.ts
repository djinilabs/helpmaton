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

describe("POST /api/workspaces/:workspaceId/agents/:agentId/suggestions/dismiss", () => {
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
        const workspaceId = (req.params as { workspaceId?: string }).workspaceId;
        const agentId = (req.params as { agentId?: string }).agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        const updatedCache = dismissSuggestion(
          agent.suggestions ?? null,
          body.suggestionId
        );

        if (updatedCache) {
          await db.agent.update({
            pk: agentPk,
            sk: "agent",
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

  it("dismisses an agent suggestion and updates cache", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const suggestions = {
      items: [
        { id: "s1", text: "Enable memory search" },
        { id: "s2", text: "Connect tools" },
      ],
      generatedAt: "2024-01-01T00:00:00Z",
      dismissedIds: [],
    };

    mockDb.agent.get = vi.fn().mockResolvedValue({
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      suggestions,
    });
    mockDb.agent.update = vi.fn().mockResolvedValue({
      ...suggestions,
      dismissedIds: ["s1"],
    });

    const req = createMockRequest({
      body: { suggestionId: "s1" },
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-123",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockDb.agent.update).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      suggestions: {
        items: [{ id: "s2", text: "Connect tools" }],
        generatedAt: "2024-01-01T00:00:00Z",
      },
    });
  });
});
