import { badRequest, notFound, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { deleteDiscordCommand, makeDiscordRequest } from "../../../utils/discordApi";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { createIntegrationDiscordCommandSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

interface DiscordCommand {
  id?: string;
  name: string;
  description: string;
  options?: DiscordCommandOption[];
}

interface DiscordCommandOption {
  type: number;
  name: string;
  description: string;
  required: boolean;
}

/**
 * Validate command name according to Discord requirements
 */
function validateCommandName(name: string): void {
  if (!name || name.length === 0) {
    throw badRequest("Command name is required");
  }
  if (name.length > 32) {
    throw badRequest("Command name must be 1-32 characters");
  }
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw badRequest(
      "Command name must contain only lowercase letters, numbers, hyphens, and underscores"
    );
  }
  if (/^[0-9]/.test(name)) {
    throw badRequest("Command name must not start with a number");
  }
}

/**
 * @openapi
 * /api/workspaces/{workspaceId}/integrations/{integrationId}/discord-command:
 *   post:
 *     summary: Register a Discord slash command
 *     description: Creates or updates a Discord slash command for a bot integration
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
 *       - name: integrationId
 *         in: path
 *         required: true
 *         description: Integration ID
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - commandName
 *             properties:
 *               commandName:
 *                 type: string
 *                 description: The name of the command (e.g., "chat")
 *     responses:
 *       200:
 *         description: Command registered successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
export const registerPostWorkspaceIntegrationDiscordCommand = (
  app: express.Application
) => {
  app.post(
    "/api/workspaces/:workspaceId/integrations/:integrationId/discord-command",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const { workspaceId, integrationId } = req.params;
        const body = validateBody(req.body, createIntegrationDiscordCommandSchema);
        const { commandName } = body;

        // Validate command name
        validateCommandName(commandName);

        const db = await database();
        const integrationPk = `bot-integrations/${workspaceId}/${integrationId}`;
        const integration = await db["bot-integration"].get(
          integrationPk,
          "integration"
        );

        if (!integration) {
          throw notFound("Integration not found");
        }

        if (integration.platform !== "discord") {
          throw badRequest("Integration is not a Discord integration");
        }

        if (integration.status !== "active") {
          throw badRequest("Integration must be active to register commands");
        }

        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        const config = integration.config as {
          botToken?: string;
          publicKey?: string;
          applicationId?: string;
          discordCommand?: {
            commandName: string;
            commandId: string;
          };
        };

        if (!config.botToken || typeof config.botToken !== "string") {
          throw badRequest("Integration missing botToken");
        }

        if (!config.applicationId || typeof config.applicationId !== "string") {
          throw badRequest(
            "Application ID is required for command registration. Please update your integration with the Application ID."
          );
        }

        // Get existing command if it exists
        const existingCommand = config.discordCommand;

        // Delete old command if it exists and has a different name
        if (existingCommand && existingCommand.commandName !== commandName) {
          try {
            await deleteDiscordCommand(
              config.applicationId,
              existingCommand.commandId,
              config.botToken
            );
            console.log(
              `Deleted old Discord command: ${existingCommand.commandName} (${existingCommand.commandId})`
            );
          } catch (error) {
            // Log but don't fail - the command might already be deleted
            console.warn(
              `Failed to delete old Discord command: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        // Create new command
        const command: DiscordCommand = {
          name: commandName,
          description: "Chat with the AI agent",
          options: [
            {
              type: 3, // STRING
              name: "message",
              description: "The message to send to the agent",
              required: true,
            },
          ],
        };

        let createdCommand: DiscordCommand;
        try {
          const response = await makeDiscordRequest(
            "POST",
            `/applications/${config.applicationId}/commands`,
            config.botToken,
            command
          );
          createdCommand = response.data as DiscordCommand;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          throw badRequest(
            `Failed to create Discord command: ${errorMessage}`
          );
        }

        if (!createdCommand.id) {
          throw badRequest("Discord API did not return command ID");
        }

        // Update integration config with command metadata
        const updatedConfig = {
          ...config,
          discordCommand: {
            commandName: commandName,
            commandId: createdCommand.id,
          },
        };

        const updated = await db["bot-integration"].update({
          pk: integrationPk,
          sk: "integration",
          config: updatedConfig,
          updatedBy: currentUserRef,
          updatedAt: new Date().toISOString(),
        });

        // Track Discord command registration
        const isUpdate = !!existingCommand;
        trackBusinessEvent(
          "discord_command",
          "registered",
          {
            workspace_id: workspaceId,
            integration_id: integrationId,
            agent_id: updated.agentId,
            command_name: commandName,
            is_update: isUpdate,
          },
          req
        );

        res.json({
          id: integrationId,
          platform: updated.platform,
          name: updated.name,
          agentId: updated.agentId,
          webhookUrl: updated.webhookUrl,
          status: updated.status,
          lastUsedAt: updated.lastUsedAt || null,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
          discordCommand: {
            commandName: commandName,
            commandId: createdCommand.id,
          },
        });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/integrations/:integrationId/discord-command"
        );
      }
    }
  );
};

