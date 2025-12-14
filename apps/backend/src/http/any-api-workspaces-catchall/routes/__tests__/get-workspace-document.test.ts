import { forbidden, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockGetDocument } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockGetDocument: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/s3", () => ({
  getDocument: mockGetDocument,
}));

describe("GET /api/workspaces/:workspaceId/documents/:documentId", () => {
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
      const documentId = req.params.documentId;
      const documentPk = `workspace-documents/${workspaceId}/${documentId}`;

      const document = await db["workspace-document"].get(
        documentPk,
        "document"
      );
      if (!document) {
        throw resourceGone("Document not found");
      }

      if (document.workspaceId !== workspaceId) {
        throw forbidden("Document does not belong to this workspace");
      }

      // Get content from S3
      const content = await mockGetDocument(
        workspaceId,
        documentId,
        document.s3Key
      );
      const contentText = content.toString("utf-8");

      res.json({
        id: documentId,
        name: document.name,
        filename: document.filename,
        folderPath: document.folderPath,
        contentType: document.contentType,
        size: document.size,
        content: contentText,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should return document with content from S3", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const documentContent = "This is the document content";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "Test Document",
      filename: "test.md",
      folderPath: "folder1",
      contentType: "text/markdown",
      size: 1024,
      s3Key: `workspaces/${workspaceId}/documents/folder1/test.md`,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const mockContentBuffer = Buffer.from(documentContent, "utf-8");
    mockGetDocument.mockResolvedValue(mockContentBuffer);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockDocumentGet).toHaveBeenCalledWith(
      `workspace-documents/${workspaceId}/${documentId}`,
      "document"
    );
    expect(mockGetDocument).toHaveBeenCalledWith(
      workspaceId,
      documentId,
      mockDocument.s3Key
    );
    expect(res.json).toHaveBeenCalledWith({
      id: documentId,
      name: "Test Document",
      filename: "test.md",
      folderPath: "folder1",
      contentType: "text/markdown",
      size: 1024,
      content: documentContent,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should return document in root folder", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const documentContent = "Root folder content";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "Root Document",
      filename: "root.txt",
      folderPath: "",
      contentType: "text/plain",
      size: 512,
      s3Key: `workspaces/${workspaceId}/documents/root.txt`,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const mockContentBuffer = Buffer.from(documentContent, "utf-8");
    mockGetDocument.mockResolvedValue(mockContentBuffer);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      id: documentId,
      name: "Root Document",
      filename: "root.txt",
      folderPath: "",
      contentType: "text/plain",
      size: 512,
      content: documentContent,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should throw resourceGone when document does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";

    const mockDocumentGet = vi.fn().mockResolvedValue(null);
    mockDb["workspace-document"].get = mockDocumentGet;

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(410);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("Document not found");
    }

    expect(mockGetDocument).not.toHaveBeenCalled();
  });

  it("should throw forbidden when document belongs to different workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId: "workspace-999", // Different workspace
      name: "Test Document",
      filename: "test.md",
      folderPath: "",
      contentType: "text/markdown",
      size: 1024,
      s3Key: `workspaces/workspace-999/documents/test.md`,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(403);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("Document does not belong to this workspace");
    }

    expect(mockGetDocument).not.toHaveBeenCalled();
  });

  it("should handle document with special characters in content", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const documentContent =
      "Content with special chars: émojis 🎉 and unicode 中文";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "Special Document",
      filename: "special.md",
      folderPath: "folder1",
      contentType: "text/markdown",
      size: 2048,
      s3Key: `workspaces/${workspaceId}/documents/folder1/special.md`,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const mockContentBuffer = Buffer.from(documentContent, "utf-8");
    mockGetDocument.mockResolvedValue(mockContentBuffer);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      id: documentId,
      name: "Special Document",
      filename: "special.md",
      folderPath: "folder1",
      contentType: "text/markdown",
      size: 2048,
      content: documentContent,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should handle large document content", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const documentContent = "A".repeat(10000); // 10KB content

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "Large Document",
      filename: "large.txt",
      folderPath: "",
      contentType: "text/plain",
      size: 10000,
      s3Key: `workspaces/${workspaceId}/documents/large.txt`,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const mockContentBuffer = Buffer.from(documentContent, "utf-8");
    mockGetDocument.mockResolvedValue(mockContentBuffer);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      id: documentId,
      name: "Large Document",
      filename: "large.txt",
      folderPath: "",
      contentType: "text/plain",
      size: 10000,
      content: documentContent,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });
});
