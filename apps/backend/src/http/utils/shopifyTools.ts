import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import {
  getOrderByNumber,
  searchProductsByTitle,
  getSalesReport,
} from "../../utils/shopify/client";

async function hasOAuthConnection(
  workspaceId: string,
  serverId: string
): Promise<boolean> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server || server.authType !== "oauth") {
    return false;
  }

  const config = server.config as { accessToken?: string; shopDomain?: string };
  return !!config.accessToken && !!config.shopDomain;
}

function parseDateInput(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export function createShopifyGetOrderTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Finds an order by ID or order number (e.g., #1001) to check status and tracking.",
    parameters: z.object({
      orderNumber: z
        .union([z.string(), z.number().int()])
        .describe("Order number or ID (e.g., #1001)"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Shopify is not connected. Please connect your Shopify account first.";
        }
        const { orderNumber } = args as { orderNumber: string | number };
        const result = await getOrderByNumber(
          workspaceId,
          serverId,
          String(orderNumber)
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Shopify get order tool:", error);
        return `Error fetching Shopify order: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createShopifySearchProductsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Searches for products by title to check inventory levels and pricing.",
    parameters: z.object({
      query: z
        .string()
        .min(1)
        .describe("Product title or keyword to search for"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Shopify is not connected. Please connect your Shopify account first.";
        }
        const { query } = args as { query: string };
        const result = await searchProductsByTitle(
          workspaceId,
          serverId,
          query
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Shopify search products tool:", error);
        return `Error searching Shopify products: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createShopifySalesReportTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Retrieves order counts and gross sales for a specific date range.",
    parameters: z.object({
      startDate: z
        .string()
        .min(1)
        .describe("Start date (ISO 8601)"),
      endDate: z.string().min(1).describe("End date (ISO 8601)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(250)
        .optional()
        .describe("Maximum number of orders to sum (default: 250)"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Shopify is not connected. Please connect your Shopify account first.";
        }
        const { startDate, endDate, limit } = args as {
          startDate: string;
          endDate: string;
          limit?: number;
        };

        const parsedStart = parseDateInput(startDate);
        const parsedEnd = parseDateInput(endDate);
        if (!parsedStart || !parsedEnd) {
          return "Error: startDate and endDate must be valid ISO 8601 dates.";
        }

        if (parsedStart > parsedEnd) {
          return "Error: startDate must be before endDate.";
        }

        const result = await getSalesReport(workspaceId, serverId, {
          startDate: parsedStart,
          endDate: parsedEnd,
          limit,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Shopify sales report tool:", error);
        return `Error retrieving Shopify sales report: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
