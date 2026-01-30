import { tool } from "ai";
import { z } from "zod";

import { getPosthogJson } from "../../utils/posthog/client";

import { validateToolArgs } from "./toolValidation";

function buildProjectPath(projectId: string, path: string) {
  return `/api/projects/${encodeURIComponent(projectId)}${path}`;
}

const posthogIdSchema = z.union([z.string(), z.number().int()]);

const posthogQuerySchema = z.record(
  z.string(),
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean()])),
  ])
);

function resolvePosthogId(args: Record<string, unknown>, key: string): string | null {
  const camelValue = args[key];
  const snakeValue = args[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
  const value = camelValue ?? snakeValue;
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

function requirePosthogId(args: Record<string, unknown>, key: string): string | null {
  const value = resolvePosthogId(args, key);
  if (!value) {
    return null;
  }
  return value;
}

export function createPosthogListProjectsTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z.object({}).strict();

  return tool({
    description:
      "List PostHog projects accessible to the API key. Returns project metadata including id, name, and organization details.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
    execute: async (args: unknown) => {
      try {
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
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
  const schema = z
    .object({
      projectId: posthogIdSchema.optional().describe("PostHog project ID"),
      project_id: posthogIdSchema
        .optional()
        .describe("Alias for projectId"),
    })
    .strict()
    .refine((data) => requirePosthogId(data as Record<string, unknown>, "projectId"), {
      message: "projectId parameter is required.",
      path: ["projectId"],
    });

  return tool({
    description: "Get details for a specific PostHog project by ID.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const projectId = requirePosthogId(
          parsed.data as Record<string, unknown>,
          "projectId"
        );
        if (!projectId) {
          return "Error: projectId parameter is required.";
        }
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(projectId, "/")
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
  const schema = z
    .object({
      projectId: posthogIdSchema.optional().describe("PostHog project ID"),
      project_id: posthogIdSchema
        .optional()
        .describe("Alias for projectId"),
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
        .union([z.number().int(), z.string()])
        .optional()
        .describe("Filter by person id"),
      person_id: z
        .union([z.number().int(), z.string()])
        .optional()
        .describe("Alias for personId"),
      limit: z.number().int().optional().describe("Number of results to return"),
      offset: z.number().int().optional().describe("Number of results to skip"),
    })
    .strict()
    .refine((data) => requirePosthogId(data as Record<string, unknown>, "projectId"), {
      message: "projectId parameter is required.",
      path: ["projectId"],
    });

  return tool({
    description:
      "List events from a PostHog project with optional filters for event name, time range, distinct id, and pagination.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const projectId = requirePosthogId(
          parsed.data as Record<string, unknown>,
          "projectId"
        );
        if (!projectId) {
          return "Error: projectId parameter is required.";
        }
        const personId = resolvePosthogId(
          parsed.data as Record<string, unknown>,
          "personId"
        );
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(projectId, "/events/"),
          {
            after: parsed.data.after,
            before: parsed.data.before,
            event: parsed.data.event,
            distinct_id: parsed.data.distinctId,
            person_id: personId ?? undefined,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
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
  const schema = z
    .object({
      projectId: posthogIdSchema.optional().describe("PostHog project ID"),
      project_id: posthogIdSchema
        .optional()
        .describe("Alias for projectId"),
      search: z.string().optional().describe("Search by flag key or name"),
      limit: z.number().int().optional().describe("Number of results to return"),
      offset: z.number().int().optional().describe("Number of results to skip"),
    })
    .strict()
    .refine((data) => requirePosthogId(data as Record<string, unknown>, "projectId"), {
      message: "projectId parameter is required.",
      path: ["projectId"],
    });

  return tool({
    description:
      "List feature flags for a PostHog project. Returns feature flag definitions and metadata.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const projectId = requirePosthogId(
          parsed.data as Record<string, unknown>,
          "projectId"
        );
        if (!projectId) {
          return "Error: projectId parameter is required.";
        }
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(projectId, "/feature_flags/"),
          {
            search: parsed.data.search,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
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
  const schema = z
    .object({
      projectId: posthogIdSchema.optional().describe("PostHog project ID"),
      project_id: posthogIdSchema
        .optional()
        .describe("Alias for projectId"),
      featureFlagId: posthogIdSchema.optional().describe("Feature flag ID"),
      feature_flag_id: posthogIdSchema
        .optional()
        .describe("Alias for featureFlagId"),
    })
    .strict()
    .refine((data) => requirePosthogId(data as Record<string, unknown>, "projectId"), {
      message: "projectId parameter is required.",
      path: ["projectId"],
    })
    .refine((data) => requirePosthogId(data as Record<string, unknown>, "featureFlagId"), {
      message: "featureFlagId parameter is required.",
      path: ["featureFlagId"],
    });

  return tool({
    description: "Get a specific feature flag by ID.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const projectId = requirePosthogId(
          parsed.data as Record<string, unknown>,
          "projectId"
        );
        if (!projectId) {
          return "Error: projectId parameter is required.";
        }
        const featureFlagId = requirePosthogId(
          parsed.data as Record<string, unknown>,
          "featureFlagId"
        );
        if (!featureFlagId) {
          return "Error: featureFlagId parameter is required.";
        }
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(
            projectId,
            `/feature_flags/${encodeURIComponent(featureFlagId)}/`
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
  const schema = z
    .object({
      projectId: posthogIdSchema.optional().describe("PostHog project ID"),
      project_id: posthogIdSchema
        .optional()
        .describe("Alias for projectId"),
      saved: z
        .boolean()
        .optional()
        .describe("Filter by saved insights only"),
      limit: z.number().int().optional().describe("Number of results to return"),
      offset: z.number().int().optional().describe("Number of results to skip"),
    })
    .strict()
    .refine((data) => requirePosthogId(data as Record<string, unknown>, "projectId"), {
      message: "projectId parameter is required.",
      path: ["projectId"],
    });

  return tool({
    description:
      "List insights for a PostHog project. Returns saved insight metadata and optional filters.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const projectId = requirePosthogId(
          parsed.data as Record<string, unknown>,
          "projectId"
        );
        if (!projectId) {
          return "Error: projectId parameter is required.";
        }
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(projectId, "/insights/"),
          {
            saved: parsed.data.saved,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
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
  const schema = z
    .object({
      projectId: posthogIdSchema.optional().describe("PostHog project ID"),
      project_id: posthogIdSchema
        .optional()
        .describe("Alias for projectId"),
      insightId: posthogIdSchema.optional().describe("Insight ID"),
      insight_id: posthogIdSchema
        .optional()
        .describe("Alias for insightId"),
    })
    .strict()
    .refine((data) => requirePosthogId(data as Record<string, unknown>, "projectId"), {
      message: "projectId parameter is required.",
      path: ["projectId"],
    })
    .refine((data) => requirePosthogId(data as Record<string, unknown>, "insightId"), {
      message: "insightId parameter is required.",
      path: ["insightId"],
    });

  return tool({
    description: "Get details for a specific PostHog insight by ID.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const projectId = requirePosthogId(
          parsed.data as Record<string, unknown>,
          "projectId"
        );
        if (!projectId) {
          return "Error: projectId parameter is required.";
        }
        const insightId = requirePosthogId(
          parsed.data as Record<string, unknown>,
          "insightId"
        );
        if (!insightId) {
          return "Error: insightId parameter is required.";
        }
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(
            projectId,
            `/insights/${encodeURIComponent(insightId)}/`
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
  const schema = z
    .object({
      projectId: posthogIdSchema.optional().describe("PostHog project ID"),
      project_id: posthogIdSchema
        .optional()
        .describe("Alias for projectId"),
      search: z.string().optional().describe("Search by person name or email"),
      distinctId: z
        .string()
        .optional()
        .describe("Filter by distinct_id"),
      distinct_id: z
        .string()
        .optional()
        .describe("Alias for distinctId"),
      limit: z.number().int().optional().describe("Number of results to return"),
      offset: z.number().int().optional().describe("Number of results to skip"),
    })
    .strict()
    .refine((data) => requirePosthogId(data as Record<string, unknown>, "projectId"), {
      message: "projectId parameter is required.",
      path: ["projectId"],
    });

  return tool({
    description:
      "List persons in a PostHog project with optional filters and pagination.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const projectId = requirePosthogId(
          parsed.data as Record<string, unknown>,
          "projectId"
        );
        if (!projectId) {
          return "Error: projectId parameter is required.";
        }
        const distinctId = resolvePosthogId(
          parsed.data as Record<string, unknown>,
          "distinctId"
        );
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(projectId, "/persons/"),
          {
            search: parsed.data.search,
            distinct_id: distinctId ?? undefined,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
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
  const schema = z
    .object({
      projectId: posthogIdSchema.optional().describe("PostHog project ID"),
      project_id: posthogIdSchema
        .optional()
        .describe("Alias for projectId"),
      personId: posthogIdSchema.optional().describe("Person ID"),
      person_id: posthogIdSchema.optional().describe("Alias for personId"),
    })
    .strict()
    .refine((data) => requirePosthogId(data as Record<string, unknown>, "projectId"), {
      message: "projectId parameter is required.",
      path: ["projectId"],
    })
    .refine((data) => requirePosthogId(data as Record<string, unknown>, "personId"), {
      message: "personId parameter is required.",
      path: ["personId"],
    });

  return tool({
    description: "Get details for a specific PostHog person by ID.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const projectId = requirePosthogId(
          parsed.data as Record<string, unknown>,
          "projectId"
        );
        if (!projectId) {
          return "Error: projectId parameter is required.";
        }
        const personId = requirePosthogId(
          parsed.data as Record<string, unknown>,
          "personId"
        );
        if (!personId) {
          return "Error: personId parameter is required.";
        }
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          buildProjectPath(
            projectId,
            `/persons/${encodeURIComponent(personId)}/`
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
  const schema = z
    .object({
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
    })
    .strict();

  return tool({
    description:
      "Fetch any read-only PostHog endpoint via GET. Use this for endpoints not covered by other PostHog tools.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }
        const result = await getPosthogJson(
          workspaceId,
          serverId,
          parsed.data.path,
          parsed.data.params
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
