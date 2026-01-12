import { badRequest, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { validateBody } from "../../utils/bodyValidation";
import { updateWorkspaceSchema } from "../../utils/schemas/workspaceSchemas";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}:
 *   put:
 *     summary: Update workspace
 *     description: Updates workspace name and description. Requires WRITE permission or higher. Trial-related fields cannot be modified through this endpoint.
 *     tags:
 *       - Workspaces
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
 *             $ref: '#/components/schemas/UpdateWorkspaceRequest'
 *     responses:
 *       200:
 *         description: Workspace updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Workspace'
 *                 - type: object
 *                   properties:
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Workspace not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPutWorkspace = (app: express.Application) => {
  app.put(
    "/api/workspaces/:workspaceId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const body = validateBody(req.body, updateWorkspaceSchema);
        const { name, description } = body;
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }

        const workspace = await db.workspace.get(
          workspaceResource,
          "workspace"
        );
        if (!workspace) {
          throw resourceGone("Workspace not found");
        }


        // Protect trial-related fields - remove them from request body if present
        // These fields are intentionally excluded to prevent modification
        if (
          "trialCreditRequested" in req.body ||
          "trialCreditRequestedAt" in req.body ||
          "trialCreditApproved" in req.body ||
          "trialCreditApprovedAt" in req.body ||
          "trialCreditAmount" in req.body
        ) {
          throw badRequest(
            "Trial-related fields cannot be modified through this endpoint"
          );
        }

        // Update workspace - explicitly set currency to ensure it's not lost
        const updatePayload = {
          pk: workspaceResource,
          sk: "workspace" as const,
          name: name !== undefined ? name : workspace.name,
          description:
            description !== undefined ? description : workspace.description,
          currency: "usd" as const, // Always use USD
          updatedBy: req.userRef || "",
          updatedAt: new Date().toISOString(),
        };

        console.log(
          "[PUT /api/workspaces/:workspaceId] Update payload:",
          updatePayload
        );

        const updated = await db.workspace.update(updatePayload);

        console.log(
          "[PUT /api/workspaces/:workspaceId] Updated workspace"
        );

        res.json({
          id: updated.pk.replace("workspaces/", ""),
          name: updated.name,
          description: updated.description,
          creditBalance: updated.creditBalance ?? 0,
          currency: "usd",
          spendingLimits: updated.spendingLimits ?? [],
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        });
      } catch (error) {
        handleError(error, next, "PUT /api/workspaces/:workspaceId");
      }
    }
  );
};
