import { randomUUID } from "crypto";

import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { trackBusinessEvent } from "../../../utils/tracking";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/integrations:
 *   post:
 *     summary: Create a new bot integration
 *     description: Creates a new Slack or Discord bot integration for an agent
 *     tags:
 *       - Integrations
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
 *               - platform
 *               - name
 *               - agentId
 *               - config
 *             properties:
 *               platform:
 *                 type: string
 *                 enum: [slack, discord]
 *                 description: Platform type
 *               name:
 *                 type: string
 *                 description: Integration name
 *               agentId:
 *                 type: string
 *                 description: Agent ID to connect to
 *               config:
 *                 type: object
 *                 description: Platform-specific configuration (encrypted)
 *     responses:
 *       201:
 *         description: Integration created successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
export const registerPostWorkspaceIntegrations = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/integrations",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const { platform, name, agentId, config } = req.body;
        const workspaceId = req.params.workspaceId;

        if (!platform || (platform !== "slack" && platform !== "discord")) {
          throw badRequest("platform must be 'slack' or 'discord'");
        }
        if (!name || typeof name !== "string") {
          throw badRequest("name is required and must be a string");
        }
        if (!agentId || typeof agentId !== "string") {
          throw badRequest("agentId is required and must be a string");
        }
        if (!config || typeof config !== "object") {
          throw badRequest("config is required and must be an object");
        }

        const db = await database();
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        // Validate agent exists and belongs to workspace
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw badRequest("Agent not found");
        }

        // Validate platform-specific config
        if (platform === "slack") {
          if (!config.botToken || typeof config.botToken !== "string") {
            throw badRequest("config.botToken is required for Slack");
          }
          if (
            !config.signingSecret ||
            typeof config.signingSecret !== "string"
          ) {
            throw badRequest("config.signingSecret is required for Slack");
          }
          // Validate messageHistoryCount if provided
          if (config.messageHistoryCount !== undefined) {
            if (
              typeof config.messageHistoryCount !== "number" ||
              !Number.isInteger(config.messageHistoryCount) ||
              config.messageHistoryCount < 0 ||
              config.messageHistoryCount > 100
            ) {
              throw badRequest(
                "config.messageHistoryCount must be an integer between 0 and 100"
              );
            }
          } else {
            // Set default value of 10
            config.messageHistoryCount = 10;
          }
        } else if (platform === "discord") {
          if (!config.botToken || typeof config.botToken !== "string") {
            throw badRequest("config.botToken is required for Discord");
          }
          if (!config.publicKey || typeof config.publicKey !== "string") {
            throw badRequest("config.publicKey is required for Discord");
          }
          // Validate public key is hex and 64 characters (32 bytes)
          if (!/^[0-9a-fA-F]{64}$/.test(config.publicKey)) {
            throw badRequest(
              "config.publicKey must be a 64-character hex string"
            );
          }
        }

        // Generate integration ID
        const integrationId = randomUUID();

        // Construct webhook URL
        const webhookBaseFromEnv = process.env.WEBHOOK_BASE_URL?.trim();
        const baseUrlFromEnv = process.env.BASE_URL?.trim();
        let baseUrl: string;

        if (webhookBaseFromEnv && webhookBaseFromEnv.length > 0) {
          baseUrl = webhookBaseFromEnv.replace(/\/+$/, "");
        } else if (baseUrlFromEnv && baseUrlFromEnv.length > 0) {
          baseUrl = baseUrlFromEnv.replace(/\/+$/, "");
        } else if (process.env.ARC_ENV === "production") {
          baseUrl = "https://api.helpmaton.com";
        } else if (process.env.ARC_ENV === "staging") {
          baseUrl = "https://staging-api.helpmaton.com";
        } else {
          throw new Error(
            "WEBHOOK_BASE_URL or BASE_URL environment variable must be set for non-production/non-staging environments"
          );
        }
        const webhookUrl = `${baseUrl}/api/webhooks/${platform}/${workspaceId}/${integrationId}`;

        // Create integration
        const integrationPk = `bot-integrations/${workspaceId}/${integrationId}`;
        const integration = await db["bot-integration"].create({
          pk: integrationPk,
          sk: "integration",
          workspaceId,
          agentId,
          platform,
          name,
          config, // Will be encrypted at rest by DynamoDB
          webhookUrl,
          status: "active",
          createdBy: currentUserRef,
        });

        const integrationConfig = (integration.config || {}) as {
          discordCommand?: {
            commandName: string;
            commandId: string;
          };
        };

        // Track integration creation
        trackBusinessEvent(
          "integration",
          "created",
          {
            workspace_id: workspaceId,
            integration_id: integrationId,
            platform: integration.platform,
            agent_id: agentId,
            integration_name: name,
          },
          req
        );

        res.status(201).json({
          id: integrationId,
          platform: integration.platform,
          name: integration.name,
          agentId: integration.agentId,
          webhookUrl: integration.webhookUrl,
          status: integration.status,
          createdAt: integration.createdAt,
          discordCommand: integrationConfig.discordCommand,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/integrations"
        );
      }
    }
  );
};
