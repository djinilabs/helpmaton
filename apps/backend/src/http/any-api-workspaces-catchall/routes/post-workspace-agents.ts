import { randomUUID } from "crypto";

import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  checkSubscriptionLimits,
  ensureWorkspaceSubscription,
} from "../../../utils/subscriptionUtils";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents:
 *   post:
 *     summary: Create a new agent
 *     description: Creates a new AI agent in the workspace
 *     tags:
 *       - Agents
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
 *               - systemPrompt
 *             properties:
 *               name:
 *                 type: string
 *                 description: Agent name
 *               systemPrompt:
 *                 type: string
 *                 description: System prompt for the agent
 *               modelName:
 *                 type: string
 *                 nullable: true
 *                 description: Model name (must be available in pricing config)
 *               clientTools:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/ClientTool'
 *                 description: Client-side tools
 *     responses:
 *       201:
 *         description: Agent created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 systemPrompt:
 *                   type: string
 *                 provider:
 *                   type: string
 *                 modelName:
 *                   type: string
 *                   nullable: true
 *                 clientTools:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ClientTool'
 *                 createdAt:
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
export const registerPostWorkspaceAgents = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/agents",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const { name, systemPrompt, modelName, clientTools } = req.body;
        if (!name || typeof name !== "string") {
          throw badRequest("name is required and must be a string");
        }
        if (!systemPrompt || typeof systemPrompt !== "string") {
          throw badRequest("systemPrompt is required and must be a string");
        }

        // Validate clientTools if provided
        if (clientTools !== undefined) {
          if (!Array.isArray(clientTools)) {
            throw badRequest("clientTools must be an array");
          }
          for (const tool of clientTools) {
            if (
              !tool ||
              typeof tool !== "object" ||
              typeof tool.name !== "string" ||
              typeof tool.description !== "string" ||
              !tool.parameters ||
              typeof tool.parameters !== "object"
            ) {
              throw badRequest(
                "Each client tool must have name, description (both strings) and parameters (object)"
              );
            }
            // Validate name is a valid JavaScript identifier
            if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(tool.name)) {
              throw badRequest(
                `Tool name "${tool.name}" must be a valid JavaScript identifier (letters, numbers, underscore, $; no spaces or special characters)`
              );
            }
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

        // Ensure workspace has a subscription and check agent limit
        const userId = currentUserRef.replace("users/", "");
        const subscriptionId = await ensureWorkspaceSubscription(
          workspaceId,
          userId
        );
        await checkSubscriptionLimits(subscriptionId, "agent", 1);

        const agentId = randomUUID();
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agentSk = "agent";

        // Validate modelName if provided
        if (modelName !== undefined && modelName !== null) {
          if (typeof modelName !== "string" || modelName.trim().length === 0) {
            throw badRequest("modelName must be a non-empty string or null");
          }
          // Validate model exists in pricing config
          const { getModelPricing } = await import("../../../utils/pricing");
          const pricing = getModelPricing("google", modelName.trim());
          if (!pricing) {
            throw badRequest(
              `Model "${modelName.trim()}" is not available. Please check available models at /api/models`
            );
          }
        }

        // Create agent entity
        const agent = await db.agent.create({
          pk: agentPk,
          sk: agentSk,
          workspaceId,
          name,
          systemPrompt,
          provider: "google", // Default to Google provider
          modelName:
            typeof modelName === "string" && modelName.trim()
              ? modelName.trim()
              : undefined,
          clientTools: clientTools || undefined,
          createdBy: currentUserRef,
        });

        res.status(201).json({
          id: agentId,
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          provider: agent.provider,
          modelName: agent.modelName ?? null,
          delegatableAgentIds: agent.delegatableAgentIds ?? [],
          enabledMcpServerIds: agent.enabledMcpServerIds ?? [],
          enableMemorySearch: agent.enableMemorySearch ?? false,
          clientTools: agent.clientTools ?? [],
          spendingLimits: agent.spendingLimits ?? [],
          createdAt: agent.createdAt,
        });
      } catch (error) {
        handleError(error, next, "POST /api/workspaces/:workspaceId/agents");
      }
    }
  );
};
