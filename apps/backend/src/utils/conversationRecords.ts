/**
 * Conversation records module
 *
 * Single place for agent-conversation record creation, retrieval, enrichment (from S3 when required),
 * and removal.
 *
 * (a) Enrichment: Every record we retrieve from DynamoDB is automatically enriched from S3 when
 * the record has messagesS3Key—getRecord, queryRecords, queryRecordsPaginated, and the return
 * value of atomicUpdateRecord all return records with messages populated from S3 when applicable.
 *
 * (b) S3 overflow: Every create or update path automatically delegates to S3 when the record
 * exceeds the size limit—createRecord, upsertRecord, and atomicUpdateRecord all run the payload
 * through ensureMessagesInDynamoOrS3 before writing (messages stored in S3, messagesS3Key set).
 *
 * All S3 fetches for conversation-messages/* are done only in this module. Conversation records
 * are not explicitly deleted for expiry—DynamoDB TTL on `expires` removes them. Only explicit
 * removal is via deleteRecord or deleteAllRecordsForAgent (e.g. agent cleanup).
 */

import type { DatabaseSchema , AgentConversationRecord , Query } from "../tables/schema";

import { deleteS3Object, getS3ObjectBody, putS3Object } from "./s3";

const CONVERSATION_UPSERT_MAX_ATTEMPTS = 3;
const CONVERSATION_UPSERT_BASE_DELAY_MS = 100;

/** DynamoDB item size limit is 400 KB; we overflow messages to S3 below this to leave headroom. */
const MAX_RECORD_SIZE_BYTES = 350_000;

function buildMessagesS3Key(
  workspaceId: string,
  agentId: string,
  conversationId: string,
): string {
  return `conversation-messages/${workspaceId}/${agentId}/${conversationId}.json`;
}

function estimateRecordSizeBytes(record: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(record), "utf-8");
}

/**
 * If the record exceeds MAX_RECORD_SIZE_BYTES, upload messages to S3 and return a record with
 * messages: [] and messagesS3Key set. Otherwise return the record unchanged.
 */
async function ensureMessagesInDynamoOrS3<
  T extends {
    messages: unknown[];
    workspaceId: string;
    agentId: string;
    conversationId: string;
  },
>(record: T): Promise<T & { messagesS3Key?: string }> {
  const size = estimateRecordSizeBytes(record as Record<string, unknown>);
  if (size <= MAX_RECORD_SIZE_BYTES) {
    return record as T & { messagesS3Key?: string };
  }
  const key = buildMessagesS3Key(
    record.workspaceId,
    record.agentId,
    record.conversationId,
  );
  await putS3Object(key, JSON.stringify(record.messages), "application/json");
  return { ...record, messages: [], messagesS3Key: key } as T & {
    messagesS3Key: string;
  };
}

/**
 * Calculate TTL timestamp (30 days from now in seconds).
 * Used for DynamoDB TTL on the `expires` attribute; items are removed automatically after this time.
 */
export function calculateTTL(): number {
  return Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConversationVersionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  return (
    message.includes("item was outdated") ||
    message.includes("item already exists") ||
    message.includes("conditional request failed") ||
    message.includes("conditionalcheckfailed")
  );
}

/**
 * Create a single conversation record (used when record does not exist).
 * Sets expires: calculateTTL(). If the record exceeds the size limit, messages are stored in S3
 * and the DynamoDB item has messages: [] and messagesS3Key set.
 */
export async function createRecord(
  db: DatabaseSchema,
  record: Omit<AgentConversationRecord, "version" | "createdAt">,
): Promise<AgentConversationRecord> {
  const withExpires = {
    ...record,
    expires: record.expires ?? calculateTTL(),
  };
  const toWrite = await ensureMessagesInDynamoOrS3(withExpires);
  return db["agent-conversations"].create(toWrite) as Promise<AgentConversationRecord>;
}

/**
 * Upsert a conversation record with conflict retry.
 * Sets expires if not already set. If the record exceeds the size limit, messages are stored
 * in S3 and the DynamoDB item has messages: [] and messagesS3Key set.
 */
export async function upsertRecord(
  db: DatabaseSchema,
  record: Omit<AgentConversationRecord, "version">,
): Promise<AgentConversationRecord> {
  const withExpires = {
    ...record,
    expires: record.expires ?? calculateTTL(),
  };
  const toWrite = await ensureMessagesInDynamoOrS3(withExpires);
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < CONVERSATION_UPSERT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return (await db["agent-conversations"].upsert(toWrite)) as AgentConversationRecord;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (
        isConversationVersionConflict(error) &&
        attempt < CONVERSATION_UPSERT_MAX_ATTEMPTS - 1
      ) {
        const backoffMs = CONVERSATION_UPSERT_BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[Conversation Records] Upsert conflict, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${CONVERSATION_UPSERT_MAX_ATTEMPTS}):`,
          {
            conversationId: record.conversationId,
            workspaceId: record.workspaceId,
            agentId: record.agentId,
            error: lastError.message,
          },
        );
        await sleep(backoffMs);
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    `Failed to upsert conversation after ${CONVERSATION_UPSERT_MAX_ATTEMPTS} attempts: ${lastError?.message || "Unknown error"}`,
  );
}

/**
 * Atomic update with enriched current and S3 overflow. The table fetches the current record; we
 * enrich it from S3 when messagesS3Key is set so the updater receives full messages. The updater
 * result is merged with current; if the merged record exceeds the size limit, messages are moved to
 * S3 (messagesS3Key set, messages: []). Omit `expires` in the updater return to preserve TTL, or
 * set `expires: calculateTTL()` to refresh it.
 */
export async function atomicUpdateRecord(
  db: DatabaseSchema,
  pk: string,
  sk: string | undefined,
  updater: (
    current: AgentConversationRecord | undefined,
  ) => Promise<Partial<AgentConversationRecord> & { pk: string }>,
  options?: { maxRetries?: number },
): Promise<AgentConversationRecord> {
  const table = db["agent-conversations"];
  const written = (await table.atomicUpdate(
    pk,
    sk,
    async (rawCurrent) => {
      const enriched = rawCurrent
        ? await enrichRecordFromS3(rawCurrent as AgentConversationRecord & { messagesS3Key?: string })
        : undefined;
      const partial = await updater(enriched);
      const now = new Date().toISOString();
      const merged = rawCurrent
        ? {
            ...rawCurrent,
            ...partial,
            version: (rawCurrent as AgentConversationRecord).version + 1,
            updatedAt: now,
            pk: (rawCurrent as { pk: string }).pk,
            sk: (rawCurrent as { sk?: string }).sk,
          }
        : {
            ...partial,
            version: 1,
            createdAt: now,
            updatedAt: now,
            expires: partial.expires ?? calculateTTL(),
          };
      return (await ensureMessagesInDynamoOrS3(
        merged as AgentConversationRecord & { messagesS3Key?: string },
      )) as Partial<AgentConversationRecord> & { pk: string };
    },
    options,
  )) as AgentConversationRecord & { messagesS3Key?: string };
  return enrichRecordFromS3(written);
}

/**
 * Get a conversation record by pk. When the record has messagesS3Key, messages are fetched
 * from S3 and attached. Returns null if not found.
 */
export async function getRecord(
  db: DatabaseSchema,
  pk: string,
  sk?: string,
): Promise<AgentConversationRecord | null> {
  const raw = (await db["agent-conversations"].get(pk, sk)) as (AgentConversationRecord & {
    messagesS3Key?: string;
  }) | null;
  if (!raw) {
    return null;
  }
  return enrichRecordFromS3(raw);
}

/**
 * Query conversation records. Each item is automatically enriched from S3 when messagesS3Key is set.
 */
export async function queryRecords(
  db: DatabaseSchema,
  query: Query,
): Promise<{ items: AgentConversationRecord[]; areAnyUnpublished: boolean }> {
  const result = await db["agent-conversations"].query(query);
  const rawItems = result.items as (AgentConversationRecord & { messagesS3Key?: string })[];
  const items = await Promise.all(rawItems.map((item) => enrichRecordFromS3(item)));
  return {
    items,
    areAnyUnpublished: result.areAnyUnpublished,
  };
}

/**
 * Query conversation records with pagination. Each item is automatically enriched from S3 when
 * messagesS3Key is set.
 */
export async function queryRecordsPaginated(
  db: DatabaseSchema,
  query: Query,
  options: { limit: number; cursor?: string | null; version?: string | null },
): Promise<{ items: AgentConversationRecord[]; nextCursor: string | null }> {
  const result = await db["agent-conversations"].queryPaginated(query, options);
  const rawItems = result.items as (AgentConversationRecord & { messagesS3Key?: string })[];
  const items = await Promise.all(rawItems.map((item) => enrichRecordFromS3(item)));
  return {
    items,
    nextCursor: result.nextCursor,
  };
}

/**
 * Delete one conversation record. If the record had messagesS3Key, deletes that S3 object too.
 * Throws if the record is not found (avoids calling table delete and gives a clear error).
 */
export async function deleteRecord(
  db: DatabaseSchema,
  pk: string,
  sk?: string,
): Promise<AgentConversationRecord> {
  const record = (await db["agent-conversations"].get(pk, sk)) as (AgentConversationRecord & {
    messagesS3Key?: string;
  }) | undefined;
  if (!record) {
    throw new Error("Conversation record not found");
  }
  const deleted = await db["agent-conversations"].delete(pk, sk);
  if (record.messagesS3Key) {
    try {
      await deleteS3Object(record.messagesS3Key);
    } catch (error) {
      console.warn(
        `[Conversation Records] Failed to delete S3 messages blob ${record.messagesS3Key}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return deleted as AgentConversationRecord;
}

function normalizeConversationFileKey(value: string, workspaceId: string): string | null {
  const keyPrefix = `conversation-files/${workspaceId}/`;
  const startIndex = value.indexOf(keyPrefix);
  if (startIndex === -1) {
    return null;
  }
  let endIndex = value.length;
  const queryIndex = value.indexOf("?", startIndex);
  if (queryIndex !== -1) {
    endIndex = Math.min(endIndex, queryIndex);
  }
  const hashIndex = value.indexOf("#", startIndex);
  if (hashIndex !== -1) {
    endIndex = Math.min(endIndex, hashIndex);
  }
  let key = value.slice(startIndex, endIndex).trim();
  key = key.replace(/[).,;:'"\]>}\s]+$/g, "");
  return key.startsWith(keyPrefix) ? key : null;
}

function collectConversationFileKeys(
  value: unknown,
  workspaceId: string,
  keys: Set<string>,
): void {
  if (typeof value === "string") {
    const key = normalizeConversationFileKey(value, workspaceId);
    if (key) {
      keys.add(key);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectConversationFileKeys(item, workspaceId, keys));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      collectConversationFileKeys(item, workspaceId, keys),
    );
  }
}

function extractConversationFileKeys(messages: unknown, workspaceId: string): Set<string> {
  const keys = new Set<string>();
  collectConversationFileKeys(messages, workspaceId, keys);
  return keys;
}

/**
 * Enrich a raw record by fetching messages from S3 when messagesS3Key is set.
 * Used by getRecord and atomicUpdateRecord so the updater receives full messages.
 */
async function enrichRecordFromS3(
  raw: AgentConversationRecord & { messagesS3Key?: string },
): Promise<AgentConversationRecord> {
  if (!raw.messagesS3Key) {
    return raw;
  }
  try {
    const body = await getS3ObjectBody(raw.messagesS3Key);
    const parsed = JSON.parse(body.toString("utf-8")) as unknown;
    const messages = Array.isArray(parsed) ? parsed : [];
    return { ...raw, messages };
  } catch (error) {
    console.warn(
      `[Conversation Records] Failed to fetch messages from S3 (${raw.messagesS3Key}):`,
      error instanceof Error ? error.message : String(error),
    );
    return raw;
  }
}

/**
 * Delete all conversation records for an agent. For each record: when messagesS3Key is set, fetches
 * messages from S3 to extract conversation file keys; otherwise uses record.messages. Deletes those
 * S3 file keys, deletes the messages blob at messagesS3Key if set, then deletes the DynamoDB record.
 */
export async function deleteAllRecordsForAgent(
  db: DatabaseSchema,
  workspaceId: string,
  agentId: string,
): Promise<void> {
  const table = db["agent-conversations"];
  for await (const conversation of table.queryAsync({
    IndexName: "byAgentId",
    KeyConditionExpression: "agentId = :agentId",
    FilterExpression: "workspaceId = :workspaceId",
    ExpressionAttributeValues: {
      ":agentId": agentId,
      ":workspaceId": workspaceId,
    },
  })) {
    const record = conversation as AgentConversationRecord & { messagesS3Key?: string };
    let messagesForFileKeys: unknown = record.messages;
    if (record.messagesS3Key) {
      try {
        const body = await getS3ObjectBody(record.messagesS3Key);
        const parsed = JSON.parse(body.toString("utf-8"));
        messagesForFileKeys = Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.warn(
          `[Conversation Records] Failed to fetch messages from S3 for file key extraction (${record.messagesS3Key}):`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    const fileKeys = extractConversationFileKeys(messagesForFileKeys, workspaceId);
    for (const key of fileKeys) {
      try {
        await deleteS3Object(key);
      } catch (error) {
        console.warn(
          `[Conversation Records] Failed to delete conversation file ${key}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (record.messagesS3Key) {
      try {
        await deleteS3Object(record.messagesS3Key);
      } catch (error) {
        console.warn(
          `[Conversation Records] Failed to delete messages blob ${record.messagesS3Key}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    await table.delete(record.pk, record.sk);
  }
}
