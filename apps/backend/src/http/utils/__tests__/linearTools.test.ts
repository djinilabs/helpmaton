/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as linearClient from "../../../utils/linear/client";
import {
  createLinearListTeamsTool,
  createLinearListProjectsTool,
  createLinearListIssuesTool,
  createLinearGetIssueTool,
  createLinearSearchIssuesTool,
} from "../linearTools";

vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../../utils/linear/client", () => ({
  listTeams: vi.fn(),
  listProjects: vi.fn(),
  listIssues: vi.fn(),
  getIssue: vi.fn(),
  searchIssues: vi.fn(),
}));

describe("Linear Tools", () => {
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

  it("should list teams successfully", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "token-123",
      },
    });

    vi.mocked(linearClient.listTeams).mockResolvedValue({
      nodes: [{ id: "team-1", name: "Platform", key: "PLAT" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    });

    const tool = createLinearListTeamsTool(workspaceId, serverId);
    const result = await (tool as any).execute({});

    expect(linearClient.listTeams).toHaveBeenCalledWith(workspaceId, serverId, {
      first: 50,
      after: undefined,
    });
    expect(result).toContain("Platform");
  });

  it("should return error if Linear is not connected", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {},
    });

    const tool = createLinearListTeamsTool(workspaceId, serverId);
    const result = await (tool as any).execute({});

    expect(result).toContain("Linear is not connected");
    expect(linearClient.listTeams).not.toHaveBeenCalled();
  });

  it("should list projects with pagination", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "token-123",
      },
    });

    vi.mocked(linearClient.listProjects).mockResolvedValue({
      nodes: [{ id: "project-1", name: "Core" }],
      pageInfo: { hasNextPage: false, endCursor: null },
    });

    const tool = createLinearListProjectsTool(workspaceId, serverId);
    const result = await (tool as any).execute({ first: 25 });

    expect(linearClient.listProjects).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      { first: 25, after: undefined }
    );
    expect(result).toContain("Core");
  });

  it("should get issue details", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "token-123",
      },
    });

    vi.mocked(linearClient.getIssue).mockResolvedValue({
      id: "issue-1",
      identifier: "ENG-1",
      title: "Fix bug",
      url: "https://linear.app/issue/ENG-1",
    });

    const tool = createLinearGetIssueTool(workspaceId, serverId);
    const result = await (tool as any).execute({ issueId: "issue-1" });

    expect(linearClient.getIssue).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      "issue-1"
    );
    expect(result).toContain("ENG-1");
  });

  it("should return validation error when issueId is missing", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "token-123",
      },
    });

    const tool = createLinearGetIssueTool(workspaceId, serverId);
    const result = await (tool as any).execute({});

    expect(result).toContain("Invalid tool arguments");
    expect(linearClient.getIssue).not.toHaveBeenCalled();
  });

  it("should search issues", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "token-123",
      },
    });

    vi.mocked(linearClient.searchIssues).mockResolvedValue({
      nodes: [
        {
          id: "issue-2",
          identifier: "ENG-2",
          title: "Search result",
          url: "https://linear.app/issue/ENG-2",
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    });

    const tool = createLinearSearchIssuesTool(workspaceId, serverId);
    const result = await (tool as any).execute({
      query: "Search result",
      teamId: "team-1",
    });

    expect(linearClient.searchIssues).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      expect.objectContaining({
        query: "Search result",
        teamId: "team-1",
      })
    );
    expect(result).toContain("ENG-2");
  });

  it("should list issues with filters", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "token-123",
      },
    });

    vi.mocked(linearClient.listIssues).mockResolvedValue({
      nodes: [
        {
          id: "issue-3",
          identifier: "ENG-3",
          title: "List result",
          url: "https://linear.app/issue/ENG-3",
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    });

    const tool = createLinearListIssuesTool(workspaceId, serverId);
    const result = await (tool as any).execute({
      state: "Todo",
      first: 10,
    });

    expect(linearClient.listIssues).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      expect.objectContaining({
        state: "Todo",
        first: 10,
      })
    );
    expect(result).toContain("ENG-3");
  });
});
