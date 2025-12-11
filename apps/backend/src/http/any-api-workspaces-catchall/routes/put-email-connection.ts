import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/email-connection:
 *   put:
 *     summary: Update workspace email connection
 *     description: Updates email connection name or configuration
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
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Connection name
 *               config:
 *                 type: object
 *                 description: Connection configuration (merged with existing)
 *     responses:
 *       200:
 *         description: Email connection updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                 type:
 *                   type: string
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
export const registerPutEmailConnection = (app: express.Application) => {
  app.put(
    "/api/workspaces/:workspaceId/email-connection",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const { name, config } = req.body;
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

        // Validate config if provided
        if (config !== undefined) {
          if (typeof config !== "object") {
            throw badRequest("config must be an object");
          }
          // Merge config with existing
          const updatedConfig = { ...connection.config, ...config };
          connection.config = updatedConfig;
        }

        // Update connection
        const updated = await db["email-connection"].update({
          pk,
          sk: "connection",
          workspaceId,
          type: connection.type,
          name: name !== undefined ? name : connection.name,
          config: connection.config,
          updatedBy: req.userRef || "",
          updatedAt: new Date().toISOString(),
        });

        res.json({
          name: updated.name,
          type: updated.type,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "PUT /api/workspaces/:workspaceId/email-connection"
        );
      }
    }
  );
};
