import { describe, it, expect, vi } from "vitest";

import type { DatabaseSchema } from "../../tables/schema";
import {
  addSpendingLimit,
  updateSpendingLimit,
  removeSpendingLimit,
} from "../spendingLimitsManagement";

const createMockDb = () => ({
  workspace: {
    get: vi.fn().mockResolvedValue({
      pk: "workspaces/workspace-123",
      sk: "workspace",
      spendingLimits: [],
    }),
    update: vi.fn().mockResolvedValue({}),
  },
  agent: {
    get: vi.fn().mockResolvedValue({
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      spendingLimits: [{ timeFrame: "daily", amount: 10 }],
    }),
    update: vi.fn().mockResolvedValue({}),
  },
});

describe("spendingLimitsManagement", () => {
  it("clears workspace suggestions when adding a spending limit", async () => {
    const db = createMockDb();
    await addSpendingLimit(
      db as unknown as DatabaseSchema,
      "workspace-123",
      { timeFrame: "daily", amount: 100 }
    );

    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestions: null,
      })
    );
  });

  it("clears agent suggestions when updating a spending limit", async () => {
    const db = createMockDb();
    await updateSpendingLimit(
      db as unknown as DatabaseSchema,
      "workspace-123",
      "daily",
      150,
      "agent-123"
    );

    expect(db.agent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestions: null,
      })
    );
  });

  it("clears workspace suggestions when removing a spending limit", async () => {
    const db = createMockDb();
    db.workspace.get.mockResolvedValue({
      pk: "workspaces/workspace-123",
      sk: "workspace",
      spendingLimits: [{ timeFrame: "weekly", amount: 200 }],
    });

    await removeSpendingLimit(
      db as unknown as DatabaseSchema,
      "workspace-123",
      "weekly"
    );

    expect(db.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestions: null,
      })
    );
  });
});
