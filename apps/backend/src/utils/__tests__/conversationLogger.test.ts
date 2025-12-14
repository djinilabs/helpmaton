import { describe, it, expect, vi, beforeEach } from "vitest";

import type {
  AgentConversationRecord,
  DatabaseSchema,
} from "../../tables/schema";
import {
  aggregateTokenUsage,
  extractTokenUsage,
  startConversation,
  updateConversation,
  type TokenUsage,
} from "../conversationLogger";

describe("conversationLogger", () => {
  describe("extractTokenUsage", () => {
    it("should extract token usage from standard AI SDK format", async () => {
      const result = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
      };

      const usage = await extractTokenUsage(result);

      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });
    });

    it("should extract token usage from inputTokens/outputTokens format", async () => {
      const result = {
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
        },
      };

      const usage = await extractTokenUsage(result);

      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });
    });

    it("should extract reasoning tokens when present", async () => {
      const result = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          reasoningTokens: 200,
        },
      };

      const usage = await extractTokenUsage(result);

      // totalTokens should be recalculated as promptTokens + completionTokens + reasoningTokens
      // 1000 + 500 + 200 = 1700, but API says 1500, so we use calculated (1700)
      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1700, // Recalculated: 1000 + 500 + 200
        reasoningTokens: 200,
      });
    });

    it("should extract reasoning tokens from nested location", async () => {
      const result = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
        reasoningTokens: 200,
      };

      const usage = await extractTokenUsage(result);

      // totalTokens should be recalculated as promptTokens + completionTokens + reasoningTokens
      // 1000 + 500 + 200 = 1700, but API says 1500, so we use calculated (1700)
      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1700, // Recalculated: 1000 + 500 + 200
        reasoningTokens: 200,
      });
    });

    it("should not include reasoningTokens when zero or missing", async () => {
      const result1 = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          reasoningTokens: 0,
        },
      };

      const result2 = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
      };

      const usage1 = await extractTokenUsage(result1);
      const usage2 = await extractTokenUsage(result2);

      expect(usage1?.reasoningTokens).toBeUndefined();
      expect(usage2?.reasoningTokens).toBeUndefined();
    });

    it("should return undefined for invalid result", async () => {
      expect(await extractTokenUsage(null)).toBeUndefined();
      expect(await extractTokenUsage(undefined)).toBeUndefined();
      expect(await extractTokenUsage({})).toBeUndefined();
      expect(await extractTokenUsage({ usage: null })).toBeUndefined();
    });

    it("should handle missing token fields gracefully", async () => {
      const result = {
        usage: {
          totalTokens: 1500,
        },
      };

      const usage = await extractTokenUsage(result);

      expect(usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 1500,
      });
    });

    it("should handle Promise usage from streamText", async () => {
      const usageValue = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };
      const result = {
        usage: Promise.resolve(usageValue),
      };

      const usage = await extractTokenUsage(result);

      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });
    });
  });

  describe("aggregateTokenUsage", () => {
    it("should aggregate multiple token usage objects", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      // totalTokens should be the sum of components: 3000 + 1500 = 4500
      expect(aggregated).toEqual({
        promptTokens: 3000,
        completionTokens: 1500,
        totalTokens: 4500, // promptTokens + completionTokens (no reasoning tokens)
      });
    });

    it("should aggregate reasoning tokens when present", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 200,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
        reasoningTokens: 300,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      // totalTokens should be the sum of all components: 3000 + 1500 + 500 = 5000
      expect(aggregated).toEqual({
        promptTokens: 3000,
        completionTokens: 1500,
        totalTokens: 5000, // promptTokens + completionTokens + reasoningTokens
        reasoningTokens: 500,
      });
    });

    it("should not include reasoningTokens when all are zero or missing", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      expect(aggregated.reasoningTokens).toBeUndefined();
    });

    it("should handle undefined usage objects", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      const aggregated = aggregateTokenUsage(usage1, undefined, undefined);

      expect(aggregated).toEqual(usage1);
    });

    it("should handle empty array", () => {
      const aggregated = aggregateTokenUsage();

      expect(aggregated).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    });

    it("should handle partial token usage", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 0,
        totalTokens: 1000,
      };

      const usage2: TokenUsage = {
        promptTokens: 0,
        completionTokens: 500,
        totalTokens: 500,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      expect(aggregated).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });
    });

    it("should handle mixed reasoning token presence", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 200,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
        // No reasoningTokens
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      expect(aggregated.reasoningTokens).toBe(200);
    });
  });

  describe("startConversation", () => {
    let mockDb: DatabaseSchema;
    let mockAtomicUpdate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      mockAtomicUpdate = vi.fn();

      mockDb = {
        "agent-conversations": {
          atomicUpdate: mockAtomicUpdate,
        },
      } as unknown as DatabaseSchema;
    });

    it("should create a new conversation using atomicUpdate", async () => {
      const conversationData = {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationType: "test" as const,
        messages: [
          {
            role: "user" as const,
            content: "Hello",
          },
        ],
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
        modelName: "gemini-2.5-flash",
        provider: "google",
        usesByok: false,
      };

      const createdConversation: AgentConversationRecord = {
        pk: "conversations/workspace-123/agent-456/test-conv-id",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "test-conv-id",
        conversationType: "test",
        messages: conversationData.messages as unknown[],
        tokenUsage: conversationData.tokenUsage,
        modelName: conversationData.modelName,
        provider: conversationData.provider,
        usesByok: false,
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockAtomicUpdate.mockImplementation(async (pk, sk, updater) => {
        const result = await updater(undefined);
        return {
          ...createdConversation,
          ...result,
          pk,
        };
      });

      const conversationId = await startConversation(mockDb, conversationData);

      expect(conversationId).toBeDefined();
      expect(mockAtomicUpdate).toHaveBeenCalledWith(
        expect.stringContaining("conversations/workspace-123/agent-456/"),
        undefined,
        expect.any(Function)
      );

      // Verify the updater function creates a new conversation when current is undefined
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const result = await updaterCall(undefined);
      expect(result.workspaceId).toBe("workspace-123");
      expect(result.agentId).toBe("agent-456");
      expect(result.conversationType).toBe("test");
      expect(result.messages).toEqual(conversationData.messages);
    });

    it("should merge messages if conversation already exists", async () => {
      const existingConversation: AgentConversationRecord = {
        pk: "conversations/workspace-123/agent-456/existing-conv-id",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "existing-conv-id",
        conversationType: "test",
        messages: [
          {
            role: "user",
            content: "First message",
          },
        ] as unknown[],
        tokenUsage: {
          promptTokens: 50,
          completionTokens: 25,
          totalTokens: 75,
        },
        modelName: "gemini-2.5-flash",
        provider: "google",
        usesByok: false,
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const newMessages = [
        {
          role: "user" as const,
          content: "Second message",
        },
      ];

      mockAtomicUpdate.mockImplementation(async (pk, sk, updater) => {
        const result = await updater(existingConversation);
        return {
          ...existingConversation,
          ...result,
        };
      });

      const conversationId = await startConversation(mockDb, {
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationType: "test",
        messages: newMessages,
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      });

      expect(conversationId).toBeDefined();
      expect(mockAtomicUpdate).toHaveBeenCalled();

      // Verify the updater function merges messages when conversation exists
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const result = await updaterCall(existingConversation);
      expect(result.messages).toHaveLength(2);
      expect((result.messages as unknown[])[0]).toMatchObject({
        role: "user",
        content: "First message",
      });
      expect((result.messages as unknown[])[1]).toMatchObject({
        role: "user",
        content: "Second message",
      });
      expect(result.tokenUsage?.totalTokens).toBe(225); // 75 + 150
    });
  });

  describe("updateConversation", () => {
    let mockDb: DatabaseSchema;
    let mockAtomicUpdate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      mockAtomicUpdate = vi.fn();

      mockDb = {
        "agent-conversations": {
          atomicUpdate: mockAtomicUpdate,
        },
      } as unknown as DatabaseSchema;
    });

    it("should update existing conversation with new messages using atomicUpdate", async () => {
      const existingConversation: AgentConversationRecord = {
        pk: "conversations/workspace-123/agent-456/conversation-789",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        conversationType: "test",
        messages: [
          {
            role: "user",
            content: "First message",
          },
        ] as unknown[],
        tokenUsage: {
          promptTokens: 50,
          completionTokens: 25,
          totalTokens: 75,
        },
        modelName: "gemini-2.5-flash",
        provider: "google",
        usesByok: false,
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const newMessages = [
        {
          role: "assistant" as const,
          content: "Response message",
        },
      ];

      const additionalTokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      mockAtomicUpdate.mockImplementation(async (pk, sk, updater) => {
        const result = await updater(existingConversation);
        return {
          ...existingConversation,
          ...result,
        };
      });

      await updateConversation(
        mockDb,
        "workspace-123",
        "agent-456",
        "conversation-789",
        newMessages,
        additionalTokenUsage
      );

      expect(mockAtomicUpdate).toHaveBeenCalledWith(
        "conversations/workspace-123/agent-456/conversation-789",
        undefined,
        expect.any(Function)
      );

      // Verify the updater function merges messages and aggregates token usage
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const result = await updaterCall(existingConversation);
      expect(result.messages).toHaveLength(2);
      expect((result.messages as unknown[])[1]).toMatchObject({
        role: "assistant",
        content: "Response message",
      });
      expect(result.tokenUsage?.totalTokens).toBe(225); // 75 + 150
      expect(result.tokenUsage?.promptTokens).toBe(150); // 50 + 100
      expect(result.tokenUsage?.completionTokens).toBe(75); // 25 + 50
    });

    it("should create new conversation if it doesn't exist", async () => {
      const newMessages = [
        {
          role: "user" as const,
          content: "New message",
        },
      ];

      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      const createdConversation: AgentConversationRecord = {
        pk: "conversations/workspace-123/agent-456/conversation-789",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        conversationType: "test",
        messages: newMessages as unknown[],
        tokenUsage,
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockAtomicUpdate.mockImplementation(async (pk, sk, updater) => {
        const result = await updater(undefined);
        return {
          ...createdConversation,
          ...result,
        };
      });

      await updateConversation(
        mockDb,
        "workspace-123",
        "agent-456",
        "conversation-789",
        newMessages,
        tokenUsage
      );

      expect(mockAtomicUpdate).toHaveBeenCalled();

      // Verify the updater function creates a new conversation when current is undefined
      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const result = await updaterCall(undefined);
      expect(result.workspaceId).toBe("workspace-123");
      expect(result.agentId).toBe("agent-456");
      expect(result.conversationId).toBe("conversation-789");
      expect(result.conversationType).toBe("test");
      expect(result.messages).toEqual(newMessages);
      expect(result.tokenUsage).toEqual(tokenUsage);
    });

    it("should preserve existing modelName and provider when updating", async () => {
      const existingConversation: AgentConversationRecord = {
        pk: "conversations/workspace-123/agent-456/conversation-789",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        conversationType: "test",
        messages: [] as unknown[],
        modelName: "gemini-2.5-flash",
        provider: "google",
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockAtomicUpdate.mockImplementation(async (pk, sk, updater) => {
        const result = await updater(existingConversation);
        return {
          ...existingConversation,
          ...result,
        };
      });

      await updateConversation(
        mockDb,
        "workspace-123",
        "agent-456",
        "conversation-789",
        [{ role: "user" as const, content: "Test" }]
      );

      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const result = await updaterCall(existingConversation);
      expect(result.modelName).toBe("gemini-2.5-flash");
      expect(result.provider).toBe("google");
    });

    it("should detect full history replacement and replace messages instead of merging", async () => {
      const existingConversation: AgentConversationRecord = {
        pk: "conversations/workspace-123/agent-456/conversation-789",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        conversationType: "stream",
        messages: [
          {
            role: "user",
            content: "First message",
          },
          {
            role: "assistant",
            content: "First response",
          },
        ] as unknown[],
        tokenUsage: {
          promptTokens: 50,
          completionTokens: 25,
          totalTokens: 75,
        },
        modelName: "gemini-2.5-flash",
        provider: "google",
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      // Full history from request (streaming endpoint case)
      const fullHistoryMessages = [
        {
          role: "user" as const,
          content: "First message",
        },
        {
          role: "assistant" as const,
          content: "First response",
        },
        {
          role: "user" as const,
          content: "Second message",
        },
        {
          role: "assistant" as const,
          content: "Second response",
        },
      ];

      const additionalTokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      mockAtomicUpdate.mockImplementation(async (pk, sk, updater) => {
        const result = await updater(existingConversation);
        return {
          ...existingConversation,
          ...result,
        };
      });

      await updateConversation(
        mockDb,
        "workspace-123",
        "agent-456",
        "conversation-789",
        fullHistoryMessages,
        additionalTokenUsage
      );

      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const result = await updaterCall(existingConversation);

      // Should replace, not merge - so we should have exactly 4 messages (no duplicates)
      expect(result.messages).toHaveLength(4);
      expect((result.messages as unknown[])[0]).toMatchObject({
        role: "user",
        content: "First message",
      });
      expect((result.messages as unknown[])[3]).toMatchObject({
        role: "assistant",
        content: "Second response",
      });
      // Token usage should be aggregated
      expect(result.tokenUsage?.totalTokens).toBe(225); // 75 + 150
    });

    it("should merge messages when newMessages doesn't start with existing messages (incremental update)", async () => {
      const existingConversation: AgentConversationRecord = {
        pk: "conversations/workspace-123/agent-456/conversation-789",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        conversationType: "test",
        messages: [
          {
            role: "user",
            content: "First message",
          },
        ] as unknown[],
        tokenUsage: {
          promptTokens: 50,
          completionTokens: 25,
          totalTokens: 75,
        },
        modelName: "gemini-2.5-flash",
        provider: "google",
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      // Only new messages (incremental update case)
      const newMessages = [
        {
          role: "assistant" as const,
          content: "New response",
        },
      ];

      const additionalTokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      mockAtomicUpdate.mockImplementation(async (pk, sk, updater) => {
        const result = await updater(existingConversation);
        return {
          ...existingConversation,
          ...result,
        };
      });

      await updateConversation(
        mockDb,
        "workspace-123",
        "agent-456",
        "conversation-789",
        newMessages,
        additionalTokenUsage
      );

      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const result = await updaterCall(existingConversation);

      // Should merge - so we should have 2 messages
      expect(result.messages).toHaveLength(2);
      expect((result.messages as unknown[])[0]).toMatchObject({
        role: "user",
        content: "First message",
      });
      expect((result.messages as unknown[])[1]).toMatchObject({
        role: "assistant",
        content: "New response",
      });
    });

    it("should recalculate totalTokens to include reasoningTokens when aggregating", async () => {
      const existingConversation: AgentConversationRecord = {
        pk: "conversations/workspace-123/agent-456/conversation-789",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        conversationType: "test",
        messages: [] as unknown[],
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150, // This should be recalculated
          reasoningTokens: 30,
        } as TokenUsage,
        modelName: "gemini-2.5-flash",
        provider: "google",
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      const newMessages = [
        {
          role: "user" as const,
          content: "Test",
        },
      ];

      const additionalTokenUsage: TokenUsage = {
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300, // This should be recalculated
        reasoningTokens: 50, // This will be included in the aggregated result
      };

      mockAtomicUpdate.mockImplementation(async (pk, sk, updater) => {
        const result = await updater(existingConversation);
        return {
          ...existingConversation,
          ...result,
        };
      });

      await updateConversation(
        mockDb,
        "workspace-123",
        "agent-456",
        "conversation-789",
        newMessages,
        additionalTokenUsage
      );

      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const result = await updaterCall(existingConversation);

      // totalTokens should be recalculated: (100 + 200) + (50 + 100) + (30 + 50) = 530
      expect(result.tokenUsage?.promptTokens).toBe(300);
      expect(result.tokenUsage?.completionTokens).toBe(150);
      expect(result.tokenUsage?.reasoningTokens).toBe(80);
      expect(result.tokenUsage?.totalTokens).toBe(530); // 300 + 150 + 80
    });

    it("should preserve tokenUsage from existing assistant messages during full history replacement", async () => {
      const existingConversation: AgentConversationRecord = {
        pk: "conversations/workspace-123/agent-456/conversation-789",
        workspaceId: "workspace-123",
        agentId: "agent-456",
        conversationId: "conversation-789",
        conversationType: "stream",
        messages: [
          {
            role: "user",
            content: "First message",
          },
          {
            role: "assistant",
            content: "First response",
            tokenUsage: {
              promptTokens: 50,
              completionTokens: 25,
              totalTokens: 75,
            },
          },
        ] as unknown[],
        tokenUsage: {
          promptTokens: 50,
          completionTokens: 25,
          totalTokens: 75,
        },
        modelName: "gemini-2.5-flash",
        provider: "google",
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        version: 1,
        createdAt: new Date().toISOString(),
      };

      // Full history from request (streaming endpoint case) - previous assistant message doesn't have tokenUsage in request
      // This simulates the real scenario where the request body contains messages without tokenUsage
      const fullHistoryMessages = [
        {
          role: "user" as const,
          content: "First message",
        },
        {
          role: "assistant" as const,
          content: "First response",
          // Note: no tokenUsage here - it should be preserved from existing conversation
        },
        {
          role: "user" as const,
          content: "Second message",
        },
        {
          role: "assistant" as const,
          content: "Second response",
          // In the real scenario, the new assistant message is added with tokenUsage
          // before calling updateConversation (see streaming endpoint code)
          tokenUsage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        },
      ];

      const additionalTokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      mockAtomicUpdate.mockImplementation(async (pk, sk, updater) => {
        const result = await updater(existingConversation);
        return {
          ...existingConversation,
          ...result,
        };
      });

      await updateConversation(
        mockDb,
        "workspace-123",
        "agent-456",
        "conversation-789",
        fullHistoryMessages,
        additionalTokenUsage
      );

      const updaterCall = mockAtomicUpdate.mock.calls[0][2];
      const result = await updaterCall(existingConversation);

      // Should have 4 messages
      expect(result.messages).toHaveLength(4);

      // First assistant message should preserve its tokenUsage from existing
      const firstAssistantMsg = (result.messages as unknown[])[1] as {
        role: string;
        content: string;
        tokenUsage?: TokenUsage;
      };
      expect(firstAssistantMsg.role).toBe("assistant");
      expect(firstAssistantMsg.content).toBe("First response");
      expect(firstAssistantMsg.tokenUsage).toBeDefined();
      expect(firstAssistantMsg.tokenUsage?.totalTokens).toBe(75);

      // Second assistant message should have tokenUsage from the new request
      const secondAssistantMsg = (result.messages as unknown[])[3] as {
        role: string;
        content: string;
        tokenUsage?: TokenUsage;
      };
      expect(secondAssistantMsg.role).toBe("assistant");
      expect(secondAssistantMsg.content).toBe("Second response");
      expect(secondAssistantMsg.tokenUsage).toBeDefined();
      expect(secondAssistantMsg.tokenUsage?.totalTokens).toBe(150);

      // Conversation-level token usage should be aggregated
      expect(result.tokenUsage?.totalTokens).toBe(225); // 75 + 150
    });
  });
});
