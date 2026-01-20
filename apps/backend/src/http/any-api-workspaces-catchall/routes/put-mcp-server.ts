import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  isValidPosthogBaseUrl,
  normalizePosthogBaseUrl,
} from "../../../utils/posthog/constants";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { updateMcpServerSchema } from "../../utils/schemas/workspaceSchemas";
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
        const body = validateBody(req.body, updateMcpServerSchema);
        const { name, url, authType, serviceType, config } = body;
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
          if (!["none", "header", "basic", "oauth"].includes(authType)) {
            throw badRequest(
              'authType must be one of: "none", "header", "basic", "oauth"'
            );
          }
        }

        // For OAuth servers, prevent updating OAuth tokens via config
        // OAuth tokens should only be updated via OAuth endpoints
        if (server.authType === "oauth" && config !== undefined) {
          const configObj = config as Record<string, unknown>;
          if (
            configObj.accessToken !== undefined ||
            configObj.refreshToken !== undefined ||
            configObj.expiresAt !== undefined
          ) {
            throw badRequest(
              "OAuth tokens cannot be updated via this endpoint. Use OAuth endpoints instead."
            );
          }
        }

        const finalServiceType = serviceType ?? server.serviceType;
        const finalAuthType = (authType || server.authType) as
          | "none"
          | "header"
          | "basic"
          | "oauth";

        // Validate config if provided
        if (config !== undefined) {
          if (typeof config !== "object" || config === null) {
            throw badRequest("config must be an object");
          }
          if (finalAuthType === "header" && finalServiceType !== "posthog") {
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
          } else if (finalServiceType === "posthog") {
            if (!config.apiKey || typeof config.apiKey !== "string") {
              throw badRequest(
                "config.apiKey is required for PostHog authentication"
              );
            }
          }
        }

        if (finalServiceType === "posthog") {
          if (finalAuthType !== "header") {
            throw badRequest("PostHog requires header authentication");
          }
          const baseUrl = url ?? server.url;
          if (!baseUrl || typeof baseUrl !== "string") {
            throw badRequest(
              "url is required for PostHog and must be a valid PostHog base URL"
            );
          }
          const normalizedUrl = normalizePosthogBaseUrl(baseUrl);
          if (!isValidPosthogBaseUrl(normalizedUrl)) {
            throw badRequest(
              "url must be https://us.posthog.com or https://eu.posthog.com"
            );
          }
          if (config === undefined) {
            const existingConfig = server.config as { apiKey?: string };
            if (!existingConfig.apiKey) {
              throw badRequest(
                "config.apiKey is required for PostHog authentication"
              );
            }
          }
        }

        if (finalServiceType === "zendesk" && finalAuthType === "oauth") {
          const existingConfig = server.config as {
            subdomain?: string;
            clientId?: string;
            clientSecret?: string;
          };
          const newConfig = (config ?? {}) as {
            subdomain?: string;
            clientId?: string;
            clientSecret?: string;
          };
          const subdomain = newConfig.subdomain ?? existingConfig.subdomain;
          const clientId = newConfig.clientId ?? existingConfig.clientId;
          const clientSecret =
            newConfig.clientSecret ?? existingConfig.clientSecret;
          if (!subdomain || !clientId || !clientSecret) {
            throw badRequest(
              "config.subdomain, config.clientId, and config.clientSecret are required for Zendesk OAuth"
            );
          }
          const zendeskSubdomainPattern = /^[a-zA-Z0-9-]+$/;
          if (!zendeskSubdomainPattern.test(subdomain)) {
            throw badRequest(
              "config.subdomain must contain only alphanumeric characters and hyphens"
            );
          }
        }

        // Update server
        // For OAuth servers, merge config but preserve OAuth tokens
        let finalConfig = config !== undefined ? config : server.config;
        if (server.authType === "oauth" && config !== undefined) {
          // Merge config but preserve OAuth tokens
          const existingConfig = server.config as Record<string, unknown>;
          const newConfig = config as Record<string, unknown>;
          finalConfig = {
            ...existingConfig,
            ...newConfig,
            // Preserve OAuth tokens
            accessToken: existingConfig.accessToken,
            refreshToken: existingConfig.refreshToken,
            expiresAt: existingConfig.expiresAt,
            email: existingConfig.email,
          };
        }

        const updated = await db["mcp-server"].update({
          pk,
          sk: "server",
          workspaceId,
          name: name !== undefined ? name : server.name,
          url: url !== undefined ? url : server.url,
          authType:
            authType !== undefined
              ? (authType as "none" | "header" | "basic" | "oauth")
              : server.authType,
          serviceType:
            serviceType !== undefined ? serviceType : server.serviceType,
          config: finalConfig,
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

        const oauthConfig = updated.config as {
          accessToken?: string;
        };
        const oauthConnected =
          updated.authType === "oauth" && !!oauthConfig.accessToken;

        res.json({
          id: serverId,
          name: updated.name,
          url: updated.url,
          authType: updated.authType,
          serviceType: updated.serviceType,
          oauthConnected:
            updated.authType === "oauth" ? oauthConnected : undefined,
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
