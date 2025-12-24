import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { UIMessage } from "../../http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types";
import {
  aggregateTokenUsage,
  extractTokenUsage,
  getMessageKey,
  findNewMessages,
  updateConversation,
  startConversation,
  type TokenUsage,
} from "../conversationLogger";

describe("conversationLogger", () => {
  describe("extractTokenUsage", () => {
    it("should extract token usage from standard AI SDK format", () => {
      const result = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
      };

      const usage = extractTokenUsage(result);

      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });
    });

    it("should extract token usage from inputTokens/outputTokens format", () => {
      const result = {
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
        },
      };

      const usage = extractTokenUsage(result);

      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });
    });

    it("should extract reasoning tokens when present", () => {
      const result = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          reasoningTokens: 200,
        },
      };

      const usage = extractTokenUsage(result);

      // totalTokens should be max(1500, 1000 + 500 + 200) = 1700
      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1700, // Includes reasoning tokens
        reasoningTokens: 200,
      });
    });

    it("should extract reasoning tokens from nested location", () => {
      const result = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
        reasoningTokens: 200,
      };

      const usage = extractTokenUsage(result);

      // totalTokens should be max(1500, 1000 + 500 + 200) = 1700
      expect(usage).toEqual({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1700, // Includes reasoning tokens
        reasoningTokens: 200,
      });
    });

    it("should not include reasoningTokens when zero or missing", () => {
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

      const usage1 = extractTokenUsage(result1);
      const usage2 = extractTokenUsage(result2);

      expect(usage1?.reasoningTokens).toBeUndefined();
      expect(usage2?.reasoningTokens).toBeUndefined();
    });

    it("should extract cached prompt tokens when present", () => {
      const result = {
        usage: {
          promptTokenCount: 1000,
          cachedPromptTokenCount: 200,
          completionTokenCount: 500,
          totalTokenCount: 1500,
        },
      };

      const usage = extractTokenUsage(result);

      // totalTokens should include cached tokens: 800 + 200 + 500 = 1500
      expect(usage).toEqual({
        promptTokens: 800, // 1000 - 200 cached
        completionTokens: 500,
        totalTokens: 1500, // 800 + 200 + 500 (includes cached)
        cachedPromptTokens: 200,
      });
    });

    it("should extract cached tokens from various field names", () => {
      const result1 = {
        usage: {
          promptTokens: 1000,
          cachedPromptTokens: 200,
          completionTokens: 500,
          totalTokens: 1500,
        },
      };

      const result2 = {
        usage: {
          promptTokens: 1000,
          cachedTokens: 200,
          completionTokens: 500,
          totalTokens: 1500,
        },
      };

      const usage1 = extractTokenUsage(result1);
      const usage2 = extractTokenUsage(result2);

      expect(usage1?.cachedPromptTokens).toBe(200);
      expect(usage1?.promptTokens).toBe(800); // 1000 - 200
      // totalTokens should include cached: 800 + 200 + 500 = 1500
      expect(usage1?.totalTokens).toBe(1500);
      expect(usage2?.cachedPromptTokens).toBe(200);
      expect(usage2?.promptTokens).toBe(800); // 1000 - 200
      // totalTokens should include cached: 800 + 200 + 500 = 1500
      expect(usage2?.totalTokens).toBe(1500);
    });

    it("should not include cachedPromptTokens when zero or missing", () => {
      const result1 = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          cachedPromptTokenCount: 0,
        },
      };

      const result2 = {
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
      };

      const usage1 = extractTokenUsage(result1);
      const usage2 = extractTokenUsage(result2);

      expect(usage1?.cachedPromptTokens).toBeUndefined();
      expect(usage2?.cachedPromptTokens).toBeUndefined();
    });

    it("should handle both cached tokens and reasoning tokens", () => {
      const result = {
        usage: {
          promptTokenCount: 1000,
          cachedPromptTokenCount: 200,
          completionTokenCount: 500,
          totalTokenCount: 1500,
          reasoningTokens: 100,
        },
      };

      const usage = extractTokenUsage(result);

      // totalTokens should include cached and reasoning tokens: 800 + 200 + 500 + 100 = 1600
      // But API says 1500, so we use max(1500, 1600) = 1600
      expect(usage).toEqual({
        promptTokens: 800, // 1000 - 200 cached
        completionTokens: 500,
        totalTokens: 1600, // 800 + 200 + 500 + 100 (includes cached and reasoning)
        cachedPromptTokens: 200,
        reasoningTokens: 100,
      });
    });

    it("should return undefined for invalid result", () => {
      expect(extractTokenUsage(null)).toBeUndefined();
      expect(extractTokenUsage(undefined)).toBeUndefined();
      expect(extractTokenUsage({})).toBeUndefined();
      expect(extractTokenUsage({ usage: null })).toBeUndefined();
    });

    it("should handle missing token fields gracefully", () => {
      const result = {
        usage: {
          totalTokens: 1500,
        },
      };

      const usage = extractTokenUsage(result);

      expect(usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
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

      // totalTokens is calculated as promptTokens + completionTokens + reasoningTokens
      // = 3000 + 1500 + 0 = 4500
      expect(aggregated).toEqual({
        promptTokens: 3000,
        completionTokens: 1500,
        totalTokens: 4500,
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

      // totalTokens is calculated as promptTokens + completionTokens + reasoningTokens
      // = 3000 + 1500 + 500 = 5000 (not 4500 from summing individual totalTokens)
      expect(aggregated).toEqual({
        promptTokens: 3000,
        completionTokens: 1500,
        totalTokens: 5000, // 3000 + 1500 + 500 (includes reasoning tokens)
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

    it("should aggregate cached prompt tokens when present", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cachedPromptTokens: 200,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
        cachedPromptTokens: 300,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      // totalTokens is calculated as promptTokens + cachedPromptTokens + completionTokens + reasoningTokens
      // = 3000 + 500 + 1500 + 0 = 5000 (includes cached tokens)
      expect(aggregated).toEqual({
        promptTokens: 3000,
        completionTokens: 1500,
        totalTokens: 5000, // 3000 + 500 + 1500 (includes cached tokens)
        cachedPromptTokens: 500,
      });
    });

    it("should not include cachedPromptTokens when all are zero or missing", () => {
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

      expect(aggregated.cachedPromptTokens).toBeUndefined();
    });

    it("should handle mixed cached token presence", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cachedPromptTokens: 200,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
        // No cachedPromptTokens
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      expect(aggregated.cachedPromptTokens).toBe(200);
    });

    it("should aggregate all token types together", () => {
      const usage1: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cachedPromptTokens: 200,
        reasoningTokens: 100,
      };

      const usage2: TokenUsage = {
        promptTokens: 2000,
        completionTokens: 1000,
        totalTokens: 3000,
        cachedPromptTokens: 300,
        reasoningTokens: 200,
      };

      const aggregated = aggregateTokenUsage(usage1, usage2);

      // totalTokens is calculated as promptTokens + cachedPromptTokens + completionTokens + reasoningTokens
      // = 3000 + 500 + 1500 + 300 = 5300 (includes cached and reasoning tokens)
      expect(aggregated).toEqual({
        promptTokens: 3000,
        completionTokens: 1500,
        totalTokens: 5300, // 3000 + 500 + 1500 + 300 (includes cached and reasoning tokens)
        cachedPromptTokens: 500,
        reasoningTokens: 300,
      });
    });
  });

  describe("getMessageKey", () => {
    it("should generate unique keys for different messages", () => {
      const msg1: UIMessage = {
        role: "user",
        content: "Hello",
      };

      const msg2: UIMessage = {
        role: "assistant",
        content: "Hi there",
      };

      const key1 = getMessageKey(msg1);
      const key2 = getMessageKey(msg2);

      expect(key1).not.toBe(key2);
      expect(key1).toContain("user:");
      expect(key2).toContain("assistant:");
    });

    it("should generate same key for messages with same role and content (string format)", () => {
      const msg1: UIMessage = {
        role: "user",
        content: "Hello",
      };

      const msg2: UIMessage = {
        role: "user",
        content: "Hello",
      };

      const key1 = getMessageKey(msg1);
      const key2 = getMessageKey(msg2);

      expect(key1).toBe(key2);
    });

    it("should generate same key for messages with same content in different formats (string vs array)", () => {
      const msg1: UIMessage = {
        role: "user",
        content: "Hello",
      };

      const msg2: UIMessage = {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      };

      const key1 = getMessageKey(msg1);
      const key2 = getMessageKey(msg2);

      expect(key1).toBe(key2);
    });

    it("should ignore tokenUsage when generating key", () => {
      const msg1: UIMessage = {
        role: "assistant",
        content: "Hello",
      };

      const msg2: UIMessage = {
        role: "assistant",
        content: "Hello",
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      };

      const key1 = getMessageKey(msg1);
      const key2 = getMessageKey(msg2);

      expect(key1).toBe(key2);
    });

    it("should include tool calls in key for distinction", () => {
      const msg1: UIMessage = {
        role: "assistant",
        content: [
          { type: "text", text: "Let me help" },
          {
            type: "tool-call",
            toolCallId: "1",
            toolName: "search",
            args: { query: "test" },
          },
        ],
      };

      const msg2: UIMessage = {
        role: "assistant",
        content: [
          { type: "text", text: "Let me help" },
          {
            type: "tool-call",
            toolCallId: "2",
            toolName: "search",
            args: { query: "different" },
          },
        ],
      };

      const key1 = getMessageKey(msg1);
      const key2 = getMessageKey(msg2);

      expect(key1).not.toBe(key2);
    });
  });

  describe("findNewMessages", () => {
    it("should return all messages when existing is empty", () => {
      const existing: UIMessage[] = [];
      const incoming: UIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];

      const newMessages = findNewMessages(existing, incoming);

      expect(newMessages).toEqual(incoming);
      expect(newMessages.length).toBe(2);
    });

    it("should return empty array when all incoming messages already exist", () => {
      const existing: UIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      const incoming: UIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];

      const newMessages = findNewMessages(existing, incoming);

      expect(newMessages).toEqual([]);
      expect(newMessages.length).toBe(0);
    });

    it("should return only truly new messages", () => {
      const existing: UIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      const incoming: UIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "How are you?" },
      ];

      const newMessages = findNewMessages(existing, incoming);

      expect(newMessages.length).toBe(1);
      expect(newMessages[0]).toEqual({ role: "user", content: "How are you?" });
    });

    it("should handle multiple new messages", () => {
      const existing: UIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];
      const incoming: UIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "I'm good!" },
        { role: "user", content: "Great!" },
      ];

      const newMessages = findNewMessages(existing, incoming);

      expect(newMessages.length).toBe(3);
      expect(newMessages).toEqual([
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "I'm good!" },
        { role: "user", content: "Great!" },
      ]);
    });

    it("should ignore tokenUsage differences when comparing messages", () => {
      const existing: UIMessage[] = [
        {
          role: "assistant",
          content: "Hello",
          tokenUsage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        },
      ];
      const incoming: UIMessage[] = [
        { role: "assistant", content: "Hello" }, // Same content, no tokenUsage
      ];

      const newMessages = findNewMessages(existing, incoming);

      expect(newMessages.length).toBe(0); // Should recognize as duplicate
    });

    it("should handle array content format", () => {
      const existing: UIMessage[] = [{ role: "user", content: "Hello" }];
      const incoming: UIMessage[] = [
        { role: "user", content: [{ type: "text", text: "Hello" }] },
        { role: "user", content: "New message" },
      ];

      const newMessages = findNewMessages(existing, incoming);

      expect(newMessages.length).toBe(1);
      expect(newMessages[0]).toEqual({ role: "user", content: "New message" });
    });
  });

  describe("updateConversation - queue write behavior", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockDb: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockWriteToWorkingMemory: any;

    beforeEach(async () => {
      // Mock the database
      mockDb = {
        "agent-conversations": {
          atomicUpdate: vi.fn(async (pk, sk, callback) => {
            // Simulate conversation doesn't exist initially
            const result = await callback(null);
            return result;
          }),
        },
      };

      // Mock writeToWorkingMemory
      const memoryWriteModule = await import("../memory/writeMemory");
      mockWriteToWorkingMemory = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(memoryWriteModule, "writeToWorkingMemory").mockImplementation(
        mockWriteToWorkingMemory
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should send all messages to queue on first update (conversation doesn't exist)", async () => {
      const messages: UIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];

      await updateConversation(
        mockDb,
        "workspace1",
        "agent1",
        "conv1",
        messages
      );

      expect(mockWriteToWorkingMemory).toHaveBeenCalledTimes(1);
      expect(mockWriteToWorkingMemory).toHaveBeenCalledWith(
        "agent1",
        "workspace1",
        "conv1",
        messages
      );
    });

    it("should only send truly new messages to queue on subsequent updates", async () => {
      // First update - conversation exists with 2 messages
      mockDb["agent-conversations"].atomicUpdate = vi.fn(
        async (pk, sk, callback) => {
          const existingConversation = {
            pk,
            workspaceId: "workspace1",
            agentId: "agent1",
            conversationId: "conv1",
            conversationType: "test" as const,
            messages: [
              { role: "user", content: "Hello" },
              { role: "assistant", content: "Hi there" },
            ],
            startedAt: new Date().toISOString(),
            expires: Date.now() + 1000000,
          };
          const result = await callback(existingConversation);
          return result;
        }
      );

      const messages: UIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "I'm good!" },
      ];

      await updateConversation(
        mockDb,
        "workspace1",
        "agent1",
        "conv1",
        messages
      );

      expect(mockWriteToWorkingMemory).toHaveBeenCalledTimes(1);
      // Should only send the 2 new messages
      expect(mockWriteToWorkingMemory).toHaveBeenCalledWith(
        "agent1",
        "workspace1",
        "conv1",
        [
          { role: "user", content: "How are you?" },
          { role: "assistant", content: "I'm good!" },
        ]
      );
    });

    it("should not call writeToWorkingMemory when no new messages", async () => {
      // Conversation exists with 2 messages
      mockDb["agent-conversations"].atomicUpdate = vi.fn(
        async (pk, sk, callback) => {
          const existingConversation = {
            pk,
            workspaceId: "workspace1",
            agentId: "agent1",
            conversationId: "conv1",
            conversationType: "test" as const,
            messages: [
              { role: "user", content: "Hello" },
              { role: "assistant", content: "Hi there" },
            ],
            startedAt: new Date().toISOString(),
            expires: Date.now() + 1000000,
          };
          const result = await callback(existingConversation);
          return result;
        }
      );

      const messages: UIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];

      await updateConversation(
        mockDb,
        "workspace1",
        "agent1",
        "conv1",
        messages
      );

      expect(mockWriteToWorkingMemory).not.toHaveBeenCalled();
    });

    it("should send only one new message when adding one to existing conversation", async () => {
      // Conversation exists with 4 messages
      mockDb["agent-conversations"].atomicUpdate = vi.fn(
        async (pk, sk, callback) => {
          const existingConversation = {
            pk,
            workspaceId: "workspace1",
            agentId: "agent1",
            conversationId: "conv1",
            conversationType: "test" as const,
            messages: [
              { role: "user", content: "Hello" },
              { role: "assistant", content: "Hi there" },
              { role: "user", content: "How are you?" },
              { role: "assistant", content: "I'm good!" },
            ],
            startedAt: new Date().toISOString(),
            expires: Date.now() + 1000000,
          };
          const result = await callback(existingConversation);
          return result;
        }
      );

      const messages: UIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "I'm good!" },
        { role: "user", content: "Goodbye" },
      ];

      await updateConversation(
        mockDb,
        "workspace1",
        "agent1",
        "conv1",
        messages
      );

      expect(mockWriteToWorkingMemory).toHaveBeenCalledTimes(1);
      expect(mockWriteToWorkingMemory).toHaveBeenCalledWith(
        "agent1",
        "workspace1",
        "conv1",
        [{ role: "user", content: "Goodbye" }]
      );
    });

    it("should handle messages with tokenUsage correctly (not treat as duplicate)", async () => {
      // Conversation exists with message without tokenUsage
      mockDb["agent-conversations"].atomicUpdate = vi.fn(
        async (pk, sk, callback) => {
          const existingConversation = {
            pk,
            workspaceId: "workspace1",
            agentId: "agent1",
            conversationId: "conv1",
            conversationType: "test" as const,
            messages: [{ role: "assistant", content: "Hello" }],
            startedAt: new Date().toISOString(),
            expires: Date.now() + 1000000,
          };
          const result = await callback(existingConversation);
          return result;
        }
      );

      // Same message content but with tokenUsage added
      const messages: UIMessage[] = [
        {
          role: "assistant",
          content: "Hello",
          tokenUsage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        },
      ];

      await updateConversation(
        mockDb,
        "workspace1",
        "agent1",
        "conv1",
        messages
      );

      // Should not send to queue because content is the same (only metadata changed)
      expect(mockWriteToWorkingMemory).not.toHaveBeenCalled();
    });

    it("should filter out empty messages before queuing", async () => {
      const messages: UIMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "" }, // Empty message
        { role: "user", content: "   " }, // Whitespace only
        { role: "assistant", content: "Hi there" },
      ];

      await updateConversation(
        mockDb,
        "workspace1",
        "agent1",
        "conv1",
        messages
      );

      expect(mockWriteToWorkingMemory).toHaveBeenCalledTimes(1);
      // Should only send non-empty messages
      expect(mockWriteToWorkingMemory).toHaveBeenCalledWith(
        "agent1",
        "workspace1",
        "conv1",
        [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ]
      );
    });
  });

  describe("cost calculation with finalCostUsd", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockDb: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockWriteToWorkingMemory: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockCalculateConversationCosts: any;

    beforeEach(async () => {
      // Mock calculateConversationCosts
      const tokenAccountingModule = await import("../tokenAccounting");
      mockCalculateConversationCosts = vi.fn().mockReturnValue({ usd: 1000 });
      vi.spyOn(tokenAccountingModule, "calculateConversationCosts").mockImplementation(
        mockCalculateConversationCosts
      );

      // Mock the database
      mockDb = {
        "agent-conversations": {
          create: vi.fn().mockResolvedValue(undefined),
          atomicUpdate: vi.fn(async (pk, sk, callback) => {
            const result = await callback(null);
            return result;
          }),
        },
      };

      // Mock writeToWorkingMemory
      const memoryWriteModule = await import("../memory/writeMemory");
      mockWriteToWorkingMemory = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(memoryWriteModule, "writeToWorkingMemory").mockImplementation(
        mockWriteToWorkingMemory
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should prefer finalCostUsd over calculated cost when creating conversation", async () => {
      const messages: UIMessage[] = [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: "Hi there",
          modelName: "openrouter/auto",
          provider: "openrouter",
          openrouterGenerationId: "gen-12345",
          finalCostUsd: 2000, // Final cost from OpenRouter API (in millionths)
          tokenUsage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        },
      ];

      await startConversation(mockDb, {
        workspaceId: "workspace1",
        agentId: "agent1",
        conversationType: "test",
        messages,
      });

      // Should use finalCostUsd (2000) instead of calculating from tokenUsage
      expect(mockCalculateConversationCosts).not.toHaveBeenCalled();
      expect(mockDb["agent-conversations"].create).toHaveBeenCalledWith(
        expect.objectContaining({
          costUsd: 2000,
        })
      );
    });

    it("should calculate cost from tokenUsage when finalCostUsd not available", async () => {
      const messages: UIMessage[] = [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: "Hi there",
          modelName: "openrouter/auto",
          provider: "openrouter",
          tokenUsage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
          // No finalCostUsd
        },
      ];

      await startConversation(mockDb, {
        workspaceId: "workspace1",
        agentId: "agent1",
        conversationType: "test",
        messages,
      });

      // Should calculate from tokenUsage
      expect(mockCalculateConversationCosts).toHaveBeenCalledWith(
        "openrouter",
        "openrouter/auto",
        expect.objectContaining({
          promptTokens: 100,
          completionTokens: 50,
        })
      );
      expect(mockDb["agent-conversations"].create).toHaveBeenCalledWith(
        expect.objectContaining({
          costUsd: 1000, // From mockCalculateConversationCosts
        })
      );
    });

    it("should sum finalCostUsd from multiple messages when updating conversation", async () => {
      // Existing conversation with one message that has finalCostUsd
      mockDb["agent-conversations"].atomicUpdate = vi.fn(
        async (pk, sk, callback) => {
          const existingConversation = {
            pk,
            workspaceId: "workspace1",
            agentId: "agent1",
            conversationId: "conv1",
            conversationType: "test" as const,
            messages: [
              {
                role: "assistant",
                content: "First response",
                finalCostUsd: 1500,
              },
            ] as UIMessage[],
            startedAt: new Date().toISOString(),
            expires: Date.now() + 1000000,
          };
          const result = await callback(existingConversation);
          return result;
        }
      );

      const messages: UIMessage[] = [
        {
          role: "assistant",
          content: "First response",
          finalCostUsd: 1500,
        },
        {
          role: "assistant",
          content: "Second response",
          finalCostUsd: 2000,
        },
      ];

      await updateConversation(
        mockDb,
        "workspace1",
        "agent1",
        "conv1",
        messages
      );

      // Verify atomicUpdate was called and cost is sum of both finalCostUsd
      expect(mockDb["agent-conversations"].atomicUpdate).toHaveBeenCalled();
      const updateCall = mockDb["agent-conversations"].atomicUpdate.mock
        .calls[0][2];
      const updated = await updateCall({
        pk: "conversations/workspace1/agent1/conv1",
        workspaceId: "workspace1",
        agentId: "agent1",
        conversationId: "conv1",
        conversationType: "test" as const,
        messages: [
          {
            role: "assistant",
            content: "First response",
            finalCostUsd: 1500,
          },
        ] as UIMessage[],
        startedAt: new Date().toISOString(),
        expires: Date.now() + 1000000,
      });

      expect(updated.costUsd).toBe(3500); // 1500 + 2000
      // Should not call calculateConversationCosts since both messages have finalCostUsd
      expect(mockCalculateConversationCosts).not.toHaveBeenCalled();
    });

    it("should mix finalCostUsd and calculated costs when updating conversation", async () => {
      mockDb["agent-conversations"].atomicUpdate = vi.fn(
        async (pk, sk, callback) => {
          const existingConversation = {
            pk,
            workspaceId: "workspace1",
            agentId: "agent1",
            conversationId: "conv1",
            conversationType: "test" as const,
            messages: [] as UIMessage[],
            startedAt: new Date().toISOString(),
            expires: Date.now() + 1000000,
          };
          const result = await callback(existingConversation);
          return result;
        }
      );

      const messages: UIMessage[] = [
        {
          role: "assistant",
          content: "First response",
          modelName: "openrouter/auto",
          provider: "openrouter",
          finalCostUsd: 2000, // Has finalCostUsd
        },
        {
          role: "assistant",
          content: "Second response",
          modelName: "openrouter/auto",
          provider: "openrouter",
          tokenUsage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
          // No finalCostUsd - should calculate
        },
      ];

      await updateConversation(
        mockDb,
        "workspace1",
        "agent1",
        "conv1",
        messages
      );

      // Should calculate cost for second message only
      expect(mockCalculateConversationCosts).toHaveBeenCalledTimes(1);
      expect(mockCalculateConversationCosts).toHaveBeenCalledWith(
        "openrouter",
        "openrouter/auto",
        expect.objectContaining({
          promptTokens: 100,
          completionTokens: 50,
        })
      );

      const updateCall = mockDb["agent-conversations"].atomicUpdate.mock
        .calls[0][2];
      const updated = await updateCall({
        pk: "conversations/workspace1/agent1/conv1",
        workspaceId: "workspace1",
        agentId: "agent1",
        conversationId: "conv1",
        conversationType: "test" as const,
        messages: [] as UIMessage[],
        startedAt: new Date().toISOString(),
        expires: Date.now() + 1000000,
      });

      // Total should be 2000 (finalCostUsd) + 1000 (calculated) = 3000
      expect(updated.costUsd).toBe(3000);
    });
  });

  describe("error persistence", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockDb: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockWriteToWorkingMemory: any;

    beforeEach(async () => {
      mockDb = {
        "agent-conversations": {
          create: vi.fn().mockResolvedValue(undefined),
          atomicUpdate: vi.fn(async (_pk: string, _sk: unknown, callback: (existing: unknown) => unknown) => {
            return callback(null);
          }),
        },
      };

      const memoryWriteModule = await import("../memory/writeMemory");
      mockWriteToWorkingMemory = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(memoryWriteModule, "writeToWorkingMemory").mockImplementation(
        mockWriteToWorkingMemory
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("stores error details when starting a conversation", async () => {
      await startConversation(mockDb, {
        workspaceId: "workspace-error",
        agentId: "agent-error",
        conversationType: "test",
        messages: [{ role: "user", content: "hello" }],
        error: {
          message: "LLM failure",
          stack: "stack-trace",
          provider: "openrouter",
        },
      });

      expect(mockDb["agent-conversations"].create).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: "LLM failure",
            stack: "stack-trace",
            provider: "openrouter",
          }),
        })
      );
    });

    it("stores error details when updating a conversation", async () => {
      await updateConversation(
        mockDb,
        "workspace-error",
        "agent-error",
        "conv-error",
        [{ role: "user", content: "hello" }],
        undefined,
        undefined,
        {
          message: "provider timeout",
          stack: "timeout-stack",
          statusCode: 504,
        }
      );

      expect(mockDb["agent-conversations"].atomicUpdate).toHaveBeenCalled();
      const atomicCallback =
        mockDb["agent-conversations"].atomicUpdate.mock.calls[0][2];
      const updated = await atomicCallback(null);
      expect(updated.error).toEqual(
        expect.objectContaining({
          message: "provider timeout",
          stack: "timeout-stack",
          statusCode: 504,
        })
      );
    });
  });
});
