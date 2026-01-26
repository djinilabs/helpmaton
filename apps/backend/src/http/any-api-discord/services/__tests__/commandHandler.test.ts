import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseSchemaWithAtomicUpdate } from "../../../../tables";
import { database } from "../../../../tables";
import { sendWorkspaceCreditNotifications } from "../../../../utils/creditAdminNotifications";
import { creditCredits } from "../../../../utils/creditManagement";
import { handleDiscordCommand } from "../commandHandler";

vi.mock("../../../../tables", () => ({
  database: vi.fn(),
}));

vi.mock("../../../../utils/creditManagement", () => ({
  creditCredits: vi.fn(),
}));

vi.mock("../../../../utils/creditAdminNotifications", () => ({
  sendWorkspaceCreditNotifications: vi.fn(),
}));

describe("handleDiscordCommand credit notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends admin notifications after crediting a workspace", async () => {
    const workspace = {
      pk: "workspaces/ws-123",
      sk: "workspace",
      name: "Acme Workspace",
      creditBalance: 1_000_000_000,
      currency: "usd",
    };

    const mockDb = {
      workspace: {
        get: vi.fn().mockResolvedValue(workspace),
      },
    } as unknown as DatabaseSchemaWithAtomicUpdate;

    vi.mocked(database).mockResolvedValue(mockDb);

    const creditResult =
      {
        creditBalance: 3_000_000_000,
        currency: "usd",
      } as unknown as Awaited<ReturnType<typeof creditCredits>>;

    vi.mocked(creditCredits).mockResolvedValue(creditResult);

    vi.mocked(sendWorkspaceCreditNotifications).mockResolvedValue(undefined);

    const result = (await handleDiscordCommand({
      data: {
        name: "credit",
        options: [
          { name: "workspace_id", value: "ws-123" },
          { name: "amount", value: 2 },
        ],
      },
    })) as { body?: string };

    const body = JSON.parse(result.body || "{}");
    expect(body.data.content).toContain("Successfully credited");
    expect(body.data.content).not.toContain("Admin email notification failed");
    expect(sendWorkspaceCreditNotifications).toHaveBeenCalledWith({
      workspace,
      amountInNanoDollars: 2_000_000_000,
      oldBalance: 1_000_000_000,
      newBalance: 3_000_000_000,
      currency: "usd",
      trialRequestId: undefined,
    });
  });

  it("adds a warning when admin email notification fails", async () => {
    const workspace = {
      pk: "workspaces/ws-456",
      sk: "workspace",
      name: "Beta Workspace",
      creditBalance: 500_000_000,
      currency: "usd",
    };

    const mockDb = {
      workspace: {
        get: vi.fn().mockResolvedValue(workspace),
      },
    } as unknown as DatabaseSchemaWithAtomicUpdate;

    vi.mocked(database).mockResolvedValue(mockDb);

    const creditResult =
      {
        creditBalance: 1_500_000_000,
        currency: "usd",
      } as unknown as Awaited<ReturnType<typeof creditCredits>>;

    vi.mocked(creditCredits).mockResolvedValue(creditResult);

    vi.mocked(sendWorkspaceCreditNotifications).mockRejectedValue(
      new Error("Email failed")
    );

    const result = (await handleDiscordCommand({
      data: {
        name: "credit",
        options: [
          { name: "workspace_id", value: "ws-456" },
          { name: "amount", value: 1 },
        ],
      },
    })) as { body?: string };

    const body = JSON.parse(result.body || "{}");
    expect(body.data.content).toContain("Successfully credited");
    expect(body.data.content).toContain("Admin email notification failed");
  });
});
