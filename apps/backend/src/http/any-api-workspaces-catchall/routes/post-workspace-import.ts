import { unauthorized } from "@hapi/boom";
import express from "express";
import { z } from "zod";

import { workspaceExportSchema } from "../../../schemas/workspace-export";
import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { importWorkspace } from "../../../utils/workspaceImport";
import { validateBody } from "../../utils/bodyValidation";
import { handleError, requireAuth } from "../middleware";

const workspaceImportRequestSchema = z
  .object({
    export: workspaceExportSchema,
    creationNotes: z
      .string()
      .max(10000)
      .optional()
      .describe("Summary of onboarding responses; stored on workspace, never returned by API"),
  })
  .strict();

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
      const currentUserRef = req.userRef;
      if (!currentUserRef) {
        throw unauthorized();
      }

      const rawBody = req.body as unknown;
      let exportData: z.infer<typeof workspaceExportSchema>;
      let creationNotes: string | undefined;
      if (rawBody && typeof rawBody === "object" && "export" in rawBody) {
        const body = validateBody(rawBody, workspaceImportRequestSchema);
        exportData = body.export;
        creationNotes = body.creationNotes;
      } else {
        exportData = validateBody(rawBody, workspaceExportSchema);
      }

      const workspaceId = await importWorkspace(exportData, currentUserRef, creationNotes);

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
