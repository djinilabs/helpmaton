import express from "express";

import { expressErrorHandler } from "../utils/errorHandler";

// Import user API key route handlers
import { registerDeleteUserApiKeys } from "./routes/delete-user-api-keys";
import { registerGetUserApiKeys } from "./routes/get-user-api-keys";
import { registerPostGenerateTokens } from "./routes/post-generate-tokens";
import { registerPostRefreshToken } from "./routes/post-refresh-token";
import { registerPostUserApiKeys } from "./routes/post-user-api-keys";
import { registerPostVerifyAuthGate } from "./routes/post-verify-auth-gate";

export const createApp = (): express.Application => {
  const app = express();
  app.set("etag", false);
  app.set("trust proxy", true);
  app.use(express.json());

  // Add request logging middleware
  app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.path}`);
    next();
  });

  // Register user API key routes
  registerGetUserApiKeys(app);
  registerPostUserApiKeys(app);
  registerDeleteUserApiKeys(app);

  // Register token management routes
  registerPostGenerateTokens(app);
  registerPostRefreshToken(app);
  registerPostVerifyAuthGate(app);

  // Error handler must be last
  app.use(expressErrorHandler);

  return app;
};
