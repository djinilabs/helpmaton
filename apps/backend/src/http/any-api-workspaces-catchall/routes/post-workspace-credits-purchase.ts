/**
 * POST /api/workspaces/:workspaceId/credits/purchase
 * Create Lemon Squeezy checkout for credit purchase
 */

import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { createCheckout } from "../../../utils/lemonSqueezy";
import { asyncHandler, requireAuth, requirePermission } from "../middleware";

export function registerPostWorkspaceCreditsPurchase(
  app: express.Application
): void {
  app.post(
    "/api/workspaces/:workspaceId/credits/purchase",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    asyncHandler(async (req, res) => {
      const workspaceId = req.params.workspaceId;

      // Validate request body
      const { amount } = req.body;
      if (typeof amount !== "number" || amount <= 0) {
        throw badRequest("Amount must be a positive number");
      }

      // Minimum amount validation (1 EUR)
      if (amount < 1) {
        throw badRequest("Minimum purchase amount is 1 EUR");
      }

      // Validate amount has at most 2 decimal places
      if (Math.round(amount * 100) !== amount * 100) {
        throw badRequest("Amount must have at most 2 decimal places");
      }

      // Workspace access is already checked by requirePermission middleware
      const workspacePk = `workspaces/${workspaceId}`;

      // Get workspace to check currency
      const db = await database();
      const workspace = await db.workspace.get(workspacePk, "workspace");
      if (!workspace) {
        throw badRequest("Workspace not found");
      }

      // Get credit product ID
      const creditProductId = process.env.LEMON_SQUEEZY_CREDIT_PRODUCT_ID;
      if (!creditProductId) {
        throw new Error("LEMON_SQUEEZY_CREDIT_PRODUCT_ID is not configured");
      }

      // Get store ID
      const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
      if (!storeId) {
        throw new Error("LEMON_SQUEEZY_STORE_ID is not configured");
      }

      // Create checkout with custom price
      const checkout = await createCheckout({
        store_id: storeId,
        product_id: creditProductId,
        custom_price: amount * 100, // Convert to cents
        checkout_data: {
          custom: {
            workspaceId,
          },
        },
        product_options: {
          name: "Workspace Credits",
          description: `Add ${amount} EUR in credits to your workspace`,
        },
        checkout_options: {
          embed: false,
          media: false,
        },
      });

      res.json({
        checkoutUrl: checkout.url,
      });
    })
  );
}
