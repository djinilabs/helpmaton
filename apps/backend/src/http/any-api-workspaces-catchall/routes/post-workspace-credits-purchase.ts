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

      // Get credit variant ID
      // Note: Even with custom prices, we need a variant ID
      // The variant should be from a "Credits" product with a default price
      // The custom_price will override the variant's price
      const creditVariantId = process.env.LEMON_SQUEEZY_CREDIT_VARIANT_ID;
      if (!creditVariantId) {
        throw new Error("LEMON_SQUEEZY_CREDIT_VARIANT_ID is not configured");
      }

      // Get store ID
      const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
      if (!storeId) {
        throw new Error("LEMON_SQUEEZY_STORE_ID is not configured");
      }

      // Create checkout with custom price
      // We use the credit variant ID and override the price with custom_price
      const checkout = await createCheckout({
        storeId,
        variantId: creditVariantId,
        customPrice: amount * 100, // Convert to cents
        checkoutData: {
          custom: {
            workspaceId,
          },
        },
        productOptions: {
          name: "Workspace Credits",
          description: `Add ${amount} EUR in credits to your workspace`,
        },
        checkoutOptions: {
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

