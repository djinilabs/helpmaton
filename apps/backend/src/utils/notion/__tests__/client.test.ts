import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  readPage,
  searchPages,
  createPage,
  updatePage,
  queryDatabase,
  createDatabasePage,
  updateDatabasePage,
  getDatabase,
  getDataSource,
  getBlockChildren,
} from "../client";
import * as notionRequest from "../request";

// Mock the shared request utility
vi.mock("../request", () => ({
  makeNotionApiRequest: vi.fn(),
}));

describe("Notion Client", () => {
  const workspaceId = "workspace-1";
  const serverId = "server-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("readPage", () => {
    it("should read a page by ID", async () => {
      const pageId = "page-123";
      const mockPage = {
        object: "page",
        id: pageId,
        properties: {},
        url: "https://notion.so/page-123",
      };

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue(mockPage);

      const result = await readPage(workspaceId, serverId, pageId);

      expect(notionRequest.makeNotionApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining(`/pages/${pageId}`),
        })
      );
      expect(result).toEqual(mockPage);
    });
  });

  describe("searchPages", () => {
    it("should search pages with query", async () => {
      const query = "test query";
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

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await searchPages(workspaceId, serverId, query);

      expect(notionRequest.makeNotionApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining("/search"),
          options: expect.objectContaining({
            method: "POST",
            body: expect.stringContaining(query),
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should search with filter and sort options", async () => {
      const mockResponse = {
        object: "list",
        results: [],
        next_cursor: null,
        has_more: false,
      };

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue(
        mockResponse
      );

      await searchPages(workspaceId, serverId, undefined, {
        filter: { value: "page", property: "object" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 50,
      });

      const callBody = JSON.parse(
        vi.mocked(notionRequest.makeNotionApiRequest).mock.calls[0][0].options
          ?.body as string
      );
      expect(callBody.filter).toEqual({ value: "page", property: "object" });
      expect(callBody.sort).toEqual({
        direction: "descending",
        timestamp: "last_edited_time",
      });
      expect(callBody.page_size).toBe(50);
    });
  });

  describe("createPage", () => {
    it("should create a new page", async () => {
      const parent = { type: "page_id" as const, page_id: "parent-page-123" };
      const properties = {
        Name: {
          title: [{ text: { content: "New Page" } }],
        },
      };
      const mockPage = {
        object: "page",
        id: "new-page-123",
        properties,
        url: "https://notion.so/new-page-123",
      };

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue(mockPage);

      const result = await createPage(workspaceId, serverId, parent, properties);

      expect(notionRequest.makeNotionApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining("/pages"),
          options: expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("New Page"),
          }),
        })
      );
      expect(result).toEqual(mockPage);
    });

    it("should create page with database parent", async () => {
      const parent = {
        type: "database_id" as const,
        database_id: "db-123",
      };
      const properties = {
        Name: {
          title: [{ text: { content: "Database Entry" } }],
        },
      };

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue({
        object: "page",
        id: "page-123",
        properties,
      });

      await createPage(workspaceId, serverId, parent, properties);

      const callBody = JSON.parse(
        vi.mocked(notionRequest.makeNotionApiRequest).mock.calls[0][0].options
          ?.body as string
      );
      expect(callBody.parent).toEqual(parent);
    });
  });

  describe("updatePage", () => {
    it("should update page properties", async () => {
      const pageId = "page-123";
      const properties = {
        Name: {
          title: [{ text: { content: "Updated Title" } }],
        },
      };
      const mockPage = {
        object: "page",
        id: pageId,
        properties,
      };

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue(mockPage);

      const result = await updatePage(
        workspaceId,
        serverId,
        pageId,
        properties
      );

      expect(notionRequest.makeNotionApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining(`/pages/${pageId}`),
          options: expect.objectContaining({
            method: "PATCH",
          }),
        })
      );
      expect(result).toEqual(mockPage);
    });

    it("should archive page when archived is true", async () => {
      const pageId = "page-123";

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue({
        object: "page",
        id: pageId,
        archived: true,
      });

      await updatePage(workspaceId, serverId, pageId, {}, true);

      const callBody = JSON.parse(
        vi.mocked(notionRequest.makeNotionApiRequest).mock.calls[0][0].options
          ?.body as string
      );
      expect(callBody.archived).toBe(true);
    });
  });

  describe("queryDatabase", () => {
    it("should query a database", async () => {
      const databaseId = "db-123";
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

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await queryDatabase(workspaceId, serverId, databaseId);

      expect(notionRequest.makeNotionApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          serverId,
          url: expect.stringContaining(`/databases/${databaseId}/query`),
          options: expect.objectContaining({
            method: "POST",
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should query with filter and sorts", async () => {
      const databaseId = "db-123";
      const filter = {
        property: "Status",
        select: { equals: "Done" },
      };
      const sorts = [
        {
          property: "Created",
          direction: "descending" as const,
        },
      ];

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue({
        object: "list",
        results: [],
        next_cursor: null,
        has_more: false,
      });

      await queryDatabase(workspaceId, serverId, databaseId, {
        filter,
        sorts,
      });

      const callBody = JSON.parse(
        vi.mocked(notionRequest.makeNotionApiRequest).mock.calls[0][0].options
          ?.body as string
      );
      expect(callBody.filter).toEqual(filter);
      expect(callBody.sorts).toEqual(sorts);
    });
  });

  describe("createDatabasePage", () => {
    it("should create a page in a database", async () => {
      const databaseId = "db-123";
      const properties = {
        Name: {
          title: [{ text: { content: "New Entry" } }],
        },
      };

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue({
        object: "page",
        id: "page-123",
        properties,
      });

      await createDatabasePage(workspaceId, serverId, databaseId, properties);

      const callBody = JSON.parse(
        vi.mocked(notionRequest.makeNotionApiRequest).mock.calls[0][0].options
          ?.body as string
      );
      expect(callBody.parent).toEqual({
        type: "database_id",
        database_id: databaseId,
      });
      expect(callBody.properties).toEqual(properties);
    });
  });

  describe("updateDatabasePage", () => {
    it("should update a database page", async () => {
      const pageId = "page-123";
      const properties = {
        Status: {
          select: { name: "In Progress" },
        },
      };

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue({
        object: "page",
        id: pageId,
        properties,
      });

      await updateDatabasePage(workspaceId, serverId, pageId, properties);

      expect(notionRequest.makeNotionApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining(`/pages/${pageId}`),
          options: expect.objectContaining({
            method: "PATCH",
          }),
        })
      );
    });
  });

  describe("getDatabase", () => {
    it("should get database by ID", async () => {
      const databaseId = "db-123";
      const mockDatabase = {
        object: "database",
        id: databaseId,
        title: [],
        properties: {},
      };

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue(
        mockDatabase
      );

      const result = await getDatabase(workspaceId, serverId, databaseId);

      expect(notionRequest.makeNotionApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining(`/databases/${databaseId}`),
        })
      );
      expect(result).toEqual(mockDatabase);
    });
  });

  describe("getDataSource", () => {
    it("should get data source by ID", async () => {
      const dataSourceId = "ds-123";
      const mockDataSource = {
        object: "data_source",
        id: dataSourceId,
        title: [],
        properties: {},
        database_id: "db-123",
      };

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue(
        mockDataSource
      );

      const result = await getDataSource(workspaceId, serverId, dataSourceId);

      expect(notionRequest.makeNotionApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining(`/data_sources/${dataSourceId}`),
        })
      );
      expect(result).toEqual(mockDataSource);
    });
  });

  describe("getBlockChildren", () => {
    it("should get block children", async () => {
      const blockId = "block-123";
      const mockResponse = {
        object: "list",
        results: [
          {
            object: "block",
            id: "child-block-1",
            type: "paragraph",
          },
        ],
        next_cursor: null,
        has_more: false,
      };

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue(
        mockResponse
      );

      const result = await getBlockChildren(workspaceId, serverId, blockId);

      expect(notionRequest.makeNotionApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining(`/blocks/${blockId}/children`),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("should get block children with pagination", async () => {
      const blockId = "block-123";

      vi.mocked(notionRequest.makeNotionApiRequest).mockResolvedValue({
        object: "list",
        results: [],
        next_cursor: "cursor-123",
        has_more: true,
      });

      await getBlockChildren(workspaceId, serverId, blockId, {
        start_cursor: "cursor-123",
        page_size: 50,
      });

      const callUrl = vi.mocked(notionRequest.makeNotionApiRequest).mock
        .calls[0][0].url;
      expect(callUrl).toContain("start_cursor=cursor-123");
      expect(callUrl).toContain("page_size=50");
    });
  });
});
