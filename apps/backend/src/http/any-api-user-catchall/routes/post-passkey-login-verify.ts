import { badRequest } from "@hapi/boom";
import express from "express";

import {
  updatePasskeyCounter,
  verifyPasskeyAuthentication,
} from "../../../utils/passkey";
import {
  clearPasskeyChallengeCookie,
  getPasskeyChallengeFromCookie,
} from "../../../utils/passkeyChallengeCookie";
import { generatePasskeyLoginToken } from "../../../utils/tokenUtils";
import { handleError } from "../../any-api-workspaces-catchall/middleware";
import { validateBody } from "../../utils/bodyValidation";
import { passkeyLoginVerifySchema } from "../../utils/schemas/userSchemas";

/**
 * POST /api/user/passkey/login/verify
 * Verifies the authentication response, updates counter, and returns a one-time token
 * for the frontend to call signIn("passkey", { token }). No auth required.
 */
export const registerPostPasskeyLoginVerify = (app: express.Application) => {
  app.post(
    "/api/user/passkey/login/verify",
    async (req, res, next) => {
      try {
        const cookieHeader = req.headers.cookie;
        const expectedChallenge = await getPasskeyChallengeFromCookie(
          cookieHeader,
          "passkey-login"
        );
        if (!expectedChallenge) {
          throw badRequest(
            "Missing or invalid passkey challenge. Please request new login options."
          );
        }

        const body = validateBody(req.body ?? {}, passkeyLoginVerifySchema);

        const result = await verifyPasskeyAuthentication(
          body as Parameters<typeof verifyPasskeyAuthentication>[0],
          expectedChallenge
        );

        if (!result) {
          throw badRequest("Passkey authentication verification failed");
        }

        const { userId, newCounter } = result;
        const credentialIdBase64 = body.id;

        const counterUpdated = await updatePasskeyCounter(
          userId,
          credentialIdBase64,
          newCounter
        );
        if (!counterUpdated) {
          throw badRequest("Passkey authentication verification failed");
        }

        clearPasskeyChallengeCookie(res);
        const token = await generatePasskeyLoginToken(userId);
        res.status(200).json({ token });
      } catch (error) {
        handleError(error, next, "POST /api/user/passkey/login/verify");
      }
    }
  );
};
