import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as stripeClient from "../../utils/stripe/client";

import { validateToolArgs } from "./toolValidation";

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

  const config = server.config as { accessToken?: string };
  return !!config.accessToken;
}

function parseDateInput(value: string | number): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.floor(parsed / 1000);
}

export function createStripeSearchChargesTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
    query: z
      .string()
      .optional()
      .describe(
        "Optional Stripe search query string (e.g., \"email:'bob@example.com' AND status:'succeeded'\")"
      ),
    email: z
      .string()
      .email()
      .optional()
      .describe("Optional email address to search charges by"),
    })
    .strict();

  return tool({
    description:
      "Search Stripe charges using the Stripe search query language. Provide a query string and/or an email address.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Stripe is not connected. Please connect your Stripe account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const query = typeof parsed.data.query === "string" ? parsed.data.query.trim() : "";
        const email = typeof parsed.data.email === "string" ? parsed.data.email.trim() : "";

        if (!query && !email) {
          return "Error: Provide a Stripe search query or an email address.";
        }

        const finalQuery = email
          ? query
            ? `(${query}) AND email:'${email}'`
            : `email:'${email}'`
          : query;

        const result = await stripeClient.searchCharges(
          workspaceId,
          serverId,
          finalQuery
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Stripe search charges tool:", error);
        return `Error searching Stripe charges: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createStripeGetMetricsTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z
    .object({
    startDate: z
      .union([z.string(), z.number()])
      .describe("Start date (ISO 8601 or Unix timestamp in seconds)"),
    endDate: z
      .union([z.string(), z.number()])
      .describe("End date (ISO 8601 or Unix timestamp in seconds)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum number of refunds to return (default: 20, max: 100)"),
    })
    .strict();

  return tool({
    description:
      "Retrieve Stripe balance and refunds within a required date range. Returns balance plus recent refunds.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Stripe is not connected. Please connect your Stripe account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const start = parseDateInput(parsed.data.startDate);
        const end = parseDateInput(parsed.data.endDate);
        if (start === null || end === null) {
          return "Error: startDate and endDate must be valid ISO dates or Unix timestamps.";
        }
        if (start > end) {
          return "Error: startDate must be before endDate.";
        }

        const [balance, refunds] = await Promise.all([
          stripeClient.getBalance(workspaceId, serverId),
          stripeClient.listRefunds(workspaceId, serverId, {
            createdGte: start,
            createdLte: end,
            limit: parsed.data.limit,
          }),
        ]);

        return JSON.stringify({ balance, refunds }, null, 2);
      } catch (error) {
        console.error("Error in Stripe get metrics tool:", error);
        return `Error retrieving Stripe metrics: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
