import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as salesforceClient from "../../utils/salesforce/client";

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

  const config = server.config as { accessToken?: string; instanceUrl?: string };
  return !!config.accessToken && !!config.instanceUrl;
}

export function createSalesforceListObjectsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Lists standard and custom objects in the org to understand available data.",
    parameters: z.object({}),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async () => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Salesforce is not connected. Please connect your Salesforce account first.";
        }

        const result = await salesforceClient.listObjects(workspaceId, serverId);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Salesforce list objects tool:", error);
        return `Error listing Salesforce objects: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createSalesforceDescribeObjectTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Returns the fields and relationships for a specific object (e.g., 'Opportunity'). Use this to find the correct field names before querying.",
    parameters: z.object({
      objectName: z
        .string()
        .min(1)
        .optional()
        .describe("Salesforce object name (e.g., Account, Opportunity)"),
      object_name: z
        .string()
        .min(1)
        .optional()
        .describe("Alias for objectName"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Salesforce is not connected. Please connect your Salesforce account first.";
        }

        const objectName = args.objectName || args.object_name;
        if (!objectName || typeof objectName !== "string") {
          return "Error: objectName parameter is required. Please provide the Salesforce object name as 'objectName'.";
        }

        const result = await salesforceClient.describeObject(
          workspaceId,
          serverId,
          objectName
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Salesforce describe object tool:", error);
        return `Error describing Salesforce object: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createSalesforceQueryTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Executes a SOQL query to find records. Supports filtering, sorting, and joins.",
    parameters: z.object({
      query: z.string().min(1).describe("SOQL query string"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Salesforce is not connected. Please connect your Salesforce account first.";
        }

        const result = await salesforceClient.querySalesforce(
          workspaceId,
          serverId,
          args.query
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Salesforce query tool:", error);
        return `Error querying Salesforce: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
