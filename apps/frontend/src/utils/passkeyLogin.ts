/**
 * Shared passkey (WebAuthn) sign-in flow.
 * Intended to be dynamic-imported so @simplewebauthn/browser and passkeyApi
 * are only loaded when the user actually clicks "Sign in with passkey".
 */
import { startAuthentication } from "@simplewebauthn/browser";

import {
  getPasskeyLoginOptions,
  verifyPasskeyLogin,
} from "./passkeyApi";

/**
 * Runs the full passkey sign-in flow: fetch options, start browser
 * authentication (system dialog), verify with backend. Returns the one-time
 * token for the caller to pass to signIn("passkey", { token }). Throws on error.
 */
export async function signInWithPasskey(): Promise<string> {
  const options = await getPasskeyLoginOptions();
  const assertion = await startAuthentication({ optionsJSON: options });
  const { token } = await verifyPasskeyLogin(
    assertion as unknown as Record<string, unknown>
  );
  return token;
}
