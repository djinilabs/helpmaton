import { boomify } from "@hapi/boom";
import * as Sentry from "@sentry/node";
import type { SQSEvent } from "aws-lambda";

import { flushPostHog } from "./posthog";
import { flushSentry, ensureError } from "./sentry";

/**
 * Wrapper for SQS Lambda functions
 * Handles errors uniformly and reports server errors to Sentry
 */
export const handlingSQSErrors = (
  userHandler: (event: SQSEvent) => Promise<void>
): ((event: SQSEvent) => Promise<void>) => {
  return async (event: SQSEvent): Promise<void> => {
    try {
      await userHandler(event);
    } catch (error) {
      const boomed = boomify(error as Error);

      // Always log the full error details
      console.error("SQS function error:", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        boom: {
          statusCode: boomed.output.statusCode,
          message: boomed.message,
          isServer: boomed.isServer,
        },
        event: {
          recordCount: event.Records.length,
          messageIds: event.Records.map((r) => r.messageId),
        },
      });

      // SQS functions don't have user errors - all errors are server errors
      // Report all errors to Sentry
      console.error("SQS function server error details:", boomed);
      Sentry.captureException(ensureError(error), {
        tags: {
          handler: "SQSFunction",
          statusCode: boomed.output.statusCode,
          recordCount: event.Records.length,
        },
        contexts: {
          event: {
            recordCount: event.Records.length,
            messageIds: event.Records.map((r) => r.messageId),
            eventSource: event.Records[0]?.eventSource,
            awsRegion: event.Records[0]?.awsRegion,
          },
        },
      });

      // Re-throw the error so Lambda marks the invocation as failed
      throw error;
    } finally {
      await Promise.all([flushPostHog(), flushSentry()]).catch(
        (flushErrors) => {
          console.error("[PostHog/Sentry] Error flushing events:", flushErrors);
        }
      );
    }
  };
};
