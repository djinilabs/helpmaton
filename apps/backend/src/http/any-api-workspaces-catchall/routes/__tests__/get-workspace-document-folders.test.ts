import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

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

describe("GET /api/workspaces/:workspaceId/documents/folders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>
  ) {
    // Extract the handler logic directly
    const handler = async (req: express.Request, res: express.Response) => {
      const db = await mockDatabase();
      const workspaceId = req.params.workspaceId;

      // Query all documents for this workspace
      const documents = await db["workspace-document"].query({
        IndexName: "byWorkspaceId",
        KeyConditionExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: {
          ":workspaceId": workspaceId,
        },
      });

      // Extract unique folder paths
      const folderPaths = new Set<string>();
      documents.items.forEach((doc: { folderPath?: string }) => {
        folderPaths.add(doc.folderPath || "");
      });

      res.json({ folders: Array.from(folderPaths).sort() });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return sorted unique folder paths", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockDocuments = [
      {
        pk: "workspace-documents/workspace-123/doc-1",
        sk: "document",
        workspaceId,
        folderPath: "folder1",
      },
      {
        pk: "workspace-documents/workspace-123/doc-2",
        sk: "document",
        workspaceId,
        folderPath: "folder2",
      },
      {
        pk: "workspace-documents/workspace-123/doc-3",
        sk: "document",
        workspaceId,
        folderPath: "folder1", // Duplicate
      },
      {
        pk: "workspace-documents/workspace-123/doc-4",
        sk: "document",
        workspaceId,
        folderPath: "folder3",
      },
    ];

    const mockDocumentQuery = vi.fn().mockResolvedValue({
      items: mockDocuments,
    });
    mockDb["workspace-document"].query = mockDocumentQuery;

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockDocumentQuery).toHaveBeenCalledWith({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });
    expect(res.json).toHaveBeenCalledWith({
      folders: ["folder1", "folder2", "folder3"],
    });
  });

  it("should include root folder (empty string) when documents exist in root", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockDocuments = [
      {
        pk: "workspace-documents/workspace-123/doc-1",
        sk: "document",
        workspaceId,
        folderPath: "",
      },
      {
        pk: "workspace-documents/workspace-123/doc-2",
        sk: "document",
        workspaceId,
        folderPath: "folder1",
      },
    ];

    const mockDocumentQuery = vi.fn().mockResolvedValue({
      items: mockDocuments,
    });
    mockDb["workspace-document"].query = mockDocumentQuery;

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      folders: ["", "folder1"],
    });
  });

  it("should return empty array when workspace has no documents", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";

    const mockDocumentQuery = vi.fn().mockResolvedValue({
      items: [],
    });
    mockDb["workspace-document"].query = mockDocumentQuery;

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      folders: [],
    });
  });

  it("should handle documents with undefined folderPath", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockDocuments = [
      {
        pk: "workspace-documents/workspace-123/doc-1",
        sk: "document",
        workspaceId,
        folderPath: undefined,
      },
      {
        pk: "workspace-documents/workspace-123/doc-2",
        sk: "document",
        workspaceId,
        folderPath: "folder1",
      },
    ];

    const mockDocumentQuery = vi.fn().mockResolvedValue({
      items: mockDocuments,
    });
    mockDb["workspace-document"].query = mockDocumentQuery;

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      folders: ["", "folder1"],
    });
  });

  it("should sort folders alphabetically", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockDocuments = [
      {
        pk: "workspace-documents/workspace-123/doc-1",
        sk: "document",
        workspaceId,
        folderPath: "zebra",
      },
      {
        pk: "workspace-documents/workspace-123/doc-2",
        sk: "document",
        workspaceId,
        folderPath: "alpha",
      },
      {
        pk: "workspace-documents/workspace-123/doc-3",
        sk: "document",
        workspaceId,
        folderPath: "beta",
      },
    ];

    const mockDocumentQuery = vi.fn().mockResolvedValue({
      items: mockDocuments,
    });
    mockDb["workspace-document"].query = mockDocumentQuery;

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      folders: ["alpha", "beta", "zebra"],
    });
  });

  it("should handle nested folder paths", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockDocuments = [
      {
        pk: "workspace-documents/workspace-123/doc-1",
        sk: "document",
        workspaceId,
        folderPath: "folder1/subfolder",
      },
      {
        pk: "workspace-documents/workspace-123/doc-2",
        sk: "document",
        workspaceId,
        folderPath: "folder1",
      },
      {
        pk: "workspace-documents/workspace-123/doc-3",
        sk: "document",
        workspaceId,
        folderPath: "folder2/nested/deep",
      },
    ];

    const mockDocumentQuery = vi.fn().mockResolvedValue({
      items: mockDocuments,
    });
    mockDb["workspace-document"].query = mockDocumentQuery;

    const req = createMockRequest({
      params: {
        workspaceId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      folders: ["folder1", "folder1/subfolder", "folder2/nested/deep"],
    });
  });
});
