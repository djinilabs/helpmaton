# Delegation Investigation: Missing Target Agent Conversations

## Issue Summary

In production, a conversation record shows delegations were tracked, but the target agent has no corresponding conversation record. This investigation identifies the root cause.

## Root Cause

The issue is in `apps/backend/src/http/utils/agentUtils.ts` in the `callAgentInternal` function, specifically around lines 1166-1240.

### Problem Flow

1. When an async delegation is processed by the queue, `callAgentInternal` is called (line 223 in `agent-delegation-queue/index.ts`)
2. `callAgentInternal` successfully calls the target agent and gets a response
3. It attempts to create a conversation record for the target agent (lines 1166-1211)
4. **The conversation creation is wrapped in a try-catch that silently swallows errors** (lines 1227-1240):
   ```typescript
   } catch (conversationError) {
     // Log but don't fail - conversation logging is best-effort
     console.error(
       "[callAgentInternal] Error creating conversation for target agent:",
       { error: ..., workspaceId, targetAgentId }
     );
   }
   return result.text; // Still returns successfully!
   ```
5. If `updateConversation` fails (database error, timeout, etc.), the error is logged but the function still returns successfully
6. The queue processor sees the call as successful and tracks the delegation in the calling agent's conversation via `trackDelegationSafely` (lines 278-286 in `agent-delegation-queue/index.ts`)
7. **Result**: Delegation is tracked in calling agent's conversation, but target agent has no conversation record

### Code Location

**File**: `apps/backend/src/http/utils/agentUtils.ts`
- Lines 1166-1211: Conversation creation attempt
- Lines 1227-1240: Error handling that silently swallows failures
- Line 1242: Function returns successfully even if conversation creation failed

## Impact

- **Data inconsistency**: Delegations are tracked in calling agent conversations, but target agent conversations are missing
- **Observability gap**: Cannot see what the target agent received or responded with
- **Cost tracking**: Target agent's token usage and costs are not recorded
- **Silent failures**: Errors in conversation creation are logged but don't surface as failures

## Proposed Fix

### Option 1: Make conversation creation failure propagate (Recommended)

Modify the error handling to re-throw the error if conversation creation fails, so the queue processor can handle it appropriately:

```typescript
} catch (conversationError) {
  // Log the error
  console.error(
    "[callAgentInternal] Error creating conversation for target agent:",
    {
      error:
        conversationError instanceof Error
          ? conversationError.message
          : String(conversationError),
      workspaceId,
      targetAgentId,
    }
  );
  
  // Re-throw to ensure the queue processor knows about the failure
  // This allows proper error handling and delegation status tracking
  throw new Error(
    `Failed to create conversation for target agent: ${
      conversationError instanceof Error
        ? conversationError.message
        : String(conversationError)
    }`
  );
}
```

**Pros**:
- Ensures data consistency
- Queue processor can mark delegation as failed
- Better observability

**Cons**:
- May cause delegations to fail if there are transient database issues
- Requires queue processor to handle this error gracefully

### Option 2: Create conversation before calling agent (Alternative)

Move conversation creation to happen before the agent call, so if it fails, the entire delegation fails before any work is done:

```typescript
// Create conversation record first (before calling agent)
const delegationConversationId = randomUUID();
try {
  await updateConversation(
    db,
    workspaceId,
    targetAgentId,
    delegationConversationId,
    [
      {
        role: "user",
        content: message,
      },
    ],
    undefined, // tokenUsage (will be updated after call)
    usesByok,
    undefined, // error
    undefined, // awsRequestId
    "test"
  );
} catch (conversationError) {
  // If we can't create the conversation, fail the entire delegation
  throw new Error(
    `Failed to create conversation for target agent: ${
      conversationError instanceof Error
        ? conversationError.message
        : String(conversationError)
    }`
  );
}

// Then proceed with agent call...
// After successful call, update the conversation with the response
```

**Pros**:
- Ensures conversation exists before work is done
- Prevents orphaned delegations

**Cons**:
- More complex flow
- May fail delegations due to transient database issues

### Option 3: Retry conversation creation (Most Robust)

Keep the current flow but add retry logic for conversation creation:

```typescript
// Retry conversation creation up to 3 times
let conversationCreated = false;
let lastError: Error | undefined;
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    await updateConversation(...);
    conversationCreated = true;
    break;
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));
    if (attempt < 2) {
      await sleep(1000 * (attempt + 1)); // Exponential backoff
    }
  }
}

if (!conversationCreated) {
  // Log and re-throw after retries exhausted
  console.error(
    "[callAgentInternal] Failed to create conversation after retries:",
    { workspaceId, targetAgentId, error: lastError }
  );
  throw new Error(
    `Failed to create conversation for target agent after retries: ${
      lastError?.message || "Unknown error"
    }`
  );
}
```

**Pros**:
- Handles transient failures gracefully
- Maintains data consistency
- Better resilience

**Cons**:
- More complex implementation
- Adds latency to delegation processing

## Recommendation

I recommend **Option 1** (make conversation creation failure propagate) because:
1. It's the simplest fix
2. It ensures data consistency
3. The queue processor already has error handling that can mark delegations as failed
4. It makes failures visible rather than silent

## Additional Considerations

1. **Error conversation creation**: There's also error conversation creation logic (lines 1363-1410) that has similar silent error handling. This should also be reviewed.

2. **Monitoring**: Add CloudWatch alarms for conversation creation failures to detect this issue proactively.

3. **Data recovery**: Consider a script to identify and backfill missing target agent conversations from delegation task records.

## Related Code

- `apps/backend/src/http/utils/agentUtils.ts` - `callAgentInternal` function
- `apps/backend/src/queues/agent-delegation-queue/index.ts` - Queue processor
- `apps/backend/src/utils/conversationLogger.ts` - `updateConversation` and `trackDelegation` functions
