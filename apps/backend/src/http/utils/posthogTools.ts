import { tool } from "ai";
import { z } from "zod";

import { getPosthogJson } from "../../utils/posthog/client";

function buildProjectPath(projectId: string, path: string) {
  return `/api/projects/${encodeURIComponent(projectId)}${path}`;
}

const posthogQuerySchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean()])),
  ])
);

export function createPosthogListProjectsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List PostHog projects accessible to the API key. Returns project metadata including id, name, and organization details.",
    parameters: z.object({}),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async () => {
      try {
        const result = await getPosthogJson(workspaceId, serverId, "/api/projects/");
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in PostHog list projects tool:", error);
        return `Error listing PostHog projects: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createPosthogGetProjectTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Get details for a specific PostHog project by ID.",
    parameters: z.object({
      projectId: z.string().describe("PostHog project ID"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(args.projectId, "/")
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in PostHog get project tool:", error);
        return `Error getting PostHog project: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createPosthogListEventsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List events from a PostHog project with optional filters for event name, time range, distinct id, and pagination.",
    parameters: z.object({
      projectId: z.string().describe("PostHog project ID"),
      after: z
        .string()
        .optional()
        .describe("Only return events after this ISO timestamp"),
      before: z
        .string()
        .optional()
        .describe("Only return events before this ISO timestamp"),
      event: z.string().optional().describe("Filter by event name"),
      distinctId: z
        .string()
        .optional()
        .describe("Filter by distinct_id"),
      personId: z
        .number()
        .int()
        .optional()
        .describe("Filter by person id"),
      limit: z.number().int().optional().describe("Number of results to return"),
      offset: z.number().int().optional().describe("Number of results to skip"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(args.projectId, "/events/"),
          {
            after: args.after,
            before: args.before,
            event: args.event,
            distinct_id: args.distinctId,
            person_id: args.personId,
            limit: args.limit,
            offset: args.offset,
          }
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in PostHog list events tool:", error);
        return `Error listing PostHog events: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createPosthogListFeatureFlagsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List feature flags for a PostHog project. Returns feature flag definitions and metadata.",
    parameters: z.object({
      projectId: z.string().describe("PostHog project ID"),
      search: z.string().optional().describe("Search by flag key or name"),
      limit: z.number().int().optional().describe("Number of results to return"),
      offset: z.number().int().optional().describe("Number of results to skip"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(args.projectId, "/feature_flags/"),
          {
            search: args.search,
            limit: args.limit,
            offset: args.offset,
          }
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in PostHog list feature flags tool:", error);
        return `Error listing PostHog feature flags: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createPosthogGetFeatureFlagTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Get a specific feature flag by ID.",
    parameters: z.object({
      projectId: z.string().describe("PostHog project ID"),
      featureFlagId: z.string().describe("Feature flag ID"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(
            args.projectId,
            `/feature_flags/${encodeURIComponent(args.featureFlagId)}/`
          )
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in PostHog get feature flag tool:", error);
        return `Error getting PostHog feature flag: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createPosthogListInsightsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List insights for a PostHog project. Returns saved insight metadata and optional filters.",
    parameters: z.object({
      projectId: z.string().describe("PostHog project ID"),
      saved: z
        .boolean()
        .optional()
        .describe("Filter by saved insights only"),
      limit: z.number().int().optional().describe("Number of results to return"),
      offset: z.number().int().optional().describe("Number of results to skip"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(args.projectId, "/insights/"),
          {
            saved: args.saved,
            limit: args.limit,
            offset: args.offset,
          }
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in PostHog list insights tool:", error);
        return `Error listing PostHog insights: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createPosthogGetInsightTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Get details for a specific PostHog insight by ID.",
    parameters: z.object({
      projectId: z.string().describe("PostHog project ID"),
      insightId: z.string().describe("Insight ID"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(
            args.projectId,
            `/insights/${encodeURIComponent(args.insightId)}/`
          )
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in PostHog get insight tool:", error);
        return `Error getting PostHog insight: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createPosthogListPersonsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "List persons in a PostHog project with optional filters and pagination.",
    parameters: z.object({
      projectId: z.string().describe("PostHog project ID"),
      search: z.string().optional().describe("Search by person name or email"),
      distinctId: z
        .string()
        .optional()
        .describe("Filter by distinct_id"),
      limit: z.number().int().optional().describe("Number of results to return"),
      offset: z.number().int().optional().describe("Number of results to skip"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(args.projectId, "/persons/"),
          {
            search: args.search,
            distinct_id: args.distinctId,
            limit: args.limit,
            offset: args.offset,
          }
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in PostHog list persons tool:", error);
        return `Error listing PostHog persons: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createPosthogGetPersonTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Get details for a specific PostHog person by ID.",
    parameters: z.object({
      projectId: z.string().describe("PostHog project ID"),
      personId: z.string().describe("Person ID"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(
            args.projectId,
            `/persons/${encodeURIComponent(args.personId)}/`
          )
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in PostHog get person tool:", error);
        return `Error getting PostHog person: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createPosthogGetTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Fetch any read-only PostHog endpoint via GET. Use this for endpoints not covered by other PostHog tools.",
    parameters: z.object({
      path: z
        .string()
        .min(1)
        .refine((value) => value.startsWith("/api/"), {
          message: 'path must start with "/api/"',
        })
        .describe('PostHog API path (must start with "/api/")'),
      params: posthogQuerySchema
        .optional()
        .describe("Optional query parameters for the request"),
    }),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (args: any) => {
      try {
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          args.path,
          args.params
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in PostHog get tool:", error);
        return `Error getting PostHog data: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
