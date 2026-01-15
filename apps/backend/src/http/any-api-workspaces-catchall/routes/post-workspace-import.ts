import { unauthorized } from "@hapi/boom";
import express from "express";

import { workspaceExportSchema } from "../../../schemas/workspace-export";
import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { importWorkspace } from "../../../utils/workspaceImport";
import { validateBody } from "../../utils/bodyValidation";
import { handleError, requireAuth } from "../middleware";

/**
 * @openapi
 * /api/workspaces/import:
 *   post:
 *     summary: Import workspace configuration
 *     description: Creates a new workspace from an exported workspace configuration JSON. Includes all agents, output channels, email connections, MCP servers, and bot integrations. All IDs will be regenerated as new UUIDs.
 *     tags:
 *       - Workspaces
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WorkspaceExport'
 *     responses:
 *       201:
 *         description: Workspace imported successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   description: The created workspace ID
 *                 name:
 *                   type: string
 *                 description:
 *                   type: string
 *                   nullable: true
 *                 permissionLevel:
 *                   type: string
 *                   enum: [owner, admin, write, read]
 *                 creditBalance:
 *                   type: number
 *                 currency:
 *                   type: string
 *                 spendingLimits:
 *                   type: array
 *                   items:
 *                     type: object
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostWorkspaceImport = (app: express.Application) => {
  app.post("/api/workspaces/import", requireAuth, async (req, res, next) => {
    try {
      // Validate request body against workspace export schema
      const body = validateBody(req.body, workspaceExportSchema);

      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }

      // Import the workspace
      const workspaceId = await importWorkspace(body, currentUserRef);

      // Fetch the created workspace to return it
      const db = await database();
      const workspacePk = `workspaces/${workspaceId}`;
      const workspace = await db.workspace.get(workspacePk, "workspace");

      if (!workspace) {
        throw new Error("Workspace was created but could not be retrieved");
      }

      res.status(201).json({
        id: workspaceId,
        name: workspace.name,
        description: workspace.description,
        permissionLevel: PERMISSION_LEVELS.OWNER,
        creditBalance: workspace.creditBalance ?? 0,
        currency: workspace.currency ?? "usd",
        spendingLimits: workspace.spendingLimits ?? [],
        createdAt: workspace.createdAt,
      });
    } catch (error) {
      handleError(error, next, "POST /api/workspaces/import");
    }
  });
};
