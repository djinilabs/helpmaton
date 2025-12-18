import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  generateApiKey,
  generateKeyLookupHash,
  hashApiKey,
  validateApiKey,
  getKeyPrefix,
  maskApiKey,
} from "../apiKeyUtils";

describe("apiKeyUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("generateApiKey", () => {
    it("should generate key with correct prefix hmat_", () => {
      const key = generateApiKey();

      expect(key).toMatch(/^hmat_/);
    });

    it("should generate key with correct length (69 chars: prefix + 64 hex chars)", () => {
      const key = generateApiKey();

      expect(key.length).toBe(69); // "hmat_" (5) + 64 hex characters
    });

    it("should generate unique keys on each call", () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      const key3 = generateApiKey();

      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
      expect(key1).not.toBe(key3);
    });

    it("should generate key with valid format", () => {
      const key = generateApiKey();

      // Should match: hmat_ followed by 64 hex characters
      expect(key).toMatch(/^hmat_[0-9a-f]{64}$/);
    });

    it("should generate multiple keys that are all unique", () => {
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        keys.add(generateApiKey());
      }

      // All 100 keys should be unique
      expect(keys.size).toBe(100);
    });
  });

  describe("generateKeyLookupHash", () => {
    it("should generate deterministic SHA256 hash", () => {
      const key =
        "hmat_test123456789012345678901234567890123456789012345678901234567890";
      const hash1 = generateKeyLookupHash(key);
      const hash2 = generateKeyLookupHash(key);

      expect(hash1).toBe(hash2);
    });

    it("should produce same hash for same key", () => {
      const key =
        "hmat_abcdef1234567890123456789012345678901234567890123456789012345678";
      const hash1 = generateKeyLookupHash(key);
      const hash2 = generateKeyLookupHash(key);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different keys", () => {
      const key1 =
        "hmat_abcdef1234567890123456789012345678901234567890123456789012345678";
      const key2 =
        "hmat_fedcba9876543210987654321098765432109876543210987654321098765432";

      const hash1 = generateKeyLookupHash(key1);
      const hash2 = generateKeyLookupHash(key2);

      expect(hash1).not.toBe(hash2);
    });

    it("should return hex string", () => {
      const key =
        "hmat_test123456789012345678901234567890123456789012345678901234567890";
      const hash = generateKeyLookupHash(key);

      // SHA256 produces 64 hex characters
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash.length).toBe(64);
    });

    it("should handle empty string", () => {
      const hash = generateKeyLookupHash("");

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash.length).toBe(64);
    });
  });

  describe("hashApiKey", () => {
    it("should generate unique salt for each call", async () => {
      const key = generateApiKey();
      const result1 = await hashApiKey(key);
      const result2 = await hashApiKey(key);

      // Same key, different salts, so different hashes
      expect(result1.salt).not.toBe(result2.salt);
      expect(result1.hash).not.toBe(result2.hash);
    });

    it("should return hash, salt, and lookupHash", async () => {
      const key = generateApiKey();
      const result = await hashApiKey(key);

      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("salt");
      expect(result).toHaveProperty("lookupHash");
    });

    it("should return base64 encoded hash and salt", async () => {
      const key = generateApiKey();
      const result = await hashApiKey(key);

      // Base64 strings should only contain valid base64 characters
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      expect(result.hash).toMatch(base64Regex);
      expect(result.salt).toMatch(base64Regex);
    });

    it("should return lookupHash that matches generateKeyLookupHash", async () => {
      const key = generateApiKey();
      const result = await hashApiKey(key);
      const expectedLookupHash = generateKeyLookupHash(key);

      expect(result.lookupHash).toBe(expectedLookupHash);
    });

    it("should produce different hashes for same key due to salt", async () => {
      const key = generateApiKey();
      const result1 = await hashApiKey(key);
      const result2 = await hashApiKey(key);

      // Hashes should be different because salts are different
      expect(result1.hash).not.toBe(result2.hash);
      expect(result1.salt).not.toBe(result2.salt);
      // But lookupHash should be the same (deterministic)
      expect(result1.lookupHash).toBe(result2.lookupHash);
    });

    it("should produce valid hash that can be validated", async () => {
      const key = generateApiKey();
      const { hash, salt } = await hashApiKey(key);

      const isValid = await validateApiKey(key, hash, salt);
      expect(isValid).toBe(true);
    });
  });

  describe("validateApiKey", () => {
    it("should return true for valid key matching stored hash", async () => {
      const key = generateApiKey();
      const { hash, salt } = await hashApiKey(key);

      const isValid = await validateApiKey(key, hash, salt);
      expect(isValid).toBe(true);
    });

    it("should return false for invalid key", async () => {
      const key = generateApiKey();
      const wrongKey = generateApiKey();
      const { hash, salt } = await hashApiKey(key);

      const isValid = await validateApiKey(wrongKey, hash, salt);
      expect(isValid).toBe(false);
    });

    it("should return false for wrong salt", async () => {
      const key = generateApiKey();
      const { hash } = await hashApiKey(key);
      const { salt: wrongSalt } = await hashApiKey(generateApiKey());

      const isValid = await validateApiKey(key, hash, wrongSalt);
      expect(isValid).toBe(false);
    });

    it("should return false when hash length differs (timing-safe check)", async () => {
      const key = generateApiKey();
      const { salt } = await hashApiKey(key);

      // Create an invalid hash with wrong length (base64 decode will produce wrong buffer length)
      const wrongHash = "dGVzdA"; // "test" in base64, much shorter than expected 64-byte hash

      const isValid = await validateApiKey(key, wrongHash, salt);
      expect(isValid).toBe(false);
    });

    it("should handle base64 encoding/decoding correctly", async () => {
      const key = generateApiKey();
      const { hash, salt } = await hashApiKey(key);

      // Validate that we can decode and re-encode
      const hashBuffer = Buffer.from(hash, "base64");
      const saltBuffer = Buffer.from(salt, "base64");

      expect(hashBuffer.length).toBeGreaterThan(0);
      expect(saltBuffer.length).toBeGreaterThan(0);

      // Should still validate correctly
      const isValid = await validateApiKey(key, hash, salt);
      expect(isValid).toBe(true);
    });

    it("should return false on invalid salt format", async () => {
      const key = generateApiKey();
      const { hash } = await hashApiKey(key);
      const invalidSalt = "not-valid-base64!!!";

      const isValid = await validateApiKey(key, hash, invalidSalt);
      expect(isValid).toBe(false);
    });

    it("should return false on invalid hash format", async () => {
      const key = generateApiKey();
      const { salt } = await hashApiKey(key);
      const invalidHash = "not-valid-base64!!!";

      const isValid = await validateApiKey(key, invalidHash, salt);
      expect(isValid).toBe(false);
    });

    it("should handle timing-safe comparison for different length hashes", async () => {
      const key = generateApiKey();
      const { salt } = await hashApiKey(key);

      // Create an invalid hash with wrong length
      const shorterHash = "dGVzdA"; // "test" in base64, much shorter than expected

      const startTime = Date.now();
      const isValid = await validateApiKey(key, shorterHash, salt);
      const endTime = Date.now();

      expect(isValid).toBe(false);
      // Should return quickly (timing-safe comparison checks length first)
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it("should validate multiple keys correctly", async () => {
      const keys = Array.from({ length: 10 }, () => generateApiKey());
      const hashedKeys = await Promise.all(keys.map((key) => hashApiKey(key)));

      for (let i = 0; i < keys.length; i++) {
        const isValid = await validateApiKey(
          keys[i],
          hashedKeys[i].hash,
          hashedKeys[i].salt
        );
        expect(isValid).toBe(true);

        // Wrong key should fail
        const wrongIndex = (i + 1) % keys.length;
        const isWrongValid = await validateApiKey(
          keys[i],
          hashedKeys[wrongIndex].hash,
          hashedKeys[wrongIndex].salt
        );
        expect(isWrongValid).toBe(false);
      }
    });
  });

  describe("getKeyPrefix", () => {
    it("should return full key if length <= 12", () => {
      const shortKey = "hmat_12345";
      const prefix = getKeyPrefix(shortKey);

      expect(prefix).toBe(shortKey);
    });

    it("should return first 12 characters if key is longer", () => {
      const key = generateApiKey(); // 69 characters
      const prefix = getKeyPrefix(key);

      expect(prefix).toBe(key.substring(0, 12));
      expect(prefix.length).toBe(12);
    });

    it("should return exactly 12 characters for standard API key", () => {
      const key = generateApiKey();
      const prefix = getKeyPrefix(key);

      expect(prefix.length).toBe(12);
      expect(prefix).toBe(key.substring(0, 12));
    });

    it("should handle edge case of exactly 12 characters", () => {
      const key = "hmat_1234567"; // Exactly 12 characters
      const prefix = getKeyPrefix(key);

      expect(prefix).toBe(key);
    });

    it("should handle very short keys", () => {
      const key = "hmat_";
      const prefix = getKeyPrefix(key);

      expect(prefix).toBe(key);
    });

    it("should handle empty string", () => {
      const prefix = getKeyPrefix("");

      expect(prefix).toBe("");
    });
  });

  describe("maskApiKey", () => {
    it("should return **** for keys <= 16 chars", () => {
      const shortKey = "hmat_123456789";
      const masked = maskApiKey(shortKey);

      expect(masked).toBe("****");
    });

    it("should return masked format with prefix and last 4 for longer keys", () => {
      const key = generateApiKey(); // 69 characters
      const masked = maskApiKey(key);

      expect(masked).toMatch(/^hmat_[0-9a-f]{7}\.\.\.[0-9a-f]{4}$/);
      expect(masked).toContain("...");
      expect(masked.length).toBeGreaterThan(16);
    });

    it("should preserve prefix and last 4 characters", () => {
      const key = generateApiKey();
      const masked = maskApiKey(key);
      const prefix = getKeyPrefix(key);
      const last4 = key.substring(key.length - 4);

      expect(masked).toBe(`${prefix}...${last4}`);
    });

    it("should handle edge case of exactly 16 characters", () => {
      const key = "hmat_12345678901"; // Exactly 16 characters
      const masked = maskApiKey(key);

      expect(masked).toBe("****");
    });

    it("should handle edge case of 17 characters", () => {
      const key = "hmat_123456789012"; // 17 characters
      const masked = maskApiKey(key);
      const prefix = getKeyPrefix(key); // "hmat_123456"
      const last4 = key.substring(key.length - 4); // "9012"

      expect(masked).toBe(`${prefix}...${last4}`);
    });

    it("should handle very short keys", () => {
      const key = "hmat_";
      const masked = maskApiKey(key);

      expect(masked).toBe("****");
    });

    it("should handle empty string", () => {
      const masked = maskApiKey("");

      expect(masked).toBe("****");
    });

    it("should mask standard API keys correctly", () => {
      const key = generateApiKey();
      const masked = maskApiKey(key);

      // Should start with prefix
      expect(masked).toMatch(/^hmat_/);
      // Should contain ellipsis
      expect(masked).toContain("...");
      // Should end with last 4 hex characters
      expect(masked).toMatch(/[0-9a-f]{4}$/);
    });
  });
});



