import { randomUUID } from "crypto";

import { unauthorized } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { ensureAuthorization } from "../../../tables/permissions";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { toNanoDollars } from "../../../utils/creditConversions";
import {
  checkWorkspaceLimitAndGetCurrentCount,
  getUserSubscription,
} from "../../../utils/subscriptionUtils";
import { trackBusinessEvent } from "../../../utils/tracking";
import { validateBody } from "../../utils/bodyValidation";
import { createWorkspaceSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth } from "../middleware";

/** Credits in USD granted to free-plan users when creating their first workspace. */
const FREE_PLAN_FIRST_WORKSPACE_CREDITS_USD = 2;

/**
 * @openapi
 * /api/workspaces:
 *   post:
 *     summary: Create a new workspace
 *     description: Creates a new workspace for the authenticated user
 *     tags:
 *       - Workspaces
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateWorkspaceRequest'
 *     responses:
 *       201:
 *         description: Workspace created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WorkspaceResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPostWorkspaces = (app: express.Application) => {
  app.post("/api/workspaces", requireAuth, async (req, res, next) => {
    try {
      const body = validateBody(req.body, createWorkspaceSchema);
      const { name, description } = body;

      const db = await database();
      const userRef = req.userRef;
      if (!userRef) {
        throw unauthorized();
      }

      // Get or create user subscription (auto-migration)
      const userId = userRef.replace("users/", "");
      const subscription = await getUserSubscription(userId);
      const subscriptionId = subscription.pk.replace("subscriptions/", "");

      // Check workspace limit and get current count in one query (avoids duplicate fetch)
      const currentWorkspaceCount = await checkWorkspaceLimitAndGetCurrentCount(
        subscriptionId,
        1
      );
      const isFirstWorkspace = currentWorkspaceCount === 0;
      const initialCredits =
        subscription.plan === "free" && isFirstWorkspace
          ? toNanoDollars(FREE_PLAN_FIRST_WORKSPACE_CREDITS_USD)
          : 0;

      const workspaceId = randomUUID();
      const workspacePk = `workspaces/${workspaceId}`;
      const workspaceSk = "workspace"; // Sort key required by DynamoDB table

      // Create workspace entity
      const workspace = await db.workspace.create({
        pk: workspacePk,
        sk: workspaceSk,
        name,
        description: description || undefined,
        createdBy: userRef,
        subscriptionId,
        currency: "usd",
        creditBalance: initialCredits,
      });

      // Grant creator OWNER permission
      await ensureAuthorization(
        workspacePk,
        userRef,
        PERMISSION_LEVELS.OWNER,
        userRef
      );

      // Track workspace creation
      trackBusinessEvent(
        "workspace",
        "created",
        {
          workspace_id: workspaceId,
        },
        req
      );

      res.status(201).json({
        id: workspaceId,
        name: workspace.name,
        description: workspace.description,
        permissionLevel: PERMISSION_LEVELS.OWNER,
        creditBalance: workspace.creditBalance ?? 0,
        currency: workspace.currency ?? "usd",
        spendingLimits: workspace.spendingLimits ?? [],
        createdAt: workspace.createdAt,
      });
    } catch (error) {
      handleError(error, next, "POST /api/workspaces");
    }
  });
};
