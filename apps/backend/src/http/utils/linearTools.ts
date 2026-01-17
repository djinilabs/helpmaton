import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as linearClient from "../../utils/linear/client";

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

export function createLinearListTeamsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List Linear teams available to the connected account. Returns team IDs, names, and keys.",
    parameters: z.object({}),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async () => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Linear is not connected. Please connect your Linear account first.";
        }

        const result = await linearClient.listTeams(workspaceId, serverId);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Linear list teams tool:", error);
        return `Error listing Linear teams: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createLinearListProjectsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List Linear projects. Returns project metadata and pagination info.",
    parameters: z.object({
      first: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results to return (default: 50, max: 100)"),
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
          return "Error: Linear is not connected. Please connect your Linear account first.";
        }

        const result = await linearClient.listProjects(workspaceId, serverId, {
          first: args.first,
          after: args.after,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Linear list projects tool:", error);
        return `Error listing Linear projects: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createLinearListIssuesTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List Linear issues with optional filters for team, project, assignee, and state.",
    parameters: z.object({
      teamId: z
        .string()
        .optional()
        .describe("Filter issues by team ID"),
      projectId: z
        .string()
        .optional()
        .describe("Filter issues by project ID"),
      assigneeId: z
        .string()
        .optional()
        .describe("Filter issues by assignee ID"),
      state: z
        .string()
        .optional()
        .describe("Filter issues by state name (e.g., 'Todo', 'In Progress')"),
      first: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results to return (default: 50, max: 100)"),
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
          return "Error: Linear is not connected. Please connect your Linear account first.";
        }

        const result = await linearClient.listIssues(workspaceId, serverId, {
          teamId: args.teamId,
          projectId: args.projectId,
          assigneeId: args.assigneeId,
          state: args.state,
          first: args.first,
          after: args.after,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Linear list issues tool:", error);
        return `Error listing Linear issues: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createLinearGetIssueTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Get detailed information about a Linear issue by its ID.",
    parameters: z.object({
      issueId: z
        .string()
        .optional()
        .describe("Linear issue ID to retrieve"),
      id: z.string().optional().describe("Alias for issueId"),
      issue_id: z.string().optional().describe("Alias for issueId"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Linear is not connected. Please connect your Linear account first.";
        }

        const issueId = args.issueId || args.id || args.issue_id;
        if (!issueId || typeof issueId !== "string") {
          return "Error: issueId parameter is required. Please provide the Linear issue ID as 'issueId'.";
        }

        const result = await linearClient.getIssue(
          workspaceId,
          serverId,
          issueId
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Linear get issue tool:", error);
        return `Error getting Linear issue: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createLinearSearchIssuesTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Search Linear issues by query text with optional filters.",
    parameters: z.object({
      query: z
        .string()
        .min(1, "Search query cannot be empty")
        .describe("Search query text"),
      teamId: z
        .string()
        .optional()
        .describe("Filter issues by team ID"),
      projectId: z
        .string()
        .optional()
        .describe("Filter issues by project ID"),
      assigneeId: z
        .string()
        .optional()
        .describe("Filter issues by assignee ID"),
      state: z
        .string()
        .optional()
        .describe("Filter issues by state name (e.g., 'Todo', 'In Progress')"),
      first: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results to return (default: 50, max: 100)"),
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
          return "Error: Linear is not connected. Please connect your Linear account first.";
        }

        const result = await linearClient.searchIssues(workspaceId, serverId, {
          query: args.query,
          teamId: args.teamId,
          projectId: args.projectId,
          assigneeId: args.assigneeId,
          state: args.state,
          first: args.first,
          after: args.after,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Linear search issues tool:", error);
        return `Error searching Linear issues: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
