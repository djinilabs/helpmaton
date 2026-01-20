import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { requireAuth, requirePermission } from "../middleware";

import { handlePutMcpServer } from "./put-mcp-server-handler";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/mcp-servers/{serverId}:
 *   put:
 *     summary: Update workspace MCP server
 *     description: Updates MCP server configuration
 *     tags:
 *       - MCP Servers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: serverId
 *         in: path
 *         required: true
 *         description: MCP server ID
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
 *               url:
 *                 type: string
 *                 format: uri
 *               authType:
 *                 type: string
 *                 enum: [none, header, basic]
 *               config:
 *                 type: object
 *                 description: Authentication configuration
 *     responses:
 *       200:
 *         description: MCP server updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 url:
 *                   type: string
 *                 authType:
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
 *         description: MCP server not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPutMcpServer = (app: express.Application) => {
  app.put(
    "/api/workspaces/:workspaceId/mcp-servers/:serverId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    handlePutMcpServer
  );
};
