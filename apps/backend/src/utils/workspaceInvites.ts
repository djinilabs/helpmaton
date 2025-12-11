import { randomBytes, randomUUID } from "crypto";

import { badRequest, forbidden, notFound } from "@hapi/boom";

import { sendEmail } from "../send-email";
import { database } from "../tables/database";
import { ensureAuthorization } from "../tables/permissions";
import {
  PERMISSION_LEVELS,
  type WorkspaceInviteRecord,
  type WorkspaceRecord,
} from "../tables/schema";

import {
  getUserEmailById,
  getUserByEmail,
  createFreeSubscription,
} from "./subscriptionUtils";

const INVITE_EXPIRY_DAYS = 7;

/**
 * Generate a secure random token for workspace invites
 */
function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Create a user account from an invite email
 * @param email - Email address of the user to create
 * @returns Created user ID
 */
export async function createUserFromInvite(email: string): Promise<string> {
  const normalizedEmail = email.toLowerCase().trim();

  // Check if user already exists
  const existingUser = await getUserByEmail(normalizedEmail);
  if (existingUser) {
    return existingUser.userId;
  }

  // Create user directly in the next-auth table using the tables API
  // DynamoDBAdapter stores users with:
  // - pk = USER#{userId}
  // - sk = USER#{userId}
  // - id = userId
  // - email = normalized email
  // - type = "USER"
  // - createdAt = ISO datetime
  // - gsi1pk = USER#{email} (for GSI2 index)
  // - gsi1sk = USER#{email} (for GSI2 index)
  const db = await database();
  const userId = randomUUID();
  const userPk = `USER#${userId}`;
  const userSk = `USER#${userId}`;

  // Create user record in next-auth table
  await db["next-auth"].create({
    pk: userPk,
    sk: userSk,
    id: userId,
    email: normalizedEmail,
    type: "USER",
    // GSI2 index fields for email lookup
    gsi1pk: `USER#${normalizedEmail}`,
    gsi1sk: `USER#${normalizedEmail}`,
  });

  // Create free subscription for the user
  await createFreeSubscription(userId);

  return userId;
}

/**
 * Create a workspace invite
 * @param workspaceId - Workspace ID (without "workspaces/" prefix)
 * @param email - Email address of user to invite (will be normalized to lowercase)
 * @param permissionLevel - Permission level (1=READ, 2=WRITE, 3=OWNER)
 * @param invitedBy - UserRef of the inviter
 * @returns Created invite record
 */
export async function createWorkspaceInvite(
  workspaceId: string,
  email: string,
  permissionLevel: number,
  invitedBy: string
): Promise<WorkspaceInviteRecord> {
  const db = await database();
  const normalizedEmail = email.toLowerCase().trim();

  // Validate permission level
  if (
    permissionLevel < PERMISSION_LEVELS.READ ||
    permissionLevel > PERMISSION_LEVELS.OWNER
  ) {
    throw badRequest("Invalid permission level");
  }

  // Check if user already has permission for this workspace
  const workspacePk = `workspaces/${workspaceId}`;
  const existingUser = await getUserByEmail(normalizedEmail);
  if (existingUser) {
    const userRef = `users/${existingUser.userId}`;
    const existingPermission = await db.permission.get(workspacePk, userRef);
    if (existingPermission) {
      throw badRequest("User already has access to this workspace");
    }
  }

  // Check for existing pending invite
  const invites = await getWorkspaceInvites(workspaceId);
  const existingInvite = invites.find(
    (inv) => inv.email === normalizedEmail && !inv.acceptedAt
  );
  if (existingInvite) {
    throw badRequest("User already has a pending invite for this workspace");
  }

  // Generate token and expiration
  const token = generateInviteToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);
  const expiresTimestamp = Math.floor(expiresAt.getTime() / 1000);

  const inviteId = randomUUID();
  const invitePk = `workspace-invites/${workspaceId}/${inviteId}`;

  const invite = await db["workspace-invite"].create({
    pk: invitePk,
    sk: "invite",
    workspaceId,
    email: normalizedEmail,
    token,
    permissionLevel,
    invitedBy,
    expiresAt: expiresAt.toISOString(),
    expires: expiresTimestamp,
  });

  return invite;
}

/**
 * Get workspace invite by token
 * @param workspaceId - Workspace ID (without "workspaces/" prefix)
 * @param token - Invite token
 * @returns Invite record or undefined if not found
 */
export async function getWorkspaceInviteByToken(
  workspaceId: string,
  token: string
): Promise<WorkspaceInviteRecord | undefined> {
  const invites = await getWorkspaceInvites(workspaceId);
  return invites.find((inv) => inv.token === token && !inv.acceptedAt);
}

/**
 * Accept a workspace invite
 * @param workspaceId - Workspace ID (without "workspaces/" prefix)
 * @param token - Invite token
 * @param userId - User ID of the user accepting the invite (optional if email is provided)
 * @param email - Email address (optional, used for unauthenticated flow)
 * @returns Accepted invite record
 */
export async function acceptWorkspaceInvite(
  workspaceId: string,
  token: string,
  userId?: string,
  email?: string
): Promise<WorkspaceInviteRecord> {
  const db = await database();
  const invite = await getWorkspaceInviteByToken(workspaceId, token);

  if (!invite) {
    throw notFound("Invite not found or already accepted");
  }

  // Check if invite is expired
  const expiresAt = new Date(invite.expiresAt);
  if (expiresAt < new Date()) {
    throw badRequest("Invite has expired");
  }

  let finalUserId: string;
  let finalUserRef: string;

  // If email is provided but no userId, find or create user
  if (email && !userId) {
    const normalizedEmail = email.toLowerCase().trim();

    // Verify email matches invite email
    if (normalizedEmail !== invite.email.toLowerCase()) {
      throw forbidden("This invite is for a different email address");
    }

    // Find or create user
    finalUserId = await createUserFromInvite(normalizedEmail);
    finalUserRef = `users/${finalUserId}`;
  } else if (userId) {
    // Verify user email matches invite email
    const userEmail = await getUserEmailById(userId);
    if (!userEmail || userEmail.toLowerCase() !== invite.email.toLowerCase()) {
      throw forbidden("This invite is for a different email address");
    }
    finalUserId = userId;
    finalUserRef = `users/${userId}`;
  } else {
    throw badRequest("Either userId or email must be provided");
  }

  // Create permission for user
  const workspacePk = `workspaces/${workspaceId}`;
  await ensureAuthorization(
    workspacePk,
    finalUserRef,
    invite.permissionLevel,
    finalUserRef
  );

  // Mark invite as accepted
  const updatedInvite = await db["workspace-invite"].update({
    ...invite,
    acceptedAt: new Date().toISOString(),
    acceptedBy: finalUserRef,
  });

  return updatedInvite;
}

/**
 * Get all invites for a workspace
 * @param workspaceId - Workspace ID (without "workspaces/" prefix)
 * @returns Array of invite records
 */
export async function getWorkspaceInvites(
  workspaceId: string
): Promise<WorkspaceInviteRecord[]> {
  const db = await database();
  const result = await db["workspace-invite"].query({
    IndexName: "byWorkspaceId",
    KeyConditionExpression: "workspaceId = :workspaceId",
    ExpressionAttributeValues: {
      ":workspaceId": workspaceId,
    },
  });
  return result.items;
}

/**
 * Delete a workspace invite
 * @param workspaceId - Workspace ID (without "workspaces/" prefix)
 * @param inviteId - Invite ID (without "workspace-invites/{workspaceId}/" prefix)
 */
export async function deleteWorkspaceInvite(
  workspaceId: string,
  inviteId: string
): Promise<void> {
  const db = await database();
  const invitePk = `workspace-invites/${workspaceId}/${inviteId}`;
  await db["workspace-invite"].delete(invitePk, "invite");
}

/**
 * Send invite email
 * @param invite - Invite record
 * @param workspace - Workspace record
 * @param inviterEmail - Email of the person who sent the invite
 */
export async function sendInviteEmail(
  invite: WorkspaceInviteRecord,
  workspace: WorkspaceRecord,
  inviterEmail: string
): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const inviteUrl = `${frontendUrl}/workspaces/${invite.workspaceId}/invites/${invite.token}`;

  const permissionLevelName =
    invite.permissionLevel === PERMISSION_LEVELS.OWNER
      ? "Owner"
      : invite.permissionLevel === PERMISSION_LEVELS.WRITE
      ? "Write"
      : "Read";

  const expiresAt = new Date(invite.expiresAt);
  const expiresAtFormatted = expiresAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const subject = `You've been invited to join ${workspace.name} on Helpmaton`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { display: inline-block; padding: 12px 24px; background-color: #008080; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
        .button:hover { background-color: #006666; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>You've been invited to join ${workspace.name}</h1>
        <p>${inviterEmail} has invited you to join the workspace <strong>${
    workspace.name
  }</strong> on Helpmaton.</p>
        <p>You'll have <strong>${permissionLevelName}</strong> permissions, which means you can ${
    invite.permissionLevel === PERMISSION_LEVELS.OWNER
      ? "manage the workspace, invite and remove users, and make any changes."
      : invite.permissionLevel === PERMISSION_LEVELS.WRITE
      ? "make changes to the workspace, but cannot invite or remove users."
      : "view the workspace, but cannot make changes."
  }</p>
        <p><a href="${inviteUrl}" class="button">Accept Invitation</a></p>
        <p>This invitation will expire on ${expiresAtFormatted}.</p>
        <p>If you don't have a Helpmaton account, you'll be able to create one when you accept the invitation.</p>
      </div>
    </body>
    </html>
  `;
  const text = `
You've been invited to join ${workspace.name} on Helpmaton.

${inviterEmail} has invited you to join the workspace "${workspace.name}".

You'll have ${permissionLevelName} permissions.

Accept the invitation by visiting:
${inviteUrl}

This invitation will expire on ${expiresAtFormatted}.

If you don't have a Helpmaton account, you'll be able to create one when you accept the invitation.
  `;

  await sendEmail({
    to: invite.email,
    subject,
    text,
    html,
  });
}

/**
 * Create a SHA-256 hash of a message (matching NextAuth's createHash function)
 * NextAuth uses Web Crypto API's subtle.digest, which produces a hex string
 * @param message - Message to hash
 * @returns Hex string of the hash
 */
async function createHash(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Create a verification token and return the callback URL
 * Creates a VT#-prefixed entry in the next-auth table and returns the callback URL
 * NextAuth hashes the token with the secret before storing it in the database,
 * but uses the raw token in the URL. When verifying, it hashes the token from
 * the URL and compares it with the stored hash.
 * @param email - User email
 * @param workspaceId - Workspace ID to redirect to after authentication
 * @param req - Express request object
 * @returns Callback URL for email verification
 */
export async function createVerificationTokenAndGetCallbackUrl(
  email: string,
  workspaceId: string,
  req: { protocol: string; headers: { host?: string } }
): Promise<string> {
  const baseUrl =
    process.env.BASE_URL || process.env.FRONTEND_URL || "http://localhost:5173";
  const protocol =
    req.protocol || (baseUrl.startsWith("https") ? "https" : "http");
  const host = req.headers.host || new URL(baseUrl).host;
  const normalizedEmail = email.toLowerCase().trim();

  // Get the AUTH_SECRET (same as used in auth-config.ts)
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required");
  }

  // Generate a secure verification token (raw token, will be used in URL)
  const rawToken = randomBytes(32).toString("base64url");

  // Hash the token with the secret (matching NextAuth's behavior)
  // NextAuth stores: createHash(`${token}${secret}`)
  const hashedToken = await createHash(`${rawToken}${secret}`);

  // Calculate expiration (24 hours, matching email provider maxAge)
  const expiresDate = new Date();
  expiresDate.setHours(expiresDate.getHours() + 24);
  // Convert to Unix timestamp in seconds (matching DynamoDBAdapter format)
  const expires = expiresDate.getTime() / 1000;

  // Store verification token in next-auth table using the tables API
  // NextAuth stores verification tokens with pk = VT#{identifier}, sk = VT#{hashedToken}
  // The token stored is the HASHED version, not the raw token
  const db = await database();
  const tokenPk = `VT#${normalizedEmail}`;
  const tokenSk = `VT#${hashedToken}`;

  // Store verification token - bypass schema validation as VT records have different structure
  await (
    db["next-auth"] as unknown as {
      create: (item: Record<string, unknown>) => Promise<unknown>;
    }
  ).create({
    pk: tokenPk,
    sk: tokenSk,
    type: "VT",
    identifier: normalizedEmail,
    token: hashedToken, // Store the hashed token, not the raw token
    expires, // Unix timestamp in seconds
  });

  // Create callback URL that NextAuth will use to verify the token
  // Include callbackUrl parameter to redirect to workspace after authentication
  // Use the RAW token in the URL (NextAuth will hash it when verifying)
  const workspaceUrl = `${baseUrl}/workspaces/${workspaceId}`;
  const callbackUrl = `${protocol}://${host}/api/auth/callback/email?token=${rawToken}&email=${encodeURIComponent(
    normalizedEmail
  )}&callbackUrl=${encodeURIComponent(workspaceUrl)}`;

  return callbackUrl;
}
