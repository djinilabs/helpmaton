import { describe, it, expect, vi } from "vitest";

vi.mock("../s3", () => ({
  deleteS3Object: vi.fn().mockResolvedValue(undefined),
  putS3Object: vi.fn().mockResolvedValue(undefined),
  getS3ObjectBody: vi.fn().mockResolvedValue(
    Buffer.from(JSON.stringify([{ role: "user", content: "from S3" }]), "utf-8"),
  ),
}));

import type { AgentConversationRecord } from "../../tables/schema";
import {
  calculateTTL,
  createRecord,
  deleteRecord,
  deleteAllRecordsForAgent,
  getRecord,
  queryRecords,
  queryRecordsPaginated,
  upsertRecord,
  atomicUpdateRecord,
} from "../conversationRecords";
import { deleteS3Object, getS3ObjectBody, putS3Object } from "../s3";

describe("conversationRecords", () => {
  describe("calculateTTL", () => {
    it("returns a number in seconds (no sub-second)", () => {
      const ttl = calculateTTL();
      expect(typeof ttl).toBe("number");
      expect(Number.isInteger(ttl)).toBe(true);
      expect(ttl).toBeGreaterThan(0);
    });

    it("returns roughly 30 days from now", () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const ttl = calculateTTL();
      const thirtyDaysSec = 30 * 24 * 60 * 60;
      expect(ttl).toBeGreaterThanOrEqual(nowSec);
      expect(ttl).toBeLessThanOrEqual(nowSec + thirtyDaysSec + 60); // allow 1 min skew
    });
  });

  describe("createRecord", () => {
    it("sets expires when not provided", async () => {
      const mockCreate = vi.fn().mockResolvedValue({});
      const db = {
        "agent-conversations": {
          create: mockCreate,
        },
      } as never;

      const now = new Date().toISOString();
      await createRecord(db, {
        pk: "conversations/ws1/ag1/conv1",
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test",
        messages: [],
        startedAt: now,
        lastMessageAt: now,
        expires: undefined as unknown as number,
      } as unknown as Omit<AgentConversationRecord, "version" | "createdAt">);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          expires: expect.any(Number),
          pk: "conversations/ws1/ag1/conv1",
        }),
      );
      const callExpires = mockCreate.mock.calls[0][0].expires;
      const nowSec = Math.floor(Date.now() / 1000);
      expect(callExpires).toBeGreaterThanOrEqual(nowSec);
      expect(callExpires).toBeLessThanOrEqual(nowSec + 31 * 24 * 60 * 60);
    });

    it("preserves expires when provided", async () => {
      const mockCreate = vi.fn().mockResolvedValue({});
      const db = {
        "agent-conversations": {
          create: mockCreate,
        },
      } as never;

      const now = new Date().toISOString();
      const customExpires = 999999;
      await createRecord(db, {
        pk: "conversations/ws1/ag1/conv1",
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test",
        messages: [],
        startedAt: now,
        lastMessageAt: now,
        expires: customExpires,
      } as unknown as Omit<AgentConversationRecord, "version" | "createdAt">);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          expires: customExpires,
        }),
      );
    });

    it("uploads messages to S3 and creates with messagesS3Key when record exceeds size limit", async () => {
      const mockCreate = vi.fn().mockResolvedValue({});
      const db = {
        "agent-conversations": {
          create: mockCreate,
        },
      } as never;

      const now = new Date().toISOString();
      const largeContent = "x".repeat(400_000);
      await createRecord(db, {
        pk: "conversations/ws1/ag1/conv1",
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test",
        messages: [{ role: "user", content: largeContent }],
        startedAt: now,
        lastMessageAt: now,
        expires: 999999,
      } as unknown as Omit<AgentConversationRecord, "version" | "createdAt">);

      expect(putS3Object).toHaveBeenCalledWith(
        "conversation-messages/ws1/ag1/conv1.json",
        expect.any(String),
        "application/json",
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [],
          messagesS3Key: "conversation-messages/ws1/ag1/conv1.json",
          pk: "conversations/ws1/ag1/conv1",
        }),
      );
    });
  });

  describe("upsertRecord", () => {
    it("sets expires when not provided", async () => {
      const mockUpsert = vi.fn().mockResolvedValue({});
      const db = {
        "agent-conversations": {
          upsert: mockUpsert,
        },
      } as never;

      const now = new Date().toISOString();
      await upsertRecord(db, {
        pk: "conversations/ws1/ag1/conv1",
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test",
        messages: [],
        startedAt: now,
        lastMessageAt: now,
        expires: undefined as unknown as number,
      } as unknown as Omit<AgentConversationRecord, "version">);

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          expires: expect.any(Number),
        }),
      );
    });

    it("uploads messages to S3 and upserts with messagesS3Key when record exceeds size limit", async () => {
      const mockUpsert = vi.fn().mockResolvedValue({});
      const db = {
        "agent-conversations": {
          upsert: mockUpsert,
        },
      } as never;

      const now = new Date().toISOString();
      const largeContent = "y".repeat(400_000);
      await upsertRecord(db, {
        pk: "conversations/ws1/ag1/conv1",
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test",
        messages: [{ role: "user", content: largeContent }],
        startedAt: now,
        lastMessageAt: now,
        expires: 888888,
      } as unknown as Omit<AgentConversationRecord, "version">);

      expect(putS3Object).toHaveBeenCalledWith(
        "conversation-messages/ws1/ag1/conv1.json",
        expect.any(String),
        "application/json",
      );
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [],
          messagesS3Key: "conversation-messages/ws1/ag1/conv1.json",
        }),
      );
    });

    it("when record already has messagesS3Key, re-uploads to S3 and stores messages: [] (authoritative)", async () => {
      const mockUpsert = vi.fn().mockResolvedValue({});
      const db = {
        "agent-conversations": {
          upsert: mockUpsert,
        },
      } as never;

      const now = new Date().toISOString();
      await upsertRecord(db, {
        pk: "conversations/ws1/ag1/conv1",
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test",
        messages: [{ role: "user", content: "small" }],
        messagesS3Key: "conversation-messages/ws1/ag1/conv1.json",
        startedAt: now,
        lastMessageAt: now,
        expires: 888888,
      } as unknown as Omit<AgentConversationRecord, "version">);

      expect(putS3Object).toHaveBeenCalledWith(
        "conversation-messages/ws1/ag1/conv1.json",
        JSON.stringify([{ role: "user", content: "small" }]),
        "application/json",
      );
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [],
          messagesS3Key: "conversation-messages/ws1/ag1/conv1.json",
        }),
      );
    });
  });

  describe("getRecord", () => {
    it("returns null when record not found", async () => {
      const db = {
        "agent-conversations": {
          get: vi.fn().mockResolvedValue(undefined),
        },
      } as never;

      const result = await getRecord(db, "conversations/ws1/ag1/conv1");
      expect(result).toBeNull();
    });

    it("returns record when found", async () => {
      const record = {
        pk: "conversations/ws1/ag1/conv1",
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test" as const,
        messages: [],
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: calculateTTL(),
      };
      const db = {
        "agent-conversations": {
          get: vi.fn().mockResolvedValue(record),
        },
      } as never;

      const result = await getRecord(db, "conversations/ws1/ag1/conv1");
      expect(result).toEqual(record);
    });

    it("fetches messages from S3 when record has messagesS3Key", async () => {
      const record = {
        pk: "conversations/ws1/ag1/conv1",
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test" as const,
        messages: [],
        messagesS3Key: "conversation-messages/ws1/ag1/conv1.json",
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: calculateTTL(),
      };
      const db = {
        "agent-conversations": {
          get: vi.fn().mockResolvedValue(record),
        },
      } as never;

      const result = await getRecord(db, "conversations/ws1/ag1/conv1");

      expect(getS3ObjectBody).toHaveBeenCalledWith(
        "conversation-messages/ws1/ag1/conv1.json",
      );
      expect(result).toEqual({
        ...record,
        messages: [{ role: "user", content: "from S3" }],
      });
    });

    it("returns record without S3 fetch when enrichFromS3: false", async () => {
      vi.mocked(getS3ObjectBody).mockClear();
      const record = {
        pk: "conversations/ws1/ag1/conv1",
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test" as const,
        messages: [],
        messagesS3Key: "conversation-messages/ws1/ag1/conv1.json",
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: calculateTTL(),
      };
      const db = {
        "agent-conversations": {
          get: vi.fn().mockResolvedValue(record),
        },
      } as never;

      const result = await getRecord(db, "conversations/ws1/ag1/conv1", undefined, {
        enrichFromS3: false,
      });

      expect(getS3ObjectBody).not.toHaveBeenCalled();
      expect(result).toEqual(record);
    });

    it("returns record without enrichment when S3 fetch fails", async () => {
      vi.mocked(getS3ObjectBody).mockRejectedValueOnce(new Error("S3 unavailable"));
      const record = {
        pk: "conversations/ws1/ag1/conv1",
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test" as const,
        messages: [],
        messagesS3Key: "conversation-messages/ws1/ag1/conv1.json",
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: calculateTTL(),
      };
      const db = {
        "agent-conversations": {
          get: vi.fn().mockResolvedValue(record),
        },
      } as never;

      const result = await getRecord(db, "conversations/ws1/ag1/conv1");

      expect(result).toEqual(record);
      expect(result?.messages).toEqual([]);
    });
  });

  describe("queryRecords", () => {
    it("returns items and areAnyUnpublished from table query", async () => {
      const items = [{ pk: "p1", conversationId: "c1" }];
      const db = {
        "agent-conversations": {
          query: vi.fn().mockResolvedValue({ items, areAnyUnpublished: false }),
        },
      } as never;

      const result = await queryRecords(db, {
        IndexName: "byAgentId",
        KeyConditionExpression: "agentId = :agentId",
        ExpressionAttributeValues: { ":agentId": "ag1" },
      });

      expect(result.items).toEqual(items);
      expect(result.areAnyUnpublished).toBe(false);
    });

    it("enriches each item from S3 when messagesS3Key is set", async () => {
      const rawItems = [
        {
          pk: "conversations/ws1/ag1/c1",
          conversationId: "c1",
          messages: [],
          messagesS3Key: "conversation-messages/ws1/ag1/c1.json",
          workspaceId: "ws1",
          agentId: "ag1",
          conversationType: "test" as const,
          startedAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
          expires: 999,
        },
      ];
      const db = {
        "agent-conversations": {
          query: vi.fn().mockResolvedValue({ items: rawItems, areAnyUnpublished: false }),
        },
      } as never;

      const result = await queryRecords(db, {
        IndexName: "byAgentId",
        KeyConditionExpression: "agentId = :agentId",
        ExpressionAttributeValues: { ":agentId": "ag1" },
      });

      expect(getS3ObjectBody).toHaveBeenCalledWith("conversation-messages/ws1/ag1/c1.json");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].messages).toEqual([{ role: "user", content: "from S3" }]);
    });

    it("skips S3 enrichment when enrichFromS3 is false", async () => {
      vi.mocked(getS3ObjectBody).mockClear();
      const rawItems = [
        {
          pk: "conversations/ws1/ag1/c1",
          conversationId: "c1",
          messages: [],
          messagesS3Key: "conversation-messages/ws1/ag1/c1.json",
          workspaceId: "ws1",
          agentId: "ag1",
          conversationType: "test" as const,
          startedAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
          expires: 999,
        },
      ];
      const db = {
        "agent-conversations": {
          query: vi.fn().mockResolvedValue({ items: rawItems, areAnyUnpublished: false }),
        },
      } as never;

      const result = await queryRecords(
        db,
        {
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: { ":agentId": "ag1" },
        },
        { enrichFromS3: false },
      );

      expect(getS3ObjectBody).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].messages).toEqual([]);
      expect(result.items[0].messagesS3Key).toBe("conversation-messages/ws1/ag1/c1.json");
    });
  });

  describe("queryRecordsPaginated", () => {
    it("returns items and nextCursor from table queryPaginated", async () => {
      const items = [{ pk: "p1" }];
      const db = {
        "agent-conversations": {
          queryPaginated: vi
            .fn()
            .mockResolvedValue({ items, nextCursor: "cursor1" }),
        },
      } as never;

      const result = await queryRecordsPaginated(
        db,
        { IndexName: "byAgentId", KeyConditionExpression: "agentId = :a", ExpressionAttributeValues: { ":a": "ag1" } },
        { limit: 10 },
      );

      expect(result.items).toEqual(items);
      expect(result.nextCursor).toBe("cursor1");
    });

    it("enriches each item from S3 when messagesS3Key is set", async () => {
      const rawItems = [
        {
          pk: "conversations/ws1/ag1/c2",
          conversationId: "c2",
          messages: [],
          messagesS3Key: "conversation-messages/ws1/ag1/c2.json",
          workspaceId: "ws1",
          agentId: "ag1",
          conversationType: "stream" as const,
          startedAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
          expires: 888,
        },
      ];
      const db = {
        "agent-conversations": {
          queryPaginated: vi
            .fn()
            .mockResolvedValue({ items: rawItems, nextCursor: null }),
        },
      } as never;

      const result = await queryRecordsPaginated(
        db,
        { IndexName: "byAgentId", KeyConditionExpression: "agentId = :a", ExpressionAttributeValues: { ":a": "ag1" } },
        { limit: 10 },
      );

      expect(getS3ObjectBody).toHaveBeenCalledWith("conversation-messages/ws1/ag1/c2.json");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].messages).toEqual([{ role: "user", content: "from S3" }]);
    });

    it("skips S3 enrichment when enrichFromS3 is false", async () => {
      vi.mocked(getS3ObjectBody).mockClear();
      const rawItems = [
        {
          pk: "conversations/ws1/ag1/c2",
          conversationId: "c2",
          messages: [],
          messagesS3Key: "conversation-messages/ws1/ag1/c2.json",
          workspaceId: "ws1",
          agentId: "ag1",
          conversationType: "stream" as const,
          startedAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
          expires: 888,
        },
      ];
      const db = {
        "agent-conversations": {
          queryPaginated: vi
            .fn()
            .mockResolvedValue({ items: rawItems, nextCursor: null }),
        },
      } as never;

      const result = await queryRecordsPaginated(
        db,
        { IndexName: "byAgentId", KeyConditionExpression: "agentId = :a", ExpressionAttributeValues: { ":a": "ag1" } },
        { limit: 10, enrichFromS3: false },
      );

      expect(getS3ObjectBody).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].messages).toEqual([]);
      expect(result.items[0].messagesS3Key).toBe("conversation-messages/ws1/ag1/c2.json");
    });
  });

  describe("deleteRecord", () => {
    it("deletes by pk and returns deleted item", async () => {
      const deleted = { pk: "conversations/ws1/ag1/conv1", sk: undefined };
      const mockDelete = vi.fn().mockResolvedValue(deleted);
      const db = {
        "agent-conversations": {
          delete: mockDelete,
        },
      } as never;

      const result = await deleteRecord(db, "conversations/ws1/ag1/conv1");

      expect(mockDelete).toHaveBeenCalledWith(
        "conversations/ws1/ag1/conv1",
        undefined,
      );
      expect(result).toEqual(deleted);
    });

    it("throws when record not found", async () => {
      const mockDelete = vi.fn().mockRejectedValue(new Error("Item not found"));
      const db = {
        "agent-conversations": {
          delete: mockDelete,
        },
      } as never;

      await expect(
        deleteRecord(db, "conversations/ws1/ag1/conv1"),
      ).rejects.toThrow("Conversation record not found");
      expect(mockDelete).toHaveBeenCalled();
    });

    it("rethrows when delete fails with non-not-found error", async () => {
      const mockDelete = vi
        .fn()
        .mockRejectedValue(new Error("Network error"));
      const db = {
        "agent-conversations": {
          delete: mockDelete,
        },
      } as never;

      await expect(
        deleteRecord(db, "conversations/ws1/ag1/conv1"),
      ).rejects.toThrow("Network error");
    });

    it("calls deleteS3Object when record has messagesS3Key", async () => {
      const deleted = {
        pk: "conversations/ws1/ag1/conv1",
        sk: undefined,
        messagesS3Key: "conversations/ws1/ag1/conv1/messages.json",
      };
      const mockDelete = vi.fn().mockResolvedValue(deleted);
      const db = {
        "agent-conversations": {
          delete: mockDelete,
        },
      } as never;

      await deleteRecord(db, "conversations/ws1/ag1/conv1");

      expect(deleteS3Object).toHaveBeenCalledWith(
        "conversations/ws1/ag1/conv1/messages.json",
      );
    });
  });

  describe("deleteAllRecordsForAgent", () => {
    it("calls queryAsync and deletes each record and S3 objects", async () => {
      const conversation = {
        pk: "conversations/ws1/ag1/conv1",
        sk: "conversation",
        workspaceId: "ws1",
        agentId: "ag1",
        messages: [
          {
            role: "user",
            content:
              "https://s3.example.com/bucket/conversation-files/ws1/ag1/conv1/file.pdf",
          },
        ],
      };
      const mockQueryAsync = vi.fn().mockReturnValue(
        (async function* () {
          yield conversation;
        })(),
      );
      const mockDelete = vi.fn().mockResolvedValue(undefined);

      const db = {
        "agent-conversations": {
          queryAsync: mockQueryAsync,
          delete: mockDelete,
        },
      } as never;

      await deleteAllRecordsForAgent(db, "ws1", "ag1");

      expect(mockQueryAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: "byAgentId",
          KeyConditionExpression: "agentId = :agentId",
          ExpressionAttributeValues: {
            ":agentId": "ag1",
            ":workspaceId": "ws1",
          },
        }),
      );
      expect(mockDelete).toHaveBeenCalledWith(
        "conversations/ws1/ag1/conv1",
        "conversation",
      );
    });

    it("calls deleteS3Object for conversation file keys extracted from messages", async () => {
      const conversation = {
        pk: "conversations/ws1/ag1/conv1",
        sk: "conversation",
        workspaceId: "ws1",
        agentId: "ag1",
        messages: [
          {
            role: "user",
            content:
              "https://s3.example.com/bucket/conversation-files/ws1/ag1/conv1/file.pdf",
          },
        ],
      };
      const mockQueryAsync = vi.fn().mockReturnValue(
        (async function* () {
          yield conversation;
        })(),
      );
      const mockDelete = vi.fn().mockResolvedValue(undefined);

      const db = {
        "agent-conversations": {
          queryAsync: mockQueryAsync,
          delete: mockDelete,
        },
      } as never;

      await deleteAllRecordsForAgent(db, "ws1", "ag1");

      expect(deleteS3Object).toHaveBeenCalledWith(
        "conversation-files/ws1/ag1/conv1/file.pdf",
      );
    });

    it("fetches messages from S3 when record has messagesS3Key and deletes file keys from those messages", async () => {
      const messagesInS3 = [
        {
          role: "user",
          content:
            "https://s3.example.com/bucket/conversation-files/ws1/ag1/conv2/attachment.pdf",
        },
      ];
      const conversation = {
        pk: "conversations/ws1/ag1/conv2",
        sk: "conversation",
        workspaceId: "ws1",
        agentId: "ag1",
        messages: [],
        messagesS3Key: "conversation-messages/ws1/ag1/conv2.json",
      };
      vi.mocked(getS3ObjectBody).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(messagesInS3), "utf-8"),
      );
      const mockQueryAsync = vi.fn().mockReturnValue(
        (async function* () {
          yield conversation;
        })(),
      );
      const mockDelete = vi.fn().mockResolvedValue(undefined);

      const db = {
        "agent-conversations": {
          queryAsync: mockQueryAsync,
          delete: mockDelete,
        },
      } as never;

      await deleteAllRecordsForAgent(db, "ws1", "ag1");

      expect(getS3ObjectBody).toHaveBeenCalledWith(
        "conversation-messages/ws1/ag1/conv2.json",
      );
      expect(deleteS3Object).toHaveBeenCalledWith(
        "conversation-files/ws1/ag1/conv2/attachment.pdf",
      );
      expect(deleteS3Object).toHaveBeenCalledWith(
        "conversation-messages/ws1/ag1/conv2.json",
      );
    });
  });

  describe("atomicUpdateRecord", () => {
    it("passes through to table atomicUpdate", async () => {
      const updated = {
        pk: "conversations/ws1/ag1/conv1",
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test" as const,
        messages: [],
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: calculateTTL(),
      };
      const mockAtomicUpdate = vi.fn().mockResolvedValue(updated);
      const db = {
        "agent-conversations": {
          atomicUpdate: mockAtomicUpdate,
        },
      } as never;

      const result = await atomicUpdateRecord(
        db,
        "conversations/ws1/ag1/conv1",
        undefined,
        async (current) => ({
          pk: current?.pk ?? "conversations/ws1/ag1/conv1",
          delegations: [],
        }),
      );

      expect(mockAtomicUpdate).toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it("enriches current from S3 when record has messagesS3Key so updater receives full messages", async () => {
      vi.mocked(putS3Object).mockClear();
      let receivedCurrent: AgentConversationRecord | undefined;
      const rawCurrent = {
        pk: "conversations/ws1/ag1/conv1",
        sk: undefined as string | undefined,
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test" as const,
        messages: [],
        messagesS3Key: "conversation-messages/ws1/ag1/conv1.json",
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: calculateTTL(),
        version: 1,
      };
      const mockAtomicUpdate = vi.fn().mockImplementation(async (_pk: string, _sk: string | undefined, callback: (current: unknown) => Promise<unknown>) => {
        return callback(rawCurrent);
      });
      const db = {
        "agent-conversations": {
          atomicUpdate: mockAtomicUpdate,
        },
      } as never;

      await atomicUpdateRecord(
        db,
        "conversations/ws1/ag1/conv1",
        undefined,
        async (current) => {
          receivedCurrent = current ?? undefined;
          return { pk: current?.pk ?? "conversations/ws1/ag1/conv1", delegations: [] };
        },
      );

      expect(getS3ObjectBody).toHaveBeenCalledWith("conversation-messages/ws1/ag1/conv1.json");
      expect(receivedCurrent?.messages).toEqual([{ role: "user", content: "from S3" }]);
      // Merged record uses enriched messages; ensure we did not overwrite S3 with []
      expect(putS3Object).toHaveBeenCalledWith(
        "conversation-messages/ws1/ag1/conv1.json",
        expect.any(String),
        "application/json",
      );
      const [, body] = vi.mocked(putS3Object).mock.calls[0];
      expect(JSON.parse(body as string)).toEqual([{ role: "user", content: "from S3" }]);
    });

    it("delegates to S3 when merged record exceeds size limit", async () => {
      const rawCurrent = {
        pk: "conversations/ws1/ag1/conv1",
        sk: undefined as string | undefined,
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test" as const,
        messages: [],
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: calculateTTL(),
        version: 1,
      };
      let putItem: unknown;
      const mockAtomicUpdate = vi.fn().mockImplementation(async (_pk: string, _sk: string | undefined, callback: (current: unknown) => Promise<unknown>) => {
        const result = await callback(rawCurrent);
        putItem = result;
        return result;
      });
      const db = {
        "agent-conversations": {
          atomicUpdate: mockAtomicUpdate,
        },
      } as never;

      await atomicUpdateRecord(
        db,
        "conversations/ws1/ag1/conv1",
        undefined,
        async (current) => ({
          pk: current?.pk ?? "conversations/ws1/ag1/conv1",
          messages: [{ role: "user", content: "x".repeat(400_000) }],
        }),
      );

      expect(putS3Object).toHaveBeenCalledWith(
        "conversation-messages/ws1/ag1/conv1.json",
        expect.any(String),
        "application/json",
      );
      expect(putItem).toEqual(
        expect.objectContaining({
          messages: [],
          messagesS3Key: "conversation-messages/ws1/ag1/conv1.json",
        }),
      );
    });

    it("returns enriched record from S3 when written record has messagesS3Key", async () => {
      const rawCurrent = {
        pk: "conversations/ws1/ag1/conv1",
        sk: undefined as string | undefined,
        workspaceId: "ws1",
        agentId: "ag1",
        conversationId: "conv1",
        conversationType: "test" as const,
        messages: [],
        startedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        expires: calculateTTL(),
        version: 1,
      };
      const writtenRecord = {
        ...rawCurrent,
        messages: [],
        messagesS3Key: "conversation-messages/ws1/ag1/conv1.json",
      };
      const mockAtomicUpdate = vi.fn().mockResolvedValue(writtenRecord);
      const db = {
        "agent-conversations": {
          atomicUpdate: mockAtomicUpdate,
        },
      } as never;

      const result = await atomicUpdateRecord(
        db,
        "conversations/ws1/ag1/conv1",
        undefined,
        async (current) => ({
          pk: current?.pk ?? "conversations/ws1/ag1/conv1",
          messages: [{ role: "user", content: "x".repeat(400_000) }],
        }),
      );

      expect(getS3ObjectBody).toHaveBeenCalledWith("conversation-messages/ws1/ag1/conv1.json");
      expect(result.messages).toEqual([{ role: "user", content: "from S3" }]);
    });
  });
});
