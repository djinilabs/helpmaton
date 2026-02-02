import { unauthorized } from "@hapi/boom";
import express from "express";

import { listPasskeysForUser } from "../../../utils/passkey";
import {
  handleError,
  requireAuth,
} from "../../any-api-workspaces-catchall/middleware";

/**
 * GET /api/user/passkeys
 * Returns whether the authenticated user has any passkeys (for prompting to add one).
 */
export const registerGetUserPasskeys = (app: express.Application) => {
  app.get("/api/user/passkeys", requireAuth, async (req, res, next) => {
    try {
      const userRef = req.userRef;
      if (!userRef) {
        throw unauthorized();
      }
      const userId = userRef.replace("users/", "");
      const passkeys = await listPasskeysForUser(userId);
      res.json({ hasPasskey: passkeys.length > 0 });
    } catch (error) {
      handleError(error, next, "GET /api/user/passkeys");
    }
  });
};
