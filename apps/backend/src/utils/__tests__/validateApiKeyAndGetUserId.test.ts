import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the database module
vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

// Import after mocks are set up
import type { DatabaseSchema, UserApiKeyRecord } from "../../tables/schema";
import {
  generateApiKey,
  hashApiKey,
  validateApiKeyAndGetUserId,
} from "../apiKeyUtils";

describe("validateApiKeyAndGetUserId", () => {
  let mockDb: DatabaseSchema;
  let mockQuery: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup mock query
    mockQuery = vi.fn().mockResolvedValue({ items: [] });

    // Setup mock update
    mockUpdate = vi.fn().mockResolvedValue({});

    // Setup mock database
    mockDb = {
      "user-api-key": {
        query: mockQuery,
        update: mockUpdate,
      },
    } as unknown as DatabaseSchema;

    mockDatabase.mockResolvedValue(mockDb);
  });

  it("should successfully validate API key and return userId", async () => {
    const apiKey = generateApiKey();
    const { hash, salt, lookupHash } = await hashApiKey(apiKey);
    const userId = "user-123";

    const keyRecord: UserApiKeyRecord = {
      pk: `user-api-keys/${userId}`,
      sk: "key-id-456",
      userId,
      keyHash: hash,
      keySalt: salt,
      keyLookupHash: lookupHash,
      keyPrefix: apiKey.substring(0, 12),
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery.mockResolvedValue({ items: [keyRecord] });

    const result = await validateApiKeyAndGetUserId(apiKey);

    expect(result).toBe(userId);
    expect(mockQuery).toHaveBeenCalledWith({
      IndexName: "byKeyHash",
      KeyConditionExpression: "keyLookupHash = :lookupHash",
      ExpressionAttributeValues: {
        ":lookupHash": lookupHash,
      },
    });
  });

  it("should update lastUsedAt timestamp when key is validated", async () => {
    const apiKey = generateApiKey();
    const { hash, salt, lookupHash } = await hashApiKey(apiKey);
    const userId = "user-123";

    const keyRecord: UserApiKeyRecord = {
      pk: `user-api-keys/${userId}`,
      sk: "key-id-456",
      userId,
      keyHash: hash,
      keySalt: salt,
      keyLookupHash: lookupHash,
      keyPrefix: apiKey.substring(0, 12),
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery.mockResolvedValue({ items: [keyRecord] });

    const beforeTime = new Date().toISOString();
    await validateApiKeyAndGetUserId(apiKey);
    const afterTime = new Date().toISOString();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        pk: keyRecord.pk,
        sk: keyRecord.sk,
        userId: keyRecord.userId,
        keyHash: keyRecord.keyHash,
        keySalt: keyRecord.keySalt,
        keyLookupHash: keyRecord.keyLookupHash,
        keyPrefix: keyRecord.keyPrefix,
        name: keyRecord.name,
        createdAt: keyRecord.createdAt,
        version: keyRecord.version,
        lastUsedAt: expect.any(String),
      })
    );

    const updateCall = mockUpdate.mock.calls[0][0];
    const lastUsedAt = updateCall.lastUsedAt;
    expect(lastUsedAt >= beforeTime).toBe(true);
    expect(lastUsedAt <= afterTime).toBe(true);
  });

  it("should return null when key lookup hash finds no records", async () => {
    const apiKey = generateApiKey();
    const { lookupHash } = await hashApiKey(apiKey);

    mockQuery.mockResolvedValue({ items: [] });

    const result = await validateApiKeyAndGetUserId(apiKey);

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledWith({
      IndexName: "byKeyHash",
      KeyConditionExpression: "keyLookupHash = :lookupHash",
      ExpressionAttributeValues: {
        ":lookupHash": lookupHash,
      },
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("should return null when key doesn't match any record's hash", async () => {
    const apiKey = generateApiKey();
    const wrongApiKey = generateApiKey();
    const { hash, salt } = await hashApiKey(wrongApiKey);
    const userId = "user-123";

    // Use the lookup hash of the apiKey (not wrongApiKey) to simulate hash collision
    const { lookupHash: apiKeyLookupHash } = await hashApiKey(apiKey);

    const keyRecord: UserApiKeyRecord = {
      pk: `user-api-keys/${userId}`,
      sk: "key-id-456",
      userId,
      keyHash: hash, // Hash of wrongApiKey
      keySalt: salt, // Salt of wrongApiKey
      keyLookupHash: apiKeyLookupHash, // But lookupHash of apiKey (collision scenario)
      keyPrefix: wrongApiKey.substring(0, 12),
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery.mockResolvedValue({ items: [keyRecord] });

    // Validation will fail because apiKey doesn't match wrongApiKey's hash
    const result = await validateApiKeyAndGetUserId(apiKey);

    expect(result).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("should return null when key matches lookup hash but scrypt validation fails", async () => {
    const apiKey = generateApiKey();
    const wrongApiKey = generateApiKey();
    const { hash, salt } = await hashApiKey(wrongApiKey);
    const userId = "user-123";

    // Use apiKey's lookupHash but wrongApiKey's hash/salt
    const { lookupHash: apiKeyLookupHash } = await hashApiKey(apiKey);

    const keyRecord: UserApiKeyRecord = {
      pk: `user-api-keys/${userId}`,
      sk: "key-id-456",
      userId,
      keyHash: hash, // Hash of wrongApiKey
      keySalt: salt, // Salt of wrongApiKey
      keyLookupHash: apiKeyLookupHash, // But lookupHash of apiKey
      keyPrefix: apiKey.substring(0, 12),
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery.mockResolvedValue({ items: [keyRecord] });

    // Validation will fail because apiKey doesn't match wrongApiKey's hash
    const result = await validateApiKeyAndGetUserId(apiKey);

    expect(result).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("should handle multiple records with same lookup hash (should validate all)", async () => {
    const apiKey = generateApiKey();
    const { hash, salt } = await hashApiKey(apiKey);
    const userId = "user-123";

    // Create two records with same lookup hash (hash collision scenario)
    const { lookupHash: apiKeyLookupHash } = await hashApiKey(apiKey);
    const keyRecord1: UserApiKeyRecord = {
      pk: `user-api-keys/${userId}`,
      sk: "key-id-456",
      userId,
      keyHash: hash,
      keySalt: salt,
      keyLookupHash: apiKeyLookupHash,
      keyPrefix: apiKey.substring(0, 12),
      version: 1,
      createdAt: new Date().toISOString(),
    };

    // Second record with different key but same lookup hash (shouldn't happen in practice)
    const wrongApiKey = generateApiKey();
    const { hash: wrongHash, salt: wrongSalt } = await hashApiKey(wrongApiKey);
    const keyRecord2: UserApiKeyRecord = {
      pk: `user-api-keys/user-789`,
      sk: "key-id-789",
      userId: "user-789",
      keyHash: wrongHash,
      keySalt: wrongSalt,
      keyLookupHash: apiKeyLookupHash, // Same lookup hash (collision)
      keyPrefix: wrongApiKey.substring(0, 12),
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery.mockResolvedValue({ items: [keyRecord1, keyRecord2] });

    const result = await validateApiKeyAndGetUserId(apiKey);

    // Should find the correct record (second one)
    expect(result).toBe(userId);
    expect(mockUpdate).toHaveBeenCalledTimes(1); // Only updates the valid one
  });

  it("should handle database query errors gracefully (returns null)", async () => {
    const apiKey = generateApiKey();

    mockQuery.mockRejectedValue(new Error("Database connection failed"));

    const result = await validateApiKeyAndGetUserId(apiKey);

    expect(result).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("should handle update errors gracefully (returns null if update fails)", async () => {
    const apiKey = generateApiKey();
    const { hash, salt, lookupHash } = await hashApiKey(apiKey);
    const userId = "user-123";

    const keyRecord: UserApiKeyRecord = {
      pk: `user-api-keys/${userId}`,
      sk: "key-id-456",
      userId,
      keyHash: hash,
      keySalt: salt,
      keyLookupHash: lookupHash,
      keyPrefix: apiKey.substring(0, 12),
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery.mockResolvedValue({ items: [keyRecord] });
    mockUpdate.mockRejectedValue(new Error("Update failed"));

    // Function catches errors and returns null
    const result = await validateApiKeyAndGetUserId(apiKey);

    expect(result).toBeNull();
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("should validate that GSI query uses correct IndexName and KeyConditionExpression", async () => {
    const apiKey = generateApiKey();
    const { lookupHash } = await hashApiKey(apiKey);

    mockQuery.mockResolvedValue({ items: [] });

    await validateApiKeyAndGetUserId(apiKey);

    expect(mockQuery).toHaveBeenCalledWith({
      IndexName: "byKeyHash",
      KeyConditionExpression: "keyLookupHash = :lookupHash",
      ExpressionAttributeValues: {
        ":lookupHash": lookupHash,
      },
    });
  });

  it("should skip records without keyHash or keySalt", async () => {
    const apiKey = generateApiKey();
    const { lookupHash } = await hashApiKey(apiKey);
    const userId = "user-123";

    const keyRecordWithoutHash: UserApiKeyRecord = {
      pk: `user-api-keys/${userId}`,
      sk: "key-id-456",
      userId,
      keyHash: undefined as unknown as string,
      keySalt: undefined as unknown as string,
      keyLookupHash: lookupHash,
      keyPrefix: apiKey.substring(0, 12),
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery.mockResolvedValue({ items: [keyRecordWithoutHash] });

    const result = await validateApiKeyAndGetUserId(apiKey);

    expect(result).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("should handle record with keyHash but no keySalt", async () => {
    const apiKey = generateApiKey();
    const { hash, lookupHash } = await hashApiKey(apiKey);
    const userId = "user-123";

    const keyRecord: UserApiKeyRecord = {
      pk: `user-api-keys/${userId}`,
      sk: "key-id-456",
      userId,
      keyHash: hash,
      keySalt: undefined as unknown as string,
      keyLookupHash: lookupHash,
      keyPrefix: apiKey.substring(0, 12),
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery.mockResolvedValue({ items: [keyRecord] });

    const result = await validateApiKeyAndGetUserId(apiKey);

    expect(result).toBeNull();
  });

  it("should handle record with keySalt but no keyHash", async () => {
    const apiKey = generateApiKey();
    const { salt, lookupHash } = await hashApiKey(apiKey);
    const userId = "user-123";

    const keyRecord: UserApiKeyRecord = {
      pk: `user-api-keys/${userId}`,
      sk: "key-id-456",
      userId,
      keyHash: undefined as unknown as string,
      keySalt: salt,
      keyLookupHash: lookupHash,
      keyPrefix: apiKey.substring(0, 12),
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery.mockResolvedValue({ items: [keyRecord] });

    const result = await validateApiKeyAndGetUserId(apiKey);

    expect(result).toBeNull();
  });

  it("should continue checking other records if first validation fails", async () => {
    const apiKey = generateApiKey();
    const wrongApiKey = generateApiKey();
    const { hash: hash1, salt: salt1 } = await hashApiKey(wrongApiKey);
    const { hash: hash2, salt: salt2 } = await hashApiKey(apiKey);
    const userId = "user-123";

    // Both records have same lookupHash (collision scenario)
    const { lookupHash: apiKeyLookupHash } = await hashApiKey(apiKey);

    const keyRecord1: UserApiKeyRecord = {
      pk: `user-api-keys/${userId}`,
      sk: "key-id-456",
      userId,
      keyHash: hash1, // Wrong hash
      keySalt: salt1, // Wrong salt
      keyLookupHash: apiKeyLookupHash,
      keyPrefix: apiKey.substring(0, 12),
      version: 1,
      createdAt: new Date().toISOString(),
    };

    const keyRecord2: UserApiKeyRecord = {
      pk: `user-api-keys/${userId}`,
      sk: "key-id-789",
      userId,
      keyHash: hash2, // Correct hash
      keySalt: salt2, // Correct salt
      keyLookupHash: apiKeyLookupHash,
      keyPrefix: apiKey.substring(0, 12),
      version: 1,
      createdAt: new Date().toISOString(),
    };

    mockQuery.mockResolvedValue({ items: [keyRecord1, keyRecord2] });

    const result = await validateApiKeyAndGetUserId(apiKey);

    // Should find the correct record (second one)
    expect(result).toBe(userId);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
