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
        amountMillionthUsd: -1000000, // Negative for debit (deducting from workspace)
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
        amountMillionthUsd: -1000000, // Negative for debit
      };
      const transaction2: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "tool-execution",
        supplier: "tavily",
        description: "Test transaction 2",
        amountMillionthUsd: -2000000, // Negative for debit
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
        amountMillionthUsd: -1000000, // Negative for debit
      };
      const transaction2: WorkspaceCreditTransaction = {
        workspaceId: "workspace-2",
        source: "text-generation",
        supplier: "openrouter",
        description: "Test transaction 2",
        amountMillionthUsd: -2000000, // Negative for debit
      };

      addTransactionToBuffer(buffer, transaction1);
      addTransactionToBuffer(buffer, transaction2);

      expect(buffer.size).toBe(2);
      expect(buffer.get("workspace-1")).toHaveLength(1);
      expect(buffer.get("workspace-2")).toHaveLength(1);
    });

    it("should discard transactions with zero amount", () => {
      const buffer = createTransactionBuffer();
      const zeroTransaction: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "text-generation",
        supplier: "openrouter",
        description: "Zero amount transaction",
        amountMillionthUsd: 0,
      };
      const nonZeroTransaction: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "text-generation",
        supplier: "openrouter",
        description: "Non-zero transaction",
        amountMillionthUsd: -1000000, // Negative for debit
      };

      addTransactionToBuffer(buffer, zeroTransaction);
      addTransactionToBuffer(buffer, nonZeroTransaction);

      // Zero transaction should be discarded
      expect(buffer.size).toBe(1);
      expect(buffer.get("workspace-1")).toHaveLength(1);
      expect(buffer.get("workspace-1")?.[0]).toEqual(nonZeroTransaction);
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
        amountMillionthUsd: -1000000, // Negative for debit (deducting from workspace)
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
        amountMillionthUsd: -1000000, // Negative for debit (deducting from workspace)
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
        amountMillionthUsd: -1000000, // Negative for debit
      };
      const transaction2: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "tool-execution",
        supplier: "tavily",
        description: "Test transaction 2",
        amountMillionthUsd: -2000000, // Negative for debit
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

      // Should update workspace with aggregated amount (-1000000 + -2000000 = -3000000)
      // Negative amounts = debits (deduct from workspace)
      const workspaceUpdate = recordsPut.find(
        (r) => (r as { pk?: string }).pk === "workspaces/workspace-1" && (r as { sk?: string }).sk === "workspace"
      ) as { creditBalance?: number } | undefined;
      expect(workspaceUpdate?.creditBalance).toBe(2000000); // 5000000 + (-3000000) = 2000000

      // Should create two transaction records
      const transactionRecords = recordsPut.filter(
        (r) => (r as { pk?: string }).pk === "workspaces/workspace-1" && (r as { sk?: string }).sk?.startsWith("1")
      );
      expect(transactionRecords).toHaveLength(2);
    });

    it("should calculate sequential balances for multiple transactions in same workspace", async () => {
      const buffer = createTransactionBuffer();
      const initialBalance = 10000000; // 10.00 USD in millionths
      
      // Create three transactions for the same workspace
      const transaction1: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "text-generation",
        supplier: "openrouter",
        description: "Transaction 1",
        amountMillionthUsd: -1000000, // -1.00 USD (debit)
      };
      const transaction2: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "tool-execution",
        supplier: "tavily",
        description: "Transaction 2",
        amountMillionthUsd: -2000000, // -2.00 USD (debit)
      };
      const transaction3: WorkspaceCreditTransaction = {
        workspaceId: "workspace-1",
        source: "embedding-generation",
        supplier: "openrouter",
        description: "Transaction 3",
        amountMillionthUsd: -500000, // -0.50 USD (debit)
      };

      addTransactionToBuffer(buffer, transaction1);
      addTransactionToBuffer(buffer, transaction2);
      addTransactionToBuffer(buffer, transaction3);

      const mockWorkspace = {
        pk: "workspaces/workspace-1",
        sk: "workspace",
        creditBalance: initialBalance,
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

      // Get transaction records sorted by SK
      const transactionRecords = recordsPut
        .filter(
          (r) =>
            (r as { pk?: string }).pk === "workspaces/workspace-1" &&
            (r as { sk?: string }).sk !== "workspace"
        )
        .sort((a, b) =>
          ((a as { sk?: string }).sk || "").localeCompare(
            (b as { sk?: string }).sk || ""
          )
        ) as Array<{
        workspaceCreditsBeforeMillionthUsd?: number;
        workspaceCreditsAfterMillionthUsd?: number;
        amountMillionthUsd?: number;
        description?: string;
      }>;

      expect(transactionRecords).toHaveLength(3);

      // Transaction 1: should use initial balance
      expect(transactionRecords[0].workspaceCreditsBeforeMillionthUsd).toBe(
        initialBalance
      );
      expect(transactionRecords[0].workspaceCreditsAfterMillionthUsd).toBe(
        initialBalance + transaction1.amountMillionthUsd
      ); // 10000000 + (-1000000) = 9000000
      expect(transactionRecords[0].amountMillionthUsd).toBe(-1000000);

      // Transaction 2: should use balance after transaction 1
      const balanceAfterT1 = initialBalance + transaction1.amountMillionthUsd;
      expect(transactionRecords[1].workspaceCreditsBeforeMillionthUsd).toBe(
        balanceAfterT1
      );
      expect(transactionRecords[1].workspaceCreditsAfterMillionthUsd).toBe(
        balanceAfterT1 + transaction2.amountMillionthUsd
      ); // 9000000 + (-2000000) = 7000000
      expect(transactionRecords[1].amountMillionthUsd).toBe(-2000000);

      // Transaction 3: should use balance after transaction 2
      const balanceAfterT2 = balanceAfterT1 + transaction2.amountMillionthUsd;
      expect(transactionRecords[2].workspaceCreditsBeforeMillionthUsd).toBe(
        balanceAfterT2
      );
      expect(transactionRecords[2].workspaceCreditsAfterMillionthUsd).toBe(
        balanceAfterT2 + transaction3.amountMillionthUsd
      ); // 7000000 + (-500000) = 6500000
      expect(transactionRecords[2].amountMillionthUsd).toBe(-500000);

      // Verify final workspace balance
      const workspaceUpdate = recordsPut.find(
        (r) =>
          (r as { pk?: string }).pk === "workspaces/workspace-1" &&
          (r as { sk?: string }).sk === "workspace"
      ) as { creditBalance?: number } | undefined;
      expect(workspaceUpdate?.creditBalance).toBe(6500000); // 10000000 + (-3500000) = 6500000
    });
  });
});

