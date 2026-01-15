import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { exportWorkspace } from "../../../utils/workspaceExport";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/export:
 *   get:
 *     summary: Export workspace configuration
 *     description: Exports a complete workspace configuration as a downloadable JSON file. Includes all agents, output channels, email connections, MCP servers, and bot integrations. Requires READ permission or higher.
 *     tags:
 *       - Workspaces
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Workspace export file
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WorkspaceExport'
 *             encoding:
 *               contentType: application/json
 *         headers:
 *           Content-Disposition:
 *             description: Attachment header with filename
 *             schema:
 *               type: string
 *               example: 'attachment; filename="workspace-export-abc123.json"'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Workspace not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceExport = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/export",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        const workspaceId = req.params.workspaceId;
        if (!workspaceId) {
          throw badRequest("workspaceId is required");
        }

        // Export the workspace
        const exportData = await exportWorkspace(workspaceId);

        // Set headers for file download
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="workspace-export-${workspaceId}.json"`
        );

        // Send the export data as JSON
        res.json(exportData);
      } catch (error) {
        handleError(error, next, "GET /api/workspaces/:workspaceId/export");
      }
    }
  );
};
