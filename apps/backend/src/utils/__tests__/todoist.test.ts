import { describe, it, expect, beforeEach, vi } from "vitest";

import * as todoistClient from "../todoist/client";

// Mock fetch
global.fetch = vi.fn();

vi.mock("../googleApi/oauth", () => ({
  getOAuthTokens: vi.fn().mockResolvedValue({
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
  ensureValidToken: vi.fn().mockResolvedValue("test-access-token"),
}));

vi.mock("../oauth/mcp/todoist", () => ({
  refreshTodoistToken: vi.fn().mockResolvedValue({
    accessToken: "refreshed-token",
    refreshToken: "refreshed-token",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  }),
}));

describe("Todoist API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list tasks with filter", async () => {
    const mockResponse = [{ id: "task-1" }];

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockResponse),
      headers: new Headers({ "content-type": "application/json" }),
    } as Partial<Response> as Response);

    const result = await todoistClient.listTasks(
      "workspace-1",
      "server-1",
      "today"
    );

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.todoist.com/rest/v2/tasks?filter=today",
      expect.any(Object)
    );
  });

  it("should add a task", async () => {
    const mockResponse = { id: "task-1", content: "Buy milk" };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockResponse),
      headers: new Headers({ "content-type": "application/json" }),
    } as Partial<Response> as Response);

    const result = await todoistClient.addTask("workspace-1", "server-1", {
      content: "Buy milk",
      due_string: "tomorrow at 5pm",
      priority: 3,
    });

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.todoist.com/rest/v2/tasks",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("should close a task", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers({}),
    } as Partial<Response> as Response);

    const result = await todoistClient.closeTask(
      "workspace-1",
      "server-1",
      "task-123"
    );

    expect(result).toEqual({});
    expect(fetch).toHaveBeenCalledWith(
      "https://api.todoist.com/rest/v2/tasks/task-123/close",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("should list projects", async () => {
    const mockResponse = [{ id: "project-1" }];

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockResponse),
      headers: new Headers({ "content-type": "application/json" }),
    } as Partial<Response> as Response);

    const result = await todoistClient.listProjects("workspace-1", "server-1");

    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.todoist.com/rest/v2/projects",
      expect.any(Object)
    );
  });
});
