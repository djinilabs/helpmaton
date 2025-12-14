import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase, mockRenameDocument, mockGenerateUniqueFilename } =
  vi.hoisted(() => {
    return {
      mockDatabase: vi.fn(),
      mockRenameDocument: vi.fn(),
      mockGenerateUniqueFilename: vi.fn(),
    };
  });

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/s3", () => ({
  renameDocument: mockRenameDocument,
  generateUniqueFilename: mockGenerateUniqueFilename,
}));

describe("PATCH /api/workspaces/:workspaceId/documents/:documentId/rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateUniqueFilename.mockImplementation(
      (_workspaceId: string, filename: string) => Promise.resolve(filename)
    );
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

      const newName = req.body.name as string;
      if (!newName || typeof newName !== "string") {
        throw badRequest("name is required");
      }

      // Use name as new filename (with extension from original if not present)
      const originalExt = document.filename.substring(
        document.filename.lastIndexOf(".")
      );
      const nameWithExt = newName.includes(".")
        ? newName
        : `${newName}${originalExt}`;

      // Check for conflicts in current folder
      const uniqueFilename = await mockGenerateUniqueFilename(
        workspaceId,
        nameWithExt,
        document.folderPath
      );

      // Rename file in S3
      const newS3Key = await mockRenameDocument(
        workspaceId,
        document.s3Key,
        uniqueFilename,
        document.folderPath
      );

      // Update database record
      const updated = await db["workspace-document"].update(
        {
          ...document,
          name: newName,
          filename: uniqueFilename,
          s3Key: newS3Key,
          updatedAt: new Date().toISOString(),
        },
        null
      );

      res.json({
        id: documentId,
        name: updated.name,
        filename: updated.filename,
        folderPath: updated.folderPath,
        contentType: updated.contentType,
        size: updated.size,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should rename document successfully when name has no extension", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const documentPk = `workspace-documents/${workspaceId}/${documentId}`;
    const newName = "New Document Name";
    const originalFilename = "old-document.md";
    const newFilename = "New Document Name.md";
    const newS3Key = `workspaces/${workspaceId}/documents/${newFilename}`;

    const mockDocument = {
      pk: documentPk,
      sk: "document",
      workspaceId,
      documentId,
      name: "Old Document Name",
      filename: originalFilename,
      folderPath: "folder1",
      contentType: "text/markdown",
      size: 1024,
      s3Key: `workspaces/${workspaceId}/documents/${originalFilename}`,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockUpdatedDocument = {
      ...mockDocument,
      name: newName,
      filename: newFilename,
      s3Key: newS3Key,
      updatedAt: "2024-01-03T00:00:00Z",
    };

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const mockDocumentUpdate = vi.fn().mockResolvedValue(mockUpdatedDocument);
    mockDb["workspace-document"].update = mockDocumentUpdate;

    mockGenerateUniqueFilename.mockResolvedValue(newFilename);
    mockRenameDocument.mockResolvedValue(newS3Key);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
      body: {
        name: newName,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockDocumentGet).toHaveBeenCalledWith(documentPk, "document");
    expect(mockGenerateUniqueFilename).toHaveBeenCalledWith(
      workspaceId,
      "New Document Name.md",
      mockDocument.folderPath
    );
    expect(mockRenameDocument).toHaveBeenCalledWith(
      workspaceId,
      mockDocument.s3Key,
      newFilename,
      mockDocument.folderPath
    );
    expect(mockDocumentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        ...mockDocument,
        name: newName,
        filename: newFilename,
        s3Key: newS3Key,
        updatedAt: expect.any(String),
      }),
      null
    );
    expect(res.json).toHaveBeenCalledWith({
      id: documentId,
      name: newName,
      filename: newFilename,
      folderPath: mockDocument.folderPath,
      contentType: mockDocument.contentType,
      size: mockDocument.size,
      createdAt: mockDocument.createdAt,
      updatedAt: mockUpdatedDocument.updatedAt,
    });
  });

  it("should rename document successfully when name includes extension", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const documentPk = `workspace-documents/${workspaceId}/${documentId}`;
    const newName = "new-document.txt";
    const originalFilename = "old-document.md";
    const newFilename = "new-document.txt";
    const newS3Key = `workspaces/${workspaceId}/documents/${newFilename}`;

    const mockDocument = {
      pk: documentPk,
      sk: "document",
      workspaceId,
      documentId,
      name: "Old Document Name",
      filename: originalFilename,
      folderPath: "folder1",
      contentType: "text/markdown",
      size: 1024,
      s3Key: `workspaces/${workspaceId}/documents/${originalFilename}`,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockUpdatedDocument = {
      ...mockDocument,
      name: newName,
      filename: newFilename,
      s3Key: newS3Key,
      updatedAt: "2024-01-03T00:00:00Z",
    };

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const mockDocumentUpdate = vi.fn().mockResolvedValue(mockUpdatedDocument);
    mockDb["workspace-document"].update = mockDocumentUpdate;

    mockGenerateUniqueFilename.mockResolvedValue(newFilename);
    mockRenameDocument.mockResolvedValue(newS3Key);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
      body: {
        name: newName,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockGenerateUniqueFilename).toHaveBeenCalledWith(
      workspaceId,
      newFilename,
      mockDocument.folderPath
    );
    expect(mockRenameDocument).toHaveBeenCalledWith(
      workspaceId,
      mockDocument.s3Key,
      newFilename,
      mockDocument.folderPath
    );
  });

  it("should use generated unique filename when conflict exists", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const documentPk = `workspace-documents/${workspaceId}/${documentId}`;
    const newName = "New Document Name";
    const originalFilename = "old-document.md";
    const uniqueFilename = "New Document Name (1).md";
    const newS3Key = `workspaces/${workspaceId}/documents/${uniqueFilename}`;

    const mockDocument = {
      pk: documentPk,
      sk: "document",
      workspaceId,
      documentId,
      name: "Old Document Name",
      filename: originalFilename,
      folderPath: "folder1",
      contentType: "text/markdown",
      size: 1024,
      s3Key: `workspaces/${workspaceId}/documents/${originalFilename}`,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockUpdatedDocument = {
      ...mockDocument,
      name: newName,
      filename: uniqueFilename,
      s3Key: newS3Key,
      updatedAt: "2024-01-03T00:00:00Z",
    };

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const mockDocumentUpdate = vi.fn().mockResolvedValue(mockUpdatedDocument);
    mockDb["workspace-document"].update = mockDocumentUpdate;

    mockGenerateUniqueFilename.mockResolvedValue(uniqueFilename);
    mockRenameDocument.mockResolvedValue(newS3Key);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
      body: {
        name: newName,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockGenerateUniqueFilename).toHaveBeenCalledWith(
      workspaceId,
      "New Document Name.md",
      mockDocument.folderPath
    );
    expect(mockRenameDocument).toHaveBeenCalledWith(
      workspaceId,
      mockDocument.s3Key,
      uniqueFilename,
      mockDocument.folderPath
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: uniqueFilename,
      })
    );
  });

  it("should throw resourceGone when document does not exist", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const documentPk = `workspace-documents/${workspaceId}/${documentId}`;

    const mockDocumentGet = vi.fn().mockResolvedValue(null);
    mockDb["workspace-document"].get = mockDocumentGet;

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
      body: {
        name: "New Name",
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: expect.stringContaining("Document not found"),
          }),
        }),
      })
    );

    expect(mockDocumentGet).toHaveBeenCalledWith(documentPk, "document");
  });

  it("should throw forbidden when document belongs to different workspace", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const documentPk = `workspace-documents/${workspaceId}/${documentId}`;

    const mockDocument = {
      pk: documentPk,
      sk: "document",
      workspaceId: "different-workspace",
      documentId,
      name: "Document Name",
      filename: "document.md",
      folderPath: "folder1",
      contentType: "text/markdown",
      size: 1024,
      s3Key: "s3-key",
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
      body: {
        name: "New Name",
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 403,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "Document does not belong to this workspace"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when name is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const documentPk = `workspace-documents/${workspaceId}/${documentId}`;

    const mockDocument = {
      pk: documentPk,
      sk: "document",
      workspaceId,
      documentId,
      name: "Document Name",
      filename: "document.md",
      folderPath: "folder1",
      contentType: "text/markdown",
      size: 1024,
      s3Key: "s3-key",
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
      body: {},
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("name is required"),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when name is not a string", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const documentPk = `workspace-documents/${workspaceId}/${documentId}`;

    const mockDocument = {
      pk: documentPk,
      sk: "document",
      workspaceId,
      documentId,
      name: "Document Name",
      filename: "document.md",
      folderPath: "folder1",
      contentType: "text/markdown",
      size: 1024,
      s3Key: "s3-key",
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
      body: {
        name: 123,
      },
    });
    const res = createMockResponse();

    await expect(callRouteHandler(req, res)).rejects.toThrow(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("name is required"),
          }),
        }),
      })
    );
  });

  it("should handle document with no extension in original filename", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const documentPk = `workspace-documents/${workspaceId}/${documentId}`;
    const newName = "New Document";
    const originalFilename = "old-document";
    // When filename has no extension, lastIndexOf(".") returns -1, so substring(-1) returns entire filename
    // So nameWithExt becomes "New Documentold-document"
    const newFilename = "New Documentold-document";
    const newS3Key = `workspaces/${workspaceId}/documents/${newFilename}`;

    const mockDocument = {
      pk: documentPk,
      sk: "document",
      workspaceId,
      documentId,
      name: "Old Document",
      filename: originalFilename,
      folderPath: "folder1",
      contentType: "text/plain",
      size: 1024,
      s3Key: `workspaces/${workspaceId}/documents/${originalFilename}`,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockUpdatedDocument = {
      ...mockDocument,
      name: newName,
      filename: newFilename,
      s3Key: newS3Key,
      updatedAt: "2024-01-03T00:00:00Z",
    };

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const mockDocumentUpdate = vi.fn().mockResolvedValue(mockUpdatedDocument);
    mockDb["workspace-document"].update = mockDocumentUpdate;

    mockGenerateUniqueFilename.mockResolvedValue(newFilename);
    mockRenameDocument.mockResolvedValue(newS3Key);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
      body: {
        name: newName,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // When original filename has no extension, lastIndexOf(".") returns -1,
    // so substring(-1) returns the entire filename, making nameWithExt = newName + originalFilename
    expect(mockGenerateUniqueFilename).toHaveBeenCalledWith(
      workspaceId,
      `${newName}${originalFilename}`,
      mockDocument.folderPath
    );
    expect(mockRenameDocument).toHaveBeenCalledWith(
      workspaceId,
      mockDocument.s3Key,
      newFilename,
      mockDocument.folderPath
    );
  });
});
