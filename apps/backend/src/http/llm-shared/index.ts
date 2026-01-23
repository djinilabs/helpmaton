import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  Callback,
  Context,
  ScheduledEvent,
  SQSEvent,
} from "aws-lambda";


import { handler as agentDelegationQueueHandler } from "../../queues/agent-delegation-queue";
import { handler as agentEvalQueueHandler } from "../../queues/agent-eval-queue";
import { handler as agentScheduleQueueHandler } from "../../queues/agent-schedule-queue";
import { handler as agentTemporalGrainQueueHandler } from "../../queues/agent-temporal-grain-queue";
import { handler as botWebhookQueueHandler } from "../../queues/bot-webhook-queue";
import { handler as webhookQueueHandler } from "../../queues/webhook-queue";
import { handler as cleanupMemoryRetentionHandler } from "../../scheduled/cleanup-memory-retention";
import { handler as summarizeMemoryDailyHandler } from "../../scheduled/summarize-memory-daily";
import { handler as summarizeMemoryMonthlyHandler } from "../../scheduled/summarize-memory-monthly";
import { handler as summarizeMemoryQuarterlyHandler } from "../../scheduled/summarize-memory-quarterly";
import { handler as summarizeMemoryWeeklyHandler } from "../../scheduled/summarize-memory-weekly";
import { handler as summarizeMemoryYearlyHandler } from "../../scheduled/summarize-memory-yearly";
import { handler as streamsHandler } from "../any-api-streams-catchall";
import { handler as workspacesHandler } from "../any-api-workspaces";
import { handler as workspacesCatchallHandler } from "../any-api-workspaces-catchall";
import { handler as webhookHandler } from "../post-api-webhook-000workspaceId-000agentId-000key";

type AnyHandler = (
  event: unknown,
  context?: Context,
  callback?: Callback
) => unknown;

const queueHandlers = new Map<string, AnyHandler>([
  ["agent-temporal-grain-queue", agentTemporalGrainQueueHandler as AnyHandler],
  ["agent-delegation-queue", agentDelegationQueueHandler as AnyHandler],
  ["bot-webhook-queue", botWebhookQueueHandler as AnyHandler],
  ["agent-schedule-queue", agentScheduleQueueHandler as AnyHandler],
  ["agent-eval-queue", agentEvalQueueHandler as AnyHandler],
  ["webhook-queue", webhookQueueHandler as AnyHandler],
]);

const scheduleHandlers = new Map<string, AnyHandler>([
  ["summarize-memory-daily", summarizeMemoryDailyHandler as AnyHandler],
  ["summarize-memory-weekly", summarizeMemoryWeeklyHandler as AnyHandler],
  ["summarize-memory-monthly", summarizeMemoryMonthlyHandler as AnyHandler],
  ["summarize-memory-quarterly", summarizeMemoryQuarterlyHandler as AnyHandler],
  ["summarize-memory-yearly", summarizeMemoryYearlyHandler as AnyHandler],
  ["cleanup-memory-retention", cleanupMemoryRetentionHandler as AnyHandler],
]);

function isLambdaContext(value: unknown): value is Context {
  return (
    typeof value === "object" &&
    value !== null &&
    "functionName" in value &&
    "awsRequestId" in value
  );
}

function resolveContext(args: unknown[]): Context | undefined {
  if (isLambdaContext(args[1])) {
    return args[1];
  }
  if (isLambdaContext(args[2])) {
    return args[2];
  }
  return undefined;
}

function isSqsEvent(event: unknown): event is SQSEvent {
  const records = (event as SQSEvent | undefined)?.Records;
  return Boolean(records?.length && records[0]?.eventSource === "aws:sqs");
}

function isScheduledEvent(event: unknown): event is ScheduledEvent {
  const scheduled = event as ScheduledEvent | undefined;
  return (
    scheduled?.source === "aws.events" ||
    scheduled?.["detail-type"] === "Scheduled Event"
  );
}

function isHttpEvent(
  event: unknown
): event is APIGatewayProxyEvent | APIGatewayProxyEventV2 {
  if (!event || typeof event !== "object") {
    return false;
  }
  const httpEvent = event as
    | Partial<APIGatewayProxyEvent>
    | Partial<APIGatewayProxyEventV2>;
  const requestContext = httpEvent.requestContext as
    | APIGatewayProxyEvent["requestContext"]
    | APIGatewayProxyEventV2["requestContext"]
    | undefined;
  return Boolean(
    ("httpMethod" in httpEvent ? httpEvent.httpMethod : undefined) ||
      (requestContext &&
        "http" in requestContext &&
        requestContext.http?.method) ||
      (requestContext &&
        "httpMethod" in requestContext &&
        requestContext.httpMethod)
  );
}

function getQueueName(event: SQSEvent): string | undefined {
  const arn = event.Records?.[0]?.eventSourceARN;
  if (!arn) {
    return undefined;
  }
  const arnParts = arn.split(":");
  const resourcePart = arnParts[arnParts.length - 1] ?? "";
  const resourceSegments = resourcePart.split("/");
  return resourceSegments[resourceSegments.length - 1] || undefined;
}

function resolveQueueHandler(event: SQSEvent): AnyHandler | undefined {
  const queueName = getQueueName(event);
  if (!queueName) {
    return undefined;
  }
  return queueHandlers.get(queueName);
}

function resolveScheduleHandler(event: ScheduledEvent): AnyHandler | undefined {
  const resources = Array.isArray(event.resources) ? event.resources : [];
  const resourceText = resources.join(" ").toLowerCase();

  for (const [scheduleName, handler] of scheduleHandlers.entries()) {
    const scheduleId = scheduleName.toLowerCase();
    const schedulePascal = scheduleName
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")
      .toLowerCase();
    if (resourceText.includes(scheduleId) || resourceText.includes(schedulePascal)) {
      return handler;
    }
  }

  return undefined;
}

function getHttpPath(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): string {
  const httpEvent = event as
    | Partial<APIGatewayProxyEvent>
    | Partial<APIGatewayProxyEventV2>;
  const requestContext = httpEvent.requestContext as
    | APIGatewayProxyEvent["requestContext"]
    | APIGatewayProxyEventV2["requestContext"]
    | undefined;
  return (
    ("rawPath" in httpEvent ? httpEvent.rawPath : undefined) ||
    ("path" in httpEvent ? httpEvent.path : undefined) ||
    (requestContext && "http" in requestContext
      ? requestContext.http?.path
      : undefined) ||
    (requestContext && "path" in requestContext
      ? requestContext.path
      : undefined) ||
    ""
  );
}

function resolveHttpHandler(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): AnyHandler | undefined {
  const path = getHttpPath(event);

  if (path.startsWith("/api/streams")) {
    return streamsHandler as unknown as AnyHandler;
  }
  if (path.startsWith("/api/webhook/")) {
    return webhookHandler as unknown as AnyHandler;
  }
  if (path === "/api/workspaces") {
    return workspacesHandler as unknown as AnyHandler;
  }
  if (path.startsWith("/api/workspaces/")) {
    return workspacesCatchallHandler as unknown as AnyHandler;
  }

  return undefined;
}

function buildHttpNotFound() {
  return {
    statusCode: 404,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: "Route not found" }),
  };
}

export const handler = async (...args: unknown[]) => {
  const event = args[0];
  const context = resolveContext(args);
  const callback = typeof args[2] === "function" ? (args[2] as Callback) : undefined;

  if (isSqsEvent(event)) {
    const queueHandler = resolveQueueHandler(event);
    if (!queueHandler) {
      throw new Error("[llm-shared] Unknown SQS queue for event");
    }
    return await queueHandler(event, context, callback);
  }

  if (isScheduledEvent(event)) {
    const scheduleHandler = resolveScheduleHandler(event);
    if (!scheduleHandler) {
      throw new Error("[llm-shared] Unknown scheduled event");
    }
    return await scheduleHandler(event, context, callback);
  }

  if (isHttpEvent(event)) {
    const httpHandler = resolveHttpHandler(event);
    if (!httpHandler) {
      return buildHttpNotFound();
    }
    return await httpHandler(event, context, callback);
  }

  throw new Error("[llm-shared] Unsupported event type");
};
