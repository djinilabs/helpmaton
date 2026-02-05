#!/usr/bin/env tsx
/**
 * Credit a workspace in a PR deployment's DynamoDB by a given USD amount.
 *
 * Usage:
 *   pnpm add-credits-pr <pr-number> <workspace-id> <amount-usd> [--region eu-west-2] [--yes]
 *
 * Example:
 *   pnpm add-credits-pr 186 70a9418f-7343-481b-b632-aa672c0532b9 25 --yes
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
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const DEFAULT_REGION = "eu-west-2";
const PR_STACK_PREFIX = "HelpmatonStagingPR";
const NANO_USD_PER_USD = 1_000_000_000;

/** Convert USD to nano-dollars (same as backend creditConversions.toNanoDollars). */
function toNanoDollars(amountUsd: number): number {
  return Math.ceil(amountUsd * NANO_USD_PER_USD);
}

type CliArgs = {
  prNumber: string;
  workspaceId: string;
  amountUsd: number;
  region: string;
  yes: boolean;
};

function showUsage(): void {
  console.log(`
Usage: pnpm add-credits-pr <pr-number> <workspace-id> <amount-usd> [options]

Arguments:
  pr-number      PR number (stack: ${PR_STACK_PREFIX}<pr-number>)
  workspace-id   Workspace ID to credit
  amount-usd     Amount in USD to add (e.g. 25 or 10.50)

Options:
  --region <name>  AWS region (default: ${DEFAULT_REGION})
  --yes, -y        Skip confirmation prompt
  -h, --help       Show this help message

Example:
  pnpm add-credits-pr 186 70a9418f-7343-481b-b632-aa672c0532b9 25 --yes
`);
}

function parseArgs(argv: string[]): CliArgs | null {
  const args: string[] = [];
  let region = DEFAULT_REGION;
  let yes = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--region") {
      region = argv[i + 1] ?? region;
      i += 1;
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      showUsage();
      return null;
    }
    if (!arg.startsWith("-")) {
      args.push(arg);
    }
  }

  if (args.length < 3) {
    console.error("Error: pr-number, workspace-id and amount-usd are required");
    showUsage();
    return null;
  }

  const amountUsd = parseFloat(args[2]);
  if (Number.isNaN(amountUsd) || amountUsd <= 0) {
    console.error(`Error: Invalid amount-usd: ${args[2]}. Must be a positive number.`);
    return null;
  }

  return {
    prNumber: args[0],
    workspaceId: args[1],
    amountUsd,
    region,
    yes,
  };
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
    logicalCandidates.map((c) => c.toLowerCase())
  );
  const directMatch = resources.find((r) => {
    const logicalId = r.LogicalResourceId?.toLowerCase();
    return logicalId && candidateSet.has(logicalId);
  });
  if (directMatch) return directMatch;
  if (physicalHint) {
    return resources.find((r) => {
      const physical = r.PhysicalResourceId?.toLowerCase();
      return physical ? physical.includes(physicalHint.toLowerCase()) : false;
    });
  }
  return undefined;
}

function resolveTableName(
  resources: StackResourceSummary[],
  tableName: string
): string {
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
        .filter((e) => e.ResourceType === "AWS::DynamoDB::Table")
        .slice(0, 10)
        .map((e) => e.LogicalResourceId),
    });
    throw new Error(`Could not resolve DynamoDB table for ${tableName}`);
  }
  return resource.PhysicalResourceId;
}

function fromNanoDollars(nanoDollars: number): number {
  return nanoDollars / NANO_USD_PER_USD;
}

async function main(): Promise<void> {
  const cliArgs = parseArgs(process.argv.slice(2));
  if (!cliArgs) process.exit(process.argv.includes("--help") || process.argv.includes("-h") ? 0 : 1);

  const { prNumber, workspaceId, amountUsd, region, yes } = cliArgs;
  const stackName = `${PR_STACK_PREFIX}${prNumber}`;
  const workspacePk = `workspaces/${workspaceId}`;
  const amountNano = toNanoDollars(amountUsd);

  console.log("\nCrediting workspace in PR deployment");
  console.log(`  PR / Stack: ${prNumber} (${stackName})`);
  console.log(`  Workspace: ${workspaceId}`);
  console.log(`  Amount:    ${amountUsd.toFixed(2)} USD\n`);

  const cfClient = new CloudFormationClient({ region });
  let resources: StackResourceSummary[];
  try {
    resources = await listStackResources(cfClient, stackName);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("does not exist") || message.includes("NotFound")) {
      console.error(`Error: Stack ${stackName} not found. Ensure the PR is deployed.`);
    } else {
      console.error("Error listing stack resources:", message);
    }
    process.exit(1);
  }

  const workspaceTableName = resolveTableName(resources, "workspace");
  console.log(`  Workspace table: ${workspaceTableName}\n`);

  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

  const getResult = await docClient.send(
    new GetCommand({
      TableName: workspaceTableName,
      Key: { pk: workspacePk, sk: "workspace" },
    })
  );

  const workspace = getResult.Item as { creditBalance?: number } | undefined;
  if (!workspace) {
    console.error(`Error: Workspace ${workspaceId} not found in PR stack.`);
    process.exit(1);
  }

  const currentBalanceNano = workspace.creditBalance ?? 0;
  const currentBalanceUsd = fromNanoDollars(currentBalanceNano);
  console.log(`  Current balance: ${currentBalanceUsd.toFixed(2)} USD`);
  console.log(`  After credit:    ${(currentBalanceUsd + amountUsd).toFixed(2)} USD\n`);

  if (!yes) {
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question("Proceed? (y/N): ");
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  try {
    const updateResult = await docClient.send(
      new UpdateCommand({
        TableName: workspaceTableName,
        Key: { pk: workspacePk, sk: "workspace" },
        UpdateExpression: "SET creditBalance = creditBalance + :amount",
        ExpressionAttributeValues: { ":amount": amountNano },
        ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
        ReturnValues: "ALL_NEW",
      })
    );
    const updated = updateResult.Attributes as { creditBalance: number };
    const newBalanceUsd = fromNanoDollars(updated.creditBalance);
    console.log(`Successfully added ${amountUsd.toFixed(2)} USD.`);
    console.log(`New balance: ${newBalanceUsd.toFixed(2)} USD\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ConditionalCheckFailedException")) {
      console.error("Error: Workspace no longer exists or was modified.");
    } else {
      console.error("Error updating credits:", message);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
