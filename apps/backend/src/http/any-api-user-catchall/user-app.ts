import express from "express";

import { expressErrorHandler } from "../utils/errorHandler";
import { posthogResetMiddleware } from "../utils/posthogMiddleware";

// Import user API key route handlers
import { registerDeleteUserApiKeys } from "./routes/delete-user-api-keys";
import { registerGetPasskeyLoginOptions } from "./routes/get-passkey-login-options";
import { registerGetUserApiKeys } from "./routes/get-user-api-keys";
import { registerGetUserPasskeys } from "./routes/get-user-passkeys";
import { registerPostGenerateTokens } from "./routes/post-generate-tokens";
import { registerPostPasskeyLoginVerify } from "./routes/post-passkey-login-verify";
import { registerPostPasskeyRegisterOptions } from "./routes/post-passkey-register-options";
import { registerPostPasskeyRegisterVerify } from "./routes/post-passkey-register-verify";
import { registerPostRefreshToken } from "./routes/post-refresh-token";
import { registerPostUserApiKeys } from "./routes/post-user-api-keys";
import { registerPostVerifyAuthGate } from "./routes/post-verify-auth-gate";

export const createApp = (): express.Application => {
  const app = express();
  app.set("etag", false);
  app.set("trust proxy", true);
  app.use(express.json());

  app.use(posthogResetMiddleware);

  // Add request logging middleware
  app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.path}`);
    next();
  });

  // Register user API key routes
  registerGetUserApiKeys(app);
  registerGetUserPasskeys(app);
  registerPostUserApiKeys(app);
  registerDeleteUserApiKeys(app);

  // Register token management routes
  registerPostGenerateTokens(app);
  registerPostRefreshToken(app);
  registerPostVerifyAuthGate(app);

  // Passkey (WebAuthn) routes
  registerPostPasskeyRegisterOptions(app);
  registerPostPasskeyRegisterVerify(app);
  registerGetPasskeyLoginOptions(app);
  registerPostPasskeyLoginVerify(app);

  // Error handler must be last
  app.use(expressErrorHandler);

  return app;
};
