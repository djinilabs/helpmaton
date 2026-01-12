import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { validateBody } from "../../utils/bodyValidation";
import { createEmailConnectionSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/email-connection:
 *   post:
 *     summary: Create or update workspace email connection
 *     description: Creates a new email connection or updates existing one for a workspace
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
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - name
 *               - config
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [gmail, outlook, smtp]
 *                 description: Email connection type
 *               name:
 *                 type: string
 *                 description: Connection name
 *               config:
 *                 type: object
 *                 description: Connection-specific configuration
 *                 properties:
 *                   host:
 *                     type: string
 *                     description: SMTP host (required for smtp type)
 *                   port:
 *                     type: integer
 *                     description: SMTP port (required for smtp type)
 *                   secure:
 *                     type: boolean
 *                     description: Use secure connection (required for smtp type)
 *                   username:
 *                     type: string
 *                     description: SMTP username (required for smtp type)
 *                   password:
 *                     type: string
 *                     description: SMTP password (required for smtp type)
 *                   fromEmail:
 *                     type: string
 *                     description: From email address (required for smtp type)
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
 *       201:
 *         description: Email connection created successfully
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
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostEmailConnection = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/email-connection",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, createEmailConnectionSchema);
        const { type, name, config } = body;
        const emailConnectionType = type as "gmail" | "outlook" | "smtp";

        // Validate type-specific config
        if (type === "smtp") {
          if (!config.host || typeof config.host !== "string") {
            throw badRequest("config.host is required for SMTP connections");
          }
          if (config.port === undefined || typeof config.port !== "number") {
            throw badRequest("config.port is required for SMTP connections");
          }
          if (typeof config.secure !== "boolean") {
            throw badRequest("config.secure is required for SMTP connections");
          }
          if (!config.username || typeof config.username !== "string") {
            throw badRequest(
              "config.username is required for SMTP connections"
            );
          }
          if (!config.password || typeof config.password !== "string") {
            throw badRequest(
              "config.password is required for SMTP connections"
            );
          }
          if (!config.fromEmail || typeof config.fromEmail !== "string") {
            throw badRequest(
              "config.fromEmail is required for SMTP connections"
            );
          }
        }

        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const workspaceId = req.params.workspaceId;
        const pk = `email-connections/${workspaceId}`;
        const sk = "connection";

        // Check if connection already exists
        const existing = await db["email-connection"].get(pk, sk);

        if (existing) {
          // Update existing connection
          const updated = await db["email-connection"].update({
            pk,
            sk,
            workspaceId,
            type: emailConnectionType,
            name,
            config,
            updatedBy: currentUserRef,
            updatedAt: new Date().toISOString(),
          });

          res.json({
            name: updated.name,
            type: updated.type,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          });
        } else {
          // Create new connection
          const connection = await db["email-connection"].create({
            pk,
            sk,
            workspaceId,
            type: emailConnectionType,
            name,
            config,
            createdBy: currentUserRef,
          });

          res.status(201).json({
            name: connection.name,
            type: connection.type,
            createdAt: connection.createdAt,
            updatedAt: connection.updatedAt,
          });
        }
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/email-connection"
        );
      }
    }
  );
};
