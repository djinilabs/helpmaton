# Delegation Retry Behavior and Failure Cycle Prevention

## Retry Mechanisms

### 1. Application-Level Retries (in `processDelegationTask`)

**Location**: `apps/backend/src/queues/agent-delegation-queue/index.ts`

- **Max Attempts**: 4 total (1 initial + 3 retries)
- **Backoff Strategy**: Exponential with jitter
  - Attempt 1: 1s delay
  - Attempt 2: 2s delay  
  - Attempt 3: 4s delay
  - Attempt 4: 8s delay (capped at 10s max)
- **Retry Condition**: Only retries if `isRetryableError()` returns `true`
- **Scope**: Retries the entire `callAgentInternal` call, including conversation creation

### 2. SQS-Level Retries

**Location**: AWS SQS queue configuration

- **Current Configuration**: No `maxReceiveCount` or dead letter queue configured
- **Behavior**: When a message is returned as failed (via `batchItemFailures`), SQS will retry it
- **Risk**: Without a dead letter queue, messages could retry indefinitely if errors persist

## Error Classification

### Retryable Errors (will be retried)

The `isRetryableError()` function classifies these as retryable:

1. **Timeouts**: Any error message containing "timeout"
2. **Network Errors**: "network", "connection", "econnrefused", "enotfound"
3. **Rate Limits**: "rate limit", "429"
4. **Server Errors**: "500", "502", "503", "504"
5. **DynamoDB Throttling** (NEW):
   - Error names: "ProvisionedThroughputExceeded", "Throttling", "Throttled"
   - Error messages: "throttling", "throttled", "throughput", "too many requests"
6. **DynamoDB Service Errors** (NEW):
   - Error names: "ServiceUnavailable", "InternalServerError"
   - Error messages: "service unavailable", "internal server error"

### Non-Retryable Errors (fail immediately)

- Validation errors
- Not found errors
- Permission errors
- Other permanent failures

## Failure Cycle Prevention

### Problem

Before the fix, if conversation creation failed with a non-retryable error:
1. Application-level: Failed immediately (not retried)
2. Queue processor: Marked task as "failed"
3. SQS: Retried the message indefinitely (no dead letter queue)
4. **Result**: Infinite retry cycle for permanent failures

### Solution

**1. Improved Error Classification**

Updated `isRetryableError()` to recognize DynamoDB throttling and service errors:
- DynamoDB throttling errors are now classified as retryable (transient)
- DynamoDB service errors are now classified as retryable (transient)
- Permanent errors (validation, permissions) still fail immediately

**2. Preserved Error Metadata**

When conversation creation fails, we now:
- Preserve the original error name/type
- Include error in `cause` property
- This allows proper error classification by `isRetryableError()`

### Result

- **Transient errors** (throttling, network issues): Retried up to 4 times at application level
- **Permanent errors** (validation, permissions): Fail immediately, marked as failed
- **SQS retries**: Still happen, but with proper error classification, most transient errors are resolved at application level

## Recommendations

### 1. Add Dead Letter Queue (Future Improvement)

Consider adding a dead letter queue to the SQS configuration:

```arc
agent-delegation-queue
  timeout 300
  deadLetterQueue agent-delegation-queue-dlq
  maxReceiveCount 5
```

This would:
- Prevent infinite retries
- Capture permanently failed messages for investigation
- Provide visibility into persistent failures

### 2. Monitoring

Add CloudWatch alarms for:
- High failure rates in delegation queue
- Messages in dead letter queue (if added)
- Conversation creation failures

### 3. Error Tracking

The current implementation:
- Logs all errors with full context
- Tracks delegations with "failed" status
- Reports to Sentry via `handlingSQSErrors`

## Code Changes Summary

### File: `apps/backend/src/queues/agent-delegation-queue/index.ts`

**Updated `isRetryableError()` function**:
- Added DynamoDB throttling error detection
- Added DynamoDB service error detection
- Checks both error name and message for better coverage

### File: `apps/backend/src/http/utils/agentUtils.ts`

**Updated conversation creation error handling**:
- Preserves original error name/type
- Includes error in `cause` property
- Better error context for classification

## Testing Recommendations

1. **Test transient errors**: Verify DynamoDB throttling errors are retried
2. **Test permanent errors**: Verify validation errors fail immediately
3. **Test error preservation**: Verify error metadata is preserved correctly
4. **Monitor production**: Watch for retry patterns and failure rates
