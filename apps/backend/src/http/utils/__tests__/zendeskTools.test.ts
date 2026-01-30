/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as zendeskClient from "../../../utils/zendesk/client";
import {
  createZendeskSearchTicketsTool,
  createZendeskGetTicketDetailsTool,
  createZendeskDraftCommentTool,
  createZendeskSearchHelpCenterTool,
} from "../zendeskTools";

vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../../utils/zendesk/client", () => ({
  searchZendeskTickets: vi.fn(),
  getZendeskTicketComments: vi.fn(),
  draftZendeskTicketComment: vi.fn(),
  searchZendeskHelpCenter: vi.fn(),
}));

describe("Zendesk Tools", () => {
  const workspaceId = "workspace-1";
  const serverId = "server-1";
  const mockDb = {
    "mcp-server": {
      get: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(database).mockResolvedValue(mockDb as any);
  });

  it("should search tickets successfully", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: { accessToken: "token-123", subdomain: "acme" },
    });

    vi.mocked(zendeskClient.searchZendeskTickets).mockResolvedValue({
      results: [{ id: 123, subject: "Need help" }],
    });

    const tool = createZendeskSearchTicketsTool(workspaceId, serverId);
    const result = await (tool as any).execute({ query: "type:ticket status:open" });

    expect(zendeskClient.searchZendeskTickets).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      "type:ticket status:open"
    );
    expect(result).toContain("Need help");
  });

  it("should return validation error when query is missing", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: { accessToken: "token-123", subdomain: "acme" },
    });

    const tool = createZendeskSearchTicketsTool(workspaceId, serverId);
    const result = await (tool as any).execute({});

    expect(result).toContain("Invalid tool arguments");
    expect(zendeskClient.searchZendeskTickets).not.toHaveBeenCalled();
  });

  it("should return error if not connected", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {},
    });

    const tool = createZendeskSearchTicketsTool(workspaceId, serverId);
    const result = await (tool as any).execute({ query: "type:ticket" });

    expect(result).toContain("Zendesk is not connected");
    expect(zendeskClient.searchZendeskTickets).not.toHaveBeenCalled();
  });

  it("should get ticket details successfully", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: { accessToken: "token-123", subdomain: "acme" },
    });

    vi.mocked(zendeskClient.getZendeskTicketComments).mockResolvedValue({
      comments: [{ id: 1, body: "Hello" }],
    });

    const tool = createZendeskGetTicketDetailsTool(workspaceId, serverId);
    const result = await (tool as any).execute({ ticketId: 456 });

    expect(zendeskClient.getZendeskTicketComments).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      "456"
    );
    expect(result).toContain("Hello");
  });

  it("should draft a comment successfully", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: { accessToken: "token-123", subdomain: "acme" },
    });

    vi.mocked(zendeskClient.draftZendeskTicketComment).mockResolvedValue({
      ticket: { id: 456 },
    });

    const tool = createZendeskDraftCommentTool(workspaceId, serverId);
    const result = await (tool as any).execute({
      ticketId: "456",
      body: "Draft reply",
    });

    expect(zendeskClient.draftZendeskTicketComment).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      "456",
      "Draft reply"
    );
    expect(result).toContain("456");
  });

  it("should search help center articles successfully", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: { accessToken: "token-123", subdomain: "acme" },
    });

    vi.mocked(zendeskClient.searchZendeskHelpCenter).mockResolvedValue({
      results: [{ id: 1, title: "FAQ" }],
    });

    const tool = createZendeskSearchHelpCenterTool(workspaceId, serverId);
    const result = await (tool as any).execute({ query: "refund policy" });

    expect(zendeskClient.searchZendeskHelpCenter).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      "refund policy"
    );
    expect(result).toContain("FAQ");
  });
});
