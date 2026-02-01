import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type {
  DatabaseSchemaWithAtomicUpdate,
  WorkspaceRecord,
  AgentRecord,
} from "../schema";

// Mock @architect/functions
vi.mock("@architect/functions", () => {
  const mockTables = vi.fn();
  return {
    tables: mockTables,
  };
});

describe("database atomicUpdate", () => {
  let mockClient: {
    _client: {
      PutItem: ReturnType<typeof vi.fn>;
      BatchGetItem: ReturnType<typeof vi.fn>;
      TransactWriteItems: ReturnType<typeof vi.fn>;
    };
    reflect: ReturnType<typeof vi.fn>;
    workspace: {
      get: ReturnType<typeof vi.fn>;
    };
    agent: {
      get: ReturnType<typeof vi.fn>;
    };
  };
  let db: DatabaseSchemaWithAtomicUpdate;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Reset modules to clear the once() cache
    vi.resetModules();

    // Setup mock client
    mockClient = {
      _client: {
        PutItem: vi.fn(),
        BatchGetItem: vi.fn(),
        TransactWriteItems: vi.fn(),
      },
      reflect: vi.fn().mockResolvedValue({
        workspace: "helpmaton-test-workspace",
        agent: "helpmaton-test-agent",
      }),
      workspace: {
        get: vi.fn(),
      },
      agent: {
        get: vi.fn(),
      },
    };

    // Mock tables() function BEFORE importing database
    const { tables } = await import("@architect/functions");
    vi.mocked(tables).mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof tables>>
    );

    // Import database after mocks are set up
    const { database } = await import("../database");
    db = await database();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("single table operations", () => {
    it("should successfully create a new record", async () => {
      // Record doesn't exist
      mockClient.workspace.get.mockResolvedValue(undefined);
      mockClient._client.TransactWriteItems.mockResolvedValue({});

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
      ]);

      const result = await db.atomicUpdate(recordSpec, async (records) => {
        expect(records.get("workspace1")).toBeUndefined();
        return [
          {
            pk: "workspaces/workspace-123",
            sk: "workspace",
            name: "New Workspace",
            currency: "usd" as const,
            creditBalance: 0,
            version: 1,
            createdAt: new Date().toISOString(),
          },
        ];
      });

      expect(result).toHaveLength(1);
      expect((result[0] as WorkspaceRecord).name).toBe("New Workspace");
      expect(mockClient._client.TransactWriteItems).toHaveBeenCalledWith({
        TransactItems: [
          expect.objectContaining({
            Put: expect.objectContaining({
              TableName: "helpmaton-test-workspace",
              ConditionExpression: "attribute_not_exists(pk)",
            }),
          }),
        ],
      });
    });

    it("should successfully update an existing record", async () => {
      const existingRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Old Workspace",
        currency: "usd" as const,
        creditBalance: 1000000,
        version: 5,
        createdAt: new Date().toISOString(),
      };

      mockClient.workspace.get.mockResolvedValue(existingRecord);
      mockClient._client.TransactWriteItems.mockResolvedValue({});

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
      ]);

      const result = await db.atomicUpdate(recordSpec, async (records) => {
        const current = records.get("workspace1");
        expect(current).toBeDefined();
        expect((current as WorkspaceRecord | undefined)?.name).toBe(
          "Old Workspace"
        );
        return [
          {
            ...current!,
            name: "Updated Workspace",
            creditBalance: 2000000,
          },
        ];
      });

      expect(result).toHaveLength(1);
      expect((result[0] as WorkspaceRecord).name).toBe("Updated Workspace");
      expect(mockClient._client.TransactWriteItems).toHaveBeenCalledWith({
        TransactItems: [
          expect.objectContaining({
            Put: expect.objectContaining({
              TableName: "helpmaton-test-workspace",
              ConditionExpression: "#version = :version",
              ExpressionAttributeValues: {
                ":version": 5,
              },
              ExpressionAttributeNames: {
                "#version": "version",
              },
            }),
          }),
        ],
      });
    });
  });

  describe("multi-table operations", () => {
    it("should successfully update multiple records across different tables", async () => {
      const existingWorkspace = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Workspace",
        currency: "usd" as const,
        creditBalance: 1000000,
        version: 3,
        createdAt: new Date().toISOString(),
      };

      const existingAgent = {
        pk: "agents/workspace-123/agent-456",
        sk: "agent",
        workspaceId: "workspace-123",
        name: "Agent",
        systemPrompt: "You are helpful",
        provider: "google" as const,
        version: 7,
        createdAt: new Date().toISOString(),
      };

      mockClient.workspace.get.mockResolvedValue(existingWorkspace);
      mockClient.agent.get.mockResolvedValue(existingAgent);
      mockClient._client.TransactWriteItems.mockResolvedValue({});

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
        [
          "agent1",
          {
            table: "agent" as const,
            pk: "agents/workspace-123/agent-456",
            sk: "agent",
          },
        ],
      ]);

      const result = await db.atomicUpdate(recordSpec, async (records) => {
        const workspace = records.get("workspace1");
        const agent = records.get("agent1");
        return [
          {
            ...workspace!,
            creditBalance: 2000000,
          },
          {
            ...agent!,
            name: "Updated Agent",
          },
        ];
      });

      expect(result).toHaveLength(2);
      expect((result[0] as WorkspaceRecord).creditBalance).toBe(2000000);
      expect((result[1] as AgentRecord).name).toBe("Updated Agent");
      expect(mockClient._client.TransactWriteItems).toHaveBeenCalledWith({
        TransactItems: expect.arrayContaining([
          expect.objectContaining({
            Put: expect.objectContaining({
              TableName: "helpmaton-test-workspace",
              ConditionExpression: "#version = :version",
              ExpressionAttributeValues: {
                ":version": 3,
              },
            }),
          }),
          expect.objectContaining({
            Put: expect.objectContaining({
              TableName: "helpmaton-test-agent",
              ConditionExpression: "#version = :version",
              ExpressionAttributeValues: {
                ":version": 7,
              },
            }),
          }),
        ]),
      });
    });
  });

  describe("version conflict retry logic", () => {
    it("should retry on version conflict and succeed on second attempt", async () => {
      const existingRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Workspace",
        currency: "usd" as const,
        creditBalance: 1000000,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      let callCount = 0;
      mockClient.workspace.get.mockImplementation(() => {
        callCount++;
        // First call returns version 1, second call returns version 2 (simulating concurrent update)
        if (callCount === 1) {
          return Promise.resolve(existingRecord);
        }
        return Promise.resolve({
          ...existingRecord,
          version: 2,
        });
      });

      // First call fails with conditional check error, second succeeds
      mockClient._client.TransactWriteItems.mockRejectedValueOnce(
        new Error("Conditional request failed")
      ).mockResolvedValueOnce({});

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
      ]);

      const result = await db.atomicUpdate(recordSpec, async (records) => {
        const current = records.get("workspace1");
        return [
          {
            ...current!,
            name: "Updated Workspace",
          },
        ];
      });

      expect(result).toHaveLength(1);
      expect(mockClient._client.TransactWriteItems).toHaveBeenCalledTimes(2);
      expect(mockClient.workspace.get).toHaveBeenCalledTimes(2);
    });

    it("should retry on transaction conflict and succeed on second attempt", async () => {
      vi.useFakeTimers();
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

      const existingRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Workspace",
        currency: "usd" as const,
        creditBalance: 1000000,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockClient.workspace.get.mockResolvedValue(existingRecord);
      const conflictError = new Error(
        "Transaction is ongoing for the item"
      ) as Error & { name: string };
      conflictError.name = "TransactionConflictException";

      mockClient._client.TransactWriteItems.mockRejectedValueOnce(
        conflictError
      ).mockResolvedValueOnce({});

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
      ]);

      const promise = db.atomicUpdate(recordSpec, async (records) => {
        const current = records.get("workspace1");
        return [
          {
            ...current!,
            name: "Updated Workspace",
          },
        ];
      });

      await vi.advanceTimersByTimeAsync(50);
      const result = await promise;

      expect(result).toHaveLength(1);
      expect(mockClient._client.TransactWriteItems).toHaveBeenCalledTimes(2);
      expect(mockClient.workspace.get).toHaveBeenCalledTimes(2);

      randomSpy.mockRestore();
      vi.useRealTimers();
    });

    it("should throw conflict error after max retries", async () => {
      const existingRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Workspace",
        currency: "usd" as const,
        creditBalance: 1000000,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockClient.workspace.get.mockResolvedValue(existingRecord);
      mockClient._client.TransactWriteItems.mockRejectedValue(
        new Error("Conditional request failed")
      );

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
      ]);

      await expect(
        db.atomicUpdate(recordSpec, async (records) => {
          const current = records.get("workspace1");
          return [
            {
              ...current!,
              name: "Updated Workspace",
            },
          ];
        })
      ).rejects.toThrow();

      // Should retry 3 times (maxRetries = 3), so 4 total attempts
      expect(mockClient._client.TransactWriteItems).toHaveBeenCalledTimes(4);
      expect(mockClient.workspace.get).toHaveBeenCalledTimes(4);
    });
  });

  describe("missing records", () => {
    it("should pass undefined to callback for non-existent records", async () => {
      mockClient.workspace.get.mockResolvedValue(undefined);
      mockClient._client.TransactWriteItems.mockResolvedValue({});

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
      ]);

      await db.atomicUpdate(recordSpec, async (records) => {
        const record = records.get("workspace1");
        expect(record).toBeUndefined();
        // Create new record
        return [
          {
            pk: "workspaces/workspace-123",
            sk: "workspace",
            name: "New Workspace",
            currency: "usd" as const,
            creditBalance: 0,
            version: 1,
            createdAt: new Date().toISOString(),
          },
        ];
      });

      expect(mockClient._client.TransactWriteItems).toHaveBeenCalledWith({
        TransactItems: [
          expect.objectContaining({
            Put: expect.objectContaining({
              ConditionExpression: "attribute_not_exists(pk)",
            }),
          }),
        ],
      });
    });

    it("should handle mix of existing and non-existing records", async () => {
      const existingWorkspace = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Workspace",
        currency: "usd" as const,
        creditBalance: 1000000,
        version: 2,
        createdAt: new Date().toISOString(),
      };

      mockClient.workspace.get
        .mockResolvedValueOnce(existingWorkspace)
        .mockResolvedValueOnce(undefined);
      mockClient._client.TransactWriteItems.mockResolvedValue({});

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
        [
          "workspace2",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-456",
            sk: "workspace",
          },
        ],
      ]);

      const result = await db.atomicUpdate(recordSpec, async (records) => {
        const workspace1 = records.get("workspace1");
        const workspace2 = records.get("workspace2");
        expect(workspace1).toBeDefined();
        expect(workspace2).toBeUndefined();
        return [
          {
            ...workspace1!,
            name: "Updated Workspace 1",
          },
          {
            pk: "workspaces/workspace-456",
            sk: "workspace",
            name: "New Workspace 2",
            currency: "usd" as const,
            creditBalance: 0,
            version: 1,
            createdAt: new Date().toISOString(),
          },
        ];
      });

      expect(result).toHaveLength(2);
      expect(mockClient._client.TransactWriteItems).toHaveBeenCalledWith({
        TransactItems: expect.arrayContaining([
          expect.objectContaining({
            Put: expect.objectContaining({
              ConditionExpression: "#version = :version",
            }),
          }),
          expect.objectContaining({
            Put: expect.objectContaining({
              ConditionExpression: "attribute_not_exists(pk)",
            }),
          }),
        ]),
      });
    });
  });

  describe("schema validation", () => {
    it("should validate records against table schemas", async () => {
      mockClient.workspace.get.mockResolvedValue(undefined);

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
      ]);

      await expect(
        db.atomicUpdate(recordSpec, async () => {
          // Invalid record - missing required fields
          return [
            {
              pk: "workspaces/workspace-123",
              sk: "workspace",
              // Missing name, currency, creditBalance
              version: 1,
              createdAt: new Date().toISOString(),
            } as WorkspaceRecord,
          ];
        })
      ).rejects.toThrow();
    });
  });

  describe("record matching", () => {
    it("should match records to correct table by pk/sk", async () => {
      const existingWorkspace = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Workspace",
        currency: "usd" as const,
        creditBalance: 1000000,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockClient.workspace.get.mockResolvedValue(existingWorkspace);
      mockClient._client.TransactWriteItems.mockResolvedValue({});

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
      ]);

      await db.atomicUpdate(recordSpec, async () => {
        return [
          {
            pk: "workspaces/workspace-123",
            sk: "workspace",
            name: "Updated Workspace",
            currency: "usd" as const,
            creditBalance: 2000000,
            version: 1,
            createdAt: new Date().toISOString(),
          },
        ];
      });

      expect(mockClient._client.TransactWriteItems).toHaveBeenCalledWith({
        TransactItems: [
          expect.objectContaining({
            Put: expect.objectContaining({
              TableName: "helpmaton-test-workspace",
            }),
          }),
        ],
      });
    });

    it("should throw error if record doesn't match any recordSpec", async () => {
      db.workspace.get = vi.fn().mockResolvedValue(undefined);

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
      ]);

      await expect(
        db.atomicUpdate(recordSpec, async () => {
          // Return record with different pk/sk
          return [
            {
              pk: "workspaces/different-workspace",
              sk: "workspace",
              name: "Different Workspace",
              currency: "usd" as const,
              creditBalance: 0,
              version: 1,
              createdAt: new Date().toISOString(),
            },
          ];
        })
      ).rejects.toThrow("does not match any recordSpec");
    });
  });

  describe("empty operations", () => {
    it("should handle empty callback result", async () => {
      mockClient.workspace.get.mockResolvedValue(undefined);

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
      ]);

      const result = await db.atomicUpdate(recordSpec, async () => {
        return [];
      });

      expect(result).toHaveLength(0);
      expect(mockClient._client.TransactWriteItems).not.toHaveBeenCalled();
    });
  });

  describe("non-conditional errors", () => {
    it("should throw immediately on non-conditional errors", async () => {
      const existingRecord = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Workspace",
        currency: "usd" as const,
        creditBalance: 1000000,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockClient.workspace.get.mockResolvedValue(existingRecord);
      mockClient._client.TransactWriteItems.mockRejectedValue(
        new Error("Some other error")
      );

      const recordSpec = new Map([
        [
          "workspace1",
          {
            table: "workspace" as const,
            pk: "workspaces/workspace-123",
            sk: "workspace",
          },
        ],
      ]);

      await expect(
        db.atomicUpdate(recordSpec, async (records) => {
          const current = records.get("workspace1");
          return [
            {
              ...current!,
              name: "Updated Workspace",
            },
          ];
        })
      ).rejects.toThrow("Some other error");

      // Should not retry on non-conditional errors
      expect(mockClient._client.TransactWriteItems).toHaveBeenCalledTimes(1);
    });
  });
});
