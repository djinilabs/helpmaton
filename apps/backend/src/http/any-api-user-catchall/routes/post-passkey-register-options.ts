import { unauthorized } from "@hapi/boom";
import express from "express";

import {
  generatePasskeyRegistrationOptions,
  listPasskeysForUser,
} from "../../../utils/passkey";
import { setPasskeyChallengeCookie } from "../../../utils/passkeyChallengeCookie";
import {
  handleError,
  requireAuthOrSession,
} from "../../any-api-workspaces-catchall/middleware";

/**
 * POST /api/user/passkey/register/options
 * Returns WebAuthn registration options for the authenticated user and sets challenge cookie.
 */
export const registerPostPasskeyRegisterOptions = (
  app: express.Application
) => {
  app.post(
    "/api/user/passkey/register/options",
    requireAuthOrSession,
    async (req, res, next) => {
      try {
        const session = req.session;
        if (!session?.user?.id || !session?.user?.email) {
          throw unauthorized("User authentication required");
        }
        const userId = session.user.id;
        const userEmail = session.user.email;

        const existingPasskeys = await listPasskeysForUser(userId);
        const excludeCredentialIds = existingPasskeys.map((p) =>
          p.sk.replace(/^PASSKEY#/, "")
        );

        const { options } = await generatePasskeyRegistrationOptions(
          userId,
          userEmail,
          excludeCredentialIds.length > 0 ? excludeCredentialIds : undefined
        );

        const challenge =
          typeof options.challenge === "string"
            ? options.challenge
            : Buffer.from(options.challenge).toString("base64url");
        await setPasskeyChallengeCookie(res, challenge, "passkey-register");

        res.json(options);
      } catch (error) {
        handleError(error, next, "POST /api/user/passkey/register/options");
      }
    }
  );
};
