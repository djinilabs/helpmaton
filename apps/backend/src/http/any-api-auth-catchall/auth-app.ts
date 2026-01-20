import { ExpressAuth } from "@auth/express";
import express from "express";

import { authConfig } from "../../auth-config";
import {
  normalizeAuthCallbackUrl,
  verifyAuthGateToken,
} from "../../utils/authGate";
import { getUserByEmail } from "../../utils/subscriptionUtils";
import { expressErrorHandler } from "../utils/errorHandler";

export const createApp: () => Promise<express.Application> = async () => {
  const app = express();
  app.set("trust proxy", true);
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  app.use("/api/auth/callback/email", async (req, res, next) => {
    try {
      const email =
        typeof req.query.email === "string" ? req.query.email : undefined;
      if (!email) {
        return next();
      }

      const existingUser = await getUserByEmail(email);
      if (existingUser?.userId) {
        return next();
      }

      const fallbackUrl = new URL(frontendUrl);
      const requestHost = req.get("host") || fallbackUrl.host;
      const requestProtocol =
        req.protocol || fallbackUrl.protocol.replace(":", "");
      const fullCallbackUrl = new URL(
        req.originalUrl,
        `${requestProtocol}://${requestHost}`
      ).toString();
      const normalizedCallbackUrl = normalizeAuthCallbackUrl(
        fullCallbackUrl,
        `${requestProtocol}://${requestHost}`,
        [`${requestProtocol}://${requestHost}`]
      ).toString();

      const gateToken =
        typeof req.query.gateToken === "string" ? req.query.gateToken : undefined;
      if (!gateToken) {
        const redirectUrl = new URL("/auth/gate", frontendUrl);
        redirectUrl.searchParams.set("callbackUrl", normalizedCallbackUrl);
        redirectUrl.searchParams.set("error", "missing_gate");
        return res.redirect(302, redirectUrl.toString());
      }

      let gatePayload: Awaited<ReturnType<typeof verifyAuthGateToken>>;
      try {
        gatePayload = await verifyAuthGateToken(gateToken);
      } catch {
        const redirectUrl = new URL("/auth/gate", frontendUrl);
        redirectUrl.searchParams.set("callbackUrl", normalizedCallbackUrl);
        redirectUrl.searchParams.set("error", "invalid_gate");
        return res.redirect(302, redirectUrl.toString());
      }
      if (
        gatePayload.email.toLowerCase() !== email.toLowerCase() ||
        gatePayload.callbackUrl !== normalizedCallbackUrl
      ) {
        const redirectUrl = new URL("/auth/gate", frontendUrl);
        redirectUrl.searchParams.set("callbackUrl", normalizedCallbackUrl);
        redirectUrl.searchParams.set("error", "invalid_gate");
        return res.redirect(302, redirectUrl.toString());
      }

      return next();
    } catch (error) {
      return next(error);
    }
  });
  app.use("/api/auth", ExpressAuth(await authConfig()));
  // Error handler must be last
  app.use(expressErrorHandler);
  return app;
};
