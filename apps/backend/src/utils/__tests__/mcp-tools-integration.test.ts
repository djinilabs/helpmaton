import { describe, it, expect } from "vitest";

import { createMcpServerTools } from "../../http/utils/mcpUtils";
import { database } from "../../tables";
import type { McpServerRecord } from "../../tables/schema";
type McpServiceType =
  | "google-drive"
  | "gmail"
  | "google-calendar"
  | "notion"
  | "github"
  | "linear"
  | "hubspot"
  | "shopify"
  | "slack"
  | "stripe"
  | "salesforce"
  | "intercom"
  | "todoist"
  | "zendesk";

const ALL_MCP_SERVICES: McpServiceType[] = [
  "google-drive",
  "gmail",
  "google-calendar",
  "notion",
  "github",
  "linear",
  "hubspot",
  "shopify",
  "slack",
  "stripe",
  "salesforce",
  "intercom",
  "todoist",
  "zendesk",
];

const shouldRun = process.env.RUN_MCP_TOOLS_INTEGRATION === "true";
const mcpDescribe = shouldRun ? describe : describe.skip;

type ProviderContext = {
  serviceType: McpServiceType;
  values: Record<string, unknown>;
  results: Record<string, unknown>;
  nowIso: string;
  laterIso: string;
};

type ProviderPlan = {
  order: string[];
  resolveArgs: Record<
    string,
    (context: ProviderContext) => Record<string, unknown>
  >;
  extract: Record<
    string,
    (context: ProviderContext, parsed: unknown) => void
  >;
};

type ToolExecutor = {
  execute: (...args: unknown[]) => Promise<unknown>;
};

const MCP_SERVICES = new Set<McpServiceType>(ALL_MCP_SERVICES);

const mcpPlans: Record<McpServiceType, ProviderPlan> = {
  "google-drive": {
    order: ["google_drive_list", "google_drive_read", "google_drive_search"],
    resolveArgs: {
      google_drive_list: () => ({}),
      google_drive_read: (context) => ({
        fileId: getRequired(
          context,
          "fileId",
          "google_drive_list",
          process.env.MCP_GOOGLE_DRIVE_FILE_ID
        ),
      }),
      google_drive_search: () => ({
        query: process.env.MCP_GOOGLE_DRIVE_QUERY || "test",
      }),
    },
    extract: {
      google_drive_list: (context, parsed) => {
        const file = pickFirstArrayItem(parsed, "files") as { id?: string } | undefined;
        setValue(context, "fileId", file?.id);
      },
      google_drive_search: (context, parsed) => {
        const file = pickFirstArrayItem(parsed, "files") as { id?: string } | undefined;
        setValue(context, "fileId", file?.id);
      },
    },
  },
  gmail: {
    order: ["gmail_list", "gmail_search", "gmail_read"],
    resolveArgs: {
      gmail_list: () => ({ query: "in:inbox" }),
      gmail_search: () => ({ query: "in:inbox" }),
      gmail_read: (context) => ({
        messageId: getRequired(context, "messageId", "gmail_list"),
      }),
    },
    extract: {
      gmail_list: (context, parsed) => {
        const message = pickFirstArrayItem(parsed, "messages") as { id?: string } | undefined;
        setValue(context, "messageId", message?.id);
      },
      gmail_search: (context, parsed) => {
        const message = pickFirstArrayItem(parsed, "messages") as { id?: string } | undefined;
        setValue(context, "messageId", message?.id);
      },
    },
  },
  "google-calendar": {
    order: [
      "google_calendar_list",
      "google_calendar_search",
      "google_calendar_create",
      "google_calendar_read",
      "google_calendar_update",
      "google_calendar_delete",
    ],
    resolveArgs: {
      google_calendar_list: () => ({
        calendarId: "primary",
        maxResults: 5,
        singleEvents: true,
      }),
      google_calendar_search: () => ({
        calendarId: "primary",
        query: "MCP Integration Test",
        maxResults: 5,
        singleEvents: true,
      }),
      google_calendar_create: (context) => ({
        calendarId: "primary",
        summary: "MCP Integration Test",
        description: "Created by MCP tool integration test",
        start: { dateTime: context.nowIso },
        end: { dateTime: context.laterIso },
      }),
      google_calendar_read: (context) => ({
        calendarId: "primary",
        eventId: getCalendarEventId(context),
      }),
      google_calendar_update: (context) => ({
        calendarId: "primary",
        eventId: getCalendarEventId(context),
        summary: "MCP Integration Test (Updated)",
      }),
      google_calendar_delete: (context) => ({
        calendarId: "primary",
        eventId: getCalendarEventId(context),
      }),
    },
    extract: {
      google_calendar_list: (context, parsed) => {
        const event = pickFirstArrayItem(parsed, "events") as { id?: string } | undefined;
        setValue(context, "listEventId", event?.id);
      },
      google_calendar_search: (context, parsed) => {
        const event = pickFirstArrayItem(parsed, "events") as { id?: string } | undefined;
        setValue(context, "listEventId", event?.id);
      },
      google_calendar_create: (context, parsed) => {
        const event = getValueByPath(parsed, ["event"]) as { id?: string } | undefined;
        setValue(context, "createdEventId", event?.id);
      },
    },
  },
  notion: {
    order: [
      "notion_search",
      "notion_create",
      "notion_read",
      "notion_update",
      "notion_append_blocks",
      "notion_query_database",
      "notion_create_database_page",
      "notion_update_database_page",
    ],
    resolveArgs: {
      notion_search: () => ({ query: "" }),
      notion_create: () => ({
        name: "MCP Integration Test",
        content: "Created by MCP tool integration test",
      }),
      notion_read: (context) => ({
        pageId: getRequired(context, "createdPageId", "notion_create"),
      }),
      notion_update: (context) => ({
        pageId: getRequired(context, "createdPageId", "notion_create"),
        properties: {
          title: [
            {
              type: "text",
              text: {
                content: "MCP Integration Test (Updated)",
              },
            },
          ],
        },
      }),
      notion_append_blocks: (context) => ({
        pageId: getRequired(context, "createdPageId", "notion_create"),
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: { content: "Appended by MCP tool integration test." },
                },
              ],
            },
          },
        ],
      }),
      notion_query_database: (context) => ({
        databaseId: getRequired(context, "databaseId", "notion_search"),
        pageSize: 1,
      }),
      notion_create_database_page: (context) => ({
        databaseId: getRequired(context, "databaseId", "notion_search"),
        properties: buildNotionDatabaseProperties(context),
      }),
      notion_update_database_page: (context) => ({
        pageId: getRequired(
          context,
          "createdDatabasePageId",
          "notion_create_database_page"
        ),
        properties: buildNotionDatabaseProperties(context),
      }),
    },
    extract: {
      notion_search: (context, parsed) => {
        const results = getValueByPath(parsed, ["results"]);
        if (!Array.isArray(results)) {
          return;
        }
        for (const result of results) {
          if (!result || typeof result !== "object") {
            continue;
          }
          const obj = result as { object?: string; id?: string };
          if (obj.object === "page") {
            setValue(context, "pageId", obj.id);
          }
          if (obj.object === "database") {
            setValue(context, "databaseId", obj.id);
          }
          if (context.values.pageId && context.values.databaseId) {
            break;
          }
        }
      },
      notion_create: (context, parsed) => {
        const page = getValueByPath(parsed, ["page"]) as { id?: string } | undefined;
        setValue(context, "createdPageId", page?.id);
      },
      notion_query_database: (context, parsed) => {
        const page = pickFirstArrayItem(parsed, "results");
        setValue(context, "databasePageSample", page);
      },
      notion_create_database_page: (context, parsed) => {
        const page = getValueByPath(parsed, ["page"]) as { id?: string } | undefined;
        setValue(context, "createdDatabasePageId", page?.id);
      },
    },
  },
  github: {
    order: [
      "github_list_repos",
      "github_get_repo",
      "github_list_issues",
      "github_get_issue",
      "github_list_prs",
      "github_get_pr",
      "github_read_file",
      "github_list_commits",
      "github_get_commit",
    ],
    resolveArgs: {
      github_list_repos: () => ({ per_page: 5 }),
      github_get_repo: (context) => ({
        owner: getRequired(context, "owner", "github_list_repos"),
        repo: getRequired(context, "repo", "github_list_repos"),
      }),
      github_list_issues: (context) => ({
        owner: getRequired(context, "owner", "github_list_repos"),
        repo: getRequired(context, "repo", "github_list_repos"),
        state: "all",
        per_page: 5,
      }),
      github_get_issue: (context) => ({
        owner: getRequired(context, "owner", "github_list_repos"),
        repo: getRequired(context, "repo", "github_list_repos"),
        issueNumber: getRequired(context, "issueNumber", "github_list_issues"),
      }),
      github_list_prs: (context) => ({
        owner: getRequired(context, "owner", "github_list_repos"),
        repo: getRequired(context, "repo", "github_list_repos"),
        state: "all",
        per_page: 5,
      }),
      github_get_pr: (context) => ({
        owner: getRequired(context, "owner", "github_list_repos"),
        repo: getRequired(context, "repo", "github_list_repos"),
        prNumber: getRequired(context, "prNumber", "github_list_prs"),
      }),
      github_read_file: (context) => ({
        owner: getRequired(context, "owner", "github_list_repos"),
        repo: getRequired(context, "repo", "github_list_repos"),
        path: "README.md",
      }),
      github_list_commits: (context) => ({
        owner: getRequired(context, "owner", "github_list_repos"),
        repo: getRequired(context, "repo", "github_list_repos"),
        per_page: 5,
      }),
      github_get_commit: (context) => ({
        owner: getRequired(context, "owner", "github_list_repos"),
        repo: getRequired(context, "repo", "github_list_repos"),
        sha: getRequired(context, "commitSha", "github_list_commits"),
      }),
    },
    extract: {
      github_list_repos: (context, parsed) => {
        const repo = Array.isArray(parsed) ? parsed[0] : undefined;
        if (repo && typeof repo === "object") {
          const repoRecord = repo as {
            full_name?: string;
            name?: string;
          };
          if (repoRecord.full_name) {
            const [owner, name] = repoRecord.full_name.split("/");
            setValue(context, "owner", owner);
            setValue(context, "repo", name);
          } else if (repoRecord.name) {
            setValue(context, "repo", repoRecord.name);
          }
        }
      },
      github_list_issues: (context, parsed) => {
        const issue = Array.isArray(parsed) ? parsed[0] : undefined;
        if (issue && typeof issue === "object") {
          setValue(context, "issueNumber", (issue as { number?: number }).number);
        }
      },
      github_list_prs: (context, parsed) => {
        const pr = Array.isArray(parsed) ? parsed[0] : undefined;
        if (pr && typeof pr === "object") {
          setValue(context, "prNumber", (pr as { number?: number }).number);
        }
      },
      github_list_commits: (context, parsed) => {
        const commit = Array.isArray(parsed) ? parsed[0] : undefined;
        if (commit && typeof commit === "object") {
          setValue(context, "commitSha", (commit as { sha?: string }).sha);
        }
      },
    },
  },
  linear: {
    order: [
      "linear_list_teams",
      "linear_list_projects",
      "linear_list_issues",
      "linear_get_issue",
      "linear_search_issues",
    ],
    resolveArgs: {
      linear_list_teams: () => ({}),
      linear_list_projects: () => ({ first: 5 }),
      linear_list_issues: () => ({ first: 5 }),
      linear_get_issue: (context) => ({
        issueId: getRequired(context, "issueId", "linear_list_issues"),
      }),
      linear_search_issues: () => ({ query: "test", first: 5 }),
    },
    extract: {
      linear_list_teams: (context, parsed) => {
        const team = Array.isArray(parsed) ? parsed[0] : undefined;
        setValue(context, "teamId", (team as { id?: string } | undefined)?.id);
      },
      linear_list_projects: (context, parsed) => {
        const project = pickFirstArrayItem(parsed, "nodes");
        setValue(
          context,
          "projectId",
          (project as { id?: string } | undefined)?.id
        );
      },
      linear_list_issues: (context, parsed) => {
        const issue = pickFirstArrayItem(parsed, "nodes");
        setValue(
          context,
          "issueId",
          (issue as { id?: string } | undefined)?.id
        );
      },
    },
  },
  hubspot: {
    order: [
      "hubspot_list_contacts",
      "hubspot_get_contact",
      "hubspot_search_contacts",
      "hubspot_list_companies",
      "hubspot_get_company",
      "hubspot_search_companies",
      "hubspot_list_deals",
      "hubspot_get_deal",
      "hubspot_search_deals",
      "hubspot_list_owners",
      "hubspot_get_owner",
      "hubspot_search_owners",
    ],
    resolveArgs: {
      hubspot_list_contacts: () => ({ limit: 5 }),
      hubspot_get_contact: (context) => ({
        contactId: getRequired(context, "contactId", "hubspot_list_contacts"),
      }),
      hubspot_search_contacts: () => ({ query: "test", limit: 5 }),
      hubspot_list_companies: () => ({ limit: 5 }),
      hubspot_get_company: (context) => ({
        companyId: getRequired(context, "companyId", "hubspot_list_companies"),
      }),
      hubspot_search_companies: () => ({ query: "test", limit: 5 }),
      hubspot_list_deals: () => ({ limit: 5 }),
      hubspot_get_deal: (context) => ({
        dealId: getRequired(context, "dealId", "hubspot_list_deals"),
      }),
      hubspot_search_deals: () => ({ query: "test", limit: 5 }),
      hubspot_list_owners: () => ({ limit: 5 }),
      hubspot_get_owner: (context) => ({
        ownerId: getRequired(context, "ownerId", "hubspot_list_owners"),
      }),
      hubspot_search_owners: () => ({ query: "test", limit: 5 }),
    },
    extract: {
      hubspot_list_contacts: (context, parsed) => {
        const contact = pickFirstArrayItem(parsed, "results");
        setValue(
          context,
          "contactId",
          (contact as { id?: string } | undefined)?.id
        );
      },
      hubspot_list_companies: (context, parsed) => {
        const company = pickFirstArrayItem(parsed, "results");
        setValue(
          context,
          "companyId",
          (company as { id?: string } | undefined)?.id
        );
      },
      hubspot_list_deals: (context, parsed) => {
        const deal = pickFirstArrayItem(parsed, "results");
        setValue(
          context,
          "dealId",
          (deal as { id?: string } | undefined)?.id
        );
      },
      hubspot_list_owners: (context, parsed) => {
        const owner = pickFirstArrayItem(parsed, "results");
        setValue(
          context,
          "ownerId",
          (owner as { id?: string } | undefined)?.id
        );
      },
    },
  },
  shopify: {
    order: ["shopify_search_products", "shopify_sales_report", "shopify_get_order"],
    resolveArgs: {
      shopify_search_products: () => ({ query: "test" }),
      shopify_sales_report: (context) => ({
        startDate: context.nowIso,
        endDate: context.laterIso,
        limit: 50,
      }),
      shopify_get_order: () => ({
        orderNumber: "1001",
      }),
    },
    extract: {},
  },
  slack: {
    order: ["slack_list_channels", "slack_get_channel_history", "slack_post_message"],
    resolveArgs: {
      slack_list_channels: () => ({ limit: 5 }),
      slack_get_channel_history: (context) => ({
        channelId: getRequired(context, "channelId", "slack_list_channels"),
        limit: 5,
      }),
      slack_post_message: (context) => ({
        channelId: getRequired(context, "channelId", "slack_list_channels"),
        text: "MCP tool integration test message",
      }),
    },
    extract: {
      slack_list_channels: (context, parsed) => {
        const channel = pickFirstArrayItem(parsed, "channels");
        setValue(
          context,
          "channelId",
          (channel as { id?: string } | undefined)?.id
        );
      },
    },
  },
  stripe: {
    order: ["stripe_search_charges", "stripe_get_metrics"],
    resolveArgs: {
      stripe_search_charges: () => ({ query: "status:'succeeded'" }),
      stripe_get_metrics: (context) => ({
        startDate: context.nowIso,
        endDate: context.laterIso,
        limit: 10,
      }),
    },
    extract: {},
  },
  salesforce: {
    order: ["salesforce_list_objects", "salesforce_describe_object", "salesforce_query"],
    resolveArgs: {
      salesforce_list_objects: () => ({}),
      salesforce_describe_object: (context) => ({
        objectName: getRequired(context, "objectName", "salesforce_list_objects"),
      }),
      salesforce_query: (context) => ({
        query: `SELECT Id FROM ${getRequired(
          context,
          "objectName",
          "salesforce_list_objects"
        )} LIMIT 1`,
      }),
    },
    extract: {
      salesforce_list_objects: (context, parsed) => {
        const sobjects = getValueByPath(parsed, ["sobjects"]);
        if (Array.isArray(sobjects)) {
          const account = sobjects.find(
            (obj) => obj && typeof obj === "object" && obj.name === "Account"
          );
          const pick = account ?? sobjects[0];
          setValue(
            context,
            "objectName",
            (pick as { name?: string } | undefined)?.name
          );
        }
      },
    },
  },
  intercom: {
    order: [
      "intercom_list_contacts",
      "intercom_get_contact",
      "intercom_search_contacts",
      "intercom_update_contact",
      "intercom_list_conversations",
      "intercom_get_conversation",
      "intercom_search_conversations",
      "intercom_reply_conversation",
    ],
    resolveArgs: {
      intercom_list_contacts: () => ({ perPage: 5 }),
      intercom_get_contact: (context) => ({
        contactId: getRequired(context, "contactId", "intercom_list_contacts"),
      }),
      intercom_search_contacts: () => ({
        query: {
          operator: "AND",
          value: [
            {
              field: "updated_at",
              operator: ">",
              value: 0,
            },
          ],
        },
      }),
      intercom_update_contact: (context) => ({
        contactId: getRequired(context, "contactId", "intercom_list_contacts"),
        updates: {
          custom_attributes: {
            mcp_integration_test: "true",
          },
        },
      }),
      intercom_list_conversations: () => ({ perPage: 5 }),
      intercom_get_conversation: (context) => ({
        conversationId: getRequired(
          context,
          "conversationId",
          "intercom_list_conversations"
        ),
      }),
      intercom_search_conversations: () => ({
        query: {
          operator: "AND",
          value: [
            {
              field: "created_at",
              operator: ">",
              value: 0,
            },
          ],
        },
      }),
      intercom_reply_conversation: (context) => ({
        conversationId: getRequired(
          context,
          "conversationId",
          "intercom_list_conversations"
        ),
        messageType: "comment",
        body: "MCP tool integration test reply",
      }),
    },
    extract: {
      intercom_list_contacts: (context, parsed) => {
        const contact = pickFirstArrayItem(parsed, "data");
        setValue(
          context,
          "contactId",
          (contact as { id?: string } | undefined)?.id
        );
      },
      intercom_list_conversations: (context, parsed) => {
        const conversation = pickFirstArrayItem(parsed, "conversations");
        setValue(
          context,
          "conversationId",
          (conversation as { id?: string } | undefined)?.id
        );
      },
    },
  },
  todoist: {
    order: ["todoist_get_projects", "todoist_add_task", "todoist_get_tasks", "todoist_close_task"],
    resolveArgs: {
      todoist_get_projects: () => ({}),
      todoist_add_task: () => ({
        content: "MCP tool integration test task",
      }),
      todoist_get_tasks: () => ({ filter: "today | overdue" }),
      todoist_close_task: (context) => ({
        id: getRequired(context, "taskId", "todoist_add_task"),
      }),
    },
    extract: {
      todoist_add_task: (context, parsed) => {
        setValue(
          context,
          "taskId",
          (parsed as { id?: string } | undefined)?.id
        );
      },
    },
  },
  zendesk: {
    order: [
      "zendesk_search_tickets",
      "zendesk_get_ticket_details",
      "zendesk_draft_comment",
      "zendesk_search_help_center",
    ],
    resolveArgs: {
      zendesk_search_tickets: () => ({ query: "type:ticket" }),
      zendesk_get_ticket_details: (context) => ({
        ticketId: getRequired(context, "ticketId", "zendesk_search_tickets"),
      }),
      zendesk_draft_comment: (context) => ({
        ticketId: getRequired(context, "ticketId", "zendesk_search_tickets"),
        body: "MCP tool integration test draft reply",
      }),
      zendesk_search_help_center: () => ({ query: "account" }),
    },
    extract: {
      zendesk_search_tickets: (context, parsed) => {
        const ticket = pickFirstArrayItem(parsed, "results");
        setValue(
          context,
          "ticketId",
          (ticket as { id?: number | string } | undefined)?.id
        );
      },
    },
  },
};

mcpDescribe("MCP tools integration (real services)", () => {
  it(
    "invokes all MCP tools for configured providers",
    async () => {
      const serviceFilter = parseServiceFilter();
      const db = await database();
      const workspaceIds = await fetchWorkspaceIds(db);
      const serversByService = await fetchLatestServers(
        db,
        workspaceIds,
        serviceFilter
      );

      const missingServices = serviceFilter.filter(
        (serviceType) => !serversByService.has(serviceType)
      );
      if (missingServices.length > 0) {
        throw new Error(
          `Missing MCP credentials for: ${missingServices.join(", ")}`
        );
      }

      for (const serviceType of serviceFilter) {
        const target = serversByService.get(serviceType);
        if (!target) {
          throw new Error(`Missing MCP server for ${serviceType}`);
        }

        const { workspaceId, serverId } = target;
        const tools = await createMcpServerTools(workspaceId, [serverId]);
        const toolEntries =
          Object.entries(tools) as unknown as Array<[string, ToolExecutor]>;

        expect(toolEntries.length).toBeGreaterThan(0);

        const plan = mcpPlans[serviceType];
        const context = buildContext(serviceType);
        const toolMap = mapToolsToPlan(toolEntries, plan);

        for (const toolBaseName of plan.order) {
          const entry = toolMap.get(toolBaseName);
          if (!entry) {
            throw new Error(
              `Missing tool ${toolBaseName} for ${serviceType} server ${serverId}`
            );
          }

          const args = plan.resolveArgs[toolBaseName](context);
          const result = await executeTool(
            serviceType,
            entry.name,
            entry.tool,
            args
          );
          context.results[toolBaseName] = result.parsed;

          const extractor = plan.extract[toolBaseName];
          if (extractor) {
            extractor(context, result.parsed);
          }
        }
      }
    },
    30 * 60 * 1000
  );
});

function parseServiceFilter(): McpServiceType[] {
  const argValue = getArgValue("--services");
  const listValue = getServiceListArg();
  const raw = argValue ?? listValue ?? process.env.MCP_TOOL_SERVICES ?? "";
  if (!raw) {
    return [...ALL_MCP_SERVICES];
  }
  const services = raw
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean);

  const invalid = services.filter((service) => !MCP_SERVICES.has(service as McpServiceType));
  if (invalid.length > 0) {
    throw new Error(`Unknown MCP services: ${invalid.join(", ")}`);
  }

  return services as McpServiceType[];
}

function getArgValue(flagName: string): string | undefined {
  const flagPrefix = `${flagName}=`;
  const arg = process.argv.find((value) => value.startsWith(flagPrefix));
  return arg ? arg.slice(flagPrefix.length) : undefined;
}

function getServiceListArg(): string | undefined {
  for (const arg of process.argv) {
    if (!arg || arg.startsWith("-")) {
      continue;
    }
    if (arg.includes("/") || arg.endsWith(".ts") || arg.includes(".test")) {
      continue;
    }
    if (arg.includes(",") || MCP_SERVICES.has(arg as McpServiceType)) {
      return arg;
    }
  }
  return undefined;
}

async function fetchWorkspaceIds(
  db: Awaited<ReturnType<typeof database>>
): Promise<string[]> {
  const permissions = await db.permission.query({
    IndexName: "byResourceTypeAndEntityId",
    KeyConditionExpression: "resourceType = :resourceType",
    ExpressionAttributeValues: {
      ":resourceType": "workspaces",
    },
  });

  const workspaceIds = new Set<string>();
  for (const item of permissions.items) {
    const pk = item.pk;
    if (!pk?.startsWith("workspaces/")) {
      continue;
    }
    const workspaceId = pk.split("/")[1];
    if (workspaceId) {
      workspaceIds.add(workspaceId);
    }
  }

  if (workspaceIds.size === 0) {
    throw new Error("No workspaces found in local sandbox.");
  }

  return [...workspaceIds];
}

async function fetchLatestServers(
  db: Awaited<ReturnType<typeof database>>,
  workspaceIds: string[],
  services: McpServiceType[]
): Promise<Map<McpServiceType, { workspaceId: string; serverId: string }>> {
  const candidates = new Map<
    McpServiceType,
    Array<{ workspaceId: string; server: McpServerRecord }>
  >();

  for (const workspaceId of workspaceIds) {
    const servers = await db["mcp-server"].query({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });

    for (const server of servers.items) {
      const serviceType = server.serviceType as McpServiceType | undefined;
      if (!serviceType || !services.includes(serviceType)) {
        continue;
      }
      if (!hasOAuthCredentials(server)) {
        continue;
      }
      if (!candidates.has(serviceType)) {
        candidates.set(serviceType, []);
      }
      candidates.get(serviceType)!.push({ workspaceId, server });
    }
  }

  const selected = new Map<
    McpServiceType,
    { workspaceId: string; serverId: string }
  >();

  for (const serviceType of services) {
    const entries = candidates.get(serviceType);
    if (!entries || entries.length === 0) {
      continue;
    }
    const latest = entries.reduce((acc, entry) => {
      if (!acc) {
        return entry;
      }
      return isAfter(entry.server, acc.server) ? entry : acc;
    }, entries[0]);

    selected.set(serviceType, {
      workspaceId: latest.workspaceId,
      serverId: parseServerId(latest.workspaceId, latest.server.pk),
    });
  }

  return selected;
}

function hasOAuthCredentials(server: McpServerRecord): boolean {
  if (server.authType !== "oauth") {
    return false;
  }
  const config = server.config as { accessToken?: string };
  return !!config?.accessToken;
}

function parseServerId(workspaceId: string, pk: string): string {
  const prefix = `mcp-servers/${workspaceId}/`;
  if (!pk.startsWith(prefix)) {
    throw new Error(`Unexpected MCP server pk format: ${pk}`);
  }
  return pk.slice(prefix.length);
}

function isAfter(a: McpServerRecord, b: McpServerRecord): boolean {
  const aTime = Date.parse(a.createdAt);
  const bTime = Date.parse(b.createdAt);
  return Number.isFinite(aTime) && Number.isFinite(bTime) ? aTime > bTime : false;
}

function buildContext(serviceType: McpServiceType): ProviderContext {
  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  return {
    serviceType,
    values: {},
    results: {},
    nowIso: now.toISOString(),
    laterIso: later.toISOString(),
  };
}

function mapToolsToPlan(
  toolEntries: Array<[string, ToolExecutor]>,
  plan: ProviderPlan
): Map<string, { name: string; tool: ToolExecutor }> {
  const map = new Map<
    string,
    { name: string; tool: ToolExecutor }
  >();
  for (const [name, tool] of toolEntries) {
    const baseName = plan.order.find((candidate) => name.startsWith(candidate));
    if (!baseName) {
      throw new Error(`Unrecognized MCP tool: ${name}`);
    }
    map.set(baseName, { name, tool });
  }
  return map;
}

async function executeTool(
  serviceType: McpServiceType,
  toolName: string,
  tool: { execute: (args: unknown) => Promise<unknown> },
  args: Record<string, unknown>
): Promise<{ raw: string; parsed: unknown }> {
  console.log(`[MCP Tools] ${serviceType}: ${toolName}`, {
    args,
  });
  const rawResult = await tool.execute(args);
  const raw = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);
  console.log(`[MCP Tools] ${serviceType}: ${toolName} result`, {
    raw,
  });

  if (raw.startsWith("Error")) {
    throw new Error(`[MCP Tools] ${toolName} failed: ${raw}`);
  }

  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // keep raw as parsed fallback
  }

  expect(raw).toBeTruthy();
  return { raw, parsed };
}

function setValue(
  context: ProviderContext,
  key: string,
  value: unknown
): void {
  if (value === undefined || value === null || value === "") {
    return;
  }
  if (context.values[key] === undefined) {
    context.values[key] = value;
  }
}

function getRequired(
  context: ProviderContext,
  key: string,
  sourceTool: string,
  fallback?: string
): string {
  const value = context.values[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (fallback && fallback.trim().length > 0) {
    return fallback.trim();
  }
  throw new Error(
    `Missing ${key} for ${context.serviceType}. Ensure ${sourceTool} returns data.`
  );
}

function pickFirstArrayItem(parsed: unknown, key: string): unknown | undefined {
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const value = (parsed as Record<string, unknown>)[key];
  return Array.isArray(value) ? value[0] : undefined;
}

function getValueByPath(parsed: unknown, path: string[]): unknown {
  let current: unknown = parsed;
  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function getCalendarEventId(context: ProviderContext): string {
  const created = context.values.createdEventId;
  if (typeof created === "string" && created.trim().length > 0) {
    return created;
  }
  const listed = context.values.listEventId;
  if (typeof listed === "string" && listed.trim().length > 0) {
    return listed;
  }
  throw new Error(
    `Missing eventId for ${context.serviceType}. Ensure google_calendar_create or list returns events.`
  );
}

function buildNotionDatabaseProperties(
  context: ProviderContext
): Record<string, unknown> {
  const sample = context.values.databasePageSample;
  if (!sample || typeof sample !== "object") {
    throw new Error(
      `Missing database page sample for ${context.serviceType}. Ensure notion_query_database returns at least one page.`
    );
  }
  const properties = (sample as { properties?: Record<string, unknown> }).properties;
  if (!properties || typeof properties !== "object") {
    throw new Error("Notion database sample is missing properties.");
  }

  const updated: Record<string, unknown> = { ...properties };
  for (const [key, value] of Object.entries(updated)) {
    if (value && typeof value === "object" && (value as { type?: string }).type === "title") {
      updated[key] = {
        type: "title",
        title: [
          {
            type: "text",
            text: { content: "MCP Integration Test (Database)" },
          },
        ],
      };
      break;
    }
  }
  return updated;
}
