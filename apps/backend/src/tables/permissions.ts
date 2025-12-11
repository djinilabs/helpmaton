import { database } from "./database";

export type IsUserAuthorizedResult =
  | [false]
  | [true, string, number];

/**
 * Check if a user has a specific permission level on a resource
 * @param userPk - User resource reference (e.g., "users/{userId}")
 * @param resource - Resource reference (e.g., "workspaces/{workspaceId}")
 * @param minimumPermission - Minimum permission level required (1=READ, 2=WRITE, 3=OWNER)
 * @returns [false] if not authorized, or [true, userPk, actualPermissionLevel] if authorized
 */
export const isUserAuthorized = async (
  userPk: string,
  resource: string,
  minimumPermission: number
): Promise<IsUserAuthorizedResult> => {
  const { permission } = await database();
  const permissionRecord = await permission.get(resource, userPk);
  if (!permissionRecord || permissionRecord.type < minimumPermission) {
    return [false];
  }
  return [true, userPk, permissionRecord.type];
};

/**
 * Create a new permission record
 * @param resource - Resource reference (e.g., "workspaces/{workspaceId}")
 * @param to - User resource reference (e.g., "users/{userId}")
 * @param level - Permission level (1=READ, 2=WRITE, 3=OWNER)
 * @param givenBy - User resource reference of the grantor
 * @param parent - Optional parent resource reference
 */
export const giveAuthorization = async (
  resource: string,
  to: string,
  level: number,
  givenBy: string,
  parent?: string
) => {
  const { permission } = await database();
  const permissionItem = {
    pk: resource,
    sk: to,
    type: level,
    createdBy: givenBy,
    createdAt: new Date().toISOString(),
    resourceType: resource.split("/")[0],
    parentPk: parent,
  };
  console.log("creating permission", permissionItem);
  await permission.create(permissionItem);
};

/**
 * Grant or update permissions (upgrade if needed)
 * If user already has a permission, it will be upgraded if the new level is higher
 * @param resource - Resource reference (e.g., "workspaces/{workspaceId}")
 * @param to - User resource reference (e.g., "users/{userId}")
 * @param level - Permission level (1=READ, 2=WRITE, 3=OWNER)
 * @param givenBy - User resource reference of the grantor
 * @param parent - Optional parent resource reference
 */
export const ensureAuthorization = async (
  resource: string,
  to: string,
  level: number,
  givenBy: string,
  parent?: string
) => {
  const { permission } = await database();

  const userPermission = await permission.get(resource, to);
  if (userPermission != null) {
    if (userPermission.type < level) {
      userPermission.type = level;
      await permission.update(userPermission);
    }
  } else {
    await giveAuthorization(resource, to, level, givenBy, parent);
  }
};

/**
 * Set exact permission level (overwrites existing)
 * @param resource - Resource reference (e.g., "workspaces/{workspaceId}")
 * @param to - User resource reference (e.g., "users/{userId}")
 * @param level - Permission level (1=READ, 2=WRITE, 3=OWNER)
 * @param givenBy - User resource reference of the grantor
 * @param parent - Optional parent resource reference
 */
export const ensureExactAuthorization = async (
  resource: string,
  to: string,
  level: number,
  givenBy: string,
  parent?: string
) => {
  const { permission } = await database();

  const userPermission = await permission.get(resource, to);
  if (userPermission != null) {
    if (userPermission.type !== level) {
      userPermission.type = level;
      await permission.update(userPermission);
    }
  } else {
    await giveAuthorization(resource, to, level, givenBy, parent);
  }
};

/**
 * Get the specific permission level a user has on a resource
 * @param resource - Resource reference (e.g., "workspaces/{workspaceId}")
 * @param userPk - User resource reference (e.g., "users/{userId}")
 * @returns Permission level (1=READ, 2=WRITE, 3=OWNER) or null if no permission
 */
export const getUserAuthorizationLevelForResource = async (
  resource: string,
  userPk: string
): Promise<number | null> => {
  const { permission } = await database();
  const permissionRecord = await permission.get(resource, userPk);

  if (!permissionRecord) {
    return null;
  }

  return permissionRecord.type;
};

