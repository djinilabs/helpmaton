import { boomify } from "@hapi/boom";
import * as Sentry from "@sentry/node";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";

import { flushPostHog } from "./posthog";
import { flushSentry, ensureError } from "./sentry";

/**
 * Wrapper for SQS Lambda functions with support for partial batch failures
 * Handles errors uniformly and reports server errors to Sentry
 *
 * When using partial batch failures:
 * - Handler should return an array of failed message IDs
 * - Successful messages will be deleted from the queue
 * - Failed messages will be retried based on queue configuration
 * - This prevents reprocessing of successfully processed messages
 */
export const handlingSQSErrors = (
  userHandler: (event: SQSEvent) => Promise<string[]>
): ((event: SQSEvent) => Promise<SQSBatchResponse>) => {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    try {
      const failedMessageIds = await userHandler(event);

      // If there are failed messages, report them for retry
      if (failedMessageIds.length > 0) {
        console.warn(
          `[SQS Handler] ${failedMessageIds.length} message(s) failed out of ${event.Records.length}:`,
          failedMessageIds
        );

        return {
          batchItemFailures: failedMessageIds.map((messageId) => ({
            itemIdentifier: messageId,
          })),
        };
      }

      // All messages processed successfully
      console.log(
        `[SQS Handler] Successfully processed all ${event.Records.length} message(s)`
      );
      return {
        batchItemFailures: [],
      };
    } catch (error) {
      // Unexpected error - treat all messages as failed
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

      // Return all messages as failed for retry
      return {
        batchItemFailures: event.Records.map((record) => ({
          itemIdentifier: record.messageId,
        })),
      };
    } finally {
      await Promise.all([flushPostHog(), flushSentry()]).catch(
        (flushErrors) => {
          console.error("[PostHog/Sentry] Error flushing events:", flushErrors);
        }
      );
    }
  };
};
