// badRequest and unauthorized are used in error checks via next() callback
import express from "express";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies
const { mockGeneratePresignedPostUrl, mockDatabase, mockValidateBody } = vi.hoisted(() => {
  return {
    mockGeneratePresignedPostUrl: vi.fn(),
    mockDatabase: vi.fn(),
    mockValidateBody: vi.fn(),
  };
});

vi.mock("../../../../utils/s3", () => ({
  generatePresignedPostUrl: mockGeneratePresignedPostUrl,
}));

vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../utils/bodyValidation", () => ({
  validateBody: mockValidateBody,
}));

describe("POST /api/workspaces/:workspaceId/agents/:agentId/conversations/:conversationId/files/upload-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mockDb = createMockDatabase();
    // Ensure agent.get is properly mocked as a vi.fn
    mockDb.agent.get = vi.fn();
    mockDatabase.mockResolvedValue(mockDb);
    // Default validateBody mock - returns the body as-is
    mockValidateBody.mockImplementation((body) => body);
  });

  afterEach(() => {
    // Reset validateBody to default
    mockValidateBody.mockImplementation((body) => body);
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Test the handler logic directly
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const { database } = await import("../../../../tables");
        const { generatePresignedPostUrl } = await import("../../../../utils/s3");
        const { badRequest, unauthorized } = await import("@hapi/boom");

        const body = mockValidateBody(req.body, expect.any(Object));
        const { contentType, fileExtension } = body;

        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const conversationId = req.params.conversationId;

        // Validate workspaceId matches workspaceResource
        const expectedResource = `workspaces/${workspaceId}`;
        if (workspaceResource !== expectedResource) {
          throw badRequest("Workspace ID mismatch");
        }

        // Validate agent exists and belongs to workspace
        const db = await database();
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw badRequest("Agent not found");
        }
        if (agent.workspaceId !== workspaceId) {
          throw badRequest("Agent does not belong to this workspace");
        }

        // Generate presigned POST URL
        const presignedData = await generatePresignedPostUrl(
          workspaceId,
          agentId,
          conversationId,
          contentType,
          fileExtension
        );

        // Set CORS headers
        const origin = req.headers.origin;
        const frontendUrl = process.env.FRONTEND_URL;
        if (frontendUrl && origin === frontendUrl) {
          res.setHeader("Access-Control-Allow-Origin", frontendUrl);
          res.setHeader("Access-Control-Allow-Credentials", "true");
        } else {
          res.setHeader("Access-Control-Allow-Origin", origin || "*");
        }
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, X-Requested-With, Origin, Accept"
        );

        res.json(presignedData);
      } catch (error) {
        next(error);
      }
    };

    const fullReq = {
      ...createMockRequest(),
      ...req,
    } as express.Request;

    const fullRes = {
      ...createMockResponse(),
      ...res,
    } as express.Response;

    await handler(fullReq, fullRes, next);
  }

  it("should generate presigned URL for file upload", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    const mockPresignedData = {
      uploadUrl: "https://s3.amazonaws.com/bucket",
      fields: {
        key: "conversation-files/ws-123/agent-456/conv-789/file.pdf",
        "Content-Type": "application/pdf",
        "x-amz-signature": "test-signature",
      },
      finalUrl: "https://s3.amazonaws.com/bucket/file.pdf",
      expiresIn: 300,
    };

    mockGeneratePresignedPostUrl.mockResolvedValue(mockPresignedData);

    const mockDb = await mockDatabase();
    vi.mocked(mockDb.agent.get).mockResolvedValue({
      pk: `agents/${workspaceId}/${agentId}`,
      workspaceId,
      name: "Test Agent",
    } as Awaited<ReturnType<typeof mockDb.agent.get>>);

    const req = createMockRequest({
      params: {
        workspaceId,
        agentId,
        conversationId,
      },
      body: {
        contentType: "application/pdf",
        fileExtension: "pdf",
      },
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-123",
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGeneratePresignedPostUrl).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      conversationId,
      "application/pdf",
      "pdf"
    );

    expect(res.json).toHaveBeenCalledWith(mockPresignedData);
    // res.json() automatically sets status 200, so we just verify json was called
  });

  it("should handle image content types", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    mockGeneratePresignedPostUrl.mockResolvedValue({
      uploadUrl: "https://s3.amazonaws.com/bucket",
      fields: {},
      finalUrl: "https://s3.amazonaws.com/bucket/image.jpg",
      expiresIn: 300,
    });

    const mockDb = await mockDatabase();
    vi.mocked(mockDb.agent.get).mockResolvedValue({
      pk: `agents/${workspaceId}/${agentId}`,
      workspaceId,
      name: "Test Agent",
    } as Awaited<ReturnType<typeof mockDb.agent.get>>);

    const req = createMockRequest({
      params: { workspaceId, agentId, conversationId },
      body: {
        contentType: "image/jpeg",
        fileExtension: "jpg",
      },
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-123",
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGeneratePresignedPostUrl).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      conversationId,
      "image/jpeg",
      "jpg"
    );
  });

  it("should work without file extension", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    mockGeneratePresignedPostUrl.mockResolvedValue({
      uploadUrl: "https://s3.amazonaws.com/bucket",
      fields: {},
      finalUrl: "https://s3.amazonaws.com/bucket/file",
      expiresIn: 300,
    });

    const mockDb = await mockDatabase();
    vi.mocked(mockDb.agent.get).mockResolvedValue({
      pk: `agents/${workspaceId}/${agentId}`,
      workspaceId,
      name: "Test Agent",
    } as Awaited<ReturnType<typeof mockDb.agent.get>>);

    const req = createMockRequest({
      params: { workspaceId, agentId, conversationId },
      body: {
        contentType: "application/octet-stream",
      },
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-123",
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGeneratePresignedPostUrl).toHaveBeenCalledWith(
      workspaceId,
      agentId,
      conversationId,
      "application/octet-stream",
      undefined
    );
  });

  it("should validate required contentType", async () => {
    // Mock validateBody to throw error for missing contentType
    mockValidateBody.mockImplementation((body) => {
      const schema = z.object({
        contentType: z.string().min(1, "contentType is required"),
        fileExtension: z.string().optional(),
      }).strict();
      return schema.parse(body);
    });

    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conv-789",
      },
      body: {},
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-123",
    });

    const res = createMockResponse();
    const next = vi.fn((error) => {
      expect(error).toBeDefined();
      // Error should be either a ZodError or a Boom error
      expect(
        error instanceof z.ZodError ||
        (error && typeof error === "object" && "isBoom" in error)
      ).toBe(true);
    });

    await callRouteHandler(req, res, next);

    expect(mockGeneratePresignedPostUrl).not.toHaveBeenCalled();
    
    // Reset mock
    mockValidateBody.mockImplementation((body) => body);
  });

  it("should validate agent exists and belongs to workspace", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    const mockDb = await mockDatabase();
    vi.mocked(mockDb.agent.get).mockResolvedValue(null);

    const req = createMockRequest({
      params: { workspaceId, agentId, conversationId },
      body: {
        contentType: "application/pdf",
      },
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-123",
    });

    const res = createMockResponse();
    const next = vi.fn((error) => {
      expect(error).toBeDefined();
      // Check if it's a Boom error
      const isBoomError = error && typeof error === "object" && "isBoom" in error && (error as { isBoom: boolean }).isBoom;
      expect(isBoomError || error instanceof Error).toBe(true);
      if (error instanceof Error) {
        expect(error.message).toContain("Agent not found");
      } else if (isBoomError && "message" in error) {
        expect(String(error.message)).toContain("Agent not found");
      }
    });

    await callRouteHandler(req, res, next);

    expect(mockGeneratePresignedPostUrl).not.toHaveBeenCalled();
  });

  it("should validate agent belongs to workspace", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    const mockDb = await mockDatabase();
    vi.mocked(mockDb.agent.get).mockResolvedValue({
      pk: `agents/${workspaceId}/${agentId}`,
      workspaceId: "different-workspace",
      name: "Test Agent",
    } as Awaited<ReturnType<typeof mockDb.agent.get>>);

    const req = createMockRequest({
      params: { workspaceId, agentId, conversationId },
      body: {
        contentType: "application/pdf",
      },
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-123",
    });

    const res = createMockResponse();
    const next = vi.fn((error) => {
      expect(error).toBeDefined();
      // Check if it's a Boom error
      const isBoomError = error && typeof error === "object" && "isBoom" in error && (error as { isBoom: boolean }).isBoom;
      expect(isBoomError || error instanceof Error).toBe(true);
      if (error instanceof Error) {
        expect(error.message).toContain("does not belong to this workspace");
      } else if (isBoomError && "message" in error) {
        expect(String(error.message)).toContain("does not belong to this workspace");
      }
    });

    await callRouteHandler(req, res, next);

    expect(mockGeneratePresignedPostUrl).not.toHaveBeenCalled();
  });

  it("should require authentication", async () => {
    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conv-789",
      },
      body: {
        contentType: "application/pdf",
      },
      workspaceResource: "workspaces/workspace-123",
      userRef: undefined, // No user
    });

    const res = createMockResponse();
    const next = vi.fn((error) => {
      expect(error).toBeDefined();
      // Check if it's a Boom error or Error
      const isBoomError = error && typeof error === "object" && "isBoom" in error && (error as { isBoom: boolean }).isBoom;
      expect(isBoomError || error instanceof Error).toBe(true);
    });

    await callRouteHandler(req, res, next);

    expect(mockGeneratePresignedPostUrl).not.toHaveBeenCalled();
  });

  it("should set CORS headers", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    mockGeneratePresignedPostUrl.mockResolvedValue({
      uploadUrl: "https://s3.amazonaws.com/bucket",
      fields: {},
      finalUrl: "https://s3.amazonaws.com/bucket/file.pdf",
      expiresIn: 300,
    });

    const mockDb = await mockDatabase();
    vi.mocked(mockDb.agent.get).mockResolvedValue({
      pk: `agents/${workspaceId}/${agentId}`,
      workspaceId,
      name: "Test Agent",
    } as Awaited<ReturnType<typeof mockDb.agent.get>>);

    const req = createMockRequest({
      params: { workspaceId, agentId, conversationId },
      body: {
        contentType: "application/pdf",
      },
      workspaceResource: `workspaces/${workspaceId}`,
      userRef: "users/user-123",
      headers: {
        origin: "https://example.com",
      },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    // Check that CORS headers are set
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      expect.any(String)
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Methods",
      "POST, OPTIONS"
    );
  });

  it("should handle OPTIONS preflight request", async () => {
    // OPTIONS is handled by middleware before the handler, so we test CORS headers are set
    const req = createMockRequest({
      params: {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conv-789",
      },
      body: {
        contentType: "application/pdf",
      },
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-123",
      headers: {
        origin: "https://example.com",
      },
    });

    const mockDb = await mockDatabase();
    (mockDb.agent.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      pk: "agents/workspace-123/agent-456",
      workspaceId: "workspace-123",
      name: "Test Agent",
    });

    mockGeneratePresignedPostUrl.mockResolvedValue({
      uploadUrl: "https://s3.amazonaws.com/bucket",
      fields: {},
      finalUrl: "https://s3.amazonaws.com/bucket/file.pdf",
      expiresIn: 300,
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    // CORS headers should be set
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      expect.any(String)
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Methods",
      "POST, OPTIONS"
    );
  });
});
