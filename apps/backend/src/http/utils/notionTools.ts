import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as notionClient from "../../utils/notion/client";
import type { NotionParent } from "../../utils/notion/types";

import { validateToolArgs } from "./toolValidation";

/**
 * Check if MCP server has OAuth connection
 */
async function hasOAuthConnection(
  workspaceId: string,
  serverId: string
): Promise<boolean> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server || server.authType !== "oauth") {
    return false;
  }

  const config = server.config as {
    accessToken?: string;
  };

  return !!config.accessToken;
}

/**
 * Create Notion read page tool
 */
export function createNotionReadPageTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      pageId: z
        .string()
        .min(1, "pageId is required")
        .describe("The Notion page ID to read"),
    })
    .strict();

  return tool({
    description:
      "Read a Notion page by its ID. Returns the full page content including properties, metadata, and URL.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Notion is not connected. Please connect your Notion account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const page = await notionClient.readPage(
          workspaceId,
          serverId,
          parsed.data.pageId
        );

        return JSON.stringify(
          {
            page,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Notion read page tool:", error);
        return `Error reading Notion page: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Notion search tool
 */
export function createNotionSearchTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      query: z
        .string()
        .optional()
        .describe(
          "Search query string (optional, empty query returns all accessible pages/databases)"
        ),
      filter: z
        .object({
          value: z.enum(["page", "database", "data_source"]),
          property: z.literal("object"),
        })
        .optional()
        .describe("Filter results by object type"),
      sort: z
        .object({
          direction: z.enum(["ascending", "descending"]),
          timestamp: z.literal("last_edited_time"),
        })
        .optional()
        .describe("Sort results by last edited time"),
      startCursor: z
        .string()
        .optional()
        .describe("Pagination cursor from previous search response"),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .describe("Maximum number of results to return (default: 50, max: 100)"),
    })
    .strict();

  return tool({
    description:
      "Search for pages, databases, and data sources in Notion. Returns a list of matching results with their metadata.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Notion is not connected. Please connect your Notion account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await notionClient.searchPages(
          workspaceId,
          serverId,
          parsed.data.query,
          {
            filter: parsed.data.filter,
            sort: parsed.data.sort,
            start_cursor: parsed.data.startCursor,
            page_size: parsed.data.pageSize,
          }
        );

        return JSON.stringify(
          {
            results: result.results,
            nextCursor: result.next_cursor,
            hasMore: result.has_more,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Notion search tool:", error);
        return `Error searching Notion: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Notion create page tool
 */
export function createNotionCreatePageTool(
  workspaceId: string,
  serverId: string
) {
  const parentSchema = z
    .object({
      type: z.enum([
        "page_id",
        "database_id",
        "data_source_id",
        "workspace",
        "block_id",
      ]),
      page_id: z.string().optional(),
      database_id: z.string().optional(),
      data_source_id: z.string().optional(),
      workspace: z.boolean().optional(),
      block_id: z.string().optional(),
    })
    .strict();

  const schema = z
    .object({
      // Simplified parameters (for convenience)
      name: z
        .string()
        .optional()
        .describe(
          "Optional: Page title/name. If provided, will be used as the page title. If 'properties' is also provided, 'name' will be ignored."
        ),
      content: z
        .string()
        .optional()
        .describe(
          "Optional: Simple text content for the page. If provided, will be converted to paragraph blocks. If 'children' is also provided, 'content' will be ignored."
        ),
      // Full API parameters
      parent: parentSchema
        .optional()
        .describe(
          "Optional: Parent reference. If not provided, defaults to workspace level. Format depends on type: For 'workspace': { type: 'workspace', workspace: true } (no ID needed). For 'page_id': { type: 'page_id', page_id: 'page-uuid' }. For 'database_id': { type: 'database_id', database_id: 'database-uuid' }. For 'data_source_id': { type: 'data_source_id', data_source_id: 'datasource-uuid' }. For 'block_id': { type: 'block_id', block_id: 'block-uuid' }."
        ),
      properties: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Optional: Page properties object. If not provided but 'name' is provided, will create a title property. For database/data source pages, properties must match the schema."
        ),
      children: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe(
          "Optional: Array of block objects to add as content to the page. Each block should have 'object': 'block', 'type', and the corresponding type-specific properties (e.g., 'paragraph' with 'text' array). If 'content' is provided as a string, it will be converted to paragraph blocks."
        ),
    })
    .strict();

  return tool({
    description:
      "Create a new page in Notion. Supports simplified parameters: use 'name' for the page title and 'content' (string) for text content. The page will be created at workspace level by default. For advanced use, you can specify 'parent' (page, database, data source, or workspace), 'properties' (full Notion properties object), and 'children' (array of block objects). If 'parent' is not provided, defaults to workspace level. If 'name' is provided without 'properties', it will be used as the title. If 'content' is provided as a string without 'children', it will be converted to paragraph blocks (split by newlines). Example (simple): {\"name\":\"Weekly Update\",\"content\":\"Line one\\nLine two\"}. Example (blocks): {\"parent\":{\"type\":\"page_id\",\"page_id\":\"PAGE_ID\"},\"properties\":{\"title\":[{\"type\":\"text\",\"text\":{\"content\":\"Status\"}}]},\"children\":[{\"object\":\"block\",\"type\":\"paragraph\",\"paragraph\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"Hello\"}}]}}]}",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Notion is not connected. Please connect your Notion account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        // Build parent object - default to workspace if not provided
        let parent: NotionParent;

        if (parsed.data.parent && parsed.data.parent.type) {
          // Use provided parent
          if (parsed.data.parent.type === "page_id" && parsed.data.parent.page_id) {
            parent = { type: "page_id", page_id: parsed.data.parent.page_id };
          } else if (
            parsed.data.parent.type === "database_id" &&
            parsed.data.parent.database_id
          ) {
            parent = {
              type: "database_id",
              database_id: parsed.data.parent.database_id,
            };
          } else if (
            parsed.data.parent.type === "data_source_id" &&
            parsed.data.parent.data_source_id
          ) {
            parent = {
              type: "data_source_id",
              data_source_id: parsed.data.parent.data_source_id,
            };
          } else if (parsed.data.parent.type === "workspace") {
            parent = { type: "workspace", workspace: true };
          } else if (
            parsed.data.parent.type === "block_id" &&
            parsed.data.parent.block_id
          ) {
            parent = { type: "block_id", block_id: parsed.data.parent.block_id };
          } else {
            return `Error: Parent type '${parsed.data.parent.type}' requires the corresponding ID field.`;
          }
        } else {
          // Default to workspace level
          parent = { type: "workspace", workspace: true };
        }

        // Build properties - use 'name' if provided and properties not provided
        let properties: Record<string, unknown>;

        if (parsed.data.properties && typeof parsed.data.properties === "object") {
          properties = parsed.data.properties;
        } else if (parsed.data.name && typeof parsed.data.name === "string") {
          // Convert 'name' to title property
          properties = {
            title: [
              {
                type: "text",
                text: {
                  content: parsed.data.name,
                },
              },
            ],
          };
        } else {
          return "Error: Either 'properties' or 'name' parameter is required.";
        }

        // Build children - use 'content' if provided and children not provided
        let children: Record<string, unknown>[] | undefined;

        if (parsed.data.children && Array.isArray(parsed.data.children)) {
          children = parsed.data.children;
        } else if (parsed.data.content && typeof parsed.data.content === "string") {
          // Convert 'content' string to paragraph blocks
          // Split by newlines to create separate paragraphs
          const lines = parsed.data.content
            .split("\n")
            .filter((line: string) => line.trim().length > 0);
          children = lines.map((line: string) => ({
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: {
                    content: line.trim(),
                  },
                },
              ],
            },
          }));
        }

        const page = await notionClient.createPage(
          workspaceId,
          serverId,
          parent,
          properties,
          children
        );

        return JSON.stringify(
          {
            page,
            message: "Page created successfully",
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Notion create page tool:", error);
        return `Error creating Notion page: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Notion update page tool
 */
export function createNotionUpdatePageTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      pageId: z
        .string()
        .min(1, "pageId is required")
        .describe("REQUIRED: The Notion page ID to update"),
      properties: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Properties to update (optional, only include fields to change)"),
      archived: z
        .boolean()
        .optional()
        .describe("Set to true to archive the page"),
    })
    .strict();

  return tool({
    description:
      "Update a Notion page's properties. Only provide the properties that should be updated. Use notion_search or notion_query_database to find the pageId. Example: {\"pageId\":\"PAGE_ID\",\"properties\":{\"Status\":{\"select\":{\"name\":\"In Progress\"}}}}",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Notion is not connected. Please connect your Notion account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        // At least one of properties or archived must be provided
        if (!parsed.data.properties && parsed.data.archived === undefined) {
          return "Error: At least one of 'properties' or 'archived' must be provided.";
        }

        const page = await notionClient.updatePage(
          workspaceId,
          serverId,
          parsed.data.pageId,
          parsed.data.properties || {},
          parsed.data.archived
        );

        return JSON.stringify(
          {
            page,
            message: "Page updated successfully",
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Notion update page tool:", error);
        return `Error updating Notion page: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Notion query database tool
 */
export function createNotionQueryDatabaseTool(
  workspaceId: string,
  serverId: string
) {
  const sortSchema = z
    .object({
      property: z.string().optional(),
      timestamp: z.enum(["created_time", "last_edited_time"]).optional(),
      direction: z.enum(["ascending", "descending"]),
    })
    .strict();

  const schema = z
    .object({
      databaseId: z
        .string()
        .min(1, "databaseId is required")
        .describe("REQUIRED: The Notion database ID to query"),
      filter: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Filter object to match pages (optional)"),
      sorts: z
        .array(sortSchema)
        .optional()
        .describe("Array of sort objects (optional)"),
      startCursor: z
        .string()
        .optional()
        .describe("Pagination cursor from previous query response"),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .describe("Maximum number of results to return (default: 50, max: 100)"),
    })
    .strict();

  return tool({
    description:
      "Query a Notion database to retrieve pages that match the specified filters and sorts. Example: {\"databaseId\":\"DB_ID\",\"filter\":{\"property\":\"Status\",\"select\":{\"equals\":\"Done\"}},\"sorts\":[{\"property\":\"Created\",\"direction\":\"descending\"}]}",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Notion is not connected. Please connect your Notion account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await notionClient.queryDatabase(
          workspaceId,
          serverId,
          parsed.data.databaseId,
          {
            filter: parsed.data.filter,
            sorts: parsed.data.sorts,
            start_cursor: parsed.data.startCursor,
            page_size: parsed.data.pageSize,
          }
        );

        return JSON.stringify(
          {
            results: result.results,
            nextCursor: result.next_cursor,
            hasMore: result.has_more,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Notion query database tool:", error);
        return `Error querying Notion database: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Notion create database page tool
 */
export function createNotionCreateDatabasePageTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      databaseId: z
        .string()
        .min(1, "databaseId is required")
        .describe("REQUIRED: The Notion database ID"),
      properties: z
        .record(z.string(), z.unknown())
        .describe(
          "REQUIRED: Page properties object that matches the database schema"
        ),
    })
    .strict();

  return tool({
    description:
      "Create a new page in a Notion database. Properties must match the database schema. Example: {\"databaseId\":\"DB_ID\",\"properties\":{\"Name\":{\"title\":[{\"text\":{\"content\":\"New Item\"}}]}}}",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Notion is not connected. Please connect your Notion account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const page = await notionClient.createDatabasePage(
          workspaceId,
          serverId,
          parsed.data.databaseId,
          parsed.data.properties
        );

        return JSON.stringify(
          {
            page,
            message: "Database page created successfully",
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Notion create database page tool:", error);
        return `Error creating Notion database page: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Notion update database page tool
 */
export function createNotionUpdateDatabasePageTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      pageId: z
        .string()
        .min(1, "pageId is required")
        .describe("REQUIRED: The Notion page ID to update"),
      properties: z
        .record(z.string(), z.unknown())
        .describe("Properties to update (must match database schema)"),
    })
    .strict();

  return tool({
    description:
      "Update a page in a Notion database. Only provide the properties that should be updated. Example: {\"pageId\":\"PAGE_ID\",\"properties\":{\"Priority\":{\"select\":{\"name\":\"High\"}}}}",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Notion is not connected. Please connect your Notion account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const page = await notionClient.updateDatabasePage(
          workspaceId,
          serverId,
          parsed.data.pageId,
          parsed.data.properties
        );

        return JSON.stringify(
          {
            page,
            message: "Database page updated successfully",
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Notion update database page tool:", error);
        return `Error updating Notion database page: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

/**
 * Create Notion append blocks tool
 */
export function createNotionAppendBlocksTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
      pageId: z
        .string()
        .min(1, "pageId is required")
        .describe("REQUIRED: The Notion page ID to append blocks to"),
      children: z
        .array(z.record(z.string(), z.unknown()))
        .min(1, "At least one block is required")
        .max(100, "Maximum 100 blocks per request")
        .describe(
          "REQUIRED: Array of block objects to append. Each block should have 'object': 'block', 'type' (e.g., 'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'code'), and type-specific properties. For paragraphs, use 'paragraph' type with 'text' array containing text objects with 'type': 'text' and 'text': { 'content': 'your text' }."
        ),
      after: z
        .string()
        .optional()
        .describe(
          "Optional block ID to insert blocks after. If not provided, blocks are appended at the end."
        ),
    })
    .strict();

  return tool({
    description:
      "Append content blocks (paragraphs, headings, lists, etc.) to an existing Notion page. Use this to add text, headings, lists, and other content to a page after it's been created. Example: {\"pageId\":\"PAGE_ID\",\"children\":[{\"object\":\"block\",\"type\":\"heading_2\",\"heading_2\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"Section\"}}]}},{\"object\":\"block\",\"type\":\"paragraph\",\"paragraph\":{\"rich_text\":[{\"type\":\"text\",\"text\":{\"content\":\"Details...\"}}]}}]}",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        // Check OAuth connection
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Notion is not connected. Please connect your Notion account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await notionClient.appendBlockChildren(
          workspaceId,
          serverId,
          parsed.data.pageId,
          parsed.data.children,
          parsed.data.after
        );

        return JSON.stringify(
          {
            blocks: result.results,
            hasMore: result.has_more,
            nextCursor: result.next_cursor,
            message: `Successfully appended ${result.results.length} block(s) to page`,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Notion append blocks tool:", error);
        return `Error appending blocks to Notion page: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
