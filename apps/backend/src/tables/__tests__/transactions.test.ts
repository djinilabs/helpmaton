import { describe, it, expect, vi, beforeEach } from "vitest";

import type {
  DatabaseSchema,
  TransactionOperation,
  TableName,
} from "../schema";
import { transactWrite } from "../transactions";

describe("transactWrite", () => {
  let mockLowLevelClient: {
    TransactWriteItems: ReturnType<typeof vi.fn>;
  };
  let mockDb: Omit<DatabaseSchema, "transactWrite">;
  let tableNameMap: Map<TableName, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup mock low-level client
    mockLowLevelClient = {
      TransactWriteItems: vi.fn(),
    };

    // Setup mock database with table APIs
    const mockTableApi = {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      query: vi.fn(),
      batchGet: vi.fn(),
      deleteIfExists: vi.fn(),
      deleteAll: vi.fn(),
      upsert: vi.fn(),
      merge: vi.fn(),
      revert: vi.fn(),
      atomicUpdate: vi.fn(),
      queryAsync: vi.fn(),
    };

    mockDb = {
      workspace: mockTableApi as unknown as DatabaseSchema["workspace"],
      agent: mockTableApi as unknown as DatabaseSchema["agent"],
      permission: mockTableApi as unknown as DatabaseSchema["permission"],
      "next-auth": mockTableApi as unknown as DatabaseSchema["next-auth"],
      "agent-key": mockTableApi as unknown as DatabaseSchema["agent-key"],
      "workspace-api-key": mockTableApi as unknown as DatabaseSchema["workspace-api-key"],
      "workspace-document": mockTableApi as unknown as DatabaseSchema["workspace-document"],
      output_channel: mockTableApi as unknown as DatabaseSchema["output_channel"],
      "agent-conversations": mockTableApi as unknown as DatabaseSchema["agent-conversations"],
      "credit-reservations": mockTableApi as unknown as DatabaseSchema["credit-reservations"],
      "token-usage-aggregates": mockTableApi as unknown as DatabaseSchema["token-usage-aggregates"],
      "email-connection": mockTableApi as unknown as DatabaseSchema["email-connection"],
      "mcp-server": mockTableApi as unknown as DatabaseSchema["mcp-server"],
      "trial-credit-requests": mockTableApi as unknown as DatabaseSchema["trial-credit-requests"],
      subscription: mockTableApi as unknown as DatabaseSchema["subscription"],
      "llm-request-buckets": mockTableApi as unknown as DatabaseSchema["llm-request-buckets"],
      "tavily-call-buckets": mockTableApi as unknown as DatabaseSchema["tavily-call-buckets"],
      "workspace-invite": mockTableApi as unknown as DatabaseSchema["workspace-invite"],
      "agent-stream-servers": mockTableApi as unknown as DatabaseSchema["agent-stream-servers"],
      "user-api-key": mockTableApi as unknown as DatabaseSchema["user-api-key"],
      "user-refresh-token": mockTableApi as unknown as DatabaseSchema["user-refresh-token"],
    };

    const tableNameEntries: [TableName, string][] = [
      ["workspace", "workspace-table"],
      ["agent", "agent-table"],
      ["permission", "permission-table"],
    ];
    tableNameMap = new Map<TableName, string>(tableNameEntries);
  });

  describe("direct values", () => {
    it("should execute Put operation with direct item", async () => {
      mockLowLevelClient.TransactWriteItems.mockResolvedValue({});

      const operations: TransactionOperation[] = [
        {
          type: "Put",
          table: "workspace",
          key: { pk: "workspaces/123", sk: "workspace" },
          item: {
            pk: "workspaces/123",
            sk: "workspace",
            name: "Test Workspace",
            currency: "usd",
            creditBalance: 1000000,
            version: 1,
            createdAt: new Date().toISOString(),
          },
        },
      ];

      const result = await transactWrite(
        {
          db: mockDb,
          lowLevelClient: mockLowLevelClient as unknown as Parameters<
            typeof transactWrite
          >[0]["lowLevelClient"],
          tableNameMap,
        },
        operations
      );

      expect(result.success).toBe(true);
      expect(mockLowLevelClient.TransactWriteItems).toHaveBeenCalledTimes(1);
      const call = mockLowLevelClient.TransactWriteItems.mock.calls[0][0];
      expect(call.TransactItems).toHaveLength(1);
      expect(call.TransactItems[0].Put).toBeDefined();
      expect(call.TransactItems[0].Put?.TableName).toBe("workspace-table");
      expect(call.TransactItems[0].Put?.Item.name).toBe("Test Workspace");
    });

    it("should execute Update operation with updateExpression", async () => {
      mockLowLevelClient.TransactWriteItems.mockResolvedValue({});

      const operations: TransactionOperation[] = [
        {
          type: "Update",
          table: "agent",
          key: { pk: "agents/456", sk: undefined },
          updateExpression: "SET #name = :name",
          expressionAttributeNames: { "#name": "name" },
          expressionAttributeValues: { ":name": "Updated Agent" },
        },
      ];

      const result = await transactWrite(
        {
          db: mockDb,
          lowLevelClient: mockLowLevelClient as unknown as Parameters<
            typeof transactWrite
          >[0]["lowLevelClient"],
          tableNameMap,
        },
        operations
      );

      expect(result.success).toBe(true);
      expect(mockLowLevelClient.TransactWriteItems).toHaveBeenCalledTimes(1);
      const call = mockLowLevelClient.TransactWriteItems.mock.calls[0][0];
      expect(call.TransactItems).toHaveLength(1);
      expect(call.TransactItems[0].Update).toBeDefined();
      expect(call.TransactItems[0].Update?.TableName).toBe("agent-table");
      expect(call.TransactItems[0].Update?.UpdateExpression).toBe(
        "SET #name = :name"
      );
      // Verify ExpressionAttributeNames and ExpressionAttributeValues are included
      // (needed for updateExpression, not just conditionExpression)
      expect(call.TransactItems[0].Update?.ExpressionAttributeNames).toEqual({
        "#name": "name",
      });
      expect(call.TransactItems[0].Update?.ExpressionAttributeValues).toEqual({
        ":name": "Updated Agent",
      });
    });

    it("should execute Update operation with updateExpression and placeholders (no condition)", async () => {
      mockLowLevelClient.TransactWriteItems.mockResolvedValue({});

      const operations: TransactionOperation[] = [
        {
          type: "Update",
          table: "agent",
          key: { pk: "agents/123", sk: undefined },
          updateExpression: "SET #name = :name, #systemPrompt = :systemPrompt",
          expressionAttributeNames: {
            "#name": "name",
            "#systemPrompt": "systemPrompt",
          },
          expressionAttributeValues: {
            ":name": "New Name",
            ":systemPrompt": "New Prompt",
          },
          // No conditionExpression - expression attributes should still be included
        },
      ];

      const result = await transactWrite(
        {
          db: mockDb,
          lowLevelClient: mockLowLevelClient as unknown as Parameters<
            typeof transactWrite
          >[0]["lowLevelClient"],
          tableNameMap,
        },
        operations
      );

      expect(result.success).toBe(true);
      expect(mockLowLevelClient.TransactWriteItems).toHaveBeenCalledTimes(1);
      const call = mockLowLevelClient.TransactWriteItems.mock.calls[0][0];
      expect(call.TransactItems).toHaveLength(1);
      expect(call.TransactItems[0].Update).toBeDefined();
      expect(call.TransactItems[0].Update?.UpdateExpression).toBe(
        "SET #name = :name, #systemPrompt = :systemPrompt"
      );
      // Verify ExpressionAttributeNames and ExpressionAttributeValues are included
      // even without conditionExpression
      expect(call.TransactItems[0].Update?.ExpressionAttributeNames).toEqual({
        "#name": "name",
        "#systemPrompt": "systemPrompt",
      });
      expect(call.TransactItems[0].Update?.ExpressionAttributeValues).toEqual({
        ":name": "New Name",
        ":systemPrompt": "New Prompt",
      });
      // Should not have ConditionExpression
      expect(call.TransactItems[0].Update?.ConditionExpression).toBeUndefined();
    });

    it("should execute Delete operation", async () => {
      mockLowLevelClient.TransactWriteItems.mockResolvedValue({});

      const operations: TransactionOperation[] = [
        {
          type: "Delete",
          table: "workspace",
          key: { pk: "workspaces/123", sk: "workspace" },
        },
      ];

      const result = await transactWrite(
        {
          db: mockDb,
          lowLevelClient: mockLowLevelClient as unknown as Parameters<
            typeof transactWrite
          >[0]["lowLevelClient"],
          tableNameMap,
        },
        operations
      );

      expect(result.success).toBe(true);
      expect(mockLowLevelClient.TransactWriteItems).toHaveBeenCalledTimes(1);
      const call = mockLowLevelClient.TransactWriteItems.mock.calls[0][0];
      expect(call.TransactItems).toHaveLength(1);
      expect(call.TransactItems[0].Delete).toBeDefined();
      expect(call.TransactItems[0].Delete?.TableName).toBe("workspace-table");
    });

    it("should execute ConditionCheck operation", async () => {
      mockLowLevelClient.TransactWriteItems.mockResolvedValue({});

      const operations: TransactionOperation[] = [
        {
          type: "ConditionCheck",
          table: "workspace",
          key: { pk: "workspaces/123", sk: "workspace" },
          conditionExpression: "creditBalance >= :min",
          expressionAttributeValues: { ":min": 0 },
        },
      ];

      const result = await transactWrite(
        {
          db: mockDb,
          lowLevelClient: mockLowLevelClient as unknown as Parameters<
            typeof transactWrite
          >[0]["lowLevelClient"],
          tableNameMap,
        },
        operations
      );

      expect(result.success).toBe(true);
      expect(mockLowLevelClient.TransactWriteItems).toHaveBeenCalledTimes(1);
      const call = mockLowLevelClient.TransactWriteItems.mock.calls[0][0];
      expect(call.TransactItems).toHaveLength(1);
      expect(call.TransactItems[0].ConditionCheck).toBeDefined();
      expect(call.TransactItems[0].ConditionCheck?.TableName).toBe(
        "workspace-table"
      );
    });
  });

  describe("updater functions", () => {
    it("should execute Put operation with updater function for existing item", async () => {
      const existingItem = {
        pk: "workspaces/123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 1000000,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb.workspace.get = vi.fn().mockResolvedValue(existingItem);
      mockLowLevelClient.TransactWriteItems.mockResolvedValue({});

      const operations: TransactionOperation[] = [
        {
          type: "Put",
          table: "workspace",
          key: { pk: "workspaces/123", sk: "workspace" },
          updater: async (current) => {
            if (!current) {
              throw new Error("Item not found");
            }
            const workspace = current as {
              creditBalance: number;
              [key: string]: unknown;
            };
            return {
              ...workspace,
              creditBalance: workspace.creditBalance + 500000,
            };
          },
        },
      ];

      const result = await transactWrite(
        {
          db: mockDb,
          lowLevelClient: mockLowLevelClient as unknown as Parameters<
            typeof transactWrite
          >[0]["lowLevelClient"],
          tableNameMap,
        },
        operations
      );

      expect(result.success).toBe(true);
      expect(mockDb.workspace.get).toHaveBeenCalledWith(
        "workspaces/123",
        "workspace"
      );
      expect(mockLowLevelClient.TransactWriteItems).toHaveBeenCalledTimes(1);
      const call = mockLowLevelClient.TransactWriteItems.mock.calls[0][0];
      expect(call.TransactItems[0].Put?.Item.creditBalance).toBe(1500000);
      expect(call.TransactItems[0].Put?.Item.version).toBe(2);
      expect(call.TransactItems[0].Put?.ConditionExpression).toBe(
        "#version = :version"
      );
    });

    it("should execute Put operation with updater function for new item", async () => {
      mockDb.workspace.get = vi.fn().mockResolvedValue(undefined);
      mockLowLevelClient.TransactWriteItems.mockResolvedValue({});

      const operations: TransactionOperation[] = [
        {
          type: "Put",
          table: "workspace",
          key: { pk: "workspaces/123", sk: "workspace" },
          updater: async (current) => {
            if (current) {
              throw new Error("Item already exists");
            }
            return {
              pk: "workspaces/123",
              sk: "workspace",
              name: "New Workspace",
              currency: "usd",
              creditBalance: 1000000,
            };
          },
        },
      ];

      const result = await transactWrite(
        {
          db: mockDb,
          lowLevelClient: mockLowLevelClient as unknown as Parameters<
            typeof transactWrite
          >[0]["lowLevelClient"],
          tableNameMap,
        },
        operations
      );

      expect(result.success).toBe(true);
      expect(mockDb.workspace.get).toHaveBeenCalledWith(
        "workspaces/123",
        "workspace"
      );
      expect(mockLowLevelClient.TransactWriteItems).toHaveBeenCalledTimes(1);
      const call = mockLowLevelClient.TransactWriteItems.mock.calls[0][0];
      expect(call.TransactItems[0].Put?.Item.version).toBe(1);
      expect(call.TransactItems[0].Put?.ConditionExpression).toBe(
        "attribute_not_exists(pk)"
      );
    });

    it("should execute Update operation with updater function", async () => {
      const existingItem = {
        pk: "agents/456",
        sk: undefined,
        workspaceId: "workspaces/123",
        name: "Test Agent",
        systemPrompt: "You are a helpful assistant",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb.agent.get = vi.fn().mockResolvedValue(existingItem);
      mockLowLevelClient.TransactWriteItems.mockResolvedValue({});

      const operations: TransactionOperation[] = [
        {
          type: "Update",
          table: "agent",
          key: { pk: "agents/456", sk: undefined },
          updater: async (current) => {
            if (!current) {
              throw new Error("Agent not found");
            }
            const agent = current as { name: string; [key: string]: unknown };
            return {
              ...agent,
              name: `${agent.name} (Updated)`,
            };
          },
        },
      ];

      const result = await transactWrite(
        {
          db: mockDb,
          lowLevelClient: mockLowLevelClient as unknown as Parameters<
            typeof transactWrite
          >[0]["lowLevelClient"],
          tableNameMap,
        },
        operations
      );

      expect(result.success).toBe(true);
      expect(mockDb.agent.get).toHaveBeenCalledWith("agents/456", undefined);
      expect(mockLowLevelClient.TransactWriteItems).toHaveBeenCalledTimes(1);
      const call = mockLowLevelClient.TransactWriteItems.mock.calls[0][0];
      expect(call.TransactItems[0].Put?.Item.name).toBe(
        "Test Agent (Updated)"
      );
      expect(call.TransactItems[0].Put?.Item.version).toBe(2);
    });
  });

  describe("mixed operations", () => {
    it("should execute mixed operations (direct values and updaters)", async () => {
      const existingItem = {
        pk: "workspaces/123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 1000000,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb.workspace.get = vi.fn().mockResolvedValue(existingItem);
      mockDb.agent.get = vi.fn().mockResolvedValue(undefined); // Agent doesn't exist
      mockLowLevelClient.TransactWriteItems.mockResolvedValue({});

      const operations: TransactionOperation[] = [
        {
          type: "Put",
          table: "workspace",
          key: { pk: "workspaces/123", sk: "workspace" },
          item: {
            pk: "workspaces/123",
            sk: "workspace",
            name: "Direct Workspace",
            currency: "usd",
            creditBalance: 2000000,
            version: 1,
            createdAt: new Date().toISOString(),
          },
        },
        {
          type: "Put",
          table: "agent",
          key: { pk: "agents/456", sk: undefined },
          updater: async (current) => {
            if (!current) {
              // Return all required fields for agent schema
              return {
                pk: "agents/456",
                workspaceId: "workspaces/123",
                name: "New Agent",
                systemPrompt: "You are a helpful assistant",
                version: 1,
                createdAt: new Date().toISOString(),
              };
            }
            return current;
          },
        },
        {
          type: "ConditionCheck",
          table: "workspace",
          key: { pk: "workspaces/123", sk: "workspace" },
          conditionExpression: "creditBalance >= :min",
          expressionAttributeValues: { ":min": 0 },
        },
      ];

      const result = await transactWrite(
        {
          db: mockDb,
          lowLevelClient: mockLowLevelClient as unknown as Parameters<
            typeof transactWrite
          >[0]["lowLevelClient"],
          tableNameMap,
        },
        operations
      );

      expect(result.success).toBe(true);
      expect(mockLowLevelClient.TransactWriteItems).toHaveBeenCalledTimes(1);
      const call = mockLowLevelClient.TransactWriteItems.mock.calls[0][0];
      expect(call.TransactItems).toHaveLength(3);
      expect(call.TransactItems[0].Put).toBeDefined();
      expect(call.TransactItems[1].Put).toBeDefined();
      expect(call.TransactItems[2].ConditionCheck).toBeDefined();
    });
  });

  describe("version conflict retries", () => {
    it("should retry transaction on version conflict", async () => {
      const existingItem = {
        pk: "workspaces/123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 1000000,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb.workspace.get = vi.fn().mockResolvedValue(existingItem);
      mockLowLevelClient.TransactWriteItems
        .mockRejectedValueOnce(
          new Error("TransactionCanceledException: Transaction cancelled")
        )
        .mockResolvedValueOnce({});

      vi.useFakeTimers();

      const operations: TransactionOperation[] = [
        {
          type: "Put",
          table: "workspace",
          key: { pk: "workspaces/123", sk: "workspace" },
          updater: async (current) => {
            if (!current) {
              throw new Error("Item not found");
            }
            const workspace = current as {
              creditBalance: number;
              [key: string]: unknown;
            };
            return {
              ...workspace,
              creditBalance: workspace.creditBalance + 500000,
            };
          },
        },
      ];

      const promise = transactWrite(
        {
          db: mockDb,
          lowLevelClient: mockLowLevelClient as unknown as Parameters<
            typeof transactWrite
          >[0]["lowLevelClient"],
          tableNameMap,
        },
        operations,
        { maxRetries: 3 }
      );

      // Fast-forward through backoff
      await vi.advanceTimersByTimeAsync(100);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockLowLevelClient.TransactWriteItems).toHaveBeenCalledTimes(2);
      expect(mockDb.workspace.get).toHaveBeenCalledTimes(2); // Re-read on retry

      vi.useRealTimers();
    });

    it("should throw conflict error after max retries", async () => {
      const existingItem = {
        pk: "workspaces/123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 1000000,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockDb.workspace.get = vi.fn().mockResolvedValue(existingItem);
      mockLowLevelClient.TransactWriteItems.mockRejectedValue(
        new Error("TransactionCanceledException: Transaction cancelled")
      );

      vi.useFakeTimers();

      const operations: TransactionOperation[] = [
        {
          type: "Put",
          table: "workspace",
          key: { pk: "workspaces/123", sk: "workspace" },
          updater: async (current) => {
            if (!current) {
              throw new Error("Item not found");
            }
            const workspace = current as {
              creditBalance: number;
              [key: string]: unknown;
            };
            return {
              ...workspace,
              creditBalance: workspace.creditBalance + 500000,
            };
          },
        },
      ];

      // Start the promise and immediately catch any unhandled rejections
      const promise = transactWrite(
        {
          db: mockDb,
          lowLevelClient: mockLowLevelClient as unknown as Parameters<
            typeof transactWrite
          >[0]["lowLevelClient"],
          tableNameMap,
        },
        operations,
        { maxRetries: 2 }
      );

      // Ensure promise rejection is handled
      promise.catch(() => {
        // Silently catch to prevent unhandled rejection
      });

      // Fast-forward through all retries (50ms + 100ms + 200ms = 350ms should be enough)
      // Advance timers in smaller increments to ensure all setTimeout calls are processed
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);

      // Await and expect the error - use expect().rejects to properly handle the promise
      await expect(promise).rejects.toThrow(/Failed to execute transaction after 2 retries/);

      expect(mockLowLevelClient.TransactWriteItems).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(mockDb.workspace.get).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });

  describe("validation errors", () => {
    it("should throw error for empty operations", async () => {
      await expect(
        transactWrite(
          {
            db: mockDb,
            lowLevelClient: mockLowLevelClient as unknown as Parameters<
              typeof transactWrite
            >[0]["lowLevelClient"],
            tableNameMap,
          },
          []
        )
      ).rejects.toThrow("At least one operation is required");
    });

    it("should throw error for more than 25 operations", async () => {
      const operations: TransactionOperation[] = Array(26).fill({
        type: "Put",
        table: "workspace",
        key: { pk: "workspaces/123", sk: "workspace" },
        item: {
          pk: "workspaces/123",
          sk: "workspace",
          name: "Test",
          currency: "usd",
          creditBalance: 0,
          version: 1,
          createdAt: new Date().toISOString(),
        },
      });

      await expect(
        transactWrite(
          {
            db: mockDb,
            lowLevelClient: mockLowLevelClient as unknown as Parameters<
              typeof transactWrite
            >[0]["lowLevelClient"],
            tableNameMap,
          },
          operations
        )
      ).rejects.toThrow("Maximum 25 operations per transaction");
    });

    it("should throw error for invalid table", async () => {
      const operations: TransactionOperation[] = [
        {
          type: "Put",
          table: "invalid-table" as any,
          key: { pk: "workspaces/123", sk: "workspace" },
          item: {
            pk: "workspaces/123",
            sk: "workspace",
            name: "Test",
            currency: "usd",
            creditBalance: 0,
            version: 1,
            createdAt: new Date().toISOString(),
          },
        },
      ];

      await expect(
        transactWrite(
          {
            db: mockDb,
            lowLevelClient: mockLowLevelClient as unknown as Parameters<
              typeof transactWrite
            >[0]["lowLevelClient"],
            tableNameMap,
          },
          operations
        )
      ).rejects.toThrow("Table invalid-table not found");
    });

    it("should throw error when Put operation has neither item nor updater", async () => {
      const operations: TransactionOperation[] = [
        {
          type: "Put",
          table: "workspace",
          key: { pk: "workspaces/123", sk: "workspace" },
        } as any,
      ];

      await expect(
        transactWrite(
          {
            db: mockDb,
            lowLevelClient: mockLowLevelClient as unknown as Parameters<
              typeof transactWrite
            >[0]["lowLevelClient"],
            tableNameMap,
          },
          operations
        )
      ).rejects.toThrow("must provide either 'item' or 'updater'");
    });

    it("should throw error when Update operation has neither updateExpression nor updater", async () => {
      const operations: TransactionOperation[] = [
        {
          type: "Update",
          table: "agent",
          key: { pk: "agents/456", sk: undefined },
        } as any,
      ];

      await expect(
        transactWrite(
          {
            db: mockDb,
            lowLevelClient: mockLowLevelClient as unknown as Parameters<
              typeof transactWrite
            >[0]["lowLevelClient"],
            tableNameMap,
          },
          operations
        )
      ).rejects.toThrow("must provide either 'updateExpression' or 'updater'");
    });
  });

  describe("non-retryable errors", () => {
    it("should not retry on non-version-conflict errors", async () => {
      mockLowLevelClient.TransactWriteItems.mockRejectedValue(
        new Error("ValidationException: Invalid request")
      );

      const operations: TransactionOperation[] = [
        {
          type: "Put",
          table: "workspace",
          key: { pk: "workspaces/123", sk: "workspace" },
          item: {
            pk: "workspaces/123",
            sk: "workspace",
            name: "Test Workspace",
            currency: "usd",
            creditBalance: 1000000,
            version: 1,
            createdAt: new Date().toISOString(),
          },
        },
      ];

      await expect(
        transactWrite(
          {
            db: mockDb,
            lowLevelClient: mockLowLevelClient as unknown as Parameters<
              typeof transactWrite
            >[0]["lowLevelClient"],
            tableNameMap,
          },
          operations
        )
      ).rejects.toThrow("ValidationException: Invalid request");

      expect(mockLowLevelClient.TransactWriteItems).toHaveBeenCalledTimes(1);
    });
  });
});

