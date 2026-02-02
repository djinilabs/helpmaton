import express from "express";

import { generatePasskeyAuthenticationOptions } from "../../../utils/passkey";
import { setPasskeyChallengeCookie } from "../../../utils/passkeyChallengeCookie";
import { handleError } from "../../any-api-workspaces-catchall/middleware";

/**
 * GET /api/user/passkey/login/options
 * Returns WebAuthn authentication options (discoverable credentials) and sets challenge cookie.
 * No authentication required.
 */
export const registerGetPasskeyLoginOptions = (app: express.Application) => {
  app.get(
    "/api/user/passkey/login/options",
    async (req, res, next) => {
      try {
        const { options } = await generatePasskeyAuthenticationOptions();

        const challenge =
          typeof options.challenge === "string"
            ? options.challenge
            : Buffer.from(options.challenge).toString("base64url");
        await setPasskeyChallengeCookie(res, challenge, "passkey-login");

        res.json(options);
      } catch (error) {
        handleError(error, next, "GET /api/user/passkey/login/options");
      }
    }
  );
};
