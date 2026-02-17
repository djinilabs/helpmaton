/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { getPosthogJson } from "../../../utils/posthog/client";
import {
  createPosthogListProjectsTool,
  createPosthogListEventsTool,
  createPosthogGetTool,
} from "../posthogTools";

vi.mock("../../../utils/posthog/client", () => ({
  getPosthogJson: vi.fn(),
}));

describe("PostHog Tools", () => {
  const workspaceId = "workspace-1";
  const serverId = "server-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list projects", async () => {
    vi.mocked(getPosthogJson).mockResolvedValue({ results: [] });

    const tool = createPosthogListProjectsTool(workspaceId, serverId);
    const result = await (tool as any).execute({});

    expect(getPosthogJson).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      "/api/projects/"
    );
    expect(result).toContain("results");
  });

  it("should map event query parameters", async () => {
    vi.mocked(getPosthogJson).mockResolvedValue({ results: [] });

    const tool = createPosthogListEventsTool(workspaceId, serverId);
    await (tool as any).execute({
      project_id: "123",
      event: "pageview",
      distinctId: "user-1",
      limit: 25,
    });

    expect(getPosthogJson).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      "/api/projects/123/events/",
      {
        after: undefined,
        before: undefined,
        event: "pageview",
        distinct_id: "user-1",
        person_id: undefined,
        limit: 25,
        offset: undefined,
      }
    );
  });

  it("should return hasMore and nextOffset when result length equals limit", async () => {
    const results = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    vi.mocked(getPosthogJson).mockResolvedValue({ results });

    const tool = createPosthogListEventsTool(workspaceId, serverId);
    const result = await (tool as any).execute({
      project_id: "123",
      limit: 50,
    });

    const parsed = JSON.parse(result);
    expect(parsed.results).toHaveLength(50);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.nextOffset).toBe(50);
  });

  it("should return validation error when projectId is missing", async () => {
    const tool = createPosthogListEventsTool(workspaceId, serverId);
    const result = await (tool as any).execute({ event: "pageview" });

    expect(result).toContain("Invalid tool arguments");
    expect(getPosthogJson).not.toHaveBeenCalled();
  });

  it("should handle get tool errors", async () => {
    vi.mocked(getPosthogJson).mockRejectedValue(
      new Error("PostHog API error")
    );

    const tool = createPosthogGetTool(workspaceId, serverId);
    const result = await (tool as any).execute({
      path: "/api/projects/",
    });

    expect(result).toContain("Error getting PostHog data");
  });
});
