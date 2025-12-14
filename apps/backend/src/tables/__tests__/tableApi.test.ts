import { conflict, resourceGone } from "@hapi/boom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { TableAPI } from "../schema";
import { tableSchemas } from "../schema";
import { tableApi } from "../tableApi";

describe("tableApi", () => {
  let mockLowLevelTable: {
    get: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let mockLowLevelClient: {
    PutItem: ReturnType<typeof vi.fn>;
    BatchGetItem: ReturnType<typeof vi.fn>;
  };
  let table: TableAPI<"workspace">;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup mock low-level table
    mockLowLevelTable = {
      get: vi.fn(),
      query: vi.fn(),
      delete: vi.fn(),
    };

    // Setup mock low-level client
    mockLowLevelClient = {
      PutItem: vi.fn(),
      BatchGetItem: vi.fn(),
    };

    // Create table API instance
    table = tableApi(
      "workspace",
      mockLowLevelTable as unknown as Parameters<typeof tableApi>[1],
      mockLowLevelClient as unknown as Parameters<typeof tableApi>[2],
      "workspace-table",
      tableSchemas.workspace
    );
  });

  describe("atomicUpdate", () => {
    it("should successfully perform atomic update with version check", async () => {
      const existingItem = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockLowLevelTable.get.mockResolvedValue(existingItem);
      mockLowLevelClient.PutItem.mockResolvedValue({});

      const result = await table.atomicUpdate(
        "workspaces/workspace-123",
        "workspace",
        async () => {
          return {
            pk: "workspaces/workspace-123",
            name: "Updated Workspace",
          };
        }
      );

      expect(result.name).toBe("Updated Workspace");
      expect(result.version).toBe(2);
      expect(mockLowLevelClient.PutItem).toHaveBeenCalledWith(
        expect.objectContaining({
          ConditionExpression: "#version = :version",
          ExpressionAttributeValues: {
            ":version": 1,
          },
        })
      );
    });

    it("should throw conflict error when version mismatch occurs", async () => {
      const existingItem = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockLowLevelTable.get.mockResolvedValue(existingItem);
      mockLowLevelClient.PutItem.mockRejectedValue(
        new Error("Conditional request failed")
      );

      await expect(
        table.atomicUpdate(
          "workspaces/workspace-123",
          "workspace",
          async () => ({
            pk: "workspaces/workspace-123",
            name: "Updated Workspace",
          }),
          { maxRetries: 0 }
        )
      ).rejects.toThrow("Failed to atomically update record");
    });

    it("should retry on version conflicts (with maxRetries parameter)", async () => {
      const existingItem = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      // First call fails with conflict, second succeeds
      mockLowLevelTable.get
        .mockResolvedValueOnce(existingItem)
        .mockResolvedValueOnce(existingItem); // Same item on retry
      mockLowLevelClient.PutItem.mockRejectedValueOnce(
        new Error("Conditional request failed")
      ).mockResolvedValueOnce({});

      // Use real timers - the backoff is short enough for tests
      const result = await table.atomicUpdate(
        "workspaces/workspace-123",
        "workspace",
        async () => ({
          pk: "workspaces/workspace-123",
          name: "Updated Workspace",
        }),
        { maxRetries: 2 }
      );

      expect(result.name).toBe("Updated Workspace");
      expect(mockLowLevelClient.PutItem).toHaveBeenCalledTimes(2);
    });

    it("should apply updater function correctly", async () => {
      const existingItem = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 100.0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockLowLevelTable.get.mockResolvedValue(existingItem);
      mockLowLevelClient.PutItem.mockResolvedValue({});

      const updater = vi.fn(async () => {
        return {
          pk: "workspaces/workspace-123",
          creditBalance: 90.0,
        };
      });

      await table.atomicUpdate(
        "workspaces/workspace-123",
        "workspace",
        updater
      );

      expect(updater).toHaveBeenCalled();
      expect(mockLowLevelClient.PutItem).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            creditBalance: 90.0,
            version: 2,
          }),
        })
      );
    });

    it("should handle optimistic locking correctly", async () => {
      const existingItem = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 5,
        createdAt: new Date().toISOString(),
      };

      mockLowLevelTable.get.mockResolvedValue(existingItem);
      mockLowLevelClient.PutItem.mockResolvedValue({});

      await table.atomicUpdate(
        "workspaces/workspace-123",
        "workspace",
        async () => ({
          pk: "workspaces/workspace-123",
          name: "Updated",
        })
      );

      // Should check for version 5, then update to version 6
      expect(mockLowLevelClient.PutItem).toHaveBeenCalledWith(
        expect.objectContaining({
          ConditionExpression: "#version = :version",
          ExpressionAttributeValues: {
            ":version": 5,
          },
        })
      );
    });

    it("should return updated item with incremented version", async () => {
      const existingItem = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        version: 3,
        createdAt: new Date().toISOString(),
      };

      mockLowLevelTable.get.mockResolvedValue(existingItem);
      mockLowLevelClient.PutItem.mockResolvedValue({});

      const result = await table.atomicUpdate(
        "workspaces/workspace-123",
        "workspace",
        async () => ({
          pk: "workspaces/workspace-123",
          name: "Updated",
        })
      );

      expect(result.version).toBe(4); // 3 + 1
      expect(result.name).toBe("Updated");
    });

    it("should create new item when current is undefined", async () => {
      mockLowLevelTable.get.mockResolvedValue(undefined);
      mockLowLevelClient.PutItem.mockResolvedValue({});

      const result = await table.atomicUpdate(
        "workspaces/workspace-123",
        "workspace",
        async (current) => {
          expect(current).toBeUndefined();
          return {
            pk: "workspaces/workspace-123",
            name: "New Workspace",
            currency: "usd" as const,
            creditBalance: 0,
          };
        }
      );

      expect(result.name).toBe("New Workspace");
      expect(result.version).toBe(1);
      expect(result.currency).toBe("usd");
      expect(mockLowLevelClient.PutItem).toHaveBeenCalledWith(
        expect.objectContaining({
          ConditionExpression: "attribute_not_exists(pk)",
        })
      );
    });

    it("should throw error after max retries on version conflicts", async () => {
      const existingItem = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      // Always return the same item, but PutItem always fails
      mockLowLevelTable.get.mockResolvedValue(existingItem);
      mockLowLevelClient.PutItem.mockRejectedValue(
        new Error("Conditional request failed")
      );

      await expect(
        table.atomicUpdate(
          "workspaces/workspace-123",
          "workspace",
          async () => ({
            pk: "workspaces/workspace-123",
            name: "Updated",
          }),
          { maxRetries: 2 }
        )
      ).rejects.toThrow("Failed to atomically update record after 2 retries");
    });
  });

  describe("query", () => {
    it("should query items correctly with pagination", async () => {
      const item1 = {
        pk: "workspaces/workspace-1",
        sk: "workspace",
        name: "Workspace 1",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const item2 = {
        pk: "workspaces/workspace-2",
        sk: "workspace",
        name: "Workspace 2",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      // First page
      mockLowLevelTable.query
        .mockResolvedValueOnce({
          Items: [item1],
          LastEvaluatedKey: { pk: "workspaces/workspace-1" },
        })
        // Second page
        .mockResolvedValueOnce({
          Items: [item2],
          LastEvaluatedKey: undefined,
        });

      const result = await table.query({
        IndexName: "bySubscriptionId",
        KeyConditionExpression: "subscriptionId = :subId",
        ExpressionAttributeValues: {
          ":subId": "sub-123",
        },
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]?.name).toBe("Workspace 1");
      expect(result.items[1]?.name).toBe("Workspace 2");
      expect(mockLowLevelTable.query).toHaveBeenCalledTimes(2);
    });

    it("should handle version filtering correctly", async () => {
      const item = {
        pk: "workspaces/workspace-1",
        sk: "workspace",
        name: "Workspace 1",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
        userVersions: {
          draft: {
            newProps: {
              name: "Draft Workspace",
            },
          },
        },
      };

      mockLowLevelTable.query.mockResolvedValue({
        Items: [item],
        LastEvaluatedKey: undefined,
      });

      const result = await table.query(
        {
          IndexName: "bySubscriptionId",
          KeyConditionExpression: "subscriptionId = :subId",
          ExpressionAttributeValues: {
            ":subId": "sub-123",
          },
        },
        "draft"
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.name).toBe("Draft Workspace");
      expect(result.areAnyUnpublished).toBe(true);
    });

    it("should return correct structure with items and areAnyUnpublished", async () => {
      const item = {
        pk: "workspaces/workspace-1",
        sk: "workspace",
        name: "Workspace 1",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockLowLevelTable.query.mockResolvedValue({
        Items: [item],
        LastEvaluatedKey: undefined,
      });

      const result = await table.query({
        IndexName: "bySubscriptionId",
        KeyConditionExpression: "subscriptionId = :subId",
        ExpressionAttributeValues: {
          ":subId": "sub-123",
        },
      });

      expect(result).toHaveProperty("items");
      expect(result).toHaveProperty("areAnyUnpublished");
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.areAnyUnpublished).toBe("boolean");
    });

    it("should handle empty results", async () => {
      mockLowLevelTable.query.mockResolvedValue({
        Items: [],
        LastEvaluatedKey: undefined,
      });

      const result = await table.query({
        IndexName: "bySubscriptionId",
        KeyConditionExpression: "subscriptionId = :subId",
        ExpressionAttributeValues: {
          ":subId": "sub-123",
        },
      });

      expect(result.items).toHaveLength(0);
      expect(result.areAnyUnpublished).toBe(false);
    });

    it("should handle query errors", async () => {
      mockLowLevelTable.query.mockRejectedValue(new Error("Query failed"));

      await expect(
        table.query({
          IndexName: "bySubscriptionId",
          KeyConditionExpression: "subscriptionId = :subId",
          ExpressionAttributeValues: {
            ":subId": "sub-123",
          },
        })
      ).rejects.toThrow("Error querying table workspace");
    });
  });

  describe("get", () => {
    it("should retrieve items correctly", async () => {
      const item = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockLowLevelTable.get.mockResolvedValue(item);

      const result = await table.get("workspaces/workspace-123", "workspace");

      expect(result?.name).toBe("Test Workspace");
      expect(result?.pk).toBe("workspaces/workspace-123");
      expect(mockLowLevelTable.get).toHaveBeenCalledWith({
        pk: "workspaces/workspace-123",
        sk: "workspace",
      });
    });

    it("should handle version-specific retrieval", async () => {
      const item = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
        userVersions: {
          draft: {
            newProps: {
              name: "Draft Workspace",
            },
          },
        },
      };

      mockLowLevelTable.get.mockResolvedValue(item);

      const result = await table.get(
        "workspaces/workspace-123",
        "workspace",
        "draft"
      );

      expect(result?.name).toBe("Draft Workspace");
    });

    it("should return undefined for non-existent items", async () => {
      mockLowLevelTable.get.mockResolvedValue(undefined);

      const result = await table.get("workspaces/nonexistent", "workspace");

      expect(result).toBeUndefined();
    });
  });

  describe("create", () => {
    it("should create items with correct structure", async () => {
      const newItem = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "New Workspace",
        currency: "usd" as const,
        creditBalance: 0,
      };

      mockLowLevelClient.PutItem.mockResolvedValue({});

      const result = await table.create(newItem);

      expect(result.name).toBe("New Workspace");
      expect(result.version).toBe(1);
      expect(result.currency).toBe("usd");
      expect(result.creditBalance).toBe(0);
      expect(result.createdAt).toBeDefined();
      expect(mockLowLevelClient.PutItem).toHaveBeenCalledWith(
        expect.objectContaining({
          ConditionExpression: "attribute_not_exists(pk)",
        })
      );
    });

    it("should throw conflict error when item already exists", async () => {
      const newItem = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "New Workspace",
        currency: "usd" as const,
        creditBalance: 0,
      };

      mockLowLevelClient.PutItem.mockRejectedValue(
        new Error("Conditional request failed")
      );

      await expect(table.create(newItem)).rejects.toThrow(
        conflict("Item already exists")
      );
    });
  });

  describe("update", () => {
    it("should update items correctly", async () => {
      const existingItem = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        currency: "usd",
        creditBalance: 0,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockLowLevelTable.get.mockResolvedValue(existingItem);
      mockLowLevelClient.PutItem.mockResolvedValue({});

      const result = await table.update({
        pk: "workspaces/workspace-123",
        name: "Updated Workspace",
      });

      expect(result.name).toBe("Updated Workspace");
      expect(result.version).toBe(2);
      expect(result.updatedAt).toBeDefined();
      expect(mockLowLevelClient.PutItem).toHaveBeenCalledWith(
        expect.objectContaining({
          ConditionExpression: "#version = :version",
          ExpressionAttributeValues: {
            ":version": 1,
          },
        })
      );
    });

    it("should throw resourceGone error for non-existent items", async () => {
      mockLowLevelTable.get.mockResolvedValue(undefined);

      await expect(
        table.update({
          pk: "workspaces/nonexistent",
          name: "Updated",
        })
      ).rejects.toThrow(
        resourceGone(
          "Error updating table workspace: Item with pk workspaces/nonexistent not found"
        )
      );
    });

    it("should throw conflict error on version mismatch", async () => {
      const existingItem = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockLowLevelTable.get.mockResolvedValue(existingItem);
      mockLowLevelClient.PutItem.mockRejectedValue(
        new Error("Conditional request failed")
      );

      await expect(
        table.update({
          pk: "workspaces/workspace-123",
          name: "Updated",
        })
      ).rejects.toThrow(conflict("Item was outdated"));
    });
  });

  describe("delete", () => {
    it("should delete items correctly", async () => {
      const existingItem = {
        pk: "workspaces/workspace-123",
        sk: "workspace",
        name: "Test Workspace",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockLowLevelTable.get.mockResolvedValue(existingItem);
      mockLowLevelTable.delete.mockResolvedValue({});

      const result = await table.delete(
        "workspaces/workspace-123",
        "workspace"
      );

      expect(result?.name).toBe("Test Workspace");
      expect(mockLowLevelTable.delete).toHaveBeenCalledWith({
        pk: "workspaces/workspace-123",
        sk: "workspace",
      });
    });

    it("should throw resourceGone error for non-existent items", async () => {
      mockLowLevelTable.get.mockResolvedValue(undefined);

      await expect(
        table.delete("workspaces/nonexistent", "workspace")
      ).rejects.toThrow(
        resourceGone("Error deleting record in table workspace: Item not found")
      );
    });
  });
});




