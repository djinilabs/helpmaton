/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as todoistClient from "../../../utils/todoist/client";
import {
  createTodoistAddTaskTool,
  createTodoistCloseTaskTool,
} from "../todoistTools";

vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../../utils/todoist/client", () => ({
  addTask: vi.fn(),
  closeTask: vi.fn(),
}));

describe("Todoist Tools", () => {
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

  it("should add a task when connected", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: { accessToken: "token-123" },
    });

    vi.mocked(todoistClient.addTask).mockResolvedValue({
      id: "task-1",
    });

    const tool = createTodoistAddTaskTool(workspaceId, serverId);
    const result = await (tool as any).execute({
      content: "Buy milk",
      due_string: "tomorrow",
    });

    expect(todoistClient.addTask).toHaveBeenCalledWith(
      workspaceId,
      serverId,
      expect.objectContaining({ content: "Buy milk", due_string: "tomorrow" })
    );
    expect(result).toContain("task-1");
  });

  it("should return validation error when content is missing", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: { accessToken: "token-123" },
    });

    const tool = createTodoistAddTaskTool(workspaceId, serverId);
    const result = await (tool as any).execute({});

    expect(result).toContain("Invalid tool arguments");
    expect(todoistClient.addTask).not.toHaveBeenCalled();
  });

  it("should return error if not connected", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: {},
    });

    const tool = createTodoistCloseTaskTool(workspaceId, serverId);
    const result = await (tool as any).execute({ id: "task-123" });

    expect(result).toContain("Todoist is not connected");
    expect(todoistClient.closeTask).not.toHaveBeenCalled();
  });
});
