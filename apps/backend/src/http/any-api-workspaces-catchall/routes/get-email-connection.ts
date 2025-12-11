import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/email-connection:
 *   get:
 *     summary: Get workspace email connection
 *     description: Returns email connection details for a workspace (without sensitive config)
 *     tags:
 *       - Email
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
 *         description: Email connection details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                 type:
 *                   type: string
 *                   description: Email connection type
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Email connection not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetEmailConnection = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/email-connection",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.READ),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const pk = `email-connections/${workspaceId}`;

        const connection = await db["email-connection"].get(pk, "connection");
        if (!connection) {
          throw resourceGone("Email connection not found");
        }

        if (connection.workspaceId !== workspaceId) {
          throw forbidden("Email connection does not belong to this workspace");
        }

        // Return connection without sensitive config data
        res.json({
          name: connection.name,
          type: connection.type,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/email-connection"
        );
      }
    }
  );
};
