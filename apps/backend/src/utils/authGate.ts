import { randomUUID } from "crypto";

import { badRequest, unauthorized } from "@hapi/boom";
import { SignJWT, jwtVerify } from "jose";

import { getDefined } from "../utils";

const GATE_TOKEN_ISSUER = "helpmaton";
const GATE_TOKEN_AUDIENCE = "helpmaton-auth-gate";
const GATE_TOKEN_EXPIRY_SECONDS = 10 * 60;
const AUTH_CALLBACK_PATH_PREFIX = "/api/auth/callback/";

const getJwtSecret = (): Uint8Array => {
  const secret = getDefined(process.env.AUTH_SECRET, "AUTH_SECRET is required");
  return new TextEncoder().encode(secret);
};

export function normalizeAuthCallbackUrl(
  input: string,
  baseUrl: string,
  allowedOrigins?: string[]
): URL {
  let url: URL;
  try {
    url = new URL(input, baseUrl);
  } catch {
    throw badRequest("Invalid callback URL");
  }

  if (allowedOrigins?.length) {
    const allowed = allowedOrigins.map((origin) => new URL(origin).origin);
    if (!allowed.includes(url.origin)) {
      throw badRequest("Invalid callback URL");
    }
  }

  if (!url.pathname.startsWith(AUTH_CALLBACK_PATH_PREFIX)) {
    throw badRequest("Invalid callback URL");
  }

  url.searchParams.delete("gateToken");

  return url;
}

export function extractEmailFromCallbackUrl(url: URL): string {
  const email = url.searchParams.get("email");
  if (!email) {
    throw badRequest("Callback URL is missing email");
  }
  return email;
}

export async function createAuthGateToken(params: {
  email: string;
  callbackUrl: string;
}): Promise<string> {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    email: params.email,
    callbackUrl: params.callbackUrl,
    nonce: randomUUID(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + GATE_TOKEN_EXPIRY_SECONDS)
    .setIssuer(GATE_TOKEN_ISSUER)
    .setAudience(GATE_TOKEN_AUDIENCE)
    .sign(secret);
}

export async function verifyAuthGateToken(
  token: string
): Promise<{ email: string; callbackUrl: string }> {
  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret, {
      issuer: GATE_TOKEN_ISSUER,
      audience: GATE_TOKEN_AUDIENCE,
    });

    if (
      typeof payload.email === "string" &&
      typeof payload.callbackUrl === "string"
    ) {
      return { email: payload.email, callbackUrl: payload.callbackUrl };
    }

    throw unauthorized("Invalid gate token payload");
  } catch (error) {
    if (error && typeof error === "object" && "isBoom" in error) {
      throw error;
    }
    throw unauthorized("Invalid or expired gate token");
  }
}
