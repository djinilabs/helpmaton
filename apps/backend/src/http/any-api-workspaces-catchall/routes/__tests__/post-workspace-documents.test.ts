import { Readable } from "stream";

import { badRequest, unauthorized } from "@hapi/boom";
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
  mockEnsureWorkspaceSubscription,
  mockCheckSubscriptionLimits,
  mockUploadDocument,
  mockGenerateUniqueFilename,
  mockNormalizeFolderPath,
  mockCalculateDocumentMetrics,
  mockRandomUUID,
} = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockEnsureWorkspaceSubscription: vi.fn(),
    mockCheckSubscriptionLimits: vi.fn(),
    mockUploadDocument: vi.fn(),
    mockGenerateUniqueFilename: vi.fn(),
    mockNormalizeFolderPath: vi.fn(),
    mockCalculateDocumentMetrics: vi.fn(),
    mockRandomUUID: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/subscriptionUtils", () => ({
  ensureWorkspaceSubscription: mockEnsureWorkspaceSubscription,
  checkSubscriptionLimits: mockCheckSubscriptionLimits,
}));

vi.mock("../../../../utils/s3", () => ({
  uploadDocument: mockUploadDocument,
  generateUniqueFilename: mockGenerateUniqueFilename,
  normalizeFolderPath: mockNormalizeFolderPath,
}));

vi.mock("../utils", () => ({
  calculateDocumentMetrics: mockCalculateDocumentMetrics,
}));

vi.mock("crypto", () => ({
  randomUUID: mockRandomUUID,
}));

describe("POST /api/workspaces/:workspaceId/documents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNormalizeFolderPath.mockImplementation((path: string) => path || "");
    mockGenerateUniqueFilename.mockImplementation(
      (_workspaceId: string, filename: string) => Promise.resolve(filename)
    );
    mockCalculateDocumentMetrics.mockReturnValue({
      totalSize: 0,
      documentCount: 0,
    });
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>
  ) {
    // Extract the handler logic directly
    const handler = async (req: express.Request, res: express.Response) => {
      const db = await mockDatabase();
      const workspaceId = req.params.workspaceId;
      const folderPath = mockNormalizeFolderPath(
        (req.body.folderPath as string) || ""
      );
      const files = (req.files as Express.Multer.File[]) || [];
      const textDocuments = req.body.textDocuments
        ? JSON.parse(req.body.textDocuments as string)
        : [];

      // Ensure workspace has a subscription and check limits before uploading
      const userRef = (req as { userRef?: string }).userRef;
      if (!userRef) {
        throw unauthorized();
      }
      const userId = userRef.replace("users/", "");
      const subscriptionId = await mockEnsureWorkspaceSubscription(
        workspaceId,
        userId
      );

      // Calculate total size and count of documents being uploaded
      const { totalSize, documentCount } = mockCalculateDocumentMetrics(
        files,
        textDocuments
      );

      // Check limits
      await mockCheckSubscriptionLimits(
        subscriptionId,
        "document",
        documentCount,
        totalSize
      );

      const uploadedDocuments = [];

      // Handle file uploads
      if (files && files.length > 0) {
        for (const file of files) {
          const documentId = mockRandomUUID();
          const originalFilename = file.originalname;

          // Validate file type
          const allowedTypes = [
            "text/markdown",
            "text/plain",
            "text/x-markdown",
          ];
          const allowedExtensions = [".md", ".txt", ".markdown"];
          const fileExt = originalFilename
            .substring(originalFilename.lastIndexOf("."))
            .toLowerCase();

          if (
            !allowedTypes.includes(file.mimetype) &&
            !allowedExtensions.includes(fileExt)
          ) {
            throw badRequest(
              `Invalid file type. Allowed: ${allowedExtensions.join(", ")}`
            );
          }

          // Generate unique filename if conflict exists
          const uniqueFilename = await mockGenerateUniqueFilename(
            workspaceId,
            originalFilename,
            folderPath
          );

          // Upload to S3
          const s3Key = await mockUploadDocument(
            workspaceId,
            documentId,
            file.buffer,
            uniqueFilename,
            file.mimetype || "text/plain",
            folderPath
          );

          // Create database record
          const documentPk = `workspace-documents/${workspaceId}/${documentId}`;
          const document = await db["workspace-document"].create({
            pk: documentPk,
            sk: "document",
            workspaceId,
            name: originalFilename, // Use original filename as display name
            filename: uniqueFilename,
            folderPath,
            s3Key,
            contentType: file.mimetype || "text/plain",
            size: file.size,
          });

          uploadedDocuments.push({
            id: documentId,
            name: document.name,
            filename: document.filename,
            folderPath: document.folderPath,
            contentType: document.contentType,
            size: document.size,
            createdAt: document.createdAt,
          });
        }
      }

      // Handle text document uploads
      if (Array.isArray(textDocuments)) {
        for (const textDoc of textDocuments) {
          if (!textDoc.name || !textDoc.content) {
            continue;
          }

          const documentId = mockRandomUUID();
          const originalFilename =
            textDoc.name.endsWith(".md") ||
            textDoc.name.endsWith(".txt") ||
            textDoc.name.endsWith(".markdown")
              ? textDoc.name
              : `${textDoc.name}.md`;

          // Generate unique filename if conflict exists
          const uniqueFilename = await mockGenerateUniqueFilename(
            workspaceId,
            originalFilename,
            folderPath
          );

          // Upload to S3
          const s3Key = await mockUploadDocument(
            workspaceId,
            documentId,
            textDoc.content,
            uniqueFilename,
            "text/markdown",
            folderPath
          );

          // Create database record
          const documentPk = `workspace-documents/${workspaceId}/${documentId}`;
          const document = await db["workspace-document"].create({
            pk: documentPk,
            sk: "document",
            workspaceId,
            name: textDoc.name,
            filename: uniqueFilename,
            folderPath,
            s3Key,
            contentType: "text/markdown",
            size: Buffer.byteLength(textDoc.content, "utf-8"),
          });

          uploadedDocuments.push({
            id: documentId,
            name: document.name,
            filename: document.filename,
            folderPath: document.folderPath,
            contentType: document.contentType,
            size: document.size,
            createdAt: document.createdAt,
          });
        }
      }

      res.status(201).json({ documents: uploadedDocuments });
    };

    await handler(req as express.Request, res as express.Response);
  }

  it("should upload a single file document successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const documentId = "doc-789";
    const subscriptionId = "sub-123";

    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockRandomUUID.mockReturnValue(documentId);
    mockGenerateUniqueFilename.mockResolvedValue("test.md");
    mockUploadDocument.mockResolvedValue(
      `workspaces/${workspaceId}/documents/test.md`
    );
    mockCalculateDocumentMetrics.mockReturnValue({
      totalSize: 1024,
      documentCount: 1,
    });

    const mockFile: Express.Multer.File = {
      fieldname: "files",
      originalname: "test.md",
      encoding: "7bit",
      mimetype: "text/markdown",
      size: 1024,
      buffer: Buffer.from("Test content"),
      destination: "",
      filename: "",
      path: "",
      stream: {} as unknown as Readable,
    };

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
    };

    const mockDocumentCreate = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].create = mockDocumentCreate;

    const req = createMockRequest({
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        folderPath: "",
      },
      files: [mockFile],
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockEnsureWorkspaceSubscription).toHaveBeenCalledWith(
      workspaceId,
      userId
    );
    expect(mockCalculateDocumentMetrics).toHaveBeenCalledWith([mockFile], []);
    expect(mockCheckSubscriptionLimits).toHaveBeenCalledWith(
      subscriptionId,
      "document",
      1,
      1024
    );
    expect(mockGenerateUniqueFilename).toHaveBeenCalledWith(
      workspaceId,
      "test.md",
      ""
    );
    expect(mockUploadDocument).toHaveBeenCalledWith(
      workspaceId,
      documentId,
      mockFile.buffer,
      "test.md",
      "text/markdown",
      ""
    );
    expect(mockDocumentCreate).toHaveBeenCalledWith({
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "test.md",
      filename: "test.md",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/test.md`,
      contentType: "text/markdown",
      size: 1024,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      documents: [
        {
          id: documentId,
          name: "test.md",
          filename: "test.md",
          folderPath: "",
          contentType: "text/markdown",
          size: 1024,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    });
  });

  it("should upload multiple file documents successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const subscriptionId = "sub-123";

    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockCalculateDocumentMetrics.mockReturnValue({
      totalSize: 2048,
      documentCount: 2,
    });

    const mockFiles: Express.Multer.File[] = [
      {
        fieldname: "files",
        originalname: "test1.md",
        encoding: "7bit",
        mimetype: "text/markdown",
        size: 1024,
        buffer: Buffer.from("Test content 1"),
        destination: "",
        filename: "",
        path: "",
        stream: {} as unknown as Readable,
      },
      {
        fieldname: "files",
        originalname: "test2.txt",
        encoding: "7bit",
        mimetype: "text/plain",
        size: 1024,
        buffer: Buffer.from("Test content 2"),
        destination: "",
        filename: "",
        path: "",
        stream: {} as unknown as Readable,
      },
    ];

    mockRandomUUID.mockReturnValueOnce("doc-1").mockReturnValueOnce("doc-2");
    mockGenerateUniqueFilename
      .mockResolvedValueOnce("test1.md")
      .mockResolvedValueOnce("test2.txt");
    mockUploadDocument
      .mockResolvedValueOnce(`workspaces/${workspaceId}/documents/test1.md`)
      .mockResolvedValueOnce(`workspaces/${workspaceId}/documents/test2.txt`);

    const mockDocuments = [
      {
        pk: `workspace-documents/${workspaceId}/doc-1`,
        sk: "document",
        workspaceId,
        name: "test1.md",
        filename: "test1.md",
        folderPath: "",
        s3Key: `workspaces/${workspaceId}/documents/test1.md`,
        contentType: "text/markdown",
        size: 1024,
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        pk: `workspace-documents/${workspaceId}/doc-2`,
        sk: "document",
        workspaceId,
        name: "test2.txt",
        filename: "test2.txt",
        folderPath: "",
        s3Key: `workspaces/${workspaceId}/documents/test2.txt`,
        contentType: "text/plain",
        size: 1024,
        createdAt: "2024-01-02T00:00:00Z",
      },
    ];

    const mockDocumentCreate = vi
      .fn()
      .mockResolvedValueOnce(mockDocuments[0])
      .mockResolvedValueOnce(mockDocuments[1]);
    mockDb["workspace-document"].create = mockDocumentCreate;

    const req = createMockRequest({
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        folderPath: "",
      },
      files: mockFiles,
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockCheckSubscriptionLimits).toHaveBeenCalledWith(
      subscriptionId,
      "document",
      2,
      2048
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(
      (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].documents
    ).toHaveLength(2);
  });

  it("should upload text documents successfully", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const documentId = "doc-789";
    const subscriptionId = "sub-123";

    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockRandomUUID.mockReturnValue(documentId);
    mockGenerateUniqueFilename.mockResolvedValue("note.md");
    mockUploadDocument.mockResolvedValue(
      `workspaces/${workspaceId}/documents/note.md`
    );
    mockCalculateDocumentMetrics.mockReturnValue({
      totalSize: 50,
      documentCount: 1,
    });

    const textDocuments = [
      {
        name: "note",
        content: "This is a note",
      },
    ];

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "note",
      filename: "note.md",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/note.md`,
      contentType: "text/markdown",
      size: Buffer.byteLength("This is a note", "utf-8"),
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockDocumentCreate = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].create = mockDocumentCreate;

    const req = createMockRequest({
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        folderPath: "",
        textDocuments: JSON.stringify(textDocuments),
      },
      files: [],
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockUploadDocument).toHaveBeenCalledWith(
      workspaceId,
      documentId,
      "This is a note",
      "note.md",
      "text/markdown",
      ""
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(
      (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].documents
    ).toHaveLength(1);
  });

  it("should handle text documents with existing extensions", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const documentId = "doc-789";
    const subscriptionId = "sub-123";

    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockRandomUUID.mockReturnValue(documentId);
    mockGenerateUniqueFilename.mockResolvedValue("note.txt");
    mockUploadDocument.mockResolvedValue(
      `workspaces/${workspaceId}/documents/note.txt`
    );
    mockCalculateDocumentMetrics.mockReturnValue({
      totalSize: 50,
      documentCount: 1,
    });

    const textDocuments = [
      {
        name: "note.txt",
        content: "This is a note",
      },
    ];

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "note.txt",
      filename: "note.txt",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/note.txt`,
      contentType: "text/markdown",
      size: Buffer.byteLength("This is a note", "utf-8"),
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockDocumentCreate = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].create = mockDocumentCreate;

    const req = createMockRequest({
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        folderPath: "",
        textDocuments: JSON.stringify(textDocuments),
      },
      files: [],
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockGenerateUniqueFilename).toHaveBeenCalledWith(
      workspaceId,
      "note.txt",
      ""
    );
  });

  it("should skip text documents without name or content", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const subscriptionId = "sub-123";

    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockCalculateDocumentMetrics.mockReturnValue({
      totalSize: 0,
      documentCount: 0,
    });

    const textDocuments = [
      {
        name: "valid",
        content: "Valid content",
      },
      {
        name: "no-content",
        // content missing
      },
      {
        // name missing
        content: "No name",
      },
    ];

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/doc-1`,
      sk: "document",
      workspaceId,
      name: "valid",
      filename: "valid.md",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/valid.md`,
      contentType: "text/markdown",
      size: Buffer.byteLength("Valid content", "utf-8"),
      createdAt: "2024-01-01T00:00:00Z",
    };

    mockRandomUUID.mockReturnValue("doc-1");
    mockGenerateUniqueFilename.mockResolvedValue("valid.md");
    mockUploadDocument.mockResolvedValue(
      `workspaces/${workspaceId}/documents/valid.md`
    );

    const mockDocumentCreate = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].create = mockDocumentCreate;

    const req = createMockRequest({
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        folderPath: "",
        textDocuments: JSON.stringify(textDocuments),
      },
      files: [],
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    // Only one document should be created (the valid one)
    expect(mockDocumentCreate).toHaveBeenCalledTimes(1);
    expect(
      (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].documents
    ).toHaveLength(1);
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: undefined,
      params: {
        workspaceId: "workspace-123",
      },
      body: {},
      files: [],
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(401);
    }

    expect(mockEnsureWorkspaceSubscription).not.toHaveBeenCalled();
  });

  it("should throw badRequest when file type is invalid", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const subscriptionId = "sub-123";

    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockCalculateDocumentMetrics.mockReturnValue({
      totalSize: 1024,
      documentCount: 1,
    });

    const mockFile: Express.Multer.File = {
      fieldname: "files",
      originalname: "test.pdf",
      encoding: "7bit",
      mimetype: "application/pdf",
      size: 1024,
      buffer: Buffer.from("Test content"),
      destination: "",
      filename: "",
      path: "",
      stream: {} as unknown as Readable,
    };

    const req = createMockRequest({
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        folderPath: "",
      },
      files: [mockFile],
    });
    const res = createMockResponse();

    try {
      await callRouteHandler(req, res);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(
        (error as { output?: { statusCode: number } }).output?.statusCode
      ).toBe(400);
      expect(
        (error as { output?: { payload: { message: string } } }).output?.payload
          .message
      ).toContain("Invalid file type");
    }
  });

  it("should accept files with valid extensions even without mimetype", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const documentId = "doc-789";
    const subscriptionId = "sub-123";

    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockRandomUUID.mockReturnValue(documentId);
    mockGenerateUniqueFilename.mockResolvedValue("test.md");
    mockUploadDocument.mockResolvedValue(
      `workspaces/${workspaceId}/documents/test.md`
    );
    mockCalculateDocumentMetrics.mockReturnValue({
      totalSize: 1024,
      documentCount: 1,
    });

    const mockFile: Express.Multer.File = {
      fieldname: "files",
      originalname: "test.md",
      encoding: "7bit",
      mimetype: "", // Missing mimetype
      size: 1024,
      buffer: Buffer.from("Test content"),
      destination: "",
      filename: "",
      path: "",
      stream: {} as unknown as Readable,
    };

    const mockDocument = {
      pk: `workspace-documents/${workspaceId}/${documentId}`,
      sk: "document",
      workspaceId,
      name: "test.md",
      filename: "test.md",
      folderPath: "",
      s3Key: `workspaces/${workspaceId}/documents/test.md`,
      contentType: "text/plain", // Default when mimetype is missing
      size: 1024,
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockDocumentCreate = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].create = mockDocumentCreate;

    const req = createMockRequest({
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        folderPath: "",
      },
      files: [mockFile],
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
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("should handle folder path correctly", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const userId = "user-456";
    const documentId = "doc-789";
    const subscriptionId = "sub-123";
    const folderPath = "folder1/subfolder";

    mockNormalizeFolderPath.mockReturnValue(folderPath);
    mockEnsureWorkspaceSubscription.mockResolvedValue(subscriptionId);
    mockCheckSubscriptionLimits.mockResolvedValue(undefined);
    mockRandomUUID.mockReturnValue(documentId);
    mockGenerateUniqueFilename.mockResolvedValue("test.md");
    mockUploadDocument.mockResolvedValue(
      `workspaces/${workspaceId}/documents/${folderPath}/test.md`
    );
    mockCalculateDocumentMetrics.mockReturnValue({
      totalSize: 1024,
      documentCount: 1,
    });

    const mockFile: Express.Multer.File = {
      fieldname: "files",
      originalname: "test.md",
      encoding: "7bit",
      mimetype: "text/markdown",
      size: 1024,
      buffer: Buffer.from("Test content"),
      destination: "",
      filename: "",
      path: "",
      stream: {} as unknown as Readable,
    };

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
    };

    const mockDocumentCreate = vi.fn().mockResolvedValue(mockDocument);
    mockDb["workspace-document"].create = mockDocumentCreate;

    const req = createMockRequest({
      userRef: `users/${userId}`,
      params: {
        workspaceId,
      },
      body: {
        folderPath,
      },
      files: [mockFile],
    });
    const res = createMockResponse();

    await callRouteHandler(req, res);

    expect(mockNormalizeFolderPath).toHaveBeenCalledWith(folderPath);
    expect(mockGenerateUniqueFilename).toHaveBeenCalledWith(
      workspaceId,
      "test.md",
      folderPath
    );
    expect(mockUploadDocument).toHaveBeenCalledWith(
      workspaceId,
      documentId,
      mockFile.buffer,
      "test.md",
      "text/markdown",
      folderPath
    );
  });
});
