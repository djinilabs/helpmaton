/**
 * POST /api/workspaces/:workspaceId/credits/purchase
 * Create Lemon Squeezy checkout for credit purchase
 */

import { badRequest } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { createCheckout, getVariant } from "../../../utils/lemonSqueezy";
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
      // Use regex to avoid floating-point precision issues
      if (!/^\d+(\.\d{1,2})?$/.test(String(amount))) {
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

      // Check variant configuration
      // For PWYW variants, custom_price sets the price that will be charged,
      // but the UI may still show an input field that needs to be filled
      try {
        const variant = await getVariant(creditVariantId);
        console.log(
          `[POST /api/workspaces/:workspaceId/credits/purchase] Variant configuration:`,
          {
            variantId: creditVariantId,
            variantName: variant.attributes.name,
            isPWYW: variant.attributes.pay_what_you_want,
            defaultPrice: variant.attributes.price,
            minPrice: variant.attributes.min_price,
            maxPrice: variant.attributes.max_price,
          }
        );
      } catch (error) {
        console.warn(
          `[POST /api/workspaces/:workspaceId/credits/purchase] Could not fetch variant details:`,
          error instanceof Error ? error.message : String(error)
        );
        // Continue anyway - variant might still work
      }

      // Get store ID
      const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
      if (!storeId) {
        throw new Error("LEMON_SQUEEZY_STORE_ID is not configured");
      }

      // Get base URL for redirect after successful purchase
      const baseUrl =
        process.env.BASE_URL ||
        process.env.FRONTEND_URL ||
        "https://app.helpmaton.com";
      const redirectUrl = `${baseUrl}/workspaces/${workspaceId}?credits_purchased=true`;

      // Create checkout with custom price
      // We use the credit variant ID and override the price with custom_price
      // custom_price must be a positive integer in cents
      const customPriceInCents = Math.round(amount * 100);

      console.log(
        "[POST /api/workspaces/:workspaceId/credits/purchase] Creating checkout:",
        {
          workspaceId,
          amount,
          currency: workspace.currency,
          customPriceInCents,
          variantId: creditVariantId,
          storeId,
        }
      );

      const checkout = await createCheckout({
        storeId,
        variantId: creditVariantId,
        customPrice: customPriceInCents, // Convert to cents (must be integer)
        checkoutData: {
          custom: {
            workspaceId,
          },
        },
        productOptions: {
          name: "Workspace Credits",
          description: `Please enter ${amount} ${workspace.currency.toUpperCase()} in the amount field below. This will add ${amount} ${workspace.currency.toUpperCase()} in credits to your workspace.`,
          enabled_variants: [parseInt(creditVariantId, 10)], // Only show this variant to ensure custom_price is used
          redirect_url: redirectUrl, // Redirect back to workspace after successful purchase
        },
        checkoutOptions: {
          embed: false,
          media: false,
        },
      });

      console.log(
        "[POST /api/workspaces/:workspaceId/credits/purchase] Checkout created:",
        {
          checkoutId: checkout.url,
          customPriceInCents,
        }
      );

      res.json({
        checkoutUrl: checkout.url,
      });
    })
  );
}






