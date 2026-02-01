import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

/**
 * Validates workspace and user context and returns workspaceId.
 * Use in routes that require workspace-scoped authorization after requirePermission middleware.
 */
export function requireWorkspaceContext(req: express.Request): {
  workspaceId: string;
} {
  if (!req.workspaceResource) {
    throw badRequest("Workspace resource not found");
  }
  if (!req.userRef) {
    throw unauthorized();
  }
  return { workspaceId: req.params.workspaceId };
}
