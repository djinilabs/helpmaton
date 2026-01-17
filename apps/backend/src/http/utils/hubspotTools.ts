import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as hubspotClient from "../../utils/hubspot/client";

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

const listSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Number of results to return (default: 100, max: 100)"),
  after: z
    .string()
    .optional()
    .describe("Pagination cursor for the next page"),
  properties: z
    .array(z.string())
    .optional()
    .describe("Optional list of properties to include"),
  archived: z
    .boolean()
    .optional()
    .describe("Whether to return archived records"),
});

const searchSchema = z.object({
  query: z.string().min(1).describe("Search query text"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Number of results to return (default: 100, max: 100)"),
  after: z
    .string()
    .optional()
    .describe("Pagination cursor for the next page"),
  properties: z
    .array(z.string())
    .optional()
    .describe("Optional list of properties to include"),
  archived: z
    .boolean()
    .optional()
    .describe("Whether to return archived records"),
});

export function createHubspotListContactsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List HubSpot contacts with optional pagination and selected properties.",
    parameters: listSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: HubSpot is not connected. Please connect your HubSpot account first.";
        }

        const result = await hubspotClient.listContacts(workspaceId, serverId, {
          limit: args.limit,
          after: args.after,
          properties: args.properties,
          archived: args.archived,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in HubSpot list contacts tool:", error);
        return `Error listing HubSpot contacts: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createHubspotGetContactTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Get a HubSpot contact by ID.",
    parameters: z.object({
      contactId: z.string().optional().describe("Contact ID to retrieve"),
      id: z.string().optional().describe("Alias for contactId"),
      contact_id: z.string().optional().describe("Alias for contactId"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Optional list of properties to include"),
      archived: z
        .boolean()
        .optional()
        .describe("Whether to return archived records"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: HubSpot is not connected. Please connect your HubSpot account first.";
        }

        const contactId = args.contactId || args.id || args.contact_id;
        if (!contactId || typeof contactId !== "string") {
          return "Error: contactId parameter is required. Please provide the HubSpot contact ID as 'contactId'.";
        }

        const result = await hubspotClient.getContact(
          workspaceId,
          serverId,
          contactId,
          {
            properties: args.properties,
            archived: args.archived,
          }
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in HubSpot get contact tool:", error);
        return `Error getting HubSpot contact: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createHubspotSearchContactsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Search HubSpot contacts by query text.",
    parameters: searchSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: HubSpot is not connected. Please connect your HubSpot account first.";
        }

        const result = await hubspotClient.searchContacts(workspaceId, serverId, {
          query: args.query,
          limit: args.limit,
          after: args.after,
          properties: args.properties,
          archived: args.archived,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in HubSpot search contacts tool:", error);
        return `Error searching HubSpot contacts: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createHubspotListCompaniesTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List HubSpot companies with optional pagination and selected properties.",
    parameters: listSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: HubSpot is not connected. Please connect your HubSpot account first.";
        }

        const result = await hubspotClient.listCompanies(workspaceId, serverId, {
          limit: args.limit,
          after: args.after,
          properties: args.properties,
          archived: args.archived,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in HubSpot list companies tool:", error);
        return `Error listing HubSpot companies: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createHubspotGetCompanyTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Get a HubSpot company by ID.",
    parameters: z.object({
      companyId: z.string().optional().describe("Company ID to retrieve"),
      id: z.string().optional().describe("Alias for companyId"),
      company_id: z.string().optional().describe("Alias for companyId"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Optional list of properties to include"),
      archived: z
        .boolean()
        .optional()
        .describe("Whether to return archived records"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: HubSpot is not connected. Please connect your HubSpot account first.";
        }

        const companyId = args.companyId || args.id || args.company_id;
        if (!companyId || typeof companyId !== "string") {
          return "Error: companyId parameter is required. Please provide the HubSpot company ID as 'companyId'.";
        }

        const result = await hubspotClient.getCompany(
          workspaceId,
          serverId,
          companyId,
          {
            properties: args.properties,
            archived: args.archived,
          }
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in HubSpot get company tool:", error);
        return `Error getting HubSpot company: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createHubspotSearchCompaniesTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Search HubSpot companies by query text.",
    parameters: searchSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: HubSpot is not connected. Please connect your HubSpot account first.";
        }

        const result = await hubspotClient.searchCompanies(
          workspaceId,
          serverId,
          {
            query: args.query,
            limit: args.limit,
            after: args.after,
            properties: args.properties,
            archived: args.archived,
          }
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in HubSpot search companies tool:", error);
        return `Error searching HubSpot companies: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createHubspotListDealsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List HubSpot deals with optional pagination and selected properties.",
    parameters: listSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: HubSpot is not connected. Please connect your HubSpot account first.";
        }

        const result = await hubspotClient.listDeals(workspaceId, serverId, {
          limit: args.limit,
          after: args.after,
          properties: args.properties,
          archived: args.archived,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in HubSpot list deals tool:", error);
        return `Error listing HubSpot deals: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createHubspotGetDealTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Get a HubSpot deal by ID.",
    parameters: z.object({
      dealId: z.string().optional().describe("Deal ID to retrieve"),
      id: z.string().optional().describe("Alias for dealId"),
      deal_id: z.string().optional().describe("Alias for dealId"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Optional list of properties to include"),
      archived: z
        .boolean()
        .optional()
        .describe("Whether to return archived records"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: HubSpot is not connected. Please connect your HubSpot account first.";
        }

        const dealId = args.dealId || args.id || args.deal_id;
        if (!dealId || typeof dealId !== "string") {
          return "Error: dealId parameter is required. Please provide the HubSpot deal ID as 'dealId'.";
        }

        const result = await hubspotClient.getDeal(
          workspaceId,
          serverId,
          dealId,
          {
            properties: args.properties,
            archived: args.archived,
          }
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in HubSpot get deal tool:", error);
        return `Error getting HubSpot deal: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createHubspotSearchDealsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Search HubSpot deals by query text.",
    parameters: searchSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: HubSpot is not connected. Please connect your HubSpot account first.";
        }

        const result = await hubspotClient.searchDeals(workspaceId, serverId, {
          query: args.query,
          limit: args.limit,
          after: args.after,
          properties: args.properties,
          archived: args.archived,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in HubSpot search deals tool:", error);
        return `Error searching HubSpot deals: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createHubspotListOwnersTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "List HubSpot owners with optional pagination.",
    parameters: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results to return (default: 100, max: 100)"),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor for the next page"),
      email: z
        .string()
        .optional()
        .describe("Optional email to filter owners"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: HubSpot is not connected. Please connect your HubSpot account first.";
        }

        const result = await hubspotClient.listOwners(workspaceId, serverId, {
          limit: args.limit,
          after: args.after,
          email: args.email,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in HubSpot list owners tool:", error);
        return `Error listing HubSpot owners: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createHubspotGetOwnerTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Get a HubSpot owner by ID.",
    parameters: z.object({
      ownerId: z.string().optional().describe("Owner ID to retrieve"),
      id: z.string().optional().describe("Alias for ownerId"),
      owner_id: z.string().optional().describe("Alias for ownerId"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: HubSpot is not connected. Please connect your HubSpot account first.";
        }

        const ownerId = args.ownerId || args.id || args.owner_id;
        if (!ownerId || typeof ownerId !== "string") {
          return "Error: ownerId parameter is required. Please provide the HubSpot owner ID as 'ownerId'.";
        }

        const result = await hubspotClient.getOwner(
          workspaceId,
          serverId,
          ownerId
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in HubSpot get owner tool:", error);
        return `Error getting HubSpot owner: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createHubspotSearchOwnersTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Search HubSpot owners by email.",
    parameters: z.object({
      email: z.string().min(1).describe("Owner email to search for"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results to return (default: 100, max: 100)"),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor for the next page"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: HubSpot is not connected. Please connect your HubSpot account first.";
        }

        const result = await hubspotClient.listOwners(workspaceId, serverId, {
          email: args.email,
          limit: args.limit,
          after: args.after,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in HubSpot search owners tool:", error);
        return `Error searching HubSpot owners: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
