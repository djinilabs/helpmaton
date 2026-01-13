import { boomify } from "@hapi/boom";
import * as Sentry from "@sentry/node";
import type { Context, SQSBatchResponse, SQSEvent } from "aws-lambda";

import { flushPostHog } from "./posthog";
import { flushSentry, ensureError } from "./sentry";
import {
  augmentContextWithCreditTransactions,
  commitContextTransactions,
  setTransactionBuffer,
  createTransactionBuffer,
  setCurrentSQSContext,
  clearCurrentSQSContext,
} from "./workspaceCreditContext";

/**
 * Wrapper for SQS Lambda functions with support for partial batch failures
 * Handles errors uniformly and reports server errors to Sentry
 *
 * When using partial batch failures:
 * - Handler should return an array of failed message IDs
 * - Successful messages will be deleted from the queue
 * - Failed messages will be retried based on queue configuration
 * - This prevents reprocessing of successfully processed messages
 *
 * Each SQS record is processed separately with its own context and transaction buffer.
 * Transactions are committed after successful processing of each record.
 */
export const handlingSQSErrors = (
  userHandler: (event: SQSEvent) => Promise<string[]>
): ((event: SQSEvent) => Promise<SQSBatchResponse>) => {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    try {
      const failedMessageIds: string[] = [];

      // Process each record separately with its own context
      for (const record of event.Records) {
        const messageId = record.messageId || "unknown";

        // Create a new context for this record
        const recordContext = {
          awsRequestId: messageId,
        } as Context;

        // Create a fresh transaction buffer for this record
        const recordBuffer = createTransactionBuffer();
        setTransactionBuffer(recordContext, recordBuffer);

        // Augment context with workspace credit transaction capability
        // Database will be lazy-loaded only if workspace credit transactions are actually used
        const augmentedContext = augmentContextWithCreditTransactions(
          recordContext
        );

        // Make context available to handler code via module-level storage
        setCurrentSQSContext(messageId, augmentedContext);

        // Create a single-record event for this record
        const singleRecordEvent: SQSEvent = {
          Records: [record],
        };

        try {
          // Process this record
          const recordFailedIds = await userHandler(singleRecordEvent);

          // If the handler returned this message as failed, track it
          if (recordFailedIds.includes(messageId)) {
            failedMessageIds.push(messageId);
          } else {
            // Record processed successfully - commit transactions
            try {
              await commitContextTransactions(recordContext, false);
              console.log(
                `[SQS Handler] Successfully processed and committed transactions for message ${messageId}`
              );
            } catch (commitError: unknown) {
              // Commit failures cause handler to fail (per user requirement)
              console.error(
                `[SQS Handler] Failed to commit credit transactions for message ${messageId}:`,
                commitError
              );
              // Mark this message as failed due to commit error
              failedMessageIds.push(messageId);

              // Re-throw to fail the handler
              const errorToThrow =
                commitError instanceof Error
                  ? commitError
                  : new Error(String(commitError));
              throw errorToThrow;
            }
          }
        } catch (error) {
          failedMessageIds.push(messageId);

          // Log error for this specific record
          const boomed = boomify(ensureError(error));
          console.error(
            `[SQS Handler] Error processing message ${messageId}:`,
            {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              boom: {
                statusCode: boomed.output.statusCode,
                message: boomed.message,
                isServer: boomed.isServer,
              },
            }
          );

          // Report to Sentry
          if (boomed.isServer) {
            Sentry.captureException(ensureError(error), {
              tags: {
                handler: "SQSFunction",
                statusCode: boomed.output.statusCode,
                messageId,
              },
              contexts: {
                event: {
                  messageId,
                  eventSource: record.eventSource,
                  awsRegion: record.awsRegion,
                },
              },
            });
          }

          // Continue processing other records even if this one failed
          // The error will be tracked in failedMessageIds
        } finally {
          // Always clear the context after processing this record
          clearCurrentSQSContext(messageId);
        }
      }

      // Return batch response with failed message IDs
      if (failedMessageIds.length > 0) {
        console.warn(
          `[SQS Handler] ${failedMessageIds.length} message(s) failed out of ${event.Records.length}:`,
          failedMessageIds
        );
        return {
          batchItemFailures: failedMessageIds.map((id) => ({
            itemIdentifier: id,
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
      const boomed = boomify(ensureError(error));

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
      // Flush analytics after all records are processed
      await Promise.all([flushPostHog(), flushSentry()]).catch(
        (flushErrors) => {
          console.error("[PostHog/Sentry] Error flushing events:", flushErrors);
        }
      );
    }
  };
};
