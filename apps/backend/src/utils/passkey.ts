/**
 * Passkey (WebAuthn) utilities: registration options/verify and authentication options/verify.
 * Stores credentials in user-passkey table; login lookup uses GSI byCredentialId only (no Scan).
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorDevice,
  PublicKeyCredentialDescriptorFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/types";

import { database } from "../tables/database";
import type { UserPasskeyRecord } from "../tables/schema";

const RP_NAME = "Helpmaton";

export type RpConfig = {
  rpId: string;
  rpName: string;
  origin: string;
};

/**
 * Get Relying Party config from FRONTEND_URL (hostname = rpId, full URL = origin).
 */
export function getRpConfig(): RpConfig {
  const frontendUrl =
    process.env.FRONTEND_URL || "http://localhost:5173";
  let origin: string;
  let rpId: string;
  try {
    const url = new URL(frontendUrl);
    origin = url.origin;
    rpId = url.hostname;
  } catch {
    origin = "http://localhost:5173";
    rpId = "localhost";
  }
  return { rpId, rpName: RP_NAME, origin };
}

/**
 * Generate registration options for an authenticated user.
 * Caller must store options.challenge (e.g. in session or signed cookie) for verify step.
 */
export async function generatePasskeyRegistrationOptions(
  userId: string,
  userEmail: string,
  excludeCredentialIds?: string[]
) {
  const { rpId, rpName, origin } = getRpConfig();
  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userID: userId,
    userName: userEmail,
    attestationType: "none",
    excludeCredentials: (excludeCredentialIds?.map((id) => ({
      id,
      type: "public-key",
      transports: [],
    })) ?? []) as unknown as PublicKeyCredentialDescriptorFuture[],
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
  return { options, origin };
}

/**
 * Verify registration response and store credential in user-passkey (PutItem with GSI keys).
 * Resolves challenge from caller (stored when generating options).
 */
export async function verifyPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  expectedChallenge: string
): Promise<{ verified: boolean }> {
  const { rpId, origin } = getRpConfig();
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
  });
  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false };
  }
  const {
    credentialID,
    credentialPublicKey,
    counter,
    credentialDeviceType,
    credentialBackedUp,
  } = verification.registrationInfo;
  const credentialIdBase64 = Buffer.from(credentialID).toString("base64url");
  const pk = `USER#${userId}`;
  const sk = `PASSKEY#${credentialIdBase64}`;
  const gsi1pk = `CREDENTIAL#${credentialIdBase64}`;
  const gsi1sk = `USER#${userId}`;
  const credentialPublicKeyBase64 = Buffer.from(credentialPublicKey).toString(
    "base64"
  );
  const transportsStr = undefined;

  const db = await database();
  const table = db["user-passkey"];
  await table.create({
    pk,
    sk,
    gsi1pk,
    gsi1sk,
    credentialPublicKey: credentialPublicKeyBase64,
    counter,
    transports: transportsStr,
  } as Omit<UserPasskeyRecord, "version" | "createdAt">);

  void credentialDeviceType;
  void credentialBackedUp;
  return { verified: true };
}

/**
 * Generate authentication options (for login). Discoverable credentials: no allowCredentials.
 * Caller must store options.challenge for verify step (e.g. signed cookie or short-lived store).
 */
export async function generatePasskeyAuthenticationOptions() {
  const { rpId, origin } = getRpConfig();
  const options = await generateAuthenticationOptions({
    rpID: rpId,
  });
  return { options, origin };
}

/**
 * Lookup passkey by credentialId via GSI byCredentialId only (no Scan).
 * Returns the single matching item or undefined.
 */
export async function getPasskeyByCredentialId(
  credentialIdBase64: string
): Promise<UserPasskeyRecord | undefined> {
  const db = await database();
  const table = db["user-passkey"];
  const gsi1Pk = `CREDENTIAL#${credentialIdBase64}`;
  const result = await table.query({
    IndexName: "byCredentialId",
    KeyConditionExpression: "gsi1pk = :gsi1Pk",
    ExpressionAttributeValues: { ":gsi1Pk": gsi1Pk },
  });
  return result.items[0];
}

/**
 * Verify authentication response and return userId. Looks up credential by id via GSI (no Scan).
 * Caller must update counter in user-passkey after successful login.
 */
export async function verifyPasskeyAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string
): Promise<{ userId: string; newCounter: number } | null> {
  const credentialIdBase64 = response.id;
  const passkey = await getPasskeyByCredentialId(credentialIdBase64);
  if (!passkey) {
    return null;
  }
  const credentialPublicKeyUint8 = new Uint8Array(
    Buffer.from(passkey.credentialPublicKey, "base64")
  );
  const credentialIDUint8 = new Uint8Array(
    Buffer.from(credentialIdBase64, "base64url")
  );
  const { rpId, origin } = getRpConfig();
  const authenticator: AuthenticatorDevice = {
    credentialID: credentialIDUint8,
    credentialPublicKey: credentialPublicKeyUint8,
    counter: passkey.counter,
    transports: passkey.transports
      ? (passkey.transports.split(",") as AuthenticatorDevice["transports"])
      : undefined,
  };
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    authenticator,
  });
  if (!verification.verified || !verification.authenticationInfo) {
    return null;
  }
  const userId = passkey.gsi1sk?.replace(/^USER#/, "") ?? passkey.pk.replace(/^USER#/, "");
  return {
    userId,
    newCounter: verification.authenticationInfo.newCounter,
  };
}

/**
 * Update passkey counter after successful authentication (GetItem then UpdateItem by pk/sk).
 */
export async function updatePasskeyCounter(
  userId: string,
  credentialIdBase64: string,
  newCounter: number
): Promise<void> {
  const db = await database();
  const table = db["user-passkey"];
  const pk = `USER#${userId}`;
  const sk = `PASSKEY#${credentialIdBase64}`;
  const existing = await table.get(pk, sk);
  if (!existing) {
    return;
  }
  await table.update({
    ...existing,
    counter: newCounter,
  });
}

/**
 * List passkeys for a user (Query main table by pk, sk begins_with PASSKEY#). No Scan.
 */
export async function listPasskeysForUser(
  userId: string
): Promise<UserPasskeyRecord[]> {
  const db = await database();
  const table = db["user-passkey"];
  const pk = `USER#${userId}`;
  const result = await table.query({
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
    ExpressionAttributeValues: { ":pk": pk, ":skPrefix": "PASSKEY#" },
  });
  return result.items;
}

