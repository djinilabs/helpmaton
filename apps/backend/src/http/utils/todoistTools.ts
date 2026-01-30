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

const getTasksSchema = z
  .object({
    filter: z
      .string()
      .min(1)
      .describe("Todoist filter syntax (e.g., 'today', 'overdue')."),
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
      "Lists active Todoist tasks. Use this to summarize what is due today or this week.",
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

        const result = await todoistClient.listTasks(
          workspaceId,
          serverId,
          parsed.data.filter
        );
        return JSON.stringify(result, null, 2);
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

export function createTodoistGetProjectsTool(
  workspaceId: string,
  serverId: string
) {
  const schema = z.object({}).strict();

  return tool({
    description:
      "Lists all Todoist projects to find the correct project ID for task creation.",
    parameters: schema,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- AI SDK tool function has type inference limitations when schema is extracted
    // @ts-ignore - The execute function signature doesn't match the expected type, but works at runtime
     
    execute: async (args: unknown) => {
      try {
        if (!(await hasOAuthConnection(workspaceId, serverId))) {
          return "Error: Todoist is not connected. Please connect your Todoist account first.";
        }

        const parsed = validateToolArgs<z.infer<typeof schema>>(schema, args);
        if (!parsed.ok) {
          return parsed.error;
        }

        const result = await todoistClient.listProjects(workspaceId, serverId);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error("Error in Todoist get projects tool:", error);
        return `Error listing Todoist projects: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  });
}
