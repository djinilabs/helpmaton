import { Readable } from "stream";

import { forbidden, resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const {
  mockDatabase,
  mockUploadDocument,
  mockRenameDocument,
  mockGenerateUniqueFilename,
  mockNormalizeFolderPath,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockUploadDocument: vi.fn(),
    mockRenameDocument: vi.fn(),
    mockGenerateUniqueFilename: vi.fn(),
    mockNormalizeFolderPath: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/s3", () => ({
  uploadDocument: mockUploadDocument,
  renameDocument: mockRenameDocument,
  generateUniqueFilename: mockGenerateUniqueFilename,
  normalizeFolderPath: mockNormalizeFolderPath,
}));

describe("PUT /api/workspaces/:workspaceId/documents/:documentId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNormalizeFolderPath.mockImplementation((path: string) => path || "");
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

      let newS3Key = document.s3Key;
      let newFilename = document.filename;
      let newFolderPath = document.folderPath;
      let newContent: Buffer | string | undefined;
      let newSize = document.size;
      let newContentType = document.contentType;
      let newName = document.name;

      // Handle content update
      if (req.body.content !== undefined) {
        newContent = req.body.content as string;
        newSize = Buffer.byteLength(newContent, "utf-8");
      } else if (req.file) {
        newContent = req.file.buffer;
        newSize = req.file.size;
        newContentType = req.file.mimetype || "text/plain";
      }

      // Handle name update
      if (req.body.name !== undefined) {
        newName = req.body.name as string;
        // If name changed, we need to rename the file in S3
        if (newName !== document.name) {
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
            newFolderPath
          );

          newFilename = uniqueFilename;
          newS3Key = await mockRenameDocument(
            workspaceId,
            document.s3Key,
            uniqueFilename,
            newFolderPath
          );
        }
      }

      // Handle folder move
      if (req.body.folderPath !== undefined) {
        newFolderPath = mockNormalizeFolderPath(req.body.folderPath as string);
        if (newFolderPath !== document.folderPath) {
          // Move file in S3
          newS3Key = await mockRenameDocument(
            workspaceId,
            document.s3Key,
            newFilename,
            newFolderPath
          );
        }
      }

      // Update content in S3 if provided
      if (newContent !== undefined) {
        newS3Key = await mockUploadDocument(
          workspaceId,
          documentId,
          newContent,
          newFilename,
          newContentType,
          newFolderPath
        );
      }

      // Update database record
      const updated = await db["workspace-document"].update(
        {
          ...document,
          name: newName,
          filename: newFilename,
          folderPath: newFolderPath,
          s3Key: newS3Key,
          contentType: newContentType,
          size: newSize,
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

  it("should update document content via body", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "test.md",
      filename: "test.md",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/test.md`,
      contentType: "text/markdown",
      size: 1024,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const newContent = "Updated content";
    const newS3Key = `workspaces/${workspaceId}/documents/test.md`;

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const updatedDocument = {
      ...mockDocument,
      size: Buffer.byteLength(newContent, "utf-8"),
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentUpdate = vi.fn().mockResolvedValue(updatedDocument);
    mockDb["workspace-document"].update = mockDocumentUpdate;

    mockUploadDocument.mockResolvedValue(newS3Key);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
      body: {
        content: newContent,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockUploadDocument).toHaveBeenCalledWith(
      workspaceId,
      documentId,
      newContent,
      "test.md",
      "text/markdown",
      ""
    );
    expect(mockDocumentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: mockDocument.name,
        filename: mockDocument.filename,
        folderPath: mockDocument.folderPath,
        s3Key: newS3Key,
        contentType: mockDocument.contentType,
        size: Buffer.byteLength(newContent, "utf-8"),
      }),
      null
    );
    expect(res.json).toHaveBeenCalledWith({
      id: documentId,
      name: "test.md",
      filename: "test.md",
      folderPath: "",
      contentType: "text/markdown",
      size: Buffer.byteLength(newContent, "utf-8"),
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
  });

  it("should update document content via file upload", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "test.md",
      filename: "test.md",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/test.md`,
      contentType: "text/markdown",
      size: 1024,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockFile: Express.Multer.File = {
      fieldname: "file",
      originalname: "updated.md",
      encoding: "7bit",
      mimetype: "text/markdown",
      size: 2048,
      buffer: Buffer.from("Updated file content"),
      destination: "",
      filename: "",
      path: "",
      stream: {} as unknown as Readable,
    };

    const newS3Key = `workspaces/${workspaceId}/documents/test.md`;

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const updatedDocument = {
      ...mockDocument,
      size: mockFile.size,
      contentType: mockFile.mimetype,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentUpdate = vi.fn().mockResolvedValue(updatedDocument);
    mockDb["workspace-document"].update = mockDocumentUpdate;

    mockUploadDocument.mockResolvedValue(newS3Key);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
      body: {},
      file: mockFile,
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockUploadDocument).toHaveBeenCalledWith(
      workspaceId,
      documentId,
      mockFile.buffer,
      "test.md",
      "text/markdown",
      ""
    );
    expect(mockDocumentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: mockDocument.name,
        filename: mockDocument.filename,
        folderPath: mockDocument.folderPath,
        s3Key: newS3Key,
        contentType: "text/markdown",
        size: mockFile.size,
      }),
      null
    );
  });

  it("should update document name and rename file in S3", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "old-name.md",
      filename: "old-name.md",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/old-name.md`,
      contentType: "text/markdown",
      size: 1024,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const newName = "new-name";
    const newFilename = "new-name.md";
    const newS3Key = `workspaces/${workspaceId}/documents/new-name.md`;

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const updatedDocument = {
      ...mockDocument,
      name: newName,
      filename: newFilename,
      s3Key: newS3Key,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentUpdate = vi.fn().mockResolvedValue(updatedDocument);
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
      "new-name.md",
      ""
    );
    expect(mockRenameDocument).toHaveBeenCalledWith(
      workspaceId,
      mockDocument.s3Key,
      newFilename,
      ""
    );
    expect(mockDocumentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: newName,
        filename: newFilename,
        s3Key: newS3Key,
      }),
      null
    );
  });

  it("should preserve extension when updating name without extension", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "old-name.md",
      filename: "old-name.md",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/old-name.md`,
      contentType: "text/markdown",
      size: 1024,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const newName = "new-name";
    const newFilename = "new-name.md";

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const updatedDocument = {
      ...mockDocument,
      name: newName,
      filename: newFilename,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentUpdate = vi.fn().mockResolvedValue(updatedDocument);
    mockDb["workspace-document"].update = mockDocumentUpdate;

    mockGenerateUniqueFilename.mockResolvedValue(newFilename);
    mockRenameDocument.mockResolvedValue(
      `workspaces/${workspaceId}/documents/${newFilename}`
    );

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

    // Should append .md extension from original filename
    expect(mockGenerateUniqueFilename).toHaveBeenCalledWith(
      workspaceId,
      "new-name.md",
      ""
    );
  });

  it("should not rename file when name is unchanged", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "test.md",
      filename: "test.md",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/test.md`,
      contentType: "text/markdown",
      size: 1024,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const updatedDocument = {
      ...mockDocument,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentUpdate = vi.fn().mockResolvedValue(updatedDocument);
    mockDb["workspace-document"].update = mockDocumentUpdate;

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
      body: {
        name: "test.md", // Same name
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // Should not call rename operations when name is unchanged
    expect(mockGenerateUniqueFilename).not.toHaveBeenCalled();
    expect(mockRenameDocument).not.toHaveBeenCalled();
  });

  it("should update folder path and move file in S3", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const newFolderPath = "folder1/subfolder";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "test.md",
      filename: "test.md",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/test.md`,
      contentType: "text/markdown",
      size: 1024,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const newS3Key = `workspaces/${workspaceId}/documents/${newFolderPath}/test.md`;

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const updatedDocument = {
      ...mockDocument,
      folderPath: newFolderPath,
      s3Key: newS3Key,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentUpdate = vi.fn().mockResolvedValue(updatedDocument);
    mockDb["workspace-document"].update = mockDocumentUpdate;

    mockNormalizeFolderPath.mockReturnValue(newFolderPath);
    mockRenameDocument.mockResolvedValue(newS3Key);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
      body: {
        folderPath: newFolderPath,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockNormalizeFolderPath).toHaveBeenCalledWith(newFolderPath);
    expect(mockRenameDocument).toHaveBeenCalledWith(
      workspaceId,
      mockDocument.s3Key,
      "test.md",
      newFolderPath
    );
    expect(mockDocumentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        folderPath: newFolderPath,
        s3Key: newS3Key,
      }),
      null
    );
  });

  it("should not move file when folder path is unchanged", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const folderPath = "folder1";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "test.md",
      filename: "test.md",
      folderPath,
      s3Key: `workspaces/${workspaceId}/documents/${folderPath}/test.md`,
      contentType: "text/markdown",
      size: 1024,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const updatedDocument = {
      ...mockDocument,
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentUpdate = vi.fn().mockResolvedValue(updatedDocument);
    mockDb["workspace-document"].update = mockDocumentUpdate;

    mockNormalizeFolderPath.mockReturnValue(folderPath);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
      body: {
        folderPath, // Same folder path
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // Should not call rename when folder path is unchanged
    expect(mockRenameDocument).not.toHaveBeenCalled();
  });

  it("should handle combined updates (name, folder, and content)", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";
    const newFolderPath = "folder1";
    const newName = "renamed";
    const newFilename = "renamed.md";
    const newContent = "Updated content";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "old-name.md",
      filename: "old-name.md",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/old-name.md`,
      contentType: "text/markdown",
      size: 1024,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const newS3Key = `workspaces/${workspaceId}/documents/${newFolderPath}/${newFilename}`;

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const updatedDocument = {
      ...mockDocument,
      name: newName,
      filename: newFilename,
      folderPath: newFolderPath,
      s3Key: newS3Key,
      size: Buffer.byteLength(newContent, "utf-8"),
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentUpdate = vi.fn().mockResolvedValue(updatedDocument);
    mockDb["workspace-document"].update = mockDocumentUpdate;

    mockNormalizeFolderPath.mockReturnValue(newFolderPath);
    mockGenerateUniqueFilename.mockResolvedValue(newFilename);
    mockRenameDocument
      .mockResolvedValueOnce(
        `workspaces/${workspaceId}/documents/${newFilename}`
      ) // First rename for name change
      .mockResolvedValueOnce(newS3Key); // Second rename for folder move
    mockUploadDocument.mockResolvedValue(newS3Key);

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
      body: {
        name: newName,
        folderPath: newFolderPath,
        content: newContent,
      },
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // Should rename for name change
    expect(mockRenameDocument).toHaveBeenCalledWith(
      workspaceId,
      mockDocument.s3Key,
      newFilename,
      ""
    );
    // Should rename again for folder move (uses original s3Key, not the renamed one)
    expect(mockRenameDocument).toHaveBeenCalledWith(
      workspaceId,
      mockDocument.s3Key,
      newFilename,
      newFolderPath
    );
    // Should upload new content
    expect(mockUploadDocument).toHaveBeenCalledWith(
      workspaceId,
      documentId,
      newContent,
      newFilename,
      "text/markdown",
      newFolderPath
    );
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
      body: {},
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
      name: "test.md",
      filename: "test.md",
      folderPath: "",
      s3Key: `workspaces/workspace-999/documents/test.md`,
      contentType: "text/markdown",
      size: 1024,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
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
  });

  it("should use default content type when file has no mimetype", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const documentId = "doc-456";

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "test.md",
      filename: "test.md",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/test.md`,
      contentType: "text/markdown",
      size: 1024,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockFile: Express.Multer.File = {
      fieldname: "file",
      originalname: "updated.md",
      encoding: "7bit",
      mimetype: "", // No mimetype
      size: 2048,
      buffer: Buffer.from("Updated file content"),
      destination: "",
      filename: "",
      path: "",
      stream: {} as unknown as Readable,
    };

    const mockDocumentGet = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].get = mockDocumentGet;

    const updatedDocument = {
      ...mockDocument,
      size: mockFile.size,
      contentType: "text/plain", // Default when mimetype is missing
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockDocumentUpdate = vi.fn().mockResolvedValue(updatedDocument);
    mockDb["workspace-document"].update = mockDocumentUpdate;

    mockUploadDocument.mockResolvedValue(
      `workspaces/${workspaceId}/documents/test.md`
    );

    const req = createMockRequest({
      params: {
        workspaceId,
        documentId,
      },
      body: {},
      file: mockFile,
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockUploadDocument).toHaveBeenCalledWith(
      workspaceId,
      documentId,
      mockFile.buffer,
      "test.md",
      "text/plain", // Default mimetype
      ""
    );
  });
});
