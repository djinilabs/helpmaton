import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the database module
vi.mock("../database", () => ({
  database: mockDatabase,
}));

// Import after mocks are set up
import {
  isUserAuthorized,
  giveAuthorization,
  ensureAuthorization,
  ensureExactAuthorization,
  getUserAuthorizationLevelForResource,
} from "../permissions";
import type { DatabaseSchema, PermissionRecord } from "../schema";
import { PERMISSION_LEVELS } from "../schema";

describe("permissions", () => {
  let mockDb: DatabaseSchema;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    // Setup mock get
    mockGet = vi.fn().mockResolvedValue(undefined);

    // Setup mock create
    mockCreate = vi.fn().mockResolvedValue({});

    // Setup mock update
    mockUpdate = vi.fn().mockResolvedValue({});

    // Setup mock database
    mockDb = {
      permission: {
        get: mockGet,
        create: mockCreate,
        update: mockUpdate,
      },
    } as unknown as DatabaseSchema;

    mockDatabase.mockResolvedValue(mockDb);
  });

  describe("isUserAuthorized", () => {
    it("should return [false] when user has no permission record", async () => {
      mockGet.mockResolvedValue(undefined);

      const result = await isUserAuthorized(
        "users/user-123",
        "workspaces/workspace-456",
        PERMISSION_LEVELS.READ
      );

      expect(result).toEqual([false]);
      expect(mockGet).toHaveBeenCalledWith(
        "workspaces/workspace-456",
        "users/user-123"
      );
    });

    it("should return [false] when user's permission level is below minimum required", async () => {
      const permissionRecord: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.READ,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(permissionRecord);

      // User has READ (1), but needs WRITE (2)
      const result = await isUserAuthorized(
        "users/user-123",
        "workspaces/workspace-456",
        PERMISSION_LEVELS.WRITE
      );

      expect(result).toEqual([false]);
    });

    it("should return [true, userPk, actualLevel] when user has exact permission match", async () => {
      const permissionRecord: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.WRITE,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(permissionRecord);

      const result = await isUserAuthorized(
        "users/user-123",
        "workspaces/workspace-456",
        PERMISSION_LEVELS.WRITE
      );

      expect(result).toEqual([true, "users/user-123", PERMISSION_LEVELS.WRITE]);
    });

    it("should return [true, userPk, actualLevel] when user has higher permission than required", async () => {
      const permissionRecord: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.OWNER,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(permissionRecord);

      // User has OWNER (3), but only needs READ (1)
      const result = await isUserAuthorized(
        "users/user-123",
        "workspaces/workspace-456",
        PERMISSION_LEVELS.READ
      );

      expect(result).toEqual([true, "users/user-123", PERMISSION_LEVELS.OWNER]);
    });

    it("should handle READ permission level correctly", async () => {
      const permissionRecord: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.READ,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(permissionRecord);

      const result = await isUserAuthorized(
        "users/user-123",
        "workspaces/workspace-456",
        PERMISSION_LEVELS.READ
      );

      expect(result).toEqual([true, "users/user-123", PERMISSION_LEVELS.READ]);
    });

    it("should handle WRITE permission level correctly", async () => {
      const permissionRecord: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.WRITE,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(permissionRecord);

      const result = await isUserAuthorized(
        "users/user-123",
        "workspaces/workspace-456",
        PERMISSION_LEVELS.WRITE
      );

      expect(result).toEqual([true, "users/user-123", PERMISSION_LEVELS.WRITE]);
    });

    it("should handle OWNER permission level correctly", async () => {
      const permissionRecord: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.OWNER,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(permissionRecord);

      const result = await isUserAuthorized(
        "users/user-123",
        "workspaces/workspace-456",
        PERMISSION_LEVELS.OWNER
      );

      expect(result).toEqual([true, "users/user-123", PERMISSION_LEVELS.OWNER]);
    });

    it("should return [false] for permission level 0", async () => {
      const permissionRecord: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: 0,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(permissionRecord);

      const result = await isUserAuthorized(
        "users/user-123",
        "workspaces/workspace-456",
        PERMISSION_LEVELS.READ
      );

      expect(result).toEqual([false]);
    });

    it("should handle very high permission levels", async () => {
      const permissionRecord: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: 100,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(permissionRecord);

      const result = await isUserAuthorized(
        "users/user-123",
        "workspaces/workspace-456",
        PERMISSION_LEVELS.OWNER
      );

      expect(result).toEqual([true, "users/user-123", 100]);
    });
  });

  describe("giveAuthorization", () => {
    it("should create new permission record with correct structure", async () => {
      const resource = "workspaces/workspace-456";
      const to = "users/user-123";
      const level = PERMISSION_LEVELS.WRITE;
      const givenBy = "users/user-789";

      await giveAuthorization(resource, to, level, givenBy);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          pk: resource,
          sk: to,
          type: level,
          createdBy: givenBy,
          resourceType: "workspaces",
          createdAt: expect.any(String),
        })
      );
    });

    it("should set correct resourceType from resource path", async () => {
      await giveAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.READ,
        "users/user-789"
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: "workspaces",
        })
      );
    });

    it("should include optional parentPk when provided", async () => {
      const parent = "organizations/org-123";

      await giveAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.READ,
        "users/user-789",
        parent
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parentPk: parent,
        })
      );
    });

    it("should not include parentPk when not provided", async () => {
      await giveAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.READ,
        "users/user-789"
      );

      const createCall = mockCreate.mock.calls[0][0];
      expect(createCall.parentPk).toBeUndefined();
    });

    it("should set createdAt timestamp", async () => {
      const beforeTime = new Date().toISOString();

      await giveAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.READ,
        "users/user-789"
      );

      const afterTime = new Date().toISOString();
      const createCall = mockCreate.mock.calls[0][0];
      const createdAt = createCall.createdAt;

      expect(createdAt).toBeDefined();
      expect(createdAt >= beforeTime).toBe(true);
      expect(createdAt <= afterTime).toBe(true);
    });

    it("should handle READ permission level", async () => {
      await giveAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.READ,
        "users/user-789"
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: PERMISSION_LEVELS.READ,
        })
      );
    });

    it("should handle WRITE permission level", async () => {
      await giveAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.WRITE,
        "users/user-789"
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: PERMISSION_LEVELS.WRITE,
        })
      );
    });

    it("should handle OWNER permission level", async () => {
      await giveAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.OWNER,
        "users/user-789"
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: PERMISSION_LEVELS.OWNER,
        })
      );
    });
  });

  describe("ensureAuthorization", () => {
    it("should create new permission when user has none", async () => {
      mockGet.mockResolvedValue(undefined);

      await ensureAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.READ,
        "users/user-789"
      );

      expect(mockGet).toHaveBeenCalledWith(
        "workspaces/workspace-456",
        "users/user-123"
      );
      expect(mockCreate).toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("should upgrade permission when existing level is lower", async () => {
      const existingPermission: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.READ,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(existingPermission);

      await ensureAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.WRITE,
        "users/user-789"
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: PERMISSION_LEVELS.WRITE,
        })
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should not downgrade permission when existing level is higher", async () => {
      const existingPermission: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.OWNER,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(existingPermission);

      await ensureAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.WRITE,
        "users/user-789"
      );

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should not update when existing level equals new level", async () => {
      const existingPermission: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.WRITE,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(existingPermission);

      await ensureAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.WRITE,
        "users/user-789"
      );

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should handle optional parentPk when creating new permission", async () => {
      mockGet.mockResolvedValue(undefined);

      const parent = "organizations/org-123";

      await ensureAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.READ,
        "users/user-789",
        parent
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parentPk: parent,
        })
      );
    });

    it("should handle optional parentPk when upgrading permission", async () => {
      const existingPermission: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.READ,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
        parentPk: "organizations/org-123",
      };

      mockGet.mockResolvedValue(existingPermission);

      await ensureAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.WRITE,
        "users/user-789"
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          parentPk: "organizations/org-123",
        })
      );
    });
  });

  describe("ensureExactAuthorization", () => {
    it("should create new permission when user has none", async () => {
      mockGet.mockResolvedValue(undefined);

      await ensureExactAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.READ,
        "users/user-789"
      );

      expect(mockGet).toHaveBeenCalledWith(
        "workspaces/workspace-456",
        "users/user-123"
      );
      expect(mockCreate).toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("should update permission when existing level differs (upgrade)", async () => {
      const existingPermission: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.READ,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(existingPermission);

      await ensureExactAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.WRITE,
        "users/user-789"
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: PERMISSION_LEVELS.WRITE,
        })
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should update permission when existing level differs (downgrade)", async () => {
      const existingPermission: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.OWNER,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(existingPermission);

      await ensureExactAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.READ,
        "users/user-789"
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: PERMISSION_LEVELS.READ,
        })
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should not update when existing level equals target level", async () => {
      const existingPermission: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.WRITE,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(existingPermission);

      await ensureExactAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.WRITE,
        "users/user-789"
      );

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should handle optional parentPk when creating new permission", async () => {
      mockGet.mockResolvedValue(undefined);

      const parent = "organizations/org-123";

      await ensureExactAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.READ,
        "users/user-789",
        parent
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parentPk: parent,
        })
      );
    });

    it("should handle optional parentPk when updating permission", async () => {
      const existingPermission: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.READ,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
        parentPk: "organizations/org-123",
      };

      mockGet.mockResolvedValue(existingPermission);

      await ensureExactAuthorization(
        "workspaces/workspace-456",
        "users/user-123",
        PERMISSION_LEVELS.WRITE,
        "users/user-789"
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          parentPk: "organizations/org-123",
        })
      );
    });
  });

  describe("getUserAuthorizationLevelForResource", () => {
    it("should return null when user has no permission", async () => {
      mockGet.mockResolvedValue(undefined);

      const result = await getUserAuthorizationLevelForResource(
        "workspaces/workspace-456",
        "users/user-123"
      );

      expect(result).toBeNull();
      expect(mockGet).toHaveBeenCalledWith(
        "workspaces/workspace-456",
        "users/user-123"
      );
    });

    it("should return correct permission level when user has READ permission", async () => {
      const permissionRecord: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.READ,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(permissionRecord);

      const result = await getUserAuthorizationLevelForResource(
        "workspaces/workspace-456",
        "users/user-123"
      );

      expect(result).toBe(PERMISSION_LEVELS.READ);
    });

    it("should return correct permission level when user has WRITE permission", async () => {
      const permissionRecord: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.WRITE,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(permissionRecord);

      const result = await getUserAuthorizationLevelForResource(
        "workspaces/workspace-456",
        "users/user-123"
      );

      expect(result).toBe(PERMISSION_LEVELS.WRITE);
    });

    it("should return correct permission level when user has OWNER permission", async () => {
      const permissionRecord: PermissionRecord = {
        pk: "workspaces/workspace-456",
        sk: "users/user-123",
        type: PERMISSION_LEVELS.OWNER,
        resourceType: "workspaces",
        version: 1,
        createdAt: new Date().toISOString(),
      };

      mockGet.mockResolvedValue(permissionRecord);

      const result = await getUserAuthorizationLevelForResource(
        "workspaces/workspace-456",
        "users/user-123"
      );

      expect(result).toBe(PERMISSION_LEVELS.OWNER);
    });
  });
});



