import { describe, it, expect, beforeEach, vi } from "vitest";

import * as intercomClient from "../intercom/client";

// Mock fetch
global.fetch = vi.fn();

vi.mock("../googleApi/oauth", () => ({
  getOAuthTokens: vi.fn().mockResolvedValue({
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
  ensureValidToken: vi.fn().mockResolvedValue("test-access-token"),
}));

vi.mock("../oauth/mcp/intercom", () => ({
  refreshIntercomToken: vi.fn().mockResolvedValue({
    accessToken: "refreshed-token",
    refreshToken: "refreshed-token",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
}));

describe("Intercom API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list contacts", async () => {
    const mockResponse = { data: [] };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockResponse),
      headers: new Headers({ "content-type": "application/json" }),
    } as Partial<Response> as Response);

    const result = await intercomClient.listContacts("workspace-1", "server-1");

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.intercom.io/contacts",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-access-token",
        }),
      })
    );
  });

  it("should search conversations", async () => {
    const mockResponse = { data: [] };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockResponse),
      headers: new Headers({ "content-type": "application/json" }),
    } as Partial<Response> as Response);

    const result = await intercomClient.searchConversations(
      "workspace-1",
      "server-1",
      {
        query: { field: "state", operator: "=", value: "open" },
      }
    );

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.intercom.io/conversations/search",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("should search contacts", async () => {
    const mockResponse = { data: [] };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockResponse),
      headers: new Headers({ "content-type": "application/json" }),
    } as Partial<Response> as Response);

    const result = await intercomClient.searchContacts("workspace-1", "server-1", {
      query: { field: "email", operator: "=", value: "email@projectmap.com" },
    });

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.intercom.io/contacts/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: { field: "email", operator: "=", value: "email@projectmap.com" },
        }),
      })
    );
  });

  it("should reply to a conversation", async () => {
    const mockResponse = { id: "conv-1", type: "conversation" };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockResponse),
      headers: new Headers({ "content-type": "application/json" }),
    } as Partial<Response> as Response);

    const result = await intercomClient.replyConversation(
      "workspace-1",
      "server-1",
      "conv-1",
      {
        type: "admin",
        admin_id: "admin-1",
        message_type: "comment",
        body: "Hello",
      }
    );

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.intercom.io/conversations/conv-1/reply",
      expect.objectContaining({
        method: "POST",
      })
    );
  });
});
