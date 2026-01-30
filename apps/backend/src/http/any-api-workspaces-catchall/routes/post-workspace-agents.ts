import { randomUUID } from "crypto";

import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { getRandomAvatar, isValidAvatar } from "../../../utils/avatarUtils";
import { normalizeSummarizationPrompts } from "../../../utils/memory/summarizeMemory";
import { isImageCapableModel } from "../../../utils/pricing";
import {
  checkSubscriptionLimits,
  ensureWorkspaceSubscription,
} from "../../../utils/subscriptionUtils";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { createAgentSchema } from "../../utils/schemas/workspaceSchemas";
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
 *               avatar:
 *                 type: string
 *                 nullable: true
 *                 description: Avatar image path (e.g., "/images/helpmaton_logo_10.svg"). If not provided, a random avatar will be assigned.
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
 *                 avatar:
 *                   type: string
 *                   nullable: true
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
        const body = validateBody(req.body, createAgentSchema);
        const {
          name,
          systemPrompt,
          notificationChannelId,
          modelName,
          clientTools,
          enableImageGeneration,
          imageGenerationModel,
          avatar,
          summarizationPrompts,
          memoryExtractionEnabled,
          memoryExtractionModel,
          memoryExtractionPrompt,
        } = body;
        const normalizedSummarizationPrompts =
          normalizeSummarizationPrompts(summarizationPrompts);

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
          userId,
        );
        await checkSubscriptionLimits(subscriptionId, "agent", 1);

        const agentId = randomUUID();
        const agentPk = `agents/${workspaceId}/${agentId}`;
        const agentSk = "agent";

        // Validate notificationChannelId if provided (Zod already validated the type)
        if (
          notificationChannelId !== undefined &&
          notificationChannelId !== null
        ) {
          // Verify channel exists and belongs to workspace
          const channelPk = `output-channels/${workspaceId}/${notificationChannelId}`;
          const channel = await db["output_channel"].get(channelPk, "channel");
          if (!channel) {
            throw badRequest("Notification channel not found");
          }
          if (channel.workspaceId !== workspaceId) {
            throw badRequest(
              "Notification channel does not belong to this workspace",
            );
          }
        }

        // Validate modelName if provided (Zod already validated the type)
        if (modelName !== undefined && modelName !== null) {
          // Validate model exists in pricing config
          // System always uses "openrouter" provider (see agentSetup.ts), regardless of agent.provider field
          const { getModelPricing } = await import("../../../utils/pricing");
          const pricing = getModelPricing("openrouter", modelName.trim());
          if (!pricing) {
            throw badRequest(
              `Model "${modelName.trim()}" is not available. Please check available models at /api/models`,
            );
          }
        }

        const trimmedMemoryExtractionModel =
          typeof memoryExtractionModel === "string"
            ? memoryExtractionModel.trim()
            : undefined;
        if (
          memoryExtractionModel !== undefined &&
          memoryExtractionModel !== null
        ) {
          if (!trimmedMemoryExtractionModel) {
            throw badRequest(
              "memoryExtractionModel must be a non-empty string or null",
            );
          }
          const { getModelPricing } = await import("../../../utils/pricing");
          const pricing = getModelPricing(
            "openrouter",
            trimmedMemoryExtractionModel,
          );
          if (!pricing) {
            throw badRequest(
              `Model "${trimmedMemoryExtractionModel}" is not available. Please check available models at /api/models`,
            );
          }
        }

        if (enableImageGeneration === true && !imageGenerationModel) {
          throw badRequest(
            "imageGenerationModel is required when enableImageGeneration is true",
          );
        }
        if (imageGenerationModel) {
          const resolvedImageModel = imageGenerationModel.trim();
          if (!isImageCapableModel("openrouter", resolvedImageModel)) {
            throw badRequest(
              `Image generation model "${resolvedImageModel}" is not image-capable. Please select a model that supports image output.`,
            );
          }
        }

        // Validate avatar if provided, otherwise assign random (Zod already validated the type)
        let avatarPath: string | undefined;
        if (avatar !== undefined && avatar !== null) {
          if (!isValidAvatar(avatar)) {
            throw badRequest(
              `Invalid avatar path. Avatar must be one of the available logo paths.`,
            );
          }
          avatarPath = avatar;
        } else {
          // Assign random avatar if not provided
          avatarPath = getRandomAvatar();
        }

        // Create agent entity
        const agent = await db.agent.create({
          pk: agentPk,
          sk: agentSk,
          workspaceId,
          name,
          systemPrompt,
          summarizationPrompts: normalizedSummarizationPrompts,
          provider: "openrouter", // Always use openrouter (only supported provider)
          notificationChannelId:
            notificationChannelId !== undefined &&
            notificationChannelId !== null
              ? notificationChannelId
              : undefined,
          modelName:
            typeof modelName === "string" && modelName.trim()
              ? modelName.trim()
              : undefined,
          clientTools: clientTools || undefined,
          memoryExtractionEnabled:
            memoryExtractionEnabled !== undefined
              ? memoryExtractionEnabled
              : undefined,
          memoryExtractionModel: trimmedMemoryExtractionModel || undefined,
          memoryExtractionPrompt:
            typeof memoryExtractionPrompt === "string" &&
            memoryExtractionPrompt.trim().length > 0
              ? memoryExtractionPrompt.trim()
              : undefined,
          enableImageGeneration:
            enableImageGeneration !== undefined
              ? enableImageGeneration
              : undefined,
          imageGenerationModel:
            typeof imageGenerationModel === "string" &&
            imageGenerationModel.trim()
              ? imageGenerationModel.trim()
              : undefined,
          avatar: avatarPath,
          createdBy: currentUserRef,
        });

        // Track agent creation
        trackBusinessEvent(
          "agent",
          "created",
          {
            workspace_id: workspaceId,
            agent_id: agentId,
            provider: agent.provider,
            model_name: agent.modelName || undefined,
          },
          req,
        );

        res.status(201).json({
          id: agentId,
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          summarizationPrompts: agent.summarizationPrompts,
          memoryExtractionEnabled: agent.memoryExtractionEnabled ?? false,
          memoryExtractionModel: agent.memoryExtractionModel ?? null,
          memoryExtractionPrompt: agent.memoryExtractionPrompt ?? null,
          provider: agent.provider,
          modelName: agent.modelName ?? null,
          delegatableAgentIds: agent.delegatableAgentIds ?? [],
          enabledMcpServerIds: agent.enabledMcpServerIds ?? [],
          enabledMcpServerToolNames: agent.enabledMcpServerToolNames ?? undefined,
          enableMemorySearch: agent.enableMemorySearch ?? false,
          enableImageGeneration: agent.enableImageGeneration ?? false,
          imageGenerationModel: agent.imageGenerationModel ?? null,
          clientTools: agent.clientTools ?? [],
          spendingLimits: agent.spendingLimits ?? [],
          avatar: agent.avatar ?? null,
          createdAt: agent.createdAt,
        });
      } catch (error) {
        handleError(error, next, "POST /api/workspaces/:workspaceId/agents");
      }
    },
  );
};
