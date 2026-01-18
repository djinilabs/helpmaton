/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as salesforceClient from "../../../utils/salesforce/client";
import {
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

    expect(result).toContain("objectName parameter is required");
    expect(salesforceClient.describeObject).not.toHaveBeenCalled();
  });

  it("should execute SOQL query successfully", async () => {
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
      "SELECT Id FROM Account"
    );
    expect(result).toContain("records");
  });
});
