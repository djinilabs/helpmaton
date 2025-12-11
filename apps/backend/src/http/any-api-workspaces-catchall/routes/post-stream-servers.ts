import { badRequest } from "@hapi/boom";
import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/stream-servers:
 *   post:
 *     summary: Create agent stream server configuration
 *     description: Creates stream server configuration for an agent with allowed CORS origins
 *     tags:
 *       - Agents
 *       - Streams
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: agentId
 *         in: path
 *         required: true
 *         description: Agent ID
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - allowedOrigins
 *             properties:
 *               allowedOrigins:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Allowed CORS origins (use '*' for all or specific URLs)
 *     responses:
 *       201:
 *         description: Stream server configuration created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 secret:
 *                   type: string
 *                   description: Stream server secret for authentication
 *                 allowedOrigins:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostStreamServers = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/agents/:agentId/stream-servers",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    asyncHandler(async (req, res) => {
      const { workspaceId, agentId } = req.params;
      const { allowedOrigins } = req.body;

      if (!workspaceId || !agentId) {
        throw badRequest("workspaceId and agentId are required");
      }

      if (!Array.isArray(allowedOrigins)) {
        throw badRequest("allowedOrigins must be an array");
      }

      // Validate each origin string
      const isValidOrigin = (origin: string) =>
        origin === "*" ||
        (typeof origin === "string" &&
          (origin.startsWith("http://") || origin.startsWith("https://")));
      if (!allowedOrigins.every(isValidOrigin)) {
        throw badRequest(
          "Each allowedOrigin must be '*' or a string starting with 'http://' or 'https://'"
        );
      }

      // Validate that agent exists and belongs to workspace
      const { validateWorkspaceAndAgent } = await import(
        "../../utils/agentUtils"
      );
      await validateWorkspaceAndAgent(workspaceId, agentId);

      // Check if stream server config already exists
      const { getStreamServerConfig, createStreamServerConfig } = await import(
        "../../../utils/streamServerUtils"
      );
      const existingConfig = await getStreamServerConfig(workspaceId, agentId);
      if (existingConfig) {
        throw badRequest(
          "Stream server configuration already exists. Use PUT to update it."
        );
      }

      const config = await createStreamServerConfig(
        workspaceId,
        agentId,
        allowedOrigins
      );

      res.status(201).json({
        secret: config.secret,
        allowedOrigins: config.allowedOrigins,
      });
    })
  );
};
