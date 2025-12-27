import { describe, it, expect, vi, beforeEach } from "vitest";

import type { DatabaseSchemaWithAtomicUpdate, TableRecord } from "../../tables/schema";
import {
  type WorkspaceCreditTransaction,
  createTransactionBuffer,
  addTransactionToBuffer,
  commitTransactions,
} from "../workspaceCreditTransactions";

describe("workspaceCreditTransactions", () => {
  let mockDb: DatabaseSchemaWithAtomicUpdate;

  beforeEach(() => {
    mockDb = {
      workspace: {
        get: vi.fn(),
      },
      "workspace-credit-transactions": {
        create: vi.fn(),
      },
      atomicUpdate: vi.fn(),
    } as unknown as DatabaseSchemaWithAtomicUpdate;
  });

  describe("createTransactionBuffer", () => {
    it("should create an empty buffer", () => {
      const buffer = createTransactionBuffer();
      expect(buffer).toBeInstanceOf(Map);
      expect(buffer.size).toBe(0);
    });
  });

  describe("addTransactionToBuffer", () => {
    it("should add a transaction to the buffer", () => {
      const buffer = createTransactionBuffer();
      const transaction: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "text-generation",
        supplier: "openrouter",
        description: "Test transaction",
        amountMillionthUsd: 1000000,
      };

      addTransactionToBuffer(buffer, transaction);

      expect(buffer.size).toBe(1);
      expect(buffer.get("workspace-1")).toHaveLength(1);
      expect(buffer.get("workspace-1")?.[0]).toEqual(transaction);
    });

    it("should aggregate transactions for the same workspace", () => {
      const buffer = createTransactionBuffer();
      const transaction1: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "text-generation",
        supplier: "openrouter",
        description: "Test transaction 1",
        amountMillionthUsd: 1000000,
      };
      const transaction2: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "tool-execution",
        supplier: "tavily",
        description: "Test transaction 2",
        amountMillionthUsd: 2000000,
      };

      addTransactionToBuffer(buffer, transaction1);
      addTransactionToBuffer(buffer, transaction2);

      expect(buffer.size).toBe(1);
      expect(buffer.get("workspace-1")).toHaveLength(2);
      expect(buffer.get("workspace-1")?.[0]).toEqual(transaction1);
      expect(buffer.get("workspace-1")?.[1]).toEqual(transaction2);
    });

    it("should handle transactions for different workspaces", () => {
      const buffer = createTransactionBuffer();
      const transaction1: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "text-generation",
        supplier: "openrouter",
        description: "Test transaction 1",
        amountMillionthUsd: 1000000,
      };
      const transaction2: WorkspaceCreditTransaction = {
        workspaceId: "workspace-2",
        source: "text-generation",
        supplier: "openrouter",
        description: "Test transaction 2",
        amountMillionthUsd: 2000000,
      };

      addTransactionToBuffer(buffer, transaction1);
      addTransactionToBuffer(buffer, transaction2);

      expect(buffer.size).toBe(2);
      expect(buffer.get("workspace-1")).toHaveLength(1);
      expect(buffer.get("workspace-2")).toHaveLength(1);
    });
  });

  describe("commitTransactions", () => {
    it("should return early if buffer is empty", async () => {
      const buffer = createTransactionBuffer();
      await commitTransactions(mockDb, buffer, "request-123");
      expect(mockDb.atomicUpdate).not.toHaveBeenCalled();
    });

    it("should commit transactions using atomicUpdate", async () => {
      const buffer = createTransactionBuffer();
      const transaction: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "text-generation",
        supplier: "openrouter",
        description: "Test transaction",
        amountMillionthUsd: 1000000,
      };

      addTransactionToBuffer(buffer, transaction);

      const mockWorkspace = {
        pk: "workspaces/workspace-1",
        sk: "workspace",
        creditBalance: 5000000,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      vi.mocked(mockDb.atomicUpdate).mockImplementation(async (recordSpec, callback) => {
        const fetchedRecords = new Map();
        fetchedRecords.set("workspace-workspace-1", mockWorkspace);
        const recordsToPut = await callback(fetchedRecords);
        return recordsToPut;
      });

      await commitTransactions(mockDb, buffer, "request-123");

      expect(mockDb.atomicUpdate).toHaveBeenCalledTimes(1);
      const [recordSpec] = vi.mocked(mockDb.atomicUpdate).mock.calls[0];
      
      expect(recordSpec.has("workspace-workspace-1")).toBe(true);
      expect(recordSpec.get("workspace-workspace-1")).toEqual({
        table: "workspace",
        pk: "workspaces/workspace-1",
        sk: "workspace",
      });
    });

    it("should throw error if workspace not found", async () => {
      const buffer = createTransactionBuffer();
      const transaction: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "text-generation",
        supplier: "openrouter",
        description: "Test transaction",
        amountMillionthUsd: 1000000,
      };

      addTransactionToBuffer(buffer, transaction);

      vi.mocked(mockDb.atomicUpdate).mockImplementation(async (recordSpec, callback) => {
        const fetchedRecords = new Map();
        // Workspace not found
        fetchedRecords.set("workspace-workspace-1", undefined);
        await callback(fetchedRecords);
        return [];
      });

      await expect(
        commitTransactions(mockDb, buffer, "request-123")
      ).rejects.toThrow("Workspace workspace-1 not found");
    });

    it("should aggregate amounts for multiple transactions in same workspace", async () => {
      const buffer = createTransactionBuffer();
      const transaction1: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "text-generation",
        supplier: "openrouter",
        description: "Test transaction 1",
        amountMillionthUsd: 1000000,
      };
      const transaction2: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "tool-execution",
        supplier: "tavily",
        description: "Test transaction 2",
        amountMillionthUsd: 2000000,
      };

      addTransactionToBuffer(buffer, transaction1);
      addTransactionToBuffer(buffer, transaction2);

      const mockWorkspace = {
        pk: "workspaces/workspace-1",
        sk: "workspace",
        creditBalance: 5000000,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      let recordsPut: TableRecord[] = [];
      vi.mocked(mockDb.atomicUpdate).mockImplementation(async (recordSpec, callback) => {
        const fetchedRecords = new Map();
        fetchedRecords.set("workspace-workspace-1", mockWorkspace);
        recordsPut = await callback(fetchedRecords);
        return recordsPut;
      });

      await commitTransactions(mockDb, buffer, "request-123");

      // Should update workspace with aggregated amount (1000000 + 2000000 = 3000000)
      const workspaceUpdate = recordsPut.find(
        (r) => (r as { pk?: string }).pk === "workspaces/workspace-1" && (r as { sk?: string }).sk === "workspace"
      ) as { creditBalance?: number } | undefined;
      expect(workspaceUpdate?.creditBalance).toBe(2000000); // 5000000 - 3000000

      // Should create two transaction records
      const transactionRecords = recordsPut.filter(
        (r) => (r as { pk?: string }).pk === "workspaces/workspace-1" && (r as { sk?: string }).sk?.startsWith("1")
      );
      expect(transactionRecords).toHaveLength(2);
    });
  });
});

