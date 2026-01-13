import { refreshNotionToken } from "../oauth/mcp/notion";

import { makeNotionApiRequest } from "./request";
import type {
  NotionPage,
  NotionSearchResponse,
  NotionDatabaseQueryResponse,
  NotionBlockChildrenResponse,
  NotionDatabase,
  NotionDataSource,
  NotionParent,
} from "./types";

const NOTION_API_BASE = "https://api.notion.com/v1";

/**
 * Read a page by ID
 */
export async function readPage(
  workspaceId: string,
  serverId: string,
  pageId: string
): Promise<NotionPage> {
  const url = `${NOTION_API_BASE}/pages/${pageId}`;
  return makeNotionApiRequest<NotionPage>({
    workspaceId,
    serverId,
    url,
    refreshTokenFn: refreshNotionToken,
  });
}

/**
 * Search pages and databases
 */
export async function searchPages(
  workspaceId: string,
  serverId: string,
  query?: string,
  options?: {
    filter?: {
      value: "page" | "database" | "data_source";
      property: "object";
    };
    sort?: {
      direction: "ascending" | "descending";
      timestamp: "last_edited_time";
    };
    start_cursor?: string;
    page_size?: number;
  }
): Promise<NotionSearchResponse> {
  const url = `${NOTION_API_BASE}/search`;
  
  const body: {
    query?: string;
    filter?: {
      value: "page" | "database" | "data_source";
      property: "object";
    };
    sort?: {
      direction: "ascending" | "descending";
      timestamp: "last_edited_time";
    };
    start_cursor?: string;
    page_size?: number;
  } = {};

  if (query) {
    body.query = query;
  }
  if (options?.filter) {
    body.filter = options.filter;
  }
  if (options?.sort) {
    body.sort = options.sort;
  }
  if (options?.start_cursor) {
    body.start_cursor = options.start_cursor;
  }
  if (options?.page_size) {
    body.page_size = options.page_size;
  }

  return makeNotionApiRequest<NotionSearchResponse>({
    workspaceId,
    serverId,
    url,
    options: {
      method: "POST",
      body: JSON.stringify(body),
    },
    refreshTokenFn: refreshNotionToken,
  });
}

/**
 * Create a new page
 */
export async function createPage(
  workspaceId: string,
  serverId: string,
  parent: NotionParent,
  properties: Record<string, unknown>,
  children?: Record<string, unknown>[]
): Promise<NotionPage> {
  const url = `${NOTION_API_BASE}/pages`;
  
  const body: {
    parent: NotionParent;
    properties: Record<string, unknown>;
    children?: Record<string, unknown>[];
  } = {
    parent,
    properties,
  };

  // Notion API supports adding children during page creation
  if (children && children.length > 0) {
    body.children = children;
  }
  
  return makeNotionApiRequest<NotionPage>({
    workspaceId,
    serverId,
    url,
    options: {
      method: "POST",
      body: JSON.stringify(body),
    },
    refreshTokenFn: refreshNotionToken,
  });
}

/**
 * Update page properties
 */
export async function updatePage(
  workspaceId: string,
  serverId: string,
  pageId: string,
  properties: Record<string, unknown>,
  archived?: boolean
): Promise<NotionPage> {
  const url = `${NOTION_API_BASE}/pages/${pageId}`;
  
  const body: {
    properties?: Record<string, unknown>;
    archived?: boolean;
  } = {};

  if (properties) {
    body.properties = properties;
  }
  if (archived !== undefined) {
    body.archived = archived;
  }

  return makeNotionApiRequest<NotionPage>({
    workspaceId,
    serverId,
    url,
    options: {
      method: "PATCH",
      body: JSON.stringify(body),
    },
    refreshTokenFn: refreshNotionToken,
  });
}

/**
 * Query a database
 */
export async function queryDatabase(
  workspaceId: string,
  serverId: string,
  databaseId: string,
  options?: {
    filter?: Record<string, unknown>;
    sorts?: Array<{
      property?: string;
      timestamp?: "created_time" | "last_edited_time";
      direction: "ascending" | "descending";
    }>;
    start_cursor?: string;
    page_size?: number;
  }
): Promise<NotionDatabaseQueryResponse> {
  const url = `${NOTION_API_BASE}/databases/${databaseId}/query`;
  
  const body: {
    filter?: Record<string, unknown>;
    sorts?: Array<{
      property?: string;
      timestamp?: "created_time" | "last_edited_time";
      direction: "ascending" | "descending";
    }>;
    start_cursor?: string;
    page_size?: number;
  } = {};

  if (options?.filter) {
    body.filter = options.filter;
  }
  if (options?.sorts) {
    body.sorts = options.sorts;
  }
  if (options?.start_cursor) {
    body.start_cursor = options.start_cursor;
  }
  if (options?.page_size) {
    body.page_size = options.page_size;
  }

  return makeNotionApiRequest<NotionDatabaseQueryResponse>({
    workspaceId,
    serverId,
    url,
    options: {
      method: "POST",
      body: JSON.stringify(body),
    },
    refreshTokenFn: refreshNotionToken,
  });
}

/**
 * Create a page in a database (data source)
 */
export async function createDatabasePage(
  workspaceId: string,
  serverId: string,
  databaseId: string,
  properties: Record<string, unknown>
): Promise<NotionPage> {
  return createPage(workspaceId, serverId, { type: "database_id", database_id: databaseId }, properties);
}

/**
 * Create a page in a data source (new in 2025-09-03)
 */
export async function createDataSourcePage(
  workspaceId: string,
  serverId: string,
  dataSourceId: string,
  properties: Record<string, unknown>
): Promise<NotionPage> {
  return createPage(workspaceId, serverId, { type: "data_source_id", data_source_id: dataSourceId }, properties);
}

/**
 * Update a database page
 */
export async function updateDatabasePage(
  workspaceId: string,
  serverId: string,
  pageId: string,
  properties: Record<string, unknown>
): Promise<NotionPage> {
  return updatePage(workspaceId, serverId, pageId, properties);
}

/**
 * Get database by ID
 */
export async function getDatabase(
  workspaceId: string,
  serverId: string,
  databaseId: string
): Promise<NotionDatabase> {
  const url = `${NOTION_API_BASE}/databases/${databaseId}`;
  return makeNotionApiRequest<NotionDatabase>({
    workspaceId,
    serverId,
    url,
    refreshTokenFn: refreshNotionToken,
  });
}

/**
 * Get data source by ID (new in 2025-09-03)
 */
export async function getDataSource(
  workspaceId: string,
  serverId: string,
  dataSourceId: string
): Promise<NotionDataSource> {
  const url = `${NOTION_API_BASE}/data_sources/${dataSourceId}`;
  return makeNotionApiRequest<NotionDataSource>({
    workspaceId,
    serverId,
    url,
    refreshTokenFn: refreshNotionToken,
  });
}

/**
 * Get block children (content blocks of a page or block)
 */
export async function getBlockChildren(
  workspaceId: string,
  serverId: string,
  blockId: string,
  options?: {
    start_cursor?: string;
    page_size?: number;
  }
): Promise<NotionBlockChildrenResponse> {
  const url = `${NOTION_API_BASE}/blocks/${blockId}/children`;
  
  const params = new URLSearchParams();
  if (options?.start_cursor) {
    params.append("start_cursor", options.start_cursor);
  }
  if (options?.page_size) {
    params.append("page_size", String(options.page_size));
  }

  const urlWithParams = params.toString() ? `${url}?${params.toString()}` : url;

  return makeNotionApiRequest<NotionBlockChildrenResponse>({
    workspaceId,
    serverId,
    url: urlWithParams,
    refreshTokenFn: refreshNotionToken,
  });
}

/**
 * Append block children to a page or block
 */
export async function appendBlockChildren(
  workspaceId: string,
  serverId: string,
  blockId: string,
  children: Record<string, unknown>[],
  after?: string
): Promise<NotionBlockChildrenResponse> {
  const url = `${NOTION_API_BASE}/blocks/${blockId}/children`;
  
  const body: {
    children: Record<string, unknown>[];
    after?: string;
  } = {
    children,
  };

  if (after) {
    body.after = after;
  }

  return makeNotionApiRequest<NotionBlockChildrenResponse>({
    workspaceId,
    serverId,
    url,
    options: {
      method: "PATCH",
      body: JSON.stringify(body),
    },
    refreshTokenFn: refreshNotionToken,
  });
}
