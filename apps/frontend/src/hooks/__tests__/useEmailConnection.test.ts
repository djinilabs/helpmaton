import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { clearEmailConnectionCache } from "../useEmailConnection";

describe("clearEmailConnectionCache", () => {
  it("removes the cached email connection entry", () => {
    const queryClient = new QueryClient();
    const workspaceId = "workspace-123";
    const queryKey = ["workspaces", workspaceId, "email-connection"];

    queryClient.setQueryData(queryKey, { name: "Test Connection" });

    clearEmailConnectionCache(queryClient, workspaceId);

    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  });
});
