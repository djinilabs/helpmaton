/**
 * Passkey (WebAuthn) API helpers.
 * Uses fetch with credentials: "include" so challenge and session cookies are sent.
 */

import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

/** WebAuthn authentication options from GET /api/user/passkey/login/options (matches library type). */
export type PasskeyLoginOptions = PublicKeyCredentialRequestOptionsJSON;

/** Response from POST /api/user/passkey/login/verify */
export interface PasskeyLoginVerifyResponse {
  token: string;
}

/** WebAuthn registration options from POST /api/user/passkey/register/options (matches library type). */
export type PasskeyRegisterOptions = PublicKeyCredentialCreationOptionsJSON;

/** Response from POST /api/user/passkey/register/verify */
export interface PasskeyRegisterVerifyResponse {
  verified: boolean;
}

const passkeyFetch = async (
  url: string,
  options: RequestInit = {}
): Promise<Response> => {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const err = await response.json();
      message = err.message ?? err.error ?? message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return response;
};

/**
 * Fetches WebAuthn authentication options for passkey login (unauthenticated).
 */
export async function getPasskeyLoginOptions(): Promise<PasskeyLoginOptions> {
  const res = await passkeyFetch("/api/user/passkey/login/options");
  return res.json();
}

/**
 * Verifies passkey authentication assertion and returns one-time token for signIn("passkey", { token }).
 */
export async function verifyPasskeyLogin(
  assertion: Record<string, unknown>
): Promise<PasskeyLoginVerifyResponse> {
  const res = await passkeyFetch("/api/user/passkey/login/verify", {
    method: "POST",
    body: JSON.stringify(assertion),
  });
  return res.json();
}

/**
 * Fetches WebAuthn registration options (requires session).
 */
export async function getPasskeyRegisterOptions(): Promise<PasskeyRegisterOptions> {
  const res = await passkeyFetch("/api/user/passkey/register/options", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return res.json();
}

/**
 * Verifies passkey registration and stores credential (requires session).
 */
export async function verifyPasskeyRegistration(
  credential: Record<string, unknown>
): Promise<PasskeyRegisterVerifyResponse> {
  const res = await passkeyFetch("/api/user/passkey/register/verify", {
    method: "POST",
    body: JSON.stringify(credential),
  });
  return res.json();
}
