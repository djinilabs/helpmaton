#!/usr/bin/env tsx
/**
 * Migration script for legacy transaction fields:
 * - amountMillionthUsd -> amountNanoUsd
 * - workspaceCreditsBeforeMillionthUsd -> workspaceCreditsBeforeNanoUsd
 * - workspaceCreditsAfterMillionthUsd -> workspaceCreditsAfterNanoUsd
 *
 * Legacy values are in millionths and are multiplied by 1,000 when migrated.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-transaction-fields.ts --stack HelpmatonProduction
 */

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  CloudFormationClient,
  ListStackResourcesCommand,
  type StackResourceSummary,
} from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const DEFAULT_REGION = "eu-west-2";
const DEFAULT_STACK_NAME = "HelpmatonProduction";

const LEGACY_FIELD_MAP = [
  {
    legacy: "amountMillionthUsd",
    modern: "amountNanoUsd",
  },
  {
    legacy: "workspaceCreditsBeforeMillionthUsd",
    modern: "workspaceCreditsBeforeNanoUsd",
  },
  {
    legacy: "workspaceCreditsAfterMillionthUsd",
    modern: "workspaceCreditsAfterNanoUsd",
  },
] as const;

type LegacyFieldMapping = (typeof LEGACY_FIELD_MAP)[number];

type CliArgs = {
  stackName: string;
  region: string;
};

function showUsage(): void {
  console.log("Usage: pnpm tsx scripts/migrate-transaction-fields.ts --stack <name>");
  console.log("");
  console.log("Options:");
  console.log(`  --stack <name>   CloudFormation stack (default: ${DEFAULT_STACK_NAME})`);
  console.log(`  --region <name>  AWS region (default: ${DEFAULT_REGION})`);
  console.log("  -h, --help       Show this help message");
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    stackName: DEFAULT_STACK_NAME,
    region: DEFAULT_REGION,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--stack") {
      args.stackName = argv[i + 1] ?? args.stackName;
      i += 1;
      continue;
    }
    if (arg === "--region") {
      args.region = argv[i + 1] ?? args.region;
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      showUsage();
      process.exit(0);
    }
  }

  return args;
}

function toPascalCase(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((segment) => (segment[0]?.toUpperCase() ?? "") + segment.slice(1))
    .join("");
}

async function listStackResources(
  client: CloudFormationClient,
  stackName: string
): Promise<StackResourceSummary[]> {
  const resources: StackResourceSummary[] = [];
  let nextToken: string | undefined;
  do {
    const response = await client.send(
      new ListStackResourcesCommand({
        StackName: stackName,
        NextToken: nextToken,
      })
    );
    resources.push(...(response.StackResourceSummaries ?? []));
    nextToken = response.NextToken;
  } while (nextToken);
  return resources;
}

function findResource(
  resources: StackResourceSummary[],
  logicalCandidates: string[],
  physicalHint?: string
): StackResourceSummary | undefined {
  const candidateSet = new Set(
    logicalCandidates.map((candidate) => candidate.toLowerCase())
  );
  const directMatch = resources.find((resource) => {
    const logicalId = resource.LogicalResourceId?.toLowerCase();
    return logicalId && candidateSet.has(logicalId);
  });
  if (directMatch) {
    return directMatch;
  }
  if (physicalHint) {
    return resources.find((resource) => {
      const physical = resource.PhysicalResourceId?.toLowerCase();
      return physical ? physical.includes(physicalHint.toLowerCase()) : false;
    });
  }
  return undefined;
}

async function resolveTableName(
  resources: StackResourceSummary[],
  tableName: string
): Promise<string> {
  const pascal = toPascalCase(tableName);
  const candidates = [
    tableName,
    pascal,
    `${pascal}Table`,
    `${pascal}DynamoDb`,
    `${pascal}DynamoDbTable`,
  ];
  const resource = findResource(resources, candidates, `-${tableName}`);
  if (!resource?.PhysicalResourceId) {
    console.error("[resolveTableName] Table not found", {
      tableName,
      candidates,
      sampleResources: resources
        .filter((entry) => entry.ResourceType === "AWS::DynamoDB::Table")
        .slice(0, 10)
        .map((entry) => entry.LogicalResourceId),
    });
    throw new Error(`Could not resolve DynamoDB table for ${tableName}`);
  }
  return resource.PhysicalResourceId;
}

async function confirmTableNames(tables: Record<string, string>): Promise<boolean> {
  console.log("\nResolved DynamoDB tables:");
  for (const [logical, physical] of Object.entries(tables)) {
    console.log(`  - ${logical}: ${physical}`);
  }
  console.log("\nThis migration will update ONLY the workspace-credit-transactions table.");
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question("Proceed with these table names? (y/N): ");
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function fetchWorkspaceIds(
  docClient: DynamoDBDocumentClient,
  permissionTable: string
): Promise<string[]> {
  const workspaceIds = new Set<string>();
  let lastKey: Record<string, unknown> | undefined;
  let page = 0;

  do {
    page += 1;
    console.log(`[Migration] Querying workspaces page ${page}`);
    const response = await docClient.send(
      new QueryCommand({
        TableName: permissionTable,
        IndexName: "byResourceTypeAndEntityId",
        KeyConditionExpression: "resourceType = :resourceType",
        ExpressionAttributeValues: {
          ":resourceType": "workspaces",
        },
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of response.Items ?? []) {
      const pk = item.pk;
      if (typeof pk === "string" && pk.startsWith("workspaces/")) {
        workspaceIds.add(pk.replace("workspaces/", ""));
      }
    }

    lastKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    console.log(
      `[Migration] Workspace scan page ${page} -> ${workspaceIds.size} workspaces`
    );
  } while (lastKey);

  return Array.from(workspaceIds.values());
}

type UpdatePlan = {
  updateExpression: string;
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, number>;
  legacyFieldCount: number;
};

function buildUpdatePlan(
  item: Record<string, unknown>
): UpdatePlan | null {
  const updateParts: string[] = [];
  const removeParts: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, number> = {};
  let legacyFieldCount = 0;

  for (const mapping of LEGACY_FIELD_MAP) {
    const legacyValue = item[mapping.legacy];
    if (legacyValue === undefined) {
      continue;
    }
    const numericValue = Number(legacyValue);
    if (!Number.isFinite(numericValue)) {
      console.warn(
        `[buildUpdatePlan] Skipping ${mapping.legacy} (non-numeric value)`,
        legacyValue
      );
      continue;
    }

    const migratedValue = Math.round(numericValue * 1000);
    const modernKey = `#${mapping.modern}`;
    const legacyKey = `#${mapping.legacy}`;
    const modernValue = `:${mapping.modern}`;

    expressionAttributeNames[modernKey] = mapping.modern;
    expressionAttributeNames[legacyKey] = mapping.legacy;
    expressionAttributeValues[modernValue] = migratedValue;

    updateParts.push(`${modernKey} = ${modernValue}`);
    removeParts.push(legacyKey);
    legacyFieldCount += 1;
  }

  if (updateParts.length === 0) {
    return null;
  }

  const updateExpression =
    `SET ${updateParts.join(", ")}` +
    (removeParts.length > 0 ? ` REMOVE ${removeParts.join(", ")}` : "");

  return {
    updateExpression,
    expressionAttributeNames,
    expressionAttributeValues,
    legacyFieldCount,
  };
}

async function migrateWorkspaceTransactions(options: {
  docClient: DynamoDBDocumentClient;
  transactionsTable: string;
  workspaceId: string;
}): Promise<{
  checked: number;
  updated: number;
  migratedFields: number;
}> {
  const { docClient, transactionsTable, workspaceId } = options;
  const pk = `workspaces/${workspaceId}`;
  let lastKey: Record<string, unknown> | undefined;
  let page = 0;
  let checked = 0;
  let updated = 0;
  let migratedFields = 0;

  do {
    page += 1;
    console.log(
      `[Migration] Querying transactions: workspace ${workspaceId}, page ${page}`
    );
    const response = await docClient.send(
      new QueryCommand({
        TableName: transactionsTable,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": pk,
        },
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of response.Items ?? []) {
      checked += 1;
      const updatePlan = buildUpdatePlan(item);
      if (!updatePlan) {
        continue;
      }

      const sk = item.sk;
      if (typeof sk !== "string") {
        console.warn(
          `[migrateWorkspaceTransactions] Skipping item without sk`,
          { pk }
        );
        continue;
      }

      await docClient.send(
        new UpdateCommand({
          TableName: transactionsTable,
          Key: {
            pk,
            sk,
          },
          UpdateExpression: updatePlan.updateExpression,
          ExpressionAttributeNames: updatePlan.expressionAttributeNames,
          ExpressionAttributeValues: updatePlan.expressionAttributeValues,
        })
      );
      console.log("[Migration] Updated transaction", {
        pk,
        sk,
        updateExpression: updatePlan.updateExpression,
        expressionAttributeNames: updatePlan.expressionAttributeNames,
        expressionAttributeValues: updatePlan.expressionAttributeValues,
      });
      updated += 1;
      migratedFields += updatePlan.legacyFieldCount;
    }

    lastKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    console.log(
      `[Migration] ${workspaceId}: page ${page} (checked ${checked}, updated ${updated})`
    );
  } while (lastKey);

  return { checked, updated, migratedFields };
}

async function migrateTransactionFields() {
  const args = parseArgs(process.argv.slice(2));
  const { stackName, region } = args;

  console.log(`[Migration] Stack: ${stackName}`);
  console.log(`[Migration] Region: ${region}`);

  const cloudFormation = new CloudFormationClient({ region });
  const resources = await listStackResources(cloudFormation, stackName);

  const permissionTable = await resolveTableName(resources, "permission");
  const transactionsTable = await resolveTableName(
    resources,
    "workspace-credit-transactions"
  );

  const confirmed = await confirmTableNames({
    permission: permissionTable,
    "workspace-credit-transactions": transactionsTable,
  });

  if (!confirmed) {
    console.log("[Migration] Aborted by user.");
    process.exit(0);
  }

  const ddbClient = new DynamoDBClient({ region });
  const docClient = DynamoDBDocumentClient.from(ddbClient);

  console.log("[Migration] Loading workspace IDs...");
  const workspaceIds = await fetchWorkspaceIds(docClient, permissionTable);
  console.log(`[Migration] Found ${workspaceIds.length} workspaces.`);

  let totalChecked = 0;
  let totalUpdated = 0;
  let totalMigratedFields = 0;

  for (const [index, workspaceId] of workspaceIds.entries()) {
    console.log(
      `[Migration] Processing workspace ${index + 1}/${workspaceIds.length}: ${workspaceId}`
    );
    const result = await migrateWorkspaceTransactions({
      docClient,
      transactionsTable,
      workspaceId,
    });

    totalChecked += result.checked;
    totalUpdated += result.updated;
    totalMigratedFields += result.migratedFields;
  }

  console.log("[Migration] Completed.");
  console.log(`[Migration] Records checked: ${totalChecked}`);
  console.log(`[Migration] Records updated: ${totalUpdated}`);
  console.log(`[Migration] Legacy fields migrated: ${totalMigratedFields}`);
}

migrateTransactionFields().catch((error) => {
  console.error("[Migration] Failed:", error);
  process.exit(1);
});
