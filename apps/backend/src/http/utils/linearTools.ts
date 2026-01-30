import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as linearClient from "../../utils/linear/client";

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

export function createLinearListTeamsTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z.object({}).strict();

  return tool({
    description:
      "List Linear teams available to the connected account. Returns team IDs, names, and keys.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Linear is not connected. Please connect your Linear account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
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
  const schema = z
    .object({
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
    })
    .strict();

  return tool({
    description:
      "List Linear projects. Returns project metadata and pagination info.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Linear is not connected. Please connect your Linear account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await linearClient.listProjects(workspaceId, serverId, {
          first: parsed.data.first,
          after: parsed.data.after,
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
  const schema = z
    .object({
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
    })
    .strict();

  return tool({
    description:
      "List Linear issues with optional filters for team, project, assignee, and state.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Linear is not connected. Please connect your Linear account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await linearClient.listIssues(workspaceId, serverId, {
          teamId: parsed.data.teamId,
          projectId: parsed.data.projectId,
          assigneeId: parsed.data.assigneeId,
          state: parsed.data.state,
          first: parsed.data.first,
          after: parsed.data.after,
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
  const schema = z
    .object({
      issueId: z.string().optional().describe("Linear issue ID to retrieve"),
      id: z.string().optional().describe("Alias for issueId"),
      issue_id: z.string().optional().describe("Alias for issueId"),
    })
    .strict()
    .refine((data) => data.issueId || data.id || data.issue_id, {
      message: "issueId parameter is required.",
      path: ["issueId"],
    });

  return tool({
    description:
      "Get detailed information about a Linear issue by its ID.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Linear is not connected. Please connect your Linear account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const issueId = parsed.data.issueId || parsed.data.id || parsed.data.issue_id;
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
  const schema = z
    .object({
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
    })
    .strict();

  return tool({
    description:
      "Search Linear issues by query text with optional filters.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Linear is not connected. Please connect your Linear account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await linearClient.searchIssues(workspaceId, serverId, {
          query: parsed.data.query,
          teamId: parsed.data.teamId,
          projectId: parsed.data.projectId,
          assigneeId: parsed.data.assigneeId,
          state: parsed.data.state,
          first: parsed.data.first,
          after: parsed.data.after,
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
