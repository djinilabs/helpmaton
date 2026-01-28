import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line import/order
import {
  createMockDatabase,
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

const {
  mockDatabase,
  mockRemoveAgentResources,
  mockDeleteDocumentSnippets,
  mockDeleteDocument,
  mockDeleteDiscordCommand,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockRemoveAgentResources: vi.fn(),
    mockDeleteDocumentSnippets: vi.fn(),
    mockDeleteDocument: vi.fn(),
    mockDeleteDiscordCommand: vi.fn(),
  };
});

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/agentCleanup", () => ({
  removeAgentResources: mockRemoveAgentResources,
}));

vi.mock("../../../../utils/documentIndexing", () => ({
  deleteDocumentSnippets: mockDeleteDocumentSnippets,
}));

vi.mock("../../../../utils/s3", () => ({
  deleteDocument: mockDeleteDocument,
}));

vi.mock("../../../../utils/discordApi", () => ({
  deleteDiscordCommand: mockDeleteDiscordCommand,
}));

vi.mock("../middleware", () => ({
  requireAuth: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    next();
  },
  requirePermission:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      next();
    },
  handleError: (error: unknown, next: express.NextFunction) => {
    next(error);
  },
}));

import { registerDeleteWorkspace } from "../delete-workspace";

import { createTestAppWithHandlerCapture } from "./route-test-helpers";

type MockDb = ReturnType<typeof createMockDatabase> &
  Record<
    string,
    {
      queryAsync?: (
        ...args: unknown[]
      ) => AsyncGenerator<unknown, void, unknown>;
      delete?: (...args: unknown[]) => unknown;
    }
  >;

type QueryAsyncTable<T extends object> = T & {
  queryAsync: (...args: unknown[]) => AsyncGenerator<unknown, void, unknown>;
};

function withQueryAsync<T extends object>(table: T): QueryAsyncTable<T> {
  return table as QueryAsyncTable<T>;
}

function buildAsyncGenerator<T>(items: T[]) {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

function ensureTable(db: MockDb, name: string): Record<string, unknown> {
  if (!db[name]) {
    db[name] = {};
  }
  return db[name];
}

describe("DELETE /api/workspaces/:workspaceId", () => {
  let testApp: ReturnType<typeof createTestAppWithHandlerCapture>;

  beforeEach(() => {
    vi.clearAllMocks();
    testApp = createTestAppWithHandlerCapture();
    registerDeleteWorkspace(testApp.app);
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction,
  ) {
    const handler = testApp.deleteHandler("/api/workspaces/:workspaceId");
    if (!handler) {
      throw new Error("Route handler not found");
    }
    await handler(req as express.Request, res as express.Response, next);
  }

  it("removes workspace resources and agents but preserves transactions", async () => {
    const mockDb = createMockDatabase() as MockDb;
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;

    mockDb.workspace.get = vi.fn().mockResolvedValue({
      pk: workspaceResource,
      sk: "workspace",
      name: "Workspace",
    });
    withQueryAsync(mockDb.agent).queryAsync = vi.fn().mockReturnValue(
      buildAsyncGenerator([
        { pk: `agents/${workspaceId}/agent-1`, sk: "agent" },
        { pk: `agents/${workspaceId}/agent-2`, sk: "agent" },
      ]),
    );
    mockRemoveAgentResources.mockResolvedValue({ cleanupErrors: [] });

    withQueryAsync(ensureTable(mockDb, "workspace-document")).queryAsync = vi
      .fn()
      .mockReturnValue(
        buildAsyncGenerator([
          {
            pk: `workspace-documents/${workspaceId}/doc-1`,
            sk: "document",
            s3Key: `workspaces/${workspaceId}/documents/file.txt`,
          },
        ]),
      );

    mockDb.permission.query = vi.fn().mockResolvedValue({
      items: [
        { pk: workspaceResource, sk: "user-1" },
        { pk: workspaceResource, sk: "user-2" },
      ],
    });
    mockDb.permission.delete = vi.fn();
    mockDb.workspace.delete = vi.fn();
    ensureTable(mockDb, "workspace-credit-transactions").delete = vi.fn();

    withQueryAsync(ensureTable(mockDb, "workspace-api-key")).queryAsync = vi
      .fn()
      .mockReturnValue(buildAsyncGenerator([]));
    withQueryAsync(ensureTable(mockDb, "output_channel")).queryAsync = vi
      .fn()
      .mockReturnValue(buildAsyncGenerator([]));
    withQueryAsync(ensureTable(mockDb, "email-connection")).queryAsync = vi
      .fn()
      .mockReturnValue(buildAsyncGenerator([]));
    withQueryAsync(ensureTable(mockDb, "mcp-server")).queryAsync = vi
      .fn()
      .mockReturnValue(buildAsyncGenerator([]));
    withQueryAsync(ensureTable(mockDb, "workspace-invite")).queryAsync = vi
      .fn()
      .mockReturnValue(buildAsyncGenerator([]));
    withQueryAsync(ensureTable(mockDb, "token-usage-aggregates")).queryAsync =
      vi.fn().mockReturnValue(buildAsyncGenerator([]));
    withQueryAsync(ensureTable(mockDb, "tool-usage-aggregates")).queryAsync = vi
      .fn()
      .mockReturnValue(buildAsyncGenerator([]));
    withQueryAsync(ensureTable(mockDb, "credit-reservations")).queryAsync = vi
      .fn()
      .mockReturnValue(buildAsyncGenerator([]));
    withQueryAsync(ensureTable(mockDb, "bot-integration")).queryAsync = vi
      .fn()
      .mockReturnValue(buildAsyncGenerator([]));
    ensureTable(mockDb, "trial-credit-requests").delete = vi.fn();

    const req = createMockRequest({
      workspaceResource,
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockRemoveAgentResources).toHaveBeenCalledTimes(2);
    expect(mockDeleteDocumentSnippets).toHaveBeenCalledWith(
      workspaceId,
      "doc-1",
    );
    expect(mockDeleteDocument).toHaveBeenCalledWith(
      workspaceId,
      "doc-1",
      `workspaces/${workspaceId}/documents/file.txt`,
    );
    expect(mockDb["trial-credit-requests"].delete).toHaveBeenCalledWith(
      `trial-credit-requests/${workspaceId}`,
      "request",
    );
    expect(
      mockDb["workspace-credit-transactions"].delete,
    ).not.toHaveBeenCalled();
    expect(mockDb.workspace.delete).toHaveBeenCalledWith(
      workspaceResource,
      "workspace",
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
