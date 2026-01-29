import { describe, expect, it, vi } from "vitest";

import { removeAgentResources } from "../agentCleanup";

const {
  mockDeleteDiscordCommand,
  mockRemoveAgentDatabases,
  mockDeleteS3Object,
  mockDeleteGraphFactsFile,
} = vi.hoisted(() => {
  return {
    mockDeleteDiscordCommand: vi.fn(),
    mockRemoveAgentDatabases: vi.fn(),
    mockDeleteS3Object: vi.fn(),
    mockDeleteGraphFactsFile: vi.fn(),
  };
});

vi.mock("../discordApi", () => ({
  deleteDiscordCommand: mockDeleteDiscordCommand,
}));

vi.mock("../vectordb/agentRemoval", () => ({
  removeAgentDatabases: mockRemoveAgentDatabases,
}));

vi.mock("../s3", () => ({
  deleteS3Object: mockDeleteS3Object,
}));

vi.mock("../duckdb/graphDb", () => ({
  deleteGraphFactsFile: mockDeleteGraphFactsFile,
}));

function buildAsyncGenerator<T>(items: T[]) {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

describe("removeAgentResources", () => {
  it("deletes conversation file objects and agent resources", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    const conversationMessages = [
      {
        role: "assistant",
        content:
          "See https://s3.eu-west-2.amazonaws.com/workspace.documents/conversation-files/workspace-123/agent-456/conv-789/file.pdf",
      },
      {
        role: "assistant",
        content:
          "Local http://localhost:4568/workspace.documents/conversation-files/workspace-123/agent-456/conv-789/file2.png?X-Amz-Signature=abc",
      },
      {
        role: "assistant",
        content:
          "Inline conversation-files/workspace-123/agent-456/conv-789/file3.txt)",
      },
    ];

    const db = {
      agent: {
        delete: vi.fn(),
      },
      "agent-key": {
        queryAsync: vi.fn().mockReturnValue(buildAsyncGenerator([])),
        delete: vi.fn(),
      },
      "agent-schedule": {
        queryAsync: vi.fn().mockReturnValue(buildAsyncGenerator([])),
        delete: vi.fn(),
      },
      "agent-conversations": {
        queryAsync: vi.fn().mockReturnValue(
          buildAsyncGenerator([
            {
              pk: `conversations/${workspaceId}/${agentId}/${conversationId}`,
              sk: "conversation",
              workspaceId,
              agentId,
              messages: conversationMessages,
            },
          ]),
        ),
        delete: vi.fn(),
      },
      "agent-eval-judge": {
        queryAsync: vi.fn().mockReturnValue(buildAsyncGenerator([])),
        delete: vi.fn(),
      },
      "agent-eval-result": {
        queryAsync: vi.fn().mockReturnValue(buildAsyncGenerator([])),
        delete: vi.fn(),
      },
      "agent-stream-servers": {
        deleteIfExists: vi.fn(),
      },
      "agent-delegation-tasks": {
        queryAsync: vi.fn().mockReturnValue(buildAsyncGenerator([])),
        delete: vi.fn(),
      },
      "bot-integration": {
        queryAsync: vi.fn().mockReturnValue(buildAsyncGenerator([])),
        delete: vi.fn(),
      },
    };

    await removeAgentResources({
      db: db as never,
      workspaceId,
      agentId,
    });

    expect(mockDeleteS3Object).toHaveBeenCalledWith(
      "conversation-files/workspace-123/agent-456/conv-789/file.pdf",
    );
    expect(mockDeleteS3Object).toHaveBeenCalledWith(
      "conversation-files/workspace-123/agent-456/conv-789/file2.png",
    );
    expect(mockDeleteS3Object).toHaveBeenCalledWith(
      "conversation-files/workspace-123/agent-456/conv-789/file3.txt",
    );
    expect(db["agent-conversations"].delete).toHaveBeenCalledWith(
      `conversations/${workspaceId}/${agentId}/${conversationId}`,
      "conversation",
    );
    expect(mockRemoveAgentDatabases).toHaveBeenCalledWith(agentId);
    expect(mockDeleteGraphFactsFile).toHaveBeenCalledWith(workspaceId, agentId);
    expect(db.agent.delete).toHaveBeenCalledWith(
      `agents/${workspaceId}/${agentId}`,
      "agent",
    );
  });
});
