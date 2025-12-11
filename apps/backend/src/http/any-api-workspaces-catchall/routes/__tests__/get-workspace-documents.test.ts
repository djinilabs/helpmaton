import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { normalizeFolderPath } from "../../../../utils/s3";
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

describe("GET /api/workspaces/:workspaceId/documents", () => {
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
      const folderPath = req.query.folder as string | undefined;

      // Query all documents for this workspace using GSI
      const documents = await db["workspace-document"].query({
        IndexName: "byWorkspaceId",
        KeyConditionExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: {
          ":workspaceId": workspaceId,
        },
      });

      let filteredDocuments = documents.items;

      // Filter by folder if specified
      if (folderPath !== undefined) {
        const normalizedPath = normalizeFolderPath(folderPath || "");
        filteredDocuments = documents.items.filter(
          (doc: { folderPath: string }) => doc.folderPath === normalizedPath
        );
      }

      const documentsList = filteredDocuments.map(
        (doc: {
          pk: string;
          name: string;
          filename: string;
          folderPath: string;
          contentType: string;
          size: number;
          createdAt: string;
          updatedAt: string;
        }) => ({
          id: doc.pk.replace(`workspace-documents/${workspaceId}/`, ""),
          name: doc.name,
          filename: doc.filename,
          folderPath: doc.folderPath,
          contentType: doc.contentType,
          size: doc.size,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        })
      );

      res.json({ documents: documentsList });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return all documents for a workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockDocuments = [
      {
        pk: `workspace-documents/${workspaceId}/doc-1`,
        sk: "document",
        workspaceId,
        name: "Document 1",
        filename: "doc1.pdf",
        folderPath: "",
        contentType: "application/pdf",
        size: 1024,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        pk: `workspace-documents/${workspaceId}/doc-2`,
        sk: "document",
        workspaceId,
        name: "Document 2",
        filename: "doc2.txt",
        folderPath: "folder1",
        contentType: "text/plain",
        size: 512,
        createdAt: "2024-01-02T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
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
      query: {},
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
      documents: [
        {
          id: "doc-1",
          name: "Document 1",
          filename: "doc1.pdf",
          folderPath: "",
          contentType: "application/pdf",
          size: 1024,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "doc-2",
          name: "Document 2",
          filename: "doc2.txt",
          folderPath: "folder1",
          contentType: "text/plain",
          size: 512,
          createdAt: "2024-01-02T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        },
      ],
    });
  });

  it("should filter documents by folder path", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockDocuments = [
      {
        pk: `workspace-documents/${workspaceId}/doc-1`,
        sk: "document",
        workspaceId,
        name: "Document 1",
        filename: "doc1.pdf",
        folderPath: "folder1",
        contentType: "application/pdf",
        size: 1024,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        pk: `workspace-documents/${workspaceId}/doc-2`,
        sk: "document",
        workspaceId,
        name: "Document 2",
        filename: "doc2.txt",
        folderPath: "folder2",
        contentType: "text/plain",
        size: 512,
        createdAt: "2024-01-02T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      },
      {
        pk: `workspace-documents/${workspaceId}/doc-3`,
        sk: "document",
        workspaceId,
        name: "Document 3",
        filename: "doc3.docx",
        folderPath: "folder1",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 2048,
        createdAt: "2024-01-03T00:00:00Z",
        updatedAt: "2024-01-03T00:00:00Z",
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
      query: {
        folder: "folder1",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      documents: [
        {
          id: "doc-1",
          name: "Document 1",
          filename: "doc1.pdf",
          folderPath: "folder1",
          contentType: "application/pdf",
          size: 1024,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "doc-3",
          name: "Document 3",
          filename: "doc3.docx",
          folderPath: "folder1",
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: 2048,
          createdAt: "2024-01-03T00:00:00Z",
          updatedAt: "2024-01-03T00:00:00Z",
        },
      ],
    });
  });

  it("should filter documents by root folder (empty string)", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockDocuments = [
      {
        pk: `workspace-documents/${workspaceId}/doc-1`,
        sk: "document",
        workspaceId,
        name: "Document 1",
        filename: "doc1.pdf",
        folderPath: "",
        contentType: "application/pdf",
        size: 1024,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
      {
        pk: `workspace-documents/${workspaceId}/doc-2`,
        sk: "document",
        workspaceId,
        name: "Document 2",
        filename: "doc2.txt",
        folderPath: "folder1",
        contentType: "text/plain",
        size: 512,
        createdAt: "2024-01-02T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
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
      query: {
        folder: "",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      documents: [
        {
          id: "doc-1",
          name: "Document 1",
          filename: "doc1.pdf",
          folderPath: "",
          contentType: "application/pdf",
          size: 1024,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
  });

  it("should normalize folder path with leading/trailing slashes", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockDocuments = [
      {
        pk: `workspace-documents/${workspaceId}/doc-1`,
        sk: "document",
        workspaceId,
        name: "Document 1",
        filename: "doc1.pdf",
        folderPath: "folder1",
        contentType: "application/pdf",
        size: 1024,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
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
      query: {
        folder: "/folder1/",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // normalizeFolderPath("/folder1/") returns "folder1"
    expect(res.json).toHaveBeenCalledWith({
      documents: [
        {
          id: "doc-1",
          name: "Document 1",
          filename: "doc1.pdf",
          folderPath: "folder1",
          contentType: "application/pdf",
          size: 1024,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
  });

  it("should return empty array when no documents exist", async () => {
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
      query: {},
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      documents: [],
    });
  });

  it("should return empty array when folder filter matches no documents", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const mockDocuments = [
      {
        pk: `workspace-documents/${workspaceId}/doc-1`,
        sk: "document",
        workspaceId,
        name: "Document 1",
        filename: "doc1.pdf",
        folderPath: "folder1",
        contentType: "application/pdf",
        size: 1024,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
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
      query: {
        folder: "nonexistent-folder",
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      documents: [],
    });
  });
});
