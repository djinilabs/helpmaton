import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getRpConfig,
  getPasskeyByCredentialId,
  listPasskeysForUser,
  updatePasskeyCounter,
} from "../passkey";

const mockDatabase = vi.hoisted(() => vi.fn());

vi.mock("../../tables/database", () => ({
  database: mockDatabase,
}));

const originalEnv = process.env;

describe("passkey utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getRpConfig", () => {
    it("should return localhost config when FRONTEND_URL is unset", () => {
      delete process.env.FRONTEND_URL;
      const config = getRpConfig();
      expect(config.rpId).toBe("localhost");
      expect(config.rpName).toBe("Helpmaton");
      expect(config.origin).toBe("http://localhost:5173");
    });

    it("should parse FRONTEND_URL for rpId and origin", () => {
      process.env.FRONTEND_URL = "https://app.helpmaton.com";
      const config = getRpConfig();
      expect(config.rpId).toBe("app.helpmaton.com");
      expect(config.origin).toBe("https://app.helpmaton.com");
      expect(config.rpName).toBe("Helpmaton");
    });

    it("should fallback to localhost on invalid URL", () => {
      process.env.FRONTEND_URL = "not-a-url";
      const config = getRpConfig();
      expect(config.rpId).toBe("localhost");
      expect(config.origin).toBe("http://localhost:5173");
    });
  });

  describe("getPasskeyByCredentialId", () => {
    it("should query GSI byCredentialId and return item", async () => {
      const credentialIdBase64 = "abc123";
      const mockItem = {
        pk: "USER#user-1",
        sk: "PASSKEY#abc123",
        gsi1pk: "CREDENTIAL#abc123",
        gsi1sk: "USER#user-1",
        credentialPublicKey: "key",
        counter: 0,
      };
      const mockQuery = vi.fn().mockResolvedValue({ items: [mockItem] });
      mockDatabase.mockResolvedValue({
        "user-passkey": {
          query: mockQuery,
        },
      });

      const result = await getPasskeyByCredentialId(credentialIdBase64);

      expect(result).toEqual(mockItem);
      expect(mockQuery).toHaveBeenCalledWith({
        IndexName: "byCredentialId",
        KeyConditionExpression: "gsi1pk = :gsi1Pk",
        ExpressionAttributeValues: { ":gsi1Pk": "CREDENTIAL#abc123" },
      });
    });

    it("should return undefined when no item found", async () => {
      mockDatabase.mockResolvedValue({
        "user-passkey": {
          query: vi.fn().mockResolvedValue({ items: [] }),
        },
      });

      const result = await getPasskeyByCredentialId("nonexistent");

      expect(result).toBeUndefined();
    });
  });

  describe("listPasskeysForUser", () => {
    it("should query main table by pk and sk prefix", async () => {
      const userId = "user-1";
      const mockItems = [
        {
          pk: "USER#user-1",
          sk: "PASSKEY#cred1",
          credentialPublicKey: "key1",
          counter: 0,
        },
      ];
      const mockQuery = vi.fn().mockResolvedValue({ items: mockItems });
      mockDatabase.mockResolvedValue({
        "user-passkey": {
          query: mockQuery,
        },
      });

      const result = await listPasskeysForUser(userId);

      expect(result).toEqual(mockItems);
      expect(mockQuery).toHaveBeenCalledWith({
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": "USER#user-1",
          ":skPrefix": "PASSKEY#",
        },
      });
    });
  });

  describe("updatePasskeyCounter", () => {
    it("should get then update and return true when item exists and newCounter > stored", async () => {
      const userId = "user-1";
      const credentialIdBase64 = "cred1";
      const existing = {
        pk: "USER#user-1",
        sk: "PASSKEY#cred1",
        counter: 0,
      };
      const mockGet = vi.fn().mockResolvedValue(existing);
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      mockDatabase.mockResolvedValue({
        "user-passkey": {
          get: mockGet,
          update: mockUpdate,
        },
      });

      const result = await updatePasskeyCounter(userId, credentialIdBase64, 1);

      expect(result).toBe(true);
      expect(mockGet).toHaveBeenCalledWith("USER#user-1", "PASSKEY#cred1");
      expect(mockUpdate).toHaveBeenCalledWith({
        ...existing,
        counter: 1,
      });
    });

    it("should return false when item does not exist", async () => {
      const mockGet = vi.fn().mockResolvedValue(null);
      const mockUpdate = vi.fn();
      mockDatabase.mockResolvedValue({
        "user-passkey": {
          get: mockGet,
          update: mockUpdate,
        },
      });

      const result = await updatePasskeyCounter("user-1", "cred1", 1);

      expect(result).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("should return false when newCounter < stored counter (rollback)", async () => {
      const existing = {
        pk: "USER#user-1",
        sk: "PASSKEY#cred1",
        counter: 5,
      };
      const mockGet = vi.fn().mockResolvedValue(existing);
      const mockUpdate = vi.fn();
      mockDatabase.mockResolvedValue({
        "user-passkey": {
          get: mockGet,
          update: mockUpdate,
        },
      });

      const result = await updatePasskeyCounter("user-1", "cred1", 3);

      expect(result).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("should return true without update when newCounter equals stored (e.g. first login or zero counter)", async () => {
      const existing = {
        pk: "USER#user-1",
        sk: "PASSKEY#cred1",
        counter: 0,
      };
      const mockGet = vi.fn().mockResolvedValue(existing);
      const mockUpdate = vi.fn();
      mockDatabase.mockResolvedValue({
        "user-passkey": {
          get: mockGet,
          update: mockUpdate,
        },
      });

      const result = await updatePasskeyCounter("user-1", "cred1", 0);

      expect(result).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
