import { badRequest } from "@hapi/boom";
import express from "express";

import {
  createAuthGateToken,
  extractEmailFromCallbackUrl,
  normalizeAuthCallbackUrl,
} from "../../../utils/authGate";
import { validateCloudflareTurnstile } from "../../../utils/captcha";
import { handleError } from "../../any-api-workspaces-catchall/middleware";
import { validateBody } from "../../utils/bodyValidation";
import { authGateVerificationSchema } from "../../utils/schemas/userSchemas";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

/**
 * @openapi
 * /api/user/verify-gate:
 *   post:
 *     summary: Verify CAPTCHA and TOS acceptance for new users
 *     description: Validates Cloudflare Turnstile and requires Terms acceptance before allowing new user sign-in.
 *     tags:
 *       - User
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - captchaToken
 *               - acceptedTerms
 *               - callbackUrl
 *             properties:
 *               captchaToken:
 *                 type: string
 *                 description: Cloudflare Turnstile CAPTCHA token
 *               acceptedTerms:
 *                 type: boolean
 *                 description: User accepted terms of service
 *               callbackUrl:
 *                 type: string
 *                 description: Auth callback URL from email link
 *     responses:
 *       200:
 *         description: Gate verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 gateToken:
 *                   type: string
 *                   description: Short-lived token proving verification
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostVerifyAuthGate = (app: express.Application) => {
  app.post("/api/user/verify-gate", async (req, res, next) => {
    try {
      const body = validateBody(req.body || {}, authGateVerificationSchema);
      const { captchaToken, callbackUrl } = body;

      const userIp = req.ip || req.socket.remoteAddress || "unknown";
      const captchaValid = await validateCloudflareTurnstile(
        captchaToken,
        userIp
      );
      if (!captchaValid) {
        throw badRequest("CAPTCHA validation failed. Please try again.");
      }

      const normalizedCallbackUrl = normalizeAuthCallbackUrl(
        callbackUrl,
        FRONTEND_URL,
        [FRONTEND_URL]
      );
      const email = extractEmailFromCallbackUrl(normalizedCallbackUrl);

      const gateToken = await createAuthGateToken({
        email: email.toLowerCase(),
        callbackUrl: normalizedCallbackUrl.toString(),
      });

      res.json({ gateToken });
    } catch (error) {
      handleError(error, next, "POST /api/user/verify-gate");
    }
  });
};
