#!/usr/bin/env tsx
import crypto from "crypto";

import {
  CloudFormationClient,
  DescribeStacksCommand,
  ListStackResourcesCommand,
} from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  GetQueueUrlCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { SignJWT } from "jose";

type StackOutput = {
  OutputKey?: string;
  OutputValue?: string;
};

type StackResource = {
  LogicalResourceId?: string;
  PhysicalResourceId?: string;
  ResourceType?: string;
};

type TestConfig = {
  prNumber: string;
  region: string;
  stackName: string;
  apiBaseUrl: string;
  streamBaseUrl: string;
  authSecret: string;
  userId: string;
  userEmail: string;
  creditsUsd: number;
  modelName: string;
  replyText: string;
  timeoutMs: number;
};

type ApiResponse<T> = {
  response: Response;
  data: T;
  rawText: string;
};

const DEFAULT_REGION = "eu-west-2";
const DEFAULT_MODEL_NAME = "google/gemini-2.5-flash";
const DEFAULT_REPLY_TEXT = "Hello from test";
const DEFAULT_CREDITS_USD = 25;
const DEFAULT_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_INTERVAL_MS = 10_000;
const QUERY_LIMIT_SMALL = 5;
const QUERY_LIMIT_LARGE = 10;

function parseArgs() {
  const args = process.argv.slice(2);
  const config: Record<string, string> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        config[key] = next;
        i += 1;
      } else {
        config[key] = "true";
      }
    }
  }

  return config;
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
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

function logStep(message: string) {
  console.log(`\n▶ ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateAccessToken(
  authSecret: string,
  userId: string,
  email: string,
  expirySeconds: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ userId, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + expirySeconds)
    .setIssuer("helpmaton")
    .setAudience("helpmaton-api")
    .sign(new TextEncoder().encode(authSecret));
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  allowedStatus: number[] = []
): Promise<ApiResponse<T>> {
  const response = await fetch(url, init);
  const rawText = await response.text();
  const isAllowed = allowedStatus.includes(response.status);
  if (!response.ok && !isAllowed) {
    throw new Error(
      `Request failed: ${init.method ?? "GET"} ${url} (${response.status}) ${rawText}`
    );
  }
  const data = rawText ? (JSON.parse(rawText) as T) : ({} as T);
  return { response, data, rawText };
}

async function fetchText(
  url: string,
  init: RequestInit,
  allowedStatus: number[] = []
): Promise<ApiResponse<string>> {
  const response = await fetch(url, init);
  const rawText = await response.text();
  const isAllowed = allowedStatus.includes(response.status);
  if (!response.ok && !isAllowed) {
    throw new Error(
      `Request failed: ${init.method ?? "GET"} ${url} (${response.status}) ${rawText}`
    );
  }
  return { response, data: rawText, rawText };
}

function buildSlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string
): string {
  const base = `v0:${timestamp}:${body}`;
  const digest = crypto
    .createHmac("sha256", signingSecret)
    .update(base)
    .digest("hex");
  return `v0=${digest}`;
}

async function getStackOutputs(
  client: CloudFormationClient,
  stackName: string
): Promise<StackOutput[]> {
  const response = await client.send(
    new DescribeStacksCommand({ StackName: stackName })
  );
  const stack = response.Stacks?.[0];
  if (!stack) {
    throw new Error(`Stack not found: ${stackName}`);
  }
  return stack.Outputs ?? [];
}

async function listStackResources(
  client: CloudFormationClient,
  stackName: string
): Promise<StackResource[]> {
  const resources: StackResource[] = [];
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

function pickOutputValue(outputs: StackOutput[], keys: string[]): string | null {
  for (const key of keys) {
    const match = outputs.find((output) => output.OutputKey === key);
    if (match?.OutputValue) {
      return match.OutputValue;
    }
  }
  return null;
}

function findResource(
  resources: StackResource[],
  logicalCandidates: string[],
  physicalHint?: string
): StackResource | undefined {
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
  resources: StackResource[],
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

async function resolveQueueUrl(
  resources: StackResource[],
  queueName: string,
  client: SQSClient
): Promise<string> {
  const pascal = toPascalCase(queueName);
  const candidates = [queueName, pascal, `${pascal}Queue`];
  const resource = findResource(resources, candidates, queueName);
  const physicalId = resource?.PhysicalResourceId;
  if (!physicalId) {
    console.error("[resolveQueueUrl] Queue not found", {
      queueName,
      candidates,
      sampleResources: resources
        .filter((entry) => entry.ResourceType === "AWS::SQS::Queue")
        .slice(0, 10)
        .map((entry) => entry.LogicalResourceId),
    });
    throw new Error(`Could not resolve SQS queue for ${queueName}`);
  }
  if (physicalId.startsWith("https://")) {
    return physicalId;
  }
  let queueNameValue: string;
  if (physicalId.startsWith("arn:")) {
    const arnParts = physicalId.split(":");
    if (arnParts.length < 6 || !arnParts[arnParts.length - 1]) {
      throw new Error(`Invalid SQS queue ARN for ${queueName}: ${physicalId}`);
    }
    queueNameValue = arnParts[arnParts.length - 1];
  } else {
    queueNameValue = physicalId;
  }
  const response = await client.send(
    new GetQueueUrlCommand({ QueueName: queueNameValue })
  );
  if (!response.QueueUrl) {
    throw new Error(`Queue URL not found for ${queueName}`);
  }
  return response.QueueUrl;
}

function extractAssistantReply(messages: unknown[]): string | null {
  for (const message of messages) {
    if (
      message &&
      typeof message === "object" &&
      "role" in message &&
      (message as { role?: string }).role === "assistant"
    ) {
      const content = (message as { content?: unknown }).content;
      if (typeof content === "string") {
        return content;
      }
      if (Array.isArray(content)) {
        const textPart = content.find(
          (part) =>
            part &&
            typeof part === "object" &&
            (part as { type?: string }).type === "text" &&
            typeof (part as { text?: string }).text === "string"
        ) as { text?: string } | undefined;
        if (textPart?.text) {
          return textPart.text;
        }
      }
    }
  }
  return null;
}

async function waitForConversation(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  workspaceId: string,
  agentId: string,
  conversationId: string,
  expectedType: string,
  expectedReply: string,
  timeoutMs: number
) {
  const pk = `conversations/${workspaceId}/${agentId}/${conversationId}`;
  const start = Date.now();
  let delayMs = POLL_INTERVAL_MS;
  while (Date.now() - start < timeoutMs) {
    const response = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk, sk: "conversation" },
      })
    );
    const item = response.Item as
      | {
          conversationType?: string;
          messages?: unknown[];
          error?: { message?: string };
        }
      | undefined;
    if (item) {
      if (item.error) {
        throw new Error(
          `Conversation ${conversationId} failed: ${item.error.message ?? "unknown"}`
        );
      }
      if (item.conversationType !== expectedType) {
        throw new Error(
          `Conversation ${conversationId} type mismatch: expected ${expectedType}, got ${item.conversationType ?? "unknown"}`
        );
      }
      const reply = extractAssistantReply(item.messages ?? []);
      if (reply && reply.includes(expectedReply)) {
        return item;
      }
    }
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(delayMs, remaining));
    delayMs = Math.min(delayMs * 2, MAX_POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for conversation ${conversationId}`);
}

async function waitForConversationByType(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  agentId: string,
  expectedType: string,
  expectedReply: string,
  timeoutMs: number
) {
  const start = Date.now();
  let delayMs = POLL_INTERVAL_MS;
  while (Date.now() - start < timeoutMs) {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "byAgentIdAndLastMessageAt",
        KeyConditionExpression: "agentId = :agentId",
        ExpressionAttributeValues: {
          ":agentId": agentId,
        },
        ScanIndexForward: false,
        Limit: QUERY_LIMIT_LARGE,
      })
    );
    const items = (response.Items ?? []) as Array<{
      conversationType?: string;
      messages?: unknown[];
      error?: { message?: string };
    }>;
    for (const item of items) {
      if (item.error) {
        continue;
      }
      if (item.conversationType !== expectedType) {
        continue;
      }
      const reply = extractAssistantReply(item.messages ?? []);
      if (reply && reply.includes(expectedReply)) {
        return item;
      }
    }
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(delayMs, remaining));
    delayMs = Math.min(delayMs * 2, MAX_POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${expectedType} conversation`);
}

async function waitForDelegationTask(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  workspaceId: string,
  callingAgentId: string,
  targetAgentId: string,
  timeoutMs: number
) {
  const gsi1pk = `workspace/${workspaceId}/agent/${callingAgentId}`;
  const start = Date.now();
  let delayMs = POLL_INTERVAL_MS;
  while (Date.now() - start < timeoutMs) {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "byWorkspaceAndAgent",
        KeyConditionExpression: "gsi1pk = :gsi1pk",
        ExpressionAttributeValues: {
          ":gsi1pk": gsi1pk,
        },
        ScanIndexForward: false,
        Limit: QUERY_LIMIT_SMALL,
      })
    );
    const items = (response.Items ?? []) as Array<{
      targetAgentId?: string;
      status?: string;
      error?: string;
      taskId?: string;
      pk?: string;
    }>;
    const match = items.find(
      (item) => item.targetAgentId === targetAgentId
    );
    if (match && match.status === "completed") {
      return match;
    }
    if (match && match.status === "failed") {
      throw new Error(
        `Delegation task failed: ${match.error ?? match.pk ?? "unknown"}`
      );
    }
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(delayMs, remaining));
    delayMs = Math.min(delayMs * 2, MAX_POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for delegation task");
}

async function waitForEvalResult(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  conversationId: string,
  judgeId: string,
  timeoutMs: number
) {
  const start = Date.now();
  let delayMs = POLL_INTERVAL_MS;
  while (Date.now() - start < timeoutMs) {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "byConversationId",
        KeyConditionExpression: "conversationId = :conversationId",
        ExpressionAttributeValues: {
          ":conversationId": conversationId,
        },
        ScanIndexForward: false,
        Limit: QUERY_LIMIT_SMALL,
      })
    );
    const items = (response.Items ?? []) as Array<{
      judgeId?: string;
      reasoningTrace?: string;
    }>;
    if (items.find((item) => item.judgeId === judgeId)) {
      return items;
    }
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(delayMs, remaining));
    delayMs = Math.min(delayMs * 2, MAX_POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for eval result");
}

async function waitForCostTransaction(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  workspaceId: string,
  conversationId: string,
  timeoutMs: number
) {
  const pk = `workspaces/${workspaceId}`;
  const start = Date.now();
  let delayMs = POLL_INTERVAL_MS;
  while (Date.now() - start < timeoutMs) {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":conversationId": conversationId,
        },
        FilterExpression: "conversationId = :conversationId",
        ScanIndexForward: false,
        Limit: QUERY_LIMIT_LARGE,
      })
    );
    if ((response.Items ?? []).length > 0) {
      return response.Items;
    }
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(delayMs, remaining));
    delayMs = Math.min(delayMs * 2, MAX_POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for cost transaction");
}

async function waitForMemoryRecord(
  apiBaseUrl: string,
  authHeader: Record<string, string>,
  workspaceId: string,
  agentId: string,
  expectedContent: string,
  timeoutMs: number
) {
  const start = Date.now();
  let delayMs = POLL_INTERVAL_MS;
  while (Date.now() - start < timeoutMs) {
    const response = await fetchJson<{
      records: Array<{ content?: string }>;
    }>(
      `${apiBaseUrl}/api/workspaces/${workspaceId}/agents/${agentId}/memory?grain=working&queryText=${encodeURIComponent(
        expectedContent
      )}&maxResults=${QUERY_LIMIT_SMALL}`,
      {
        method: "GET",
        headers: {
          ...authHeader,
        },
      }
    );
    if (
      response.data.records?.some((record) =>
        record.content?.includes(expectedContent)
      )
    ) {
      return;
    }
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(delayMs, remaining));
    delayMs = Math.min(delayMs * 2, MAX_POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for memory record");
}

async function main() {
  const args = parseArgs();
  const prNumber =
    args.pr ??
    args.prNumber ??
    process.env.PR_NUMBER ??
    process.env.GITHUB_PR_NUMBER;
  const region = args.region ?? process.env.AWS_REGION ?? DEFAULT_REGION;
  const authSecret = requireValue(process.env.AUTH_SECRET, "AUTH_SECRET");
  const modelName = args.model ?? DEFAULT_MODEL_NAME;
  const replyText = args.reply ?? DEFAULT_REPLY_TEXT;
  const creditsUsd = args.credits
    ? Number(args.credits)
    : DEFAULT_CREDITS_USD;
  const timeoutMs = args.timeout
    ? Number(args.timeout)
    : DEFAULT_TIMEOUT_MS;
  const keepResources =
    process.env.KEEP_STAGING_TEST_RESOURCES === "true" ||
    process.env.KEEP_STAGING_TEST_RESOURCES === "1";

  if (!prNumber) {
    throw new Error("PR number is required (use --pr <number>)");
  }
  if (Number.isNaN(creditsUsd) || creditsUsd <= 0) {
    throw new Error("credits must be a positive number");
  }

  const stackName = `HelpmatonStagingPR${prNumber}`;
  const cfClient = new CloudFormationClient({ region });
  const sqsClient = new SQSClient({ region });
  const ddbClient = new DynamoDBClient({ region });
  const docClient = DynamoDBDocumentClient.from(ddbClient);

  logStep(`Loading CloudFormation outputs for ${stackName}`);
  const outputs = await getStackOutputs(cfClient, stackName);
  const resources = await listStackResources(cfClient, stackName);

  const apiBaseUrl = normalizeUrl(
    process.env.API_BASE_URL ??
      pickOutputValue(outputs, ["ApiUrl", "RestApiUrl", "HttpApiUrl"]) ??
      ""
  );
  const streamBaseUrl = normalizeUrl(
    process.env.STREAMING_FUNCTION_URL ??
      pickOutputValue(outputs, ["StreamingFunctionUrl"]) ??
      ""
  );

  if (!apiBaseUrl) {
    throw new Error("API base URL not found in outputs");
  }
  if (!streamBaseUrl) {
    throw new Error("Streaming function URL not found in outputs");
  }

  logStep(`Resolved API base URL: ${apiBaseUrl}`);
  logStep(`Resolved stream URL: ${streamBaseUrl}`);

  const tables = {
    workspace: await resolveTableName(resources, "workspace"),
    conversations: await resolveTableName(resources, "agent-conversations"),
    delegation: await resolveTableName(resources, "agent-delegation-tasks"),
    evalResults: await resolveTableName(resources, "agent-eval-result"),
    creditTransactions: await resolveTableName(
      resources,
      "workspace-credit-transactions"
    ),
  };

  const queueUrls = {
    schedule: await resolveQueueUrl(resources, "agent-schedule-queue", sqsClient),
    temporal: await resolveQueueUrl(
      resources,
      "agent-temporal-grain-queue",
      sqsClient
    ),
  };

  const userId =
    process.env.STAGING_TEST_USER_ID ??
    `staging-pr-${prNumber}-${crypto.randomUUID()}`;
  const userEmail =
    process.env.STAGING_TEST_USER_EMAIL ??
    `staging-pr-${prNumber}-${Date.now()}@helpmaton.com`;

  const accessTokenExpirySeconds = Math.min(
    60 * 60,
    Math.max(15 * 60, Math.ceil(timeoutMs / 1000) + 300)
  );
  const accessToken = await generateAccessToken(
    authSecret,
    userId,
    userEmail,
    accessTokenExpirySeconds
  );
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  let workspaceId: string | undefined;
  try {
    logStep("Creating workspace");
    const workspaceResponse = await fetchJson<{ id: string }>(
      `${apiBaseUrl}/api/workspaces`,
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `staging-pr-${prNumber}-agent-tests`,
          description: "Automated staging agent tests",
        }),
      }
    );
    workspaceId = workspaceResponse.data.id;

    logStep(`Created workspace ${workspaceId}`);

    logStep("Creating agents");
    const helloAgentResponse = await fetchJson<{ id: string }>(
      `${apiBaseUrl}/api/workspaces/${workspaceId}/agents`,
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Hello Agent",
          systemPrompt: `Always respond with exactly: ${replyText}`,
          modelName,
        }),
      }
    );
    const helloAgentId = helloAgentResponse.data.id;

  const delegateAgentResponse = await fetchJson<{ id: string }>(
    `${apiBaseUrl}/api/workspaces/${workspaceId}/agents`,
    {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Delegated Agent",
        systemPrompt: `Always respond with exactly: ${replyText}`,
        modelName,
      }),
    }
  );
  const delegateAgentId = delegateAgentResponse.data.id;

  const delegatorAgentResponse = await fetchJson<{ id: string }>(
    `${apiBaseUrl}/api/workspaces/${workspaceId}/agents`,
    {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Delegator Agent",
        systemPrompt:
          `You must call call_agent_async with agentId "${delegateAgentId}" and message "Hello". ` +
          `After the tool returns, respond with exactly: ${replyText}`,
        modelName,
      }),
    }
  );
  const delegatorAgentId = delegatorAgentResponse.data.id;

  logStep("Enabling delegation");
  await fetchJson(
    `${apiBaseUrl}/api/workspaces/${workspaceId}/agents/${delegatorAgentId}`,
    {
      method: "PUT",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        delegatableAgentIds: [delegateAgentId],
      }),
    }
  );

    logStep("Creating stream server config");
    const streamConfigResponse = await fetchJson<{ secret: string }>(
      `${apiBaseUrl}/api/workspaces/${workspaceId}/agents/${helloAgentId}/stream-servers`,
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          allowedOrigins: ["*"],
        }),
      }
    );
    const streamSecret = streamConfigResponse.data.secret;

    logStep("Creating webhook key");
    const webhookKeyResponse = await fetchJson<{ key: string }>(
      `${apiBaseUrl}/api/workspaces/${workspaceId}/agents/${helloAgentId}/keys`,
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Webhook key",
          type: "webhook",
        }),
      }
    );
    const webhookKey = webhookKeyResponse.data.key;

    logStep("Creating eval judge");
    const evalJudgeResponse = await fetchJson<{ id: string }>(
      `${apiBaseUrl}/api/workspaces/${workspaceId}/agents/${helloAgentId}/eval-judges`,
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Staging Eval Judge",
          modelName,
          evalPrompt:
            "Summarize the assistant response and score goal completion (0-100).",
          provider: "openrouter",
          enabled: true,
          samplingProbability: 100,
        }),
      }
    );
    const evalJudgeId = evalJudgeResponse.data.id;

    logStep("Setting workspace credits in DynamoDB");
    const creditBalance = Math.round(creditsUsd * 1_000_000);
    const workspacePk = `workspaces/${workspaceId}`;
    await docClient.send(
      new UpdateCommand({
        TableName: tables.workspace,
        Key: { pk: workspacePk, sk: "workspace" },
        UpdateExpression: "SET creditBalance = :balance, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":balance": creditBalance,
          ":updatedAt": new Date().toISOString(),
        },
      })
    );
    const workspaceCheck = await docClient.send(
      new GetCommand({
        TableName: tables.workspace,
        Key: { pk: workspacePk, sk: "workspace" },
      })
    );
    const storedBalance = (workspaceCheck.Item as { creditBalance?: number })
      ?.creditBalance;
    if (storedBalance !== creditBalance) {
      throw new Error(
        `Failed to set credits. Expected ${creditBalance} (number), got ${
          storedBalance ?? "unknown"
        } (type: ${typeof storedBalance})`
      );
    }

    logStep("Testing /api/workspaces/:workspaceId/agents/:agentId/test");
    const testConversationId = crypto.randomUUID();
    await fetchText(
      `${apiBaseUrl}/api/workspaces/${workspaceId}/agents/${helloAgentId}/test`,
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/json",
          "X-Conversation-Id": testConversationId,
        },
        body: JSON.stringify([{ role: "user", content: "Hello" }]),
      }
    );
    await waitForConversation(
      docClient,
      tables.conversations,
      workspaceId,
      helloAgentId,
      testConversationId,
      "test",
      replyText,
      timeoutMs
    );

    logStep("Testing streaming endpoint");
    const streamConversationId = crypto.randomUUID();
    await fetchText(
      `${streamBaseUrl}/api/streams/${workspaceId}/${helloAgentId}/${streamSecret}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Conversation-Id": streamConversationId,
          Origin: "https://app.helpmaton.com",
        },
        body: JSON.stringify([{ role: "user", content: "Hello" }]),
      }
    );
    await waitForConversation(
      docClient,
      tables.conversations,
      workspaceId,
      helloAgentId,
      streamConversationId,
      "stream",
      replyText,
      timeoutMs
    );

    logStep("Testing webhook endpoint");
    const webhookResponse = await fetchText(
      `${apiBaseUrl}/api/webhook/${workspaceId}/${helloAgentId}/${webhookKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: "Hello",
      }
    );
    if (!webhookResponse.data.includes(replyText)) {
      throw new Error("Webhook response did not contain expected reply");
    }
    await waitForConversationByType(
      docClient,
      tables.conversations,
      helloAgentId,
      "webhook",
      replyText,
      timeoutMs
    );

    logStep("Testing async delegation via SQS");
    const delegatorConversationId = crypto.randomUUID();
    await fetchText(
      `${apiBaseUrl}/api/workspaces/${workspaceId}/agents/${delegatorAgentId}/test`,
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/json",
          "X-Conversation-Id": delegatorConversationId,
        },
        body: JSON.stringify([{ role: "user", content: "Hello" }]),
      }
    );
    await waitForDelegationTask(
      docClient,
      tables.delegation,
      workspaceId,
      delegatorAgentId,
      delegateAgentId,
      timeoutMs
    );
    await waitForConversationByType(
      docClient,
      tables.conversations,
      delegateAgentId,
      "test",
      replyText,
      timeoutMs
    );

    logStep("Testing eval queue");
    await waitForEvalResult(
      docClient,
      tables.evalResults,
      testConversationId,
      evalJudgeId,
      timeoutMs
    );

    logStep("Testing schedule queue via direct SQS message");
    const scheduleResponse = await fetchJson<{ id: string }>(
      `${apiBaseUrl}/api/workspaces/${workspaceId}/agents/${helloAgentId}/schedules`,
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Staging schedule",
          cronExpression: "0 0 * * *",
          prompt: "Hello",
          enabled: true,
        }),
      }
    );
    const scheduleId = scheduleResponse.data.id;
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrls.schedule,
        MessageBody: JSON.stringify({
          scheduleId,
          workspaceId,
          agentId: helloAgentId,
        }),
      })
    );
    await waitForConversationByType(
      docClient,
      tables.conversations,
      helloAgentId,
      "scheduled",
      replyText,
      timeoutMs
    );

    logStep("Testing temporal grain queue via direct SQS message");
    const factId = crypto.randomUUID();
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrls.temporal,
        MessageBody: JSON.stringify({
          operation: "insert",
          agentId: helloAgentId,
          temporalGrain: "working",
          workspaceId,
          data: {
            rawFacts: [
              {
                id: factId,
                content: "staging test fact",
                timestamp: new Date().toISOString(),
                metadata: { source: "staging-test" },
              },
            ],
          },
        }),
        MessageGroupId: `${helloAgentId}-working`,
        MessageDeduplicationId: crypto.randomUUID(),
      })
    );

    logStep("Verifying memory write via API");
    await waitForMemoryRecord(
      apiBaseUrl,
      authHeader,
      workspaceId,
      helloAgentId,
      "staging test fact",
      timeoutMs
    );

    logStep("Verifying cost verification queue");
    await waitForCostTransaction(
      docClient,
      tables.creditTransactions,
      workspaceId,
      testConversationId,
      timeoutMs
    );

    console.log("ℹ️  Skipping Slack bot-webhook test (disabled in CI).");

    console.log("\n✅ Staging agent tests completed successfully.");
  } finally {
    if (workspaceId && !keepResources) {
      logStep(`Cleaning up workspace ${workspaceId}`);
      try {
        await fetchText(
          `${apiBaseUrl}/api/workspaces/${workspaceId}`,
          {
            method: "DELETE",
            headers: {
              ...authHeader,
            },
          },
          [204]
        );
      } catch (error) {
        console.warn("⚠️  Failed to cleanup workspace:", error);
      }
    } else if (workspaceId) {
      console.log(
        `ℹ️  KEEP_STAGING_TEST_RESOURCES set; leaving workspace ${workspaceId}`
      );
    }
  }
}

main().catch((error) => {
  console.error("❌ Staging agent tests failed:", error);
  process.exit(1);
});
