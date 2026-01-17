import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../tables";
import { getPosthogJson } from "../posthog/client";

global.fetch = vi.fn();

vi.mock("../../tables", () => ({
  database: vi.fn(),
}));

describe("PostHog API Client", () => {
  const workspaceId = "workspace-1";
  const serverId = "server-1";
  type MockDb = {
    "mcp-server": {
      get: ReturnType<typeof vi.fn>;
    };
  };
  const mockDb = {
    "mcp-server": {
      get: vi.fn(),
    },
  } satisfies MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(database).mockResolvedValue(
      mockDb as unknown as Awaited<ReturnType<typeof database>>
    );
  });

  it("should make a request with the API key and base URL", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      serviceType: "posthog",
      url: "https://us.posthog.com",
      config: {
        apiKey: "phx_test",
      },
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ results: [] }),
    } as Partial<Response> as Response);

    const result = await getPosthogJson(
      workspaceId,
      serverId,
      "/api/projects/",
      { limit: 10 }
    );

    expect(result).toEqual({ results: [] });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://us.posthog.com/api/projects/?limit=10"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer phx_test",
        }),
      })
    );
  });

  it("should reject invalid PostHog base URLs", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      serviceType: "posthog",
      url: "https://invalid.example.com",
      config: {
        apiKey: "phx_test",
      },
    });

    await expect(
      getPosthogJson(workspaceId, serverId, "/api/projects/")
    ).rejects.toThrow("PostHog base URL must be https://us.posthog.com or https://eu.posthog.com");
  });

  it("should reject missing API keys", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      workspaceId,
      serviceType: "posthog",
      url: "https://eu.posthog.com",
      config: {},
    });

    await expect(
      getPosthogJson(workspaceId, serverId, "/api/projects/")
    ).rejects.toThrow("PostHog API key is missing");
  });
});
