/* eslint-disable import/order */
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

const { mockDatabase, mockSearchMemory, mockGetMemoryRecord } = vi.hoisted(
  () => {
    return {
      mockDatabase: vi.fn(),
      mockSearchMemory: vi.fn(),
      mockGetMemoryRecord: vi.fn(),
    };
  },
);

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/memory/searchMemory", () => ({
  searchMemory: mockSearchMemory,
  getMemoryRecord: mockGetMemoryRecord,
}));

import {
  registerGetAgentMemory,
  registerGetAgentMemoryRecord,
} from "../get-agent-memory";

import { createTestAppWithHandlerCapture } from "./route-test-helpers";

describe("GET /api/workspaces/:workspaceId/agents/:agentId/memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns truncated content when previewLength is provided", async () => {
    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue({
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
    });
    mockDatabase.mockResolvedValue(mockDb);

    mockSearchMemory.mockResolvedValue([
      {
        id: "record-1",
        content: "This is a long memory content.",
        date: "2025-01-01",
        timestamp: "2025-01-01T00:00:00.000Z",
        metadata: { workspaceId: "workspace-123" },
      },
    ]);

    const { app, getHandler } = createTestAppWithHandlerCapture();
    registerGetAgentMemory(app);
    const handler = getHandler(
      "/api/workspaces/:workspaceId/agents/:agentId/memory",
    );

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
      },
      query: {
        previewLength: "10",
      },
    }) as express.Request;

    const res = createMockResponse() as express.Response;
    const next = createMockNext();

    await handler?.(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockSearchMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-456",
        workspaceId: "workspace-123",
      }),
    );
    expect(res.json).toHaveBeenCalledWith({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      records: [
        {
          id: "record-1",
          content: "This is a ",
          date: "2025-01-01",
          timestamp: "2025-01-01T00:00:00.000Z",
          metadata: { workspaceId: "workspace-123" },
          isTruncated: true,
        },
      ],
    });
  });
});

describe("GET /api/workspaces/:workspaceId/agents/:agentId/memory/:recordId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the full record for the given record ID", async () => {
    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue({
      pk: "agents/workspace-123/agent-456",
      sk: "agent",
    });
    mockDatabase.mockResolvedValue(mockDb);

    mockGetMemoryRecord.mockResolvedValue({
      id: "record-1",
      content: "Full memory content.",
      date: "2025-01-01",
      timestamp: "2025-01-01T00:00:00.000Z",
      metadata: { workspaceId: "workspace-123" },
    });

    const { app, getHandler } = createTestAppWithHandlerCapture();
    registerGetAgentMemoryRecord(app);
    const handler = getHandler(
      "/api/workspaces/:workspaceId/agents/:agentId/memory/:recordId",
    );

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        recordId: "record-1",
      },
      query: {},
    }) as express.Request;

    const res = createMockResponse() as express.Response;
    const next = createMockNext();

    await handler?.(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockGetMemoryRecord).toHaveBeenCalledWith({
      agentId: "agent-456",
      grain: "working",
      recordId: "record-1",
    });
    expect(res.json).toHaveBeenCalledWith({
      workspaceId: "workspace-123",
      agentId: "agent-456",
      record: {
        id: "record-1",
        content: "Full memory content.",
        date: "2025-01-01",
        timestamp: "2025-01-01T00:00:00.000Z",
        metadata: { workspaceId: "workspace-123" },
      },
    });
  });
});
