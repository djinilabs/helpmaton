import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { trackBusinessEvent } from "../../../utils/tracking";
import { handleError, requireAuth, requirePermission } from "../middleware";

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
    async (req, res, next) => {
      try {
        const { name, url, authType, config } = req.body;
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const serverId = req.params.serverId;
        const pk = `mcp-servers/${workspaceId}/${serverId}`;

        const server = await db["mcp-server"].get(pk, "server");
        if (!server) {
          throw resourceGone("MCP server not found");
        }

        if (server.workspaceId !== workspaceId) {
          throw forbidden("MCP server does not belong to this workspace");
        }

        // Validate name if provided
        if (name !== undefined) {
          if (typeof name !== "string") {
            throw badRequest("name must be a string");
          }
        }

        // Validate URL if provided
        if (url !== undefined) {
          if (typeof url !== "string") {
            throw badRequest("url must be a string");
          }
          try {
            new URL(url);
          } catch {
            throw badRequest("url must be a valid URL");
          }
        }

        // Validate authType if provided
        if (authType !== undefined) {
          if (typeof authType !== "string") {
            throw badRequest("authType must be a string");
          }
          if (!["none", "header", "basic"].includes(authType)) {
            throw badRequest(
              'authType must be one of: "none", "header", "basic"'
            );
          }
        }

        // Validate config if provided
        if (config !== undefined) {
          if (typeof config !== "object" || config === null) {
            throw badRequest("config must be an object");
          }
          const finalAuthType = (authType || server.authType) as
            | "none"
            | "header"
            | "basic";
          if (finalAuthType === "header") {
            if (!config.headerValue || typeof config.headerValue !== "string") {
              throw badRequest(
                "config.headerValue is required for header authentication"
              );
            }
          } else if (finalAuthType === "basic") {
            if (!config.username || typeof config.username !== "string") {
              throw badRequest(
                "config.username is required for basic authentication"
              );
            }
            if (!config.password || typeof config.password !== "string") {
              throw badRequest(
                "config.password is required for basic authentication"
              );
            }
          }
        }

        // Update server
        const updated = await db["mcp-server"].update({
          pk,
          sk: "server",
          workspaceId,
          name: name !== undefined ? name : server.name,
          url: url !== undefined ? url : server.url,
          authType:
            authType !== undefined
              ? (authType as "none" | "header" | "basic")
              : server.authType,
          config: config !== undefined ? config : server.config,
          updatedBy: req.userRef || "",
          updatedAt: new Date().toISOString(),
        });

        // Track MCP server update
        trackBusinessEvent(
          "mcp_server",
          "updated",
          {
            workspace_id: workspaceId,
            server_id: serverId,
          },
          req
        );

        res.json({
          id: serverId,
          name: updated.name,
          url: updated.url,
          authType: updated.authType,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "PUT /api/workspaces/:workspaceId/mcp-servers/:serverId"
        );
      }
    }
  );
};
