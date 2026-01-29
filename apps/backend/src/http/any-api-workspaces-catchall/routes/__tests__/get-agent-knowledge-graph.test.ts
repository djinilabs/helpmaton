/* eslint-disable import/order */
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

const { mockDatabase, mockCreateGraphDb } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockCreateGraphDb: vi.fn(),
  };
});

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/duckdb/graphDb", () => ({
  createGraphDb: mockCreateGraphDb,
}));

import { registerGetAgentKnowledgeGraph } from "../get-agent-knowledge-graph";
import { createTestAppWithHandlerCapture } from "./route-test-helpers";

describe("GET /api/workspaces/:workspaceId/agents/:agentId/knowledge-graph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns facts with queryText and maxResults", async () => {
    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue({
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
    });
    mockDatabase.mockResolvedValue(mockDb);

    const mockQueryGraph = vi.fn().mockResolvedValue([
      {
        id: "fact-1",
        source_id: "Alice",
        target_id: "Project X",
        label: "works_on",
        properties: { confidence: 0.9 },
      },
    ]);
    const mockClose = vi.fn().mockResolvedValue(undefined);

    mockCreateGraphDb.mockResolvedValue({
      queryGraph: mockQueryGraph,
      close: mockClose,
    });

    const { app, getHandler } = createTestAppWithHandlerCapture();
    registerGetAgentKnowledgeGraph(app);
    const handler = getHandler(
      "/api/workspaces/:workspaceId/agents/:agentId/knowledge-graph",
    );

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      query: {
        queryText: "Alice",
        maxResults: "10",
      },
    }) as express.Request;

    const res = createMockResponse() as express.Response;
    const next = createMockNext();

    await handler?.(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockCreateGraphDb).toHaveBeenCalledWith(
      "workspace-123",
      "agent-456",
    );
    expect(mockQueryGraph).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 10"),
    );
    expect(res.json).toHaveBeenCalledWith({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      facts: [
        {
          id: "fact-1",
          source_id: "Alice",
          target_id: "Project X",
          label: "works_on",
          properties: { confidence: 0.9 },
        },
      ],
    });
    expect(mockClose).toHaveBeenCalled();
  });

  it("returns 410 when agent is missing", async () => {
    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue(null);
    mockDatabase.mockResolvedValue(mockDb);

    const { app, getHandler } = createTestAppWithHandlerCapture();
    registerGetAgentKnowledgeGraph(app);
    const handler = getHandler(
      "/api/workspaces/:workspaceId/agents/:agentId/knowledge-graph",
    );

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
    }) as express.Request;

    const res = createMockResponse() as express.Response;
    const next = vi.fn();

    await handler?.(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0]?.[0] as {
      output?: { statusCode?: number };
    };
    expect(error?.output?.statusCode).toBe(410);
  });

  it("rejects invalid maxResults values", async () => {
    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue({
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
    });
    mockDatabase.mockResolvedValue(mockDb);

    const { app, getHandler } = createTestAppWithHandlerCapture();
    registerGetAgentKnowledgeGraph(app);
    const handler = getHandler(
      "/api/workspaces/:workspaceId/agents/:agentId/knowledge-graph",
    );

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      query: {
        maxResults: "999",
      },
    }) as express.Request;

    const res = createMockResponse() as express.Response;
    const next = vi.fn();

    await handler?.(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0]?.[0] as {
      output?: { statusCode?: number };
    };
    expect(error?.output?.statusCode).toBe(400);
  });

  it("escapes queryText when building the SQL", async () => {
    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue({
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
    });
    mockDatabase.mockResolvedValue(mockDb);

    const mockQueryGraph = vi.fn().mockResolvedValue([]);
    const mockClose = vi.fn().mockResolvedValue(undefined);

    mockCreateGraphDb.mockResolvedValue({
      queryGraph: mockQueryGraph,
      close: mockClose,
    });

    const { app, getHandler } = createTestAppWithHandlerCapture();
    registerGetAgentKnowledgeGraph(app);
    const handler = getHandler(
      "/api/workspaces/:workspaceId/agents/:agentId/knowledge-graph",
    );

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      query: {
        queryText: "guitar%_\"'",
        maxResults: "10",
      },
    }) as express.Request;

    const res = createMockResponse() as express.Response;
    const next = createMockNext();

    await handler?.(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockQueryGraph).toHaveBeenCalledWith(
      expect.stringContaining("LIKE '%guitar\\%\\_\"''%' ESCAPE '\\'"),
    );
    expect(mockClose).toHaveBeenCalled();
  });
});
