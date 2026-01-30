/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { database } from "../../../tables";
import { ensureValidToken, getOAuthTokens } from "../../googleApi/oauth";
import { searchProductsByTitle } from "../client";

vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../googleApi/oauth", () => ({
  ensureValidToken: vi.fn(),
  getOAuthTokens: vi.fn(),
}));

vi.mock("../../oauth/mcp/shopify", () => ({
  refreshShopifyToken: vi.fn(),
}));

describe("shopify client", () => {
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
    vi.mocked(getOAuthTokens).mockResolvedValue({ accessToken: "token-123" } as any);
    vi.mocked(ensureValidToken).mockResolvedValue("access-token");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        data: {
          products: {
            nodes: [
              {
                id: "gid://shopify/Product/1",
                title: "Hoodie",
                handle: "hoodie",
                status: "ACTIVE",
                publishedAt: "2024-01-02T00:00:00Z",
              },
            ],
          },
        },
      }),
    } as any);
  });

  it("builds a safe GraphQL search query and returns normalized products", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      serviceType: "shopify",
      config: { shopDomain: "cool-store.myshopify.com" },
    });

    const result = await searchProductsByTitle(
      workspaceId,
      serverId,
      'title:(Hoodie) OR "Injected"'
    );

    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    const payload = JSON.parse(String(requestInit?.body ?? "{}"));
    const queryString = payload.variables?.query as string;

    expect(queryString).toContain("status:active");
    expect(queryString).toContain("published_status:published");
    expect(queryString).toContain('title:"title Hoodie OR \\"Injected\\""');
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.handle).toBe("hoodie");
  });
});
