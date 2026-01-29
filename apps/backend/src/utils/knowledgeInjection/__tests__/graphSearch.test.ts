import { describe, it, expect, vi, beforeEach } from "vitest";

import { searchGraphByEntities } from "../graphSearch";

const mockQueryGraph = vi.fn();
const mockClose = vi.fn();
const mockCreateGraphDb = vi.fn();

vi.mock("../../duckdb/graphDb", () => ({
  createGraphDb: (...args: unknown[]) => mockCreateGraphDb(...args),
}));

describe("searchGraphByEntities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGraphDb.mockResolvedValue({
      queryGraph: mockQueryGraph,
      close: mockClose,
    });
  });

  it("returns empty array when no entities provided", async () => {
    const result = await searchGraphByEntities({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      entities: [],
    });

    expect(result).toEqual([]);
    expect(mockCreateGraphDb).not.toHaveBeenCalled();
  });

  it("maps graph rows into snippets", async () => {
    mockQueryGraph.mockResolvedValue([
      { source_id: "User", target_id: "React", label: "likes" },
    ]);

    const result = await searchGraphByEntities({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      entities: ["User"],
    });

    expect(mockCreateGraphDb).toHaveBeenCalled();
    expect(mockQueryGraph).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
    expect(result).toEqual([
      {
        snippet: "Subject: User\nPredicate: likes\nObject: React",
        similarity: 1,
        subject: "User",
        predicate: "likes",
        object: "React",
      },
    ]);
  });
});
