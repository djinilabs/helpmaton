#!/usr/bin/env tsx
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: "tests/e2e/.env" });

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

type McpServerRecord = {
  pk: string;
  sk?: string;
  workspaceId: string;
  name: string;
  url?: string;
  authType: "none" | "header" | "basic" | "oauth";
  serviceType?: string;
  config: Record<string, unknown>;
  createdAt: string;
};

const MCP_SERVICES: McpServiceType[] = [
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

const OUTPUT_PATH = path.join("tmp", "mcp-credentials.json");

const { database } = await import("../apps/backend/src/tables/index.ts");

type ExportedCredential = {
  workspaceId: string;
  serverId: string;
  name: string;
  authType: string;
  serviceType: string;
  url?: string;
  config: Record<string, unknown>;
  createdAt: string;
};

async function main() {
  process.env.ARC_ENV = process.env.ARC_ENV ?? "testing";

  const db = await database();
  const workspaceIds = await fetchWorkspaceIds(db);

  const latestByService = new Map<McpServiceType, ExportedCredential>();

  for (const workspaceId of workspaceIds) {
    const servers = await db["mcp-server"].query({
      IndexName: "byWorkspaceId",
      KeyConditionExpression: "workspaceId = :workspaceId",
      ExpressionAttributeValues: {
        ":workspaceId": workspaceId,
      },
    });

    for (const server of servers.items as McpServerRecord[]) {
      const serviceType = server.serviceType as McpServiceType | undefined;
      if (!serviceType || !MCP_SERVICES.includes(serviceType)) {
        continue;
      }
      if (!hasValidCredentials(server)) {
        continue;
      }

      const candidate: ExportedCredential = {
        workspaceId,
        serverId: parseServerId(workspaceId, server.pk),
        name: server.name,
        authType: server.authType,
        serviceType,
        url: server.url,
        config: server.config,
        createdAt: server.createdAt,
      };

      const current = latestByService.get(serviceType);
      if (!current || isAfter(candidate.createdAt, current.createdAt)) {
        latestByService.set(serviceType, candidate);
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    services: Object.fromEntries(
      MCP_SERVICES.map((service) => [service, latestByService.get(service) ?? null])
    ),
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf8");

  console.warn(
    `⚠️  ${OUTPUT_PATH} contains sensitive OAuth credentials. ` +
      `The tmp/ directory is gitignored, but delete this file when you're done.`
  );
  console.log(
    `✅ Exported MCP credentials to ${OUTPUT_PATH} (${countCredentials(
      latestByService
    )}/${MCP_SERVICES.length} services)`
  );
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

function hasValidCredentials(server: McpServerRecord): boolean {
  if (server.authType === "oauth") {
    const config = server.config as {
      accessToken?: string;
      expiresAt?: string | number;
    };
    if (!config.accessToken) {
      return false;
    }
    if (config.expiresAt === undefined) {
      return true;
    }
    const expiryTime =
      typeof config.expiresAt === "number"
        ? config.expiresAt
        : Date.parse(config.expiresAt);
    if (!Number.isFinite(expiryTime)) {
      return true;
    }
    return expiryTime > Date.now();
  }
  return false;
}

function parseServerId(workspaceId: string, pk: string): string {
  const prefix = `mcp-servers/${workspaceId}/`;
  if (!pk.startsWith(prefix)) {
    throw new Error(`Unexpected MCP server pk format: ${pk}`);
  }
  return pk.slice(prefix.length);
}

function isAfter(a: string, b: string): boolean {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  return Number.isFinite(aTime) && Number.isFinite(bTime) ? aTime > bTime : false;
}

function countCredentials(map: Map<McpServiceType, ExportedCredential>): number {
  return Array.from(map.values()).filter(Boolean).length;
}

main().catch((error) => {
  console.error("❌ Failed to export MCP credentials:", error);
  process.exit(1);
});
