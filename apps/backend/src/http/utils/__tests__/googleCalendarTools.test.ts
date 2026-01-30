/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { database } from "../../../tables";
import * as googleCalendarClient from "../../../utils/googleCalendar/client";
import { createGoogleCalendarDeleteTool } from "../googleCalendarTools";

vi.mock("../../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../../utils/googleCalendar/client", () => ({
  deleteEvent: vi.fn(),
}));

describe("Google Calendar Tools", () => {
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

  it("should return validation error when eventId is missing", async () => {
    mockDb["mcp-server"].get.mockResolvedValue({
      pk: `mcp-servers/${workspaceId}/${serverId}`,
      sk: "server",
      authType: "oauth",
      config: { accessToken: "token-123" },
    });

    const tool = createGoogleCalendarDeleteTool(workspaceId, serverId);
    const result = await (tool as any).execute({});

    expect(result).toContain("Invalid tool arguments");
    expect(googleCalendarClient.deleteEvent).not.toHaveBeenCalled();
  });
});
