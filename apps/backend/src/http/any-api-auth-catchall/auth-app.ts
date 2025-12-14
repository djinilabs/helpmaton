import { ExpressAuth } from "@auth/express";
import express from "express";

import { authConfig } from "../../auth-config";
import { expressErrorHandler } from "../utils/errorHandler";

export const createApp: () => Promise<express.Application> = async () => {
  const app = express();
  app.set("trust proxy", true);
  app.use("/api/auth", ExpressAuth(await authConfig()));
  // Error handler must be last
  app.use(expressErrorHandler);
  return app;
};
