import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import * as todoistClient from "../../utils/todoist/client";

import { validateToolArgs } from "./toolValidation";

async function getTodoistConfig(
  workspaceId: string,
  serverId: string
): Promise<{ accessToken?: string } | null> {
  const db = await database();
  const pk = `mcp-servers/${workspaceId}/${serverId}`;
  const server = await db["mcp-server"].get(pk, "server");

  if (!server || server.authType !== "oauth") {
    return null;
  }

  return server.config as { accessToken?: string };
}

async function hasOAuthConnection(
  workspaceId: string,
  serverId: string
): Promise<boolean> {
  const config = await getTodoistConfig(workspaceId, serverId);
  return !!config?.accessToken;
}

const addTaskSchema = z
  .object({
    content: z.string().min(1).describe("The task name (e.g., 'Buy milk')."),
    due_string: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Natural language due date (e.g., 'tomorrow at 5pm', 'every friday')."
      ),
    priority: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe("Task priority from 1 (Normal) to 4 (Urgent)."),
  })
  .strict();

const todoistLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(200)
  .default(30)
  .describe("Maximum number of items to return (default: 30, max: 200)");
const todoistOffsetSchema = z
  .number()
  .int()
  .min(0)
  .max(10_000)
  .default(0)
  .describe(
    "Offset for pagination (0-based). Use nextOffset from previous response for next page."
  );

const getTasksSchema = z
  .object({
    filter: z
      .string()
      .min(1)
      .describe("Todoist filter syntax (e.g., 'today', 'overdue')."),
    limit: todoistLimitSchema,
    offset: todoistOffsetSchema,
  })
  .strict();

const closeTaskSchema = z
  .object({
    id: z.string().min(1).describe("The Todoist task ID to close."),
  })
  .strict();

export function createTodoistAddTaskTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Creates a new Todoist task. Supports natural language dates.",
    parameters: addTaskSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Todoist is not connected. Please connect your Todoist account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof addTaskSchema>>(
          addTaskSchema,
          args
        );
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await todoistClient.addTask(
          workspaceId,
          serverId,
          parsed.data
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Todoist add task tool:", error);
        return `Error adding Todoist task: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createTodoistGetTasksTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Lists active Todoist tasks. Use limit and offset to paginate. Use this to summarize what is due today or this week.",
    parameters: getTasksSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Todoist is not connected. Please connect your Todoist account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof getTasksSchema>>(
          getTasksSchema,
          args
        );
        if (!parsed.ok) {
          return parsed.error;
        }

        const allTasks = await todoistClient.listTasks(
          workspaceId,
          serverId,
          parsed.data.filter
        );
        const items = Array.isArray(allTasks) ? allTasks : [];
        const { limit, offset } = parsed.data;
        const slice = items.slice(offset, offset + limit);
        const hasMore = items.length > offset + limit;
        return JSON.stringify(
          {
            tasks: slice,
            hasMore,
            nextOffset: hasMore ? offset + limit : undefined,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Todoist get tasks tool:", error);
        return `Error listing Todoist tasks: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

export function createTodoistCloseTaskTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description: "Completes a Todoist task by ID.",
    parameters: closeTaskSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Todoist is not connected. Please connect your Todoist account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof closeTaskSchema>>(
          closeTaskSchema,
          args
        );
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await todoistClient.closeTask(
          workspaceId,
          serverId,
          parsed.data.id
        );
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Todoist close task tool:", error);
        return `Error closing Todoist task: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}

const getProjectsSchema = z
  .object({
    limit: todoistLimitSchema,
    offset: todoistOffsetSchema,
  })
  .strict();

export function createTodoistGetProjectsTool(
  workspaceId: string,
  serverId: string
) {
  return tool({
    description:
      "Lists Todoist projects to find the correct project ID for task creation. Use limit and offset to paginate.",
    parameters: getProjectsSchema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Todoist is not connected. Please connect your Todoist account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof getProjectsSchema>>(
          getProjectsSchema,
          args
        );
        if (!parsed.ok) {
          return parsed.error;
        }

        const allProjects = await todoistClient.listProjects(
          workspaceId,
          serverId
        );
        const items = Array.isArray(allProjects) ? allProjects : [];
        const { limit, offset } = parsed.data;
        const slice = items.slice(offset, offset + limit);
        const hasMore = items.length > offset + limit;
        return JSON.stringify(
          {
            projects: slice,
            hasMore,
            nextOffset: hasMore ? offset + limit : undefined,
          },
          null,
          2
        );
      } catch (error) {
        console.error("Error in Todoist get projects tool:", error);
        return `Error listing Todoist projects: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
