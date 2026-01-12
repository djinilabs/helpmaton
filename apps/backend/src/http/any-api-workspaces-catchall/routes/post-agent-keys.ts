import { randomUUID } from "crypto";

import { badRequest, resourceGone, unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import {
  checkSubscriptionLimits,
  ensureWorkspaceSubscription,
} from "../../../utils/subscriptionUtils";
import { validateBody } from "../../utils/bodyValidation";
import { createAgentKeySchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}/keys:
 *   post:
 *     summary: Create agent key
 *     description: Creates a new API key for an agent. The key value is only returned once upon creation.
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
 *       - name: agentId
 *         in: path
 *         required: true
 *         description: Agent ID
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
 *                 description: Optional name for the key
     *               provider:
     *                 type: string
     *                 description: Provider for the key
     *                 default: google
     *               type:
     *                 type: string
     *                 enum: [webhook, widget]
     *                 description: Key type - 'webhook' for webhook authentication, 'widget' for widget authentication
     *                 default: webhook
 *     responses:
 *       201:
 *         description: Agent key created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 key:
 *                   type: string
 *                   description: The API key value (only shown once)
 *                 name:
 *                   type: string
 *                   nullable: true
     *                 provider:
     *                   type: string
     *                 type:
     *                   type: string
     *                   enum: [webhook, widget]
     *                   description: Key type
     *                 createdAt:
     *                   type: string
     *                   format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Agent not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostAgentKeys = (app: express.Application) => {
  app.post(
    "/api/workspaces/:workspaceId/agents/:agentId/keys",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        // Verify agent exists
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        const body = validateBody(req.body || {}, createAgentKeySchema);
        const { name, provider, type } = body;
        const currentUserRef = req.userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }

        // Ensure workspace has a subscription and check agent key limit
        const userId = currentUserRef.replace("users/", "");
        const subscriptionId = await ensureWorkspaceSubscription(
          workspaceId,
          userId
        );
        await checkSubscriptionLimits(subscriptionId, "agentKey", 1);

        // Generate keyId and key value
        const keyId = randomUUID();
        const keyValue = randomUUID(); // Use UUID as key value
        const agentKeyPk = `agent-keys/${workspaceId}/${agentId}/${keyId}`;
        const agentKeySk = "key";

        // Create agent key
        const agentKey = await db["agent-key"].create({
          pk: agentKeyPk,
          sk: agentKeySk,
          workspaceId,
          agentId,
          key: keyValue,
          name: name || undefined,
          provider: provider || "google",
          type: type || "webhook", // Default to webhook for backward compatibility
          createdBy: currentUserRef,
        });

        res.status(201).json({
          id: keyId,
          key: keyValue,
          name: agentKey.name,
          provider: agentKey.provider,
          type: agentKey.type || "webhook",
          createdAt: agentKey.createdAt,
        });
      } catch (error) {
        handleError(
          error,
          next,
          "POST /api/workspaces/:workspaceId/agents/:agentId/keys"
        );
      }
    }
  );
};
