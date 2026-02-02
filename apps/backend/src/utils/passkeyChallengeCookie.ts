/**
 * Passkey challenge storage via signed JWT in a cookie.
 * Used for both register and login flows so verify can recover the expected challenge (no Scan).
 */

import { SignJWT, jwtVerify } from "jose";

const CHALLENGE_EXPIRY_SECONDS = 5 * 60; // 5 minutes
const COOKIE_NAME = "passkey_challenge";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required for passkey challenge cookie");
  }
  return new TextEncoder().encode(secret);
}

export type PasskeyChallengePurpose = "passkey-register" | "passkey-login";

/**
 * Create a signed JWT containing the challenge and set it as a cookie on the response.
 */
export async function setPasskeyChallengeCookie(
  res: { setHeader: (name: string, value: string) => void },
  challenge: string,
  purpose: PasskeyChallengePurpose
): Promise<void> {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ challenge, purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + CHALLENGE_EXPIRY_SECONDS)
    .setIssuer("helpmaton")
    .setAudience("helpmaton-passkey-challenge")
    .sign(secret);

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const isSecure = frontendUrl.startsWith("https");
  const cookieParts = [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${CHALLENGE_EXPIRY_SECONDS}`,
    "SameSite=Lax",
  ];
  if (isSecure) {
    cookieParts.push("Secure");
  }
  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

/**
 * Read and verify the challenge from the Cookie header. Returns the challenge or null if missing/invalid.
 */
export async function getPasskeyChallengeFromCookie(
  cookieHeader: string | undefined,
  purpose: PasskeyChallengePurpose
): Promise<string | null> {
  if (!cookieHeader) {
    return null;
  }
  const match = cookieHeader.match(
    new RegExp(`${COOKIE_NAME}=([^;]+)`, "i")
  );
  const token = match?.[1]?.trim();
  if (!token) {
    return null;
  }
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret, {
      issuer: "helpmaton",
      audience: "helpmaton-passkey-challenge",
    });
    if (
      payload.purpose === purpose &&
      typeof payload.challenge === "string"
    ) {
      return payload.challenge;
    }
    return null;
  } catch {
    return null;
  }
}
