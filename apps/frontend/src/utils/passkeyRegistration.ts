/**
 * Shared passkey (WebAuthn) registration flow.
 * Intended to be dynamic-imported so @simplewebauthn/browser and passkeyApi
 * are only loaded when the user actually starts creating a passkey.
 */
import { startRegistration } from "@simplewebauthn/browser";

import {
  getPasskeyRegisterOptions,
  verifyPasskeyRegistration,
} from "./passkeyApi";

/**
 * Runs the full passkey registration flow: fetch options, start browser
 * registration (system dialog), verify with backend. Throws on error.
 */
export async function createPasskey(): Promise<void> {
  const options = await getPasskeyRegisterOptions();
  const credential = await startRegistration({ optionsJSON: options });
  await verifyPasskeyRegistration(
    credential as unknown as Record<string, unknown>
  );
}
