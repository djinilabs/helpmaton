/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as notionClient from "../../../utils/notion/client";
import {
  createNotionReadPageTool,
  createNotionSearchTool,
  createNotionCreatePageTool,
  createNotionUpdatePageTool,
  createNotionQueryDatabaseTool,
  createNotionCreateDatabasePageTool,
  createNotionUpdateDatabasePageTool,
} from "../notionTools";

// Mock database
vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

// Mock notion client
vi.mock("../../../utils/notion/client", () => ({
  readPage: vi.fn(),
  searchPages: vi.fn(),
  createPage: vi.fn(),
  updatePage: vi.fn(),
  queryDatabase: vi.fn(),
  createDatabasePage: vi.fn(),
  updateDatabasePage: vi.fn(),
}));

describe("Notion Tools", () => {
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

  describe("createNotionReadPageTool", () => {
    it("should read a page successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockPage: any = {
        object: "page",
        id: "page-123",
        parent: { type: "workspace", workspace: true },
        properties: {},
        url: "https://notion.so/page-123",
        created_time: "2024-01-01T00:00:00.000Z",
        last_edited_time: "2024-01-01T00:00:00.000Z",
      };

      vi.mocked(notionClient.readPage).mockResolvedValue(mockPage);

      const tool = createNotionReadPageTool(workspaceId, serverId);
      const result = await (tool as any).execute({ pageId: "page-123" });

      expect(notionClient.readPage).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "page-123"
      );
      expect(result).toContain("page-123");
    });

    it("should return error if not connected", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {},
      });

      const tool = createNotionReadPageTool(workspaceId, serverId);
      const result = await (tool as any).execute({ pageId: "page-123" });

      expect(result).toContain("Notion is not connected");
      expect(notionClient.readPage).not.toHaveBeenCalled();
    });
  });

  describe("createNotionSearchTool", () => {
    it("should search pages successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockResponse = {
        object: "list",
        results: [
          {
            object: "page",
            id: "page-1",
            properties: {},
          },
        ],
        next_cursor: null,
        has_more: false,
      };

      vi.mocked(notionClient.searchPages).mockResolvedValue(mockResponse as any);

      const tool = createNotionSearchTool(workspaceId, serverId);
      const result = await (tool as any).execute({ query: "test" });

      expect(notionClient.searchPages).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "test",
        expect.any(Object)
      );
      expect(result).toContain("page-1");
    });

    it("should search with filter and sort options", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      vi.mocked(notionClient.searchPages).mockResolvedValue({
        object: "list",
        type: "page_or_database",
        results: [],
        next_cursor: null,
        has_more: false,
        page_or_database: {},
      } as any);

      const tool = createNotionSearchTool(workspaceId, serverId);
      await (tool as any).execute({
        query: "test",
        filter: { value: "page", property: "object" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
      });

      expect(notionClient.searchPages).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "test",
        expect.objectContaining({
          filter: { value: "page", property: "object" },
          sort: { direction: "descending", timestamp: "last_edited_time" },
        })
      );
    });
  });

  describe("createNotionCreatePageTool", () => {
    it("should create a page successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockPage: any = {
        object: "page",
        id: "new-page-123",
        parent: { type: "page_id", page_id: "parent-123" },
        properties: {},
        url: "https://notion.so/new-page-123",
        created_time: "2024-01-01T00:00:00.000Z",
        last_edited_time: "2024-01-01T00:00:00.000Z",
      };

      vi.mocked(notionClient.createPage).mockResolvedValue(mockPage);

      const tool = createNotionCreatePageTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        parent: { type: "page_id", page_id: "parent-123" },
        properties: {
          Name: {
            title: [{ text: { content: "New Page" } }],
          },
        },
      });

      expect(notionClient.createPage).toHaveBeenCalled();
      expect(result).toContain("Page created successfully");
    });

    it("should validate parent structure", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const tool = createNotionCreatePageTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        parent: { type: "page_id" }, // Missing page_id
        properties: {},
      });

      expect(result).toContain("requires the corresponding ID field");
      expect(notionClient.createPage).not.toHaveBeenCalled();
    });

    it("should create a page with simplified 'name' parameter (defaults to workspace)", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockPage: any = {
        object: "page",
        id: "new-page-123",
        parent: { type: "workspace", workspace: true },
        properties: {},
        url: "https://notion.so/new-page-123",
        created_time: "2024-01-01T00:00:00.000Z",
        last_edited_time: "2024-01-01T00:00:00.000Z",
      };

      vi.mocked(notionClient.createPage).mockResolvedValue(mockPage);

      const tool = createNotionCreatePageTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        name: "My New Page",
      });

      expect(notionClient.createPage).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        { type: "workspace", workspace: true },
        {
          title: [
            {
              type: "text",
              text: {
                content: "My New Page",
              },
            },
          ],
        },
        undefined
      );
      expect(result).toContain("Page created successfully");
    });

    it("should create a page with 'name' and 'content' parameters", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockPage: any = {
        object: "page",
        id: "new-page-123",
        parent: { type: "workspace", workspace: true },
        properties: {},
        url: "https://notion.so/new-page-123",
        created_time: "2024-01-01T00:00:00.000Z",
        last_edited_time: "2024-01-01T00:00:00.000Z",
      };

      vi.mocked(notionClient.createPage).mockResolvedValue(mockPage);

      const tool = createNotionCreatePageTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        name: "Helpmaton Haiku",
        content: "Old silent pond...\nA frog jumps into the pond,\nsplash! Silence again.",
      });

      expect(notionClient.createPage).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        { type: "workspace", workspace: true },
        {
          title: [
            {
              type: "text",
              text: {
                content: "Helpmaton Haiku",
              },
            },
          ],
        },
        [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: "Old silent pond...",
                  },
                },
              ],
            },
          },
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: "A frog jumps into the pond,",
                  },
                },
              ],
            },
          },
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: "splash! Silence again.",
                  },
                },
              ],
            },
          },
        ]
      );
      expect(result).toContain("Page created successfully");
    });

    it("should require either 'name' or 'properties'", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const tool = createNotionCreatePageTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        content: "Some content",
      });

      expect(result).toContain("Either 'properties' or 'name' parameter is required");
      expect(notionClient.createPage).not.toHaveBeenCalled();
    });
  });

  describe("createNotionUpdatePageTool", () => {
    it("should update a page successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockPage: any = {
        object: "page",
        id: "page-123",
        parent: { type: "workspace", workspace: true },
        properties: {},
        url: "https://notion.so/page-123",
        created_time: "2024-01-01T00:00:00.000Z",
        last_edited_time: "2024-01-01T00:00:00.000Z",
      };

      vi.mocked(notionClient.updatePage).mockResolvedValue(mockPage);

      const tool = createNotionUpdatePageTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        pageId: "page-123",
        properties: {
          Name: {
            title: [{ text: { content: "Updated" } }],
          },
        },
      });

      expect(notionClient.updatePage).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "page-123",
        expect.any(Object),
        undefined
      );
      expect(result).toContain("Page updated successfully");
    });

    it("should require at least properties or archived", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const tool = createNotionUpdatePageTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        pageId: "page-123",
      });

      expect(result).toContain("At least one of 'properties' or 'archived'");
      expect(notionClient.updatePage).not.toHaveBeenCalled();
    });
  });

  describe("createNotionQueryDatabaseTool", () => {
    it("should query a database successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockResponse = {
        object: "list",
        results: [
          {
            object: "page",
            id: "page-1",
            properties: {},
          },
        ],
        next_cursor: null,
        has_more: false,
      };

      vi.mocked(notionClient.queryDatabase).mockResolvedValue(mockResponse as any);

      const tool = createNotionQueryDatabaseTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        databaseId: "db-123",
      });

      expect(notionClient.queryDatabase).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "db-123",
        expect.any(Object)
      );
      expect(result).toContain("page-1");
    });

    it("should validate databaseId", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const tool = createNotionQueryDatabaseTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        databaseId: "",
      });

      expect(result).toContain("databaseId parameter is required");
      expect(notionClient.queryDatabase).not.toHaveBeenCalled();
    });
  });

  describe("createNotionCreateDatabasePageTool", () => {
    it("should create a database page successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockPage: any = {
        object: "page",
        id: "page-123",
        parent: { type: "workspace", workspace: true },
        properties: {},
        url: "https://notion.so/page-123",
        created_time: "2024-01-01T00:00:00.000Z",
        last_edited_time: "2024-01-01T00:00:00.000Z",
      };

      vi.mocked(notionClient.createDatabasePage).mockResolvedValue(mockPage);

      const tool = createNotionCreateDatabasePageTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        databaseId: "db-123",
        properties: {
          Name: {
            title: [{ text: { content: "New Entry" } }],
          },
        },
      });

      expect(notionClient.createDatabasePage).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "db-123",
        expect.any(Object)
      );
      expect(result).toContain("Database page created successfully");
    });
  });

  describe("createNotionUpdateDatabasePageTool", () => {
    it("should update a database page successfully", async () => {
      mockDb["mcp-server"].get.mockResolvedValue({
        pk: `mcp-servers/${workspaceId}/${serverId}`,
        sk: "server",
        authType: "oauth",
        config: {
          accessToken: "token-123",
        },
      });

      const mockPage: any = {
        object: "page",
        id: "page-123",
        parent: { type: "workspace", workspace: true },
        properties: {},
        url: "https://notion.so/page-123",
        created_time: "2024-01-01T00:00:00.000Z",
        last_edited_time: "2024-01-01T00:00:00.000Z",
      };

      vi.mocked(notionClient.updateDatabasePage).mockResolvedValue(mockPage);

      const tool = createNotionUpdateDatabasePageTool(workspaceId, serverId);
      const result = await (tool as any).execute({
        pageId: "page-123",
        properties: {
          Status: {
            select: { name: "Done" },
          },
        },
      });

      expect(notionClient.updateDatabasePage).toHaveBeenCalledWith(
        workspaceId,
        serverId,
        "page-123",
        expect.any(Object)
      );
      expect(result).toContain("Database page updated successfully");
    });
  });
});
