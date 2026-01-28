import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

const { mockDeleteDiscordCommand, mockRemoveAgentDatabases } = vi.hoisted(
  () => {
    return {
      mockDeleteDiscordCommand: vi.fn(),
      mockRemoveAgentDatabases: vi.fn(),
    };
  },
);

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

vi.mock("../../../../utils/discordApi", () => ({
  deleteDiscordCommand: mockDeleteDiscordCommand,
}));

vi.mock("../../../../utils/vectordb/agentRemoval", () => ({
  removeAgentDatabases: mockRemoveAgentDatabases,
}));

type MockQueryTable = {
  queryAsync: (
    query: unknown,
  ) => AsyncGenerator<Record<string, unknown>, void, unknown>;
  delete: (pk: string, sk?: string) => Promise<unknown>;
};

type MockDeleteIfExistsTable = {
  deleteIfExists: (pk: string, sk?: string) => Promise<unknown>;
};

type MockDb = {
  agent: {
    get: (...args: unknown[]) => Promise<unknown>;
    delete: (...args: unknown[]) => Promise<unknown>;
  };
} & Record<string, unknown>;

function buildAsyncGenerator<T>(items: T[]) {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

type MockIntegrationRecord = {
  workspaceId: string;
  pk: string;
  sk?: string;
  platform?: string;
  config?: Record<string, unknown>;
};

function setupMockCleanupTables(
  mockDb: MockDb,
  options?: {
    integrations?: MockIntegrationRecord[];
  },
) {
  mockDb["agent-key"] = {
    queryAsync: vi.fn().mockReturnValue(buildAsyncGenerator([])),
    delete: vi.fn(),
  } as MockQueryTable;
  mockDb["agent-schedule"] = {
    queryAsync: vi.fn().mockReturnValue(buildAsyncGenerator([])),
    delete: vi.fn(),
  } as MockQueryTable;
  mockDb["agent-conversations"] = {
    queryAsync: vi.fn().mockReturnValue(buildAsyncGenerator([])),
    delete: vi.fn(),
  } as MockQueryTable;
  mockDb["agent-eval-judge"] = {
    queryAsync: vi.fn().mockReturnValue(buildAsyncGenerator([])),
    delete: vi.fn(),
  } as MockQueryTable;
  mockDb["agent-eval-result"] = {
    queryAsync: vi.fn().mockReturnValue(buildAsyncGenerator([])),
    delete: vi.fn(),
  } as MockQueryTable;
  mockDb["agent-stream-servers"] = {
    deleteIfExists: vi.fn(),
  } as MockDeleteIfExistsTable;
  mockDb["agent-delegation-tasks"] = {
    queryAsync: vi.fn().mockReturnValue(buildAsyncGenerator([])),
    delete: vi.fn(),
  } as MockQueryTable;
  mockDb["bot-integration"] = {
    queryAsync: vi
      .fn()
      .mockReturnValue(buildAsyncGenerator(options?.integrations ?? [])),
    delete: vi.fn(),
  } as MockQueryTable;
}

describe("DELETE /api/workspaces/:workspaceId/agents/:agentId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction,
  ) {
    // Extract the handler logic directly
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      try {
        const db = (await mockDatabase()) as MockDb;
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = (req.params as { workspaceId?: string })
          .workspaceId;
        const agentId = (req.params as { agentId?: string }).agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        const cleanupErrors: Error[] = [];
        const safeCleanup = async (
          label: string,
          cleanup: () => Promise<void>,
        ) => {
          try {
            await cleanup();
          } catch (error) {
            const err =
              error instanceof Error ? error : new Error(String(error));
            console.warn(
              `[Agent Removal] Cleanup failed for ${label}:`,
              err.message,
            );
            cleanupErrors.push(err);
          }
        };

        await safeCleanup("agent-keys", async () => {
          const agentKeyTable = db["agent-key"] as MockQueryTable;
          for await (const key of agentKeyTable.queryAsync({
            IndexName: "byAgentId",
            KeyConditionExpression: "agentId = :agentId",
            ExpressionAttributeValues: {
              ":agentId": agentId,
            },
          })) {
            const keyRecord = key as {
              workspaceId?: string;
              pk: string;
              sk?: string;
            };
            if (keyRecord.workspaceId !== workspaceId) {
              continue;
            }
            await agentKeyTable.delete(keyRecord.pk, keyRecord.sk);
          }
        });

        await safeCleanup("agent-schedules", async () => {
          const scheduleTable = db["agent-schedule"] as MockQueryTable;
          for await (const schedule of scheduleTable.queryAsync({
            IndexName: "byAgentId",
            KeyConditionExpression: "agentId = :agentId",
            ExpressionAttributeValues: {
              ":agentId": agentId,
            },
          })) {
            const scheduleRecord = schedule as {
              workspaceId?: string;
              pk: string;
              sk?: string;
            };
            if (scheduleRecord.workspaceId !== workspaceId) {
              continue;
            }
            await scheduleTable.delete(scheduleRecord.pk, scheduleRecord.sk);
          }
        });

        await safeCleanup("agent-conversations", async () => {
          const conversationTable = db["agent-conversations"] as MockQueryTable;
          for await (const conversation of conversationTable.queryAsync({
            IndexName: "byAgentId",
            KeyConditionExpression: "agentId = :agentId",
            FilterExpression: "workspaceId = :workspaceId",
            ExpressionAttributeValues: {
              ":agentId": agentId,
              ":workspaceId": workspaceId,
            },
          })) {
            const conversationRecord = conversation as {
              pk: string;
              sk?: string;
            };
            await conversationTable.delete(
              conversationRecord.pk,
              conversationRecord.sk,
            );
          }
        });

        await safeCleanup("agent-eval-judges", async () => {
          const evalJudgeTable = db["agent-eval-judge"] as MockQueryTable;
          for await (const judge of evalJudgeTable.queryAsync({
            IndexName: "byAgentId",
            KeyConditionExpression: "agentId = :agentId",
            ExpressionAttributeValues: {
              ":agentId": agentId,
            },
          })) {
            const judgeRecord = judge as {
              workspaceId?: string;
              pk: string;
              sk?: string;
            };
            if (judgeRecord.workspaceId !== workspaceId) {
              continue;
            }
            await evalJudgeTable.delete(judgeRecord.pk, judgeRecord.sk);
          }
        });

        await safeCleanup("agent-eval-results", async () => {
          const evalResultTable = db["agent-eval-result"] as MockQueryTable;
          for await (const result of evalResultTable.queryAsync({
            IndexName: "byAgentId",
            KeyConditionExpression: "agentId = :agentId",
            ExpressionAttributeValues: {
              ":agentId": agentId,
            },
          })) {
            const resultRecord = result as {
              workspaceId?: string;
              pk: string;
              sk?: string;
            };
            if (resultRecord.workspaceId !== workspaceId) {
              continue;
            }
            await evalResultTable.delete(resultRecord.pk, resultRecord.sk);
          }
        });

        await safeCleanup("agent-stream-servers", async () => {
          const streamServerPk = `stream-servers/${workspaceId}/${agentId}`;
          const streamServerTable = db[
            "agent-stream-servers"
          ] as MockDeleteIfExistsTable;
          await streamServerTable.deleteIfExists(streamServerPk, "config");
        });

        await safeCleanup("agent-delegation-tasks", async () => {
          const gsi1pk = `workspace/${workspaceId}/agent/${agentId}`;
          const delegationTable = db[
            "agent-delegation-tasks"
          ] as MockQueryTable;
          for await (const task of delegationTable.queryAsync({
            IndexName: "byWorkspaceAndAgent",
            KeyConditionExpression: "gsi1pk = :gsi1pk",
            ExpressionAttributeValues: {
              ":gsi1pk": gsi1pk,
            },
          })) {
            const taskRecord = task as { pk: string; sk?: string };
            await delegationTable.delete(taskRecord.pk, taskRecord.sk);
          }
        });

        await safeCleanup("bot-integrations", async () => {
          const integrationTable = db["bot-integration"] as MockQueryTable;
          for await (const integration of integrationTable.queryAsync({
            IndexName: "byAgentId",
            KeyConditionExpression: "agentId = :agentId",
            ExpressionAttributeValues: {
              ":agentId": agentId,
            },
          })) {
            const integrationRecord = integration as {
              workspaceId?: string;
              pk: string;
              sk?: string;
              platform?: string;
              config?: Record<string, unknown>;
            };
            if (integrationRecord.workspaceId !== workspaceId) {
              continue;
            }
            if (integrationRecord.platform === "discord") {
              const config = integrationRecord.config as {
                botToken?: string;
                applicationId?: string;
                discordCommand?: {
                  commandName: string;
                  commandId: string;
                };
              };
              if (
                config.discordCommand &&
                config.applicationId &&
                config.botToken
              ) {
                try {
                  await mockDeleteDiscordCommand(
                    config.applicationId,
                    config.discordCommand.commandId,
                    config.botToken,
                  );
                } catch (error) {
                  console.warn(
                    `[Agent Removal] Failed to delete Discord command:`,
                    error,
                  );
                }
              }
            }
            await integrationTable.delete(
              integrationRecord.pk,
              integrationRecord.sk,
            );
          }
        });

        await safeCleanup("vector-databases", async () => {
          await mockRemoveAgentDatabases(agentId);
        });

        // Delete agent
        await db.agent.delete(agentPk, "agent");

        res.status(204).send();
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should delete agent successfully", async () => {
    const mockDb = createMockDatabase() as MockDb;
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const mockAgentDelete = vi.fn().mockResolvedValue(undefined);
    mockDb.agent.delete = mockAgentDelete;

    setupMockCleanupTables(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockAgentGet).toHaveBeenCalledWith(
      "agents/workspace-123/agent-456",
      "agent",
    );
    expect(mockAgentDelete).toHaveBeenCalledWith(
      "agents/workspace-123/agent-456",
      "agent",
    );
    expect(
      (mockDb["agent-stream-servers"] as MockDeleteIfExistsTable)
        .deleteIfExists,
    ).toHaveBeenCalledWith("stream-servers/workspace-123/agent-456", "config");
    expect(mockRemoveAgentDatabases).toHaveBeenCalledWith("agent-456");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase() as MockDb;
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { statusCode: number } }).output?.statusCode,
    ).toBe(400);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message,
    ).toContain("Workspace resource not found");
  });

  it("should throw resourceGone when agent does not exist", async () => {
    const mockDb = createMockDatabase() as MockDb;
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgentGet = vi.fn().mockResolvedValue(null);
    mockDb.agent.get = mockAgentGet;

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(
      (error as { output?: { statusCode: number } }).output?.statusCode,
    ).toBe(410);
    expect(
      (error as { output?: { payload: { message: string } } }).output?.payload
        .message,
    ).toContain("Agent not found");
    // Agent should not be deleted when it doesn't exist
  });

  it("should handle database errors during deletion", async () => {
    const mockDb = createMockDatabase() as MockDb;
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockAgentGet = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.get = mockAgentGet;

    const deleteError = new Error("Database deletion failed");
    const mockAgentDelete = vi.fn().mockRejectedValue(deleteError);
    mockDb.agent.delete = mockAgentDelete;

    setupMockCleanupTables(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error).toBe(deleteError);
  });

  it("should delete discord command when removing bot integrations", async () => {
    const mockDb = createMockDatabase() as MockDb;
    mockDatabase.mockResolvedValue(mockDb);

    const mockAgent = {
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      systemPrompt: "Test Prompt",
      provider: "google",
      createdAt: "2024-01-01T00:00:00Z",
    };

    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    mockDb.agent.delete = vi.fn().mockResolvedValue(undefined);

    const integration = {
      pk: "bot-integrations/workspace-123/integration-123",
      sk: "integration",
      workspaceId: "workspace-123",
      agentId: "agent-456",
      platform: "discord",
      config: {
        botToken: "token",
        applicationId: "app-123",
        discordCommand: {
          commandName: "test",
          commandId: "cmd-123",
        },
      },
    };

    setupMockCleanupTables(mockDb, { integrations: [integration] });

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
    });
    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockDeleteDiscordCommand).toHaveBeenCalledWith(
      "app-123",
      "cmd-123",
      "token",
    );
    expect(
      (mockDb["bot-integration"] as MockQueryTable).delete,
    ).toHaveBeenCalledWith(
      "bot-integrations/workspace-123/integration-123",
      "integration",
    );
  });
});
