import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/documents/folders:
 *   get:
 *     summary: List document folders
 *     description: Returns all unique folder paths in a workspace
 *     tags:
 *       - Documents
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
 *         description: List of folder paths
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 folders:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Sorted list of unique folder paths
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetWorkspaceDocumentFolders = (
  app: express.Application
) => {
  app.get(
    "/api/workspaces/:workspaceId/documents/folders",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    asyncHandler(async (req, res) => {
      const db = await database();
      const workspaceId = req.params.workspaceId;

      // Query all documents for this workspace
      const documents = await db["workspace-document"].query({
        IndexName: "byWorkspaceId",
        KeyConditionExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: {
          ":workspaceId": workspaceId,
        },
      });

      // Extract unique folder paths
      const folderPaths = new Set<string>();
      documents.items.forEach((doc) => {
        folderPaths.add(doc.folderPath || "");
      });

      res.json({ folders: Array.from(folderPaths).sort() });
    })
  );
};
