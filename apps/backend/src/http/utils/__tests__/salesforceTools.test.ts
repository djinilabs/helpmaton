/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as salesforceClient from "../../../utils/salesforce/client";
import {
  applyQueryLimit,
  createSalesforceListObjectsTool,
  createSalesforceDescribeObjectTool,
  createSalesforceQueryTool,
} from "../salesforceTools";

vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../../utils/salesforce/client", () => ({
  listObjects: vi.fn(),
  describeObject: vi.fn(),
  querySalesforce: vi.fn(),
}));

describe("Salesforce Tools", () => {
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

  describe("applyQueryLimit", () => {
    it("appends LIMIT when SOQL has no LIMIT", () => {
      expect(applyQueryLimit("SELECT Id FROM Account", 100)).toBe(
        "SELECT Id FROM Account LIMIT 100"
      );
    });

    it("caps existing LIMIT to maxRows", () => {
      expect(
        applyQueryLimit("SELECT Id FROM Account LIMIT 5000", 500)
      ).toBe("SELECT Id FROM Account LIMIT 500");
    });

    it("strips trailing semicolon and applies limit", () => {
      expect(applyQueryLimit("SELECT Id FROM Account LIMIT 10;", 100)).toBe(
        "SELECT Id FROM Account LIMIT 10"
      );
    });

    it("when SOQL has LIMIT with trailing semicolon, caps and returns without semicolon", () => {
      expect(
        applyQueryLimit("SELECT Id FROM Account ORDER BY CreatedDate LIMIT 2000;", 100)
      ).toBe("SELECT Id FROM Account ORDER BY CreatedDate LIMIT 100");
    });
  });

  it("should list objects successfully", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "token-123",
        instanceUrl: "https://na1.salesforce.com",
      },
    });

    vi.mocked(salesforceClient.listObjects).mockResolvedValue({
      sobjects: [{ name: "Account" }],
    });

    const tool = createSalesforceListObjectsTool(workspaceId, serverId);
    const result = await (tool as any).execute({});

    expect(salesforceClient.listObjects).toHaveBeenCalledWith(
      workspaceId,
      serverId
    );
    expect(result).toContain("sobjects");
  });

  it("should return error if not connected", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {},
    });

    const tool = createSalesforceListObjectsTool(workspaceId, serverId);
    const result = await (tool as any).execute({});

    expect(result).toContain("Salesforce is not connected");
    expect(salesforceClient.listObjects).not.toHaveBeenCalled();
  });

  it("should return error when objectName is missing", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "token-123",
        instanceUrl: "https://na1.salesforce.com",
      },
    });

    const tool = createSalesforceDescribeObjectTool(workspaceId, serverId);
    const result = await (tool as any).execute({});

    expect(result).toContain("Invalid tool arguments");
    expect(result).toContain("objectName parameter is required");
    expect(salesforceClient.describeObject).not.toHaveBeenCalled();
  });

  it("should execute SOQL query successfully and apply default limit", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "token-123",
        instanceUrl: "https://na1.salesforce.com",
      },
    });

    vi.mocked(salesforceClient.querySalesforce).mockResolvedValue({
      totalSize: 0,
      records: [],
    });

    const tool = createSalesforceQueryTool(workspaceId, serverId);
    const result = await (tool as any).execute({
      query: "SELECT Id FROM Account",
    });

    expect(salesforceClient.querySalesforce).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      "SELECT Id FROM Account LIMIT 100"
    );
    expect(result).toContain("records");
  });

  it("should cap user LIMIT in SOQL to tool limit", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "token-123",
        instanceUrl: "https://na1.salesforce.com",
      },
    });

    vi.mocked(salesforceClient.querySalesforce).mockResolvedValue({
      totalSize: 0,
      records: [],
    });

    const tool = createSalesforceQueryTool(workspaceId, serverId);
    await (tool as any).execute({
      query: "SELECT Id FROM Account LIMIT 5000",
      limit: 500,
    });

    expect(salesforceClient.querySalesforce).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      "SELECT Id FROM Account LIMIT 500"
    );
  });

  it("should return validation error when list_objects limit exceeds max", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "token-123",
        instanceUrl: "https://na1.salesforce.com",
      },
    });

    const tool = createSalesforceListObjectsTool(workspaceId, serverId);
    const result = await (tool as any).execute({ limit: 500 });

    expect(result).toContain("Invalid tool arguments");
    expect(salesforceClient.listObjects).not.toHaveBeenCalled();
  });

  it("should return list_objects with hasMore when sobjects exceed limit", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {
        accessToken: "token-123",
        instanceUrl: "https://na1.salesforce.com",
      },
    });

    const sobjects = Array.from({ length: 150 }, (_, i) => ({ name: `Obj${i}` }));
    vi.mocked(salesforceClient.listObjects).mockResolvedValue({ sobjects });

    const tool = createSalesforceListObjectsTool(workspaceId, serverId);
    const result = await (tool as any).execute({ limit: 100 });

    const parsed = JSON.parse(result);
    expect(parsed.sobjects).toHaveLength(100);
    expect(parsed.hasMore).toBe(true);
  });
});
