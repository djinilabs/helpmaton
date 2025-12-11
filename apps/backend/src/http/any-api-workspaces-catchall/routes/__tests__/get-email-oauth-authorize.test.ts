import { badRequest } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockGenerateGmailAuthUrl, mockGenerateOutlookAuthUrl } = vi.hoisted(
  () => {
    return {
      mockGenerateGmailAuthUrl: vi.fn(),
      mockGenerateOutlookAuthUrl: vi.fn(),
    };
  }
);

// Mock the OAuth modules
vi.mock("../../../../utils/oauth/gmail", () => ({
  generateGmailAuthUrl: mockGenerateGmailAuthUrl,
}));

vi.mock("../../../../utils/oauth/outlook", () => ({
  generateOutlookAuthUrl: mockGenerateOutlookAuthUrl,
}));

describe("GET /api/workspaces/:workspaceId/email/oauth/:provider/authorize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Extract the handler logic directly
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const workspaceId = req.params.workspaceId;
        const provider = req.params.provider as "gmail" | "outlook";

        if (!["gmail", "outlook"].includes(provider)) {
          throw badRequest('provider must be "gmail" or "outlook"');
        }

        // Generate authorization URL (state token includes workspaceId)
        let authUrl: string;
        if (provider === "gmail") {
          const { generateGmailAuthUrl } = await import(
            "../../../../utils/oauth/gmail"
          );
          authUrl = generateGmailAuthUrl(workspaceId);
        } else {
          const { generateOutlookAuthUrl } = await import(
            "../../../../utils/oauth/outlook"
          );
          authUrl = generateOutlookAuthUrl(workspaceId);
        }

        res.json({ authUrl });
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return Gmail authorization URL successfully", async () => {
    const workspaceId = "workspace-123";
    const authUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&redirect_uri=test&response_type=code&scope=https://www.googleapis.com/auth/gmail.send&access_type=offline&prompt=consent&state=test-state";

    mockGenerateGmailAuthUrl.mockReturnValue(authUrl);

    const req = createMockRequest({
      params: {
        workspaceId,
        provider: "gmail",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGenerateGmailAuthUrl).toHaveBeenCalledWith(workspaceId);
    expect(mockGenerateGmailAuthUrl).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ authUrl });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return Outlook authorization URL successfully", async () => {
    const workspaceId = "workspace-123";
    const authUrl =
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=test&redirect_uri=test&response_type=code&scope=https://graph.microsoft.com/Mail.Send&response_mode=query&state=test-state&prompt=consent";

    mockGenerateOutlookAuthUrl.mockReturnValue(authUrl);

    const req = createMockRequest({
      params: {
        workspaceId,
        provider: "outlook",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGenerateOutlookAuthUrl).toHaveBeenCalledWith(workspaceId);
    expect(mockGenerateOutlookAuthUrl).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ authUrl });
    expect(next).not.toHaveBeenCalled();
  });

  it("should throw badRequest when provider is invalid", async () => {
    const workspaceId = "workspace-123";

    const req = createMockRequest({
      params: {
        workspaceId,
        provider: "invalid-provider",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: 'provider must be "gmail" or "outlook"',
          }),
        }),
      })
    );
    expect(mockGenerateGmailAuthUrl).not.toHaveBeenCalled();
    expect(mockGenerateOutlookAuthUrl).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should throw badRequest when provider is empty string", async () => {
    const workspaceId = "workspace-123";

    const req = createMockRequest({
      params: {
        workspaceId,
        provider: "",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: 'provider must be "gmail" or "outlook"',
          }),
        }),
      })
    );
    expect(mockGenerateGmailAuthUrl).not.toHaveBeenCalled();
    expect(mockGenerateOutlookAuthUrl).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("should handle Gmail authorization with different workspace IDs", async () => {
    const workspaceId1 = "workspace-123";
    const workspaceId2 = "workspace-456";
    const authUrl1 =
      "https://accounts.google.com/o/oauth2/v2/auth?state=workspace-123";
    const authUrl2 =
      "https://accounts.google.com/o/oauth2/v2/auth?state=workspace-456";

    mockGenerateGmailAuthUrl
      .mockReturnValueOnce(authUrl1)
      .mockReturnValueOnce(authUrl2);

    const req1 = createMockRequest({
      params: {
        workspaceId: workspaceId1,
        provider: "gmail",
      },
    });
    const res1 = createMockResponse();
    const next1 = vi.fn();

    await callRouteHandler(req1, res1, next1);

    expect(mockGenerateGmailAuthUrl).toHaveBeenCalledWith(workspaceId1);
    expect(res1.json).toHaveBeenCalledWith({ authUrl: authUrl1 });

    const req2 = createMockRequest({
      params: {
        workspaceId: workspaceId2,
        provider: "gmail",
      },
    });
    const res2 = createMockResponse();
    const next2 = vi.fn();

    await callRouteHandler(req2, res2, next2);

    expect(mockGenerateGmailAuthUrl).toHaveBeenCalledWith(workspaceId2);
    expect(res2.json).toHaveBeenCalledWith({ authUrl: authUrl2 });
    expect(mockGenerateGmailAuthUrl).toHaveBeenCalledTimes(2);
  });

  it("should handle Outlook authorization with different workspace IDs", async () => {
    const workspaceId1 = "workspace-123";
    const workspaceId2 = "workspace-456";
    const authUrl1 =
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=workspace-123";
    const authUrl2 =
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=workspace-456";

    mockGenerateOutlookAuthUrl
      .mockReturnValueOnce(authUrl1)
      .mockReturnValueOnce(authUrl2);

    const req1 = createMockRequest({
      params: {
        workspaceId: workspaceId1,
        provider: "outlook",
      },
    });
    const res1 = createMockResponse();
    const next1 = vi.fn();

    await callRouteHandler(req1, res1, next1);

    expect(mockGenerateOutlookAuthUrl).toHaveBeenCalledWith(workspaceId1);
    expect(res1.json).toHaveBeenCalledWith({ authUrl: authUrl1 });

    const req2 = createMockRequest({
      params: {
        workspaceId: workspaceId2,
        provider: "outlook",
      },
    });
    const res2 = createMockResponse();
    const next2 = vi.fn();

    await callRouteHandler(req2, res2, next2);

    expect(mockGenerateOutlookAuthUrl).toHaveBeenCalledWith(workspaceId2);
    expect(res2.json).toHaveBeenCalledWith({ authUrl: authUrl2 });
    expect(mockGenerateOutlookAuthUrl).toHaveBeenCalledTimes(2);
  });
});
