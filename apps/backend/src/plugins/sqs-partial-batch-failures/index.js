/**
 * SQS Partial Batch Failures Plugin
 *
 * This plugin configures SQS event source mappings to report partial batch failures.
 * When enabled, Lambda functions can return a list of failed message IDs, allowing
 * successful messages to be deleted from the queue while failed ones are retried.
 *
 * This prevents reprocessing of successfully processed messages and improves
 * efficiency when handling SQS batches.
 */

/**
 * Converts a queue name to its Lambda function logical ID
 * @param {string} queueName - Queue name (e.g., "agent-temporal-grain-queue")
 * @returns {string} Lambda function logical ID (e.g., "AgentTemporalGrainQueueLambda")
 */
function queueNameToFunctionId(queueName) {
  if (!queueName) {
    return null;
  }

  // Convert kebab-case to PascalCase and add "Lambda" suffix
  // Example: "agent-temporal-grain-queue" -> "AgentTemporalGrainQueueLambda"
  const parts = queueName.split("-").filter(Boolean);
  const pascalCase = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");

  return `${pascalCase}Lambda`;
}

/**
 * Converts a queue name to its SQS resource logical ID
 * @param {string} queueName - Queue name (e.g., "agent-temporal-grain-queue")
 * @returns {string} SQS resource logical ID (e.g., "AgentTemporalGrainQueue")
 */
function queueNameToResourceId(queueName) {
  if (!queueName) {
    return null;
  }

  // Convert kebab-case to PascalCase
  // Example: "agent-temporal-grain-queue" -> "AgentTemporalGrainQueue"
  const parts = queueName.split("-").filter(Boolean);
  const pascalCase = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");

  return pascalCase;
}

/**
 * Converts a queue name to its event source mapping logical ID
 * @param {string} queueName - Queue name (e.g., "agent-temporal-grain-queue")
 * @returns {string} Event source mapping logical ID (e.g., "AgentTemporalGrainQueueLambdaEventSourceMapping")
 */
function queueNameToEventSourceMappingId(queueName) {
  if (!queueName) {
    return null;
  }

  const functionId = queueNameToFunctionId(queueName);
  return `${functionId}EventSourceMapping`;
}

/**
 * Parses the @queues pragma from the arc file
 * @param {Object} arc - Parsed arc file
 * @returns {Object[]} Array of queue configurations with name and options
 */
function parseQueuesPragma(arc) {
  const pragma = arc["queues"];

  if (!pragma) {
    return [];
  }

  // Architect parses the pragma into an array of arrays:
  // [["agent-temporal-grain-queue"], ["fifo", "true"], ["visibilityTimeout", "60"]]
  // We need to group these into queue configurations
  const queues = [];
  let currentQueue = null;

  if (Array.isArray(pragma)) {
    for (const item of pragma) {
      if (Array.isArray(item) && item.length >= 1) {
        const key = item[0];

        // If the key doesn't contain a hyphen and is a known queue option,
        // it's a property of the current queue
        if (
          currentQueue &&
          (key === "fifo" ||
            key === "visibilityTimeout" ||
            key === "messageRetentionPeriod" ||
            key === "maxRetries" ||
            key === "batchSize")
        ) {
          currentQueue.options = currentQueue.options || {};
          currentQueue.options[key] = item[1];
        } else {
          // It's a new queue name
          currentQueue = {
            name: key,
            options: {},
          };
          queues.push(currentQueue);
        }
      }
    }
  }

  return queues;
}

/**
 * Configures partial batch failures for SQS event source mappings
 * @param {Object} resources - CloudFormation resources
 * @param {string} queueName - Queue name
 */
function configurePartialBatchFailures(resources, queueName) {
  const eventSourceMappingId = queueNameToEventSourceMappingId(queueName);

  if (!resources[eventSourceMappingId]) {
    console.warn(
      `[sqs-partial-batch-failures] Event source mapping ${eventSourceMappingId} not found for queue ${queueName}`
    );
    return;
  }

  const eventSourceMapping = resources[eventSourceMappingId];

  // Enable partial batch failure reporting
  // This allows Lambda to return which messages failed and which succeeded
  if (!eventSourceMapping.Properties.FunctionResponseTypes) {
    eventSourceMapping.Properties.FunctionResponseTypes = [
      "ReportBatchItemFailures",
    ];
    console.log(
      `[sqs-partial-batch-failures] Enabled ReportBatchItemFailures for ${queueName}`
    );
  }
}

/**
 * Main plugin function that configures SQS event source mappings
 */
async function configureSqsPartialBatchFailures({
  cloudformation,
  inventory,
  arc,
}) {
  const resources = cloudformation.Resources || {};

  // Parse @queues pragma
  const arcData = arc || inventory?.arc || inventory?.app?.arc || {};

  console.log("[sqs-partial-batch-failures] Plugin execution started");

  const queues = parseQueuesPragma(arcData);

  if (queues.length === 0) {
    console.log(
      "[sqs-partial-batch-failures] No @queues pragma found, skipping configuration"
    );
    return cloudformation;
  }

  console.log(
    `[sqs-partial-batch-failures] Found ${queues.length} queue(s):`,
    queues.map((q) => q.name).join(", ")
  );

  // Configure each queue
  for (const queue of queues) {
    console.log(
      `[sqs-partial-batch-failures] Configuring queue: ${queue.name}`
    );
    configurePartialBatchFailures(resources, queue.name);
  }

  return cloudformation;
}

module.exports = {
  deploy: {
    start: configureSqsPartialBatchFailures,
  },
  package: configureSqsPartialBatchFailures,
};

// Export for testing
module.exports.configureSqsPartialBatchFailures =
  configureSqsPartialBatchFailures;
module.exports.queueNameToFunctionId = queueNameToFunctionId;
module.exports.queueNameToResourceId = queueNameToResourceId;
module.exports.queueNameToEventSourceMappingId =
  queueNameToEventSourceMappingId;
module.exports.parseQueuesPragma = parseQueuesPragma;



