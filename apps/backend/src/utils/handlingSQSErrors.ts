import { boomify } from "@hapi/boom";
import type { Context, SQSBatchResponse, SQSEvent } from "aws-lambda";

import { isTimeoutError } from "../http/utils/requestTimeout";

import { flushPostHog } from "./posthog";
import { flushSentry, ensureError, Sentry } from "./sentry";
import {
  augmentContextWithCreditTransactions,
  commitContextTransactions,
  setTransactionBuffer,
  createTransactionBuffer,
  setCurrentSQSContext,
  clearCurrentSQSContext,
} from "./workspaceCreditContext";

/**
 * Extract queue name from SQS event source ARN
 * ARN format: arn:aws:sqs:region:account:queue-name
 */
function extractQueueName(eventSourceARN: string | undefined): string {
  if (!eventSourceARN) {
    return "unknown";
  }
  const parts = eventSourceARN.split(":");
  return parts[parts.length - 1] || "unknown";
}

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
  userHandler: (event: SQSEvent) => Promise<string[]>,
  options?: { handlerName?: string }
): ((event: SQSEvent) => Promise<SQSBatchResponse>) => {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const queueNames = event.Records.map((record) =>
      extractQueueName(record.eventSourceARN)
    );
    const uniqueQueueNames = [...new Set(queueNames)];
    const handlerName = options?.handlerName || userHandler.name || "unknown";
    const transactionName =
      uniqueQueueNames.length === 1
        ? `SQS ${uniqueQueueNames[0]}`
        : "SQS batch";

    return Sentry.startSpan(
      {
        op: "sqs.consume",
        name: transactionName,
        attributes: {
          "messaging.system": "aws.sqs",
          "messaging.operation": "process",
        },
      },
      async () => {
        Sentry.setTag("handler", "SQSFunction");
        Sentry.setTag("sqs.handler_name", handlerName);
        if (uniqueQueueNames.length > 0) {
          Sentry.setTag("sqs.queue_names", uniqueQueueNames.join(","));
        }
        Sentry.setContext("sqs", {
          queueNames: uniqueQueueNames,
          recordCount: event.Records.length,
          handlerName,
        });

        try {
          const failedMessageIds = new Set<string>();

          // Process each record separately with its own context
          await Promise.all(
            event.Records.map(async (record) => {
              const messageId = record.messageId || "unknown";
              const queueName = extractQueueName(record.eventSourceARN);

              return Sentry.withScope(async (scope) => {
                scope.setTag("sqs.message_id", messageId);
                scope.setTag("sqs.queue_name", queueName);
                scope.setContext("sqs.message", {
                  messageId,
                  queueName,
                  eventSource: record.eventSource,
                  awsRegion: record.awsRegion,
                });

                return Sentry.startSpan(
                  {
                    op: "sqs.message",
                    name: `SQS ${queueName}`,
                    attributes: {
                      "messaging.system": "aws.sqs",
                      "messaging.destination.name": queueName,
                      "messaging.message.id": messageId,
                    },
                  },
                  async () => {
                    const recordStartTime = Date.now();
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
                        failedMessageIds.add(messageId);
                      } else {
                        // Record processed successfully - commit transactions
                        try {
                          await commitContextTransactions(recordContext, false);
                          console.log(
                            `[SQS Handler] Successfully processed and committed transactions for message ${messageId}`
                          );
                        } catch (commitError: unknown) {
                          console.error(
                            `[SQS Handler] Failed to commit credit transactions for message ${messageId} in queue ${queueName}:`,
                            {
                              error:
                                commitError instanceof Error
                                  ? commitError.message
                                  : String(commitError),
                              stack:
                                commitError instanceof Error
                                  ? commitError.stack
                                  : undefined,
                              queueName,
                              messageId,
                              messageBody: record.body,
                            }
                          );
                          // Mark this message as failed due to commit error
                          failedMessageIds.add(messageId);

                          // Report commit errors but do not fail the entire batch
                          Sentry.captureException(ensureError(commitError), {
                            tags: {
                              handler: "SQSFunction",
                              statusCode: 500,
                              messageId,
                              queueName,
                            },
                            contexts: {
                              event: {
                                messageId,
                                queueName,
                                eventSource: record.eventSource,
                                awsRegion: record.awsRegion,
                                messageBody: record.body,
                              },
                            },
                          });
                        }
                      }
                    } catch (error) {
                      failedMessageIds.add(messageId);

                      const processingDurationMs = Date.now() - recordStartTime;
                      const timeoutContext = {
                        handlerName,
                        queueName,
                        messageId,
                        queueElement: record.body,
                        processingDurationMs,
                        startedAt: new Date(recordStartTime).toISOString(),
                        finishedAt: new Date().toISOString(),
                      };

                      // Log error for this specific record with queue name and message body
                      const boomed = boomify(ensureError(error));
                      console.error(
                        `[SQS Handler] Error processing message ${messageId} in queue ${queueName}:`,
                        {
                          error:
                            error instanceof Error ? error.message : String(error),
                          stack: error instanceof Error ? error.stack : undefined,
                          queueName,
                          messageId,
                          messageBody: record.body,
                          boom: {
                            statusCode: boomed.output.statusCode,
                            message: boomed.message,
                            isServer: boomed.isServer,
                          },
                        }
                      );

                      // Report to Sentry
                      if (isTimeoutError(error)) {
                        Sentry.captureException(ensureError(error), {
                          tags: {
                            handler: "SQSFunction",
                            statusCode: boomed.output.statusCode,
                            messageId,
                            queueName,
                            queueHandler: handlerName,
                            timeout: "true",
                          },
                          contexts: {
                            event: {
                              messageId,
                              queueName,
                              eventSource: record.eventSource,
                              awsRegion: record.awsRegion,
                              messageBody: record.body,
                            },
                            timeout: timeoutContext,
                          },
                        });
                      } else if (boomed.isServer) {
                        Sentry.captureException(ensureError(error), {
                          tags: {
                            handler: "SQSFunction",
                            statusCode: boomed.output.statusCode,
                            messageId,
                            queueName,
                            queueHandler: handlerName,
                          },
                          contexts: {
                            event: {
                              messageId,
                              queueName,
                              eventSource: record.eventSource,
                              awsRegion: record.awsRegion,
                              messageBody: record.body,
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
                );
              });
            })
          );

          // Return batch response with failed message IDs
          const failedMessageIdList = [...failedMessageIds];
          if (failedMessageIdList.length > 0) {
            const failedRecords = event.Records.filter((r) =>
              failedMessageIds.has(r.messageId || "unknown")
            );
            const failedQueueNames = failedRecords.map((r) =>
              extractQueueName(r.eventSourceARN)
            );
            console.warn(
              `[SQS Handler] ${failedMessageIdList.length} message(s) failed out of ${event.Records.length}:`,
              {
                failedMessageIds: failedMessageIdList,
                queueNames: failedQueueNames,
                failedMessages: failedRecords.map((r) => ({
                  messageId: r.messageId,
                  queueName: extractQueueName(r.eventSourceARN),
                  messageBody: r.body,
                })),
              }
            );
            return {
              batchItemFailures: failedMessageIdList.map((id) => ({
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

          // Always log the full error details with queue names and message bodies
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
              queueNames: uniqueQueueNames,
              messages: event.Records.map((r) => ({
                messageId: r.messageId,
                queueName: extractQueueName(r.eventSourceARN),
                messageBody: r.body,
              })),
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
              queueNames: uniqueQueueNames.join(","),
            },
            contexts: {
              event: {
                recordCount: event.Records.length,
                messageIds: event.Records.map((r) => r.messageId),
                queueNames: uniqueQueueNames,
                eventSource: event.Records[0]?.eventSource,
                awsRegion: event.Records[0]?.awsRegion,
                messages: event.Records.map((r) => ({
                  messageId: r.messageId,
                  queueName: extractQueueName(r.eventSourceARN),
                  messageBody: r.body,
                })),
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
      }
    );
  };
};
