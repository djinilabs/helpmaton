import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { verifyPasskeyRegistration } from "../../../utils/passkey";
import { getPasskeyChallengeFromCookie } from "../../../utils/passkeyChallengeCookie";
import {
  handleError,
  requireAuthOrSession,
} from "../../any-api-workspaces-catchall/middleware";
import { validateBody } from "../../utils/bodyValidation";
import { passkeyRegisterVerifySchema } from "../../utils/schemas/userSchemas";

/**
 * POST /api/user/passkey/register/verify
 * Verifies the registration response and stores the passkey. Requires challenge cookie.
 */
export const registerPostPasskeyRegisterVerify = (
  app: express.Application
) => {
  app.post(
    "/api/user/passkey/register/verify",
    requireAuthOrSession,
    async (req, res, next) => {
      try {
        const session = req.session;
        if (!session?.user?.id) {
          throw unauthorized("User authentication required");
        }
        const userId = session.user.id;

        const cookieHeader = req.headers.cookie;
        const expectedChallenge = await getPasskeyChallengeFromCookie(
          cookieHeader,
          "passkey-register"
        );
        if (!expectedChallenge) {
          throw badRequest(
            "Missing or invalid passkey challenge. Please request new registration options."
          );
        }

        const body = validateBody(req.body ?? {}, passkeyRegisterVerifySchema);

        const result = await verifyPasskeyRegistration(
          userId,
          body as Parameters<typeof verifyPasskeyRegistration>[1],
          expectedChallenge
        );

        if (!result.verified) {
          throw badRequest("Passkey registration verification failed");
        }

        res.status(200).json({ verified: true });
      } catch (error) {
        handleError(error, next, "POST /api/user/passkey/register/verify");
      }
    }
  );
};
