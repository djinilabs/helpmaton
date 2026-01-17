import { randomUUID } from "crypto";

import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  isValidPosthogBaseUrl,
  normalizePosthogBaseUrl,
} from "../../../utils/posthog/constants";
import {
  checkSubscriptionLimits,
  ensureWorkspaceSubscription,
} from "../../../utils/subscriptionUtils";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { createMcpServerSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/mcp-servers:
 *   post:
 *     summary: Create workspace MCP server
 *     description: Creates a new MCP (Model Context Protocol) server for a workspace
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - url
 *               - authType
 *               - config
 *             properties:
 *               name:
 *                 type: string
 *                 description: MCP server name
 *               url:
 *                 type: string
 *                 format: uri
 *                 description: MCP server URL
 *               authType:
 *                 type: string
 *                 enum: [none, header, basic]
 *                 description: Authentication type
 *               config:
 *                 type: object
 *                 description: Authentication configuration
 *                 properties:
 *                   headerValue:
 *                     type: string
 *                     description: Header value (required for header auth)
 *                   username:
 *                     type: string
 *                     description: Username (required for basic auth)
 *                   password:
 *                     type: string
 *                     description: Password (required for basic auth)
 *     responses:
 *       201:
 *         description: MCP server created successfully
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
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostMcpServer = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/mcp-servers",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, createMcpServerSchema);
        const { name, url, authType, serviceType, config } = body;

        // Validate config based on authType
        if (authType === "header" && serviceType !== "posthog") {
          if (!config.headerValue || typeof config.headerValue !== "string") {
            throw badRequest(
              "config.headerValue is required for header authentication"
            );
          }
        } else if (authType === "basic") {
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
        } else if (authType === "oauth") {
          // For OAuth, serviceType is required
          if (!serviceType || serviceType === "external") {
            throw badRequest(
              "serviceType must be specified and cannot be 'external' for OAuth authentication"
            );
          }
          // Config should be empty initially (OAuth connection happens via separate flow)
          // But we allow it to be empty or contain serviceType
        }

        if (serviceType === "posthog") {
          if (authType !== "header") {
            throw badRequest("PostHog requires header authentication");
          }
          if (!config.apiKey || typeof config.apiKey !== "string") {
            throw badRequest("config.apiKey is required for PostHog authentication");
          }
          if (!url || typeof url !== "string") {
            throw badRequest(
              "url is required for PostHog and must be a valid PostHog base URL"
            );
          }
          const normalizedUrl = normalizePosthogBaseUrl(url);
          if (!isValidPosthogBaseUrl(normalizedUrl)) {
            throw badRequest(
              "url must be https://us.posthog.com or https://eu.posthog.com"
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

        // Ensure workspace has a subscription and check MCP server limit
        const userId = currentUserRef.replace("users/", "");
        const subscriptionId = await ensureWorkspaceSubscription(
          workspaceId,
          userId
        );
        await checkSubscriptionLimits(subscriptionId, "mcpServer", 1);

        const serverId = randomUUID();
        const pk = `mcp-servers/${workspaceId}/${serverId}`;
        const sk = "server";

        // Create MCP server
        const server = await db["mcp-server"].create({
          pk,
          sk,
          workspaceId,
          name,
          url: url || undefined, // url is optional for OAuth servers
          authType: authType as "none" | "header" | "basic" | "oauth",
          serviceType: serviceType || "external",
          config: authType === "oauth" ? {} : config, // Start with empty config for OAuth
          createdBy: currentUserRef,
        });

        // Track MCP server creation
        trackBusinessEvent(
          "mcp_server",
          "created",
          {
            workspace_id: workspaceId,
            server_id: serverId,
            auth_type: authType,
          },
          req
        );

        res.status(201).json({
          id: serverId,
          name: server.name,
          url: server.url,
          authType: server.authType,
          serviceType: server.serviceType,
          createdAt: server.createdAt,
          updatedAt: server.updatedAt,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/mcp-servers"
        );
      }
    }
  );
};
