# LanceDB Metadata Diagnosis

## Issue Summary

LanceDB search is retrieving records with null metadata values:

```json
{
  "conversationId": null,
  "workspaceId": null,
  "agentId": null
}
```

## Code Analysis

The metadata flow is as follows:

1. **Conversation Creation** (`conversationLogger.ts`)

   - Calls `writeToWorkingMemory(agentId, workspaceId, conversationId, messages)`
   - Passes `data.agentId`, `data.workspaceId`, and `conversationId`

2. **Memory Write** (`writeMemory.ts`)

   - Creates metadata object with these values:

   ```typescript
   const metadata = {
     conversationId,
     workspaceId,
     agentId,
   };
   ```

   - Adds metadata to each rawFact

3. **Queue Processing** (`agent-temporal-grain-queue/index.ts`)

   - Receives rawFacts via SQS
   - Generates embeddings
   - Stores records with metadata in LanceDB using JSON serialization

4. **Read Operations** (`readClient.ts`)
   - Queries LanceDB
   - Converts Arrow Struct metadata to plain object using JSON serialization

## Likely Root Causes

### 1. **Old Records** (Most Likely)

Records were written **before** the metadata fix was implemented. These old records have null values and need to be regenerated.

**Verification:**

- Check when the records were created
- Compare with the date of the metadata fix (December 2025)

**Solution:**

- Delete old vector databases and regenerate from conversations

### 2. **Parameter Values Are Actually Null**

The `agentId`, `workspaceId`, or `conversationId` parameters passed to `writeToWorkingMemory()` are null.

**Verification:**

- Check logs for: `[Conversation Logger] Parameter values being passed`
- Check logs for: `[Memory Write] Parameter values`

**Solution:**

- Fix the code that calls `writeToWorkingMemory()` to pass correct values

### 3. **LanceDB Schema Mismatch**

The table was created with a schema that doesn't properly support the metadata structure.

**Verification:**

- Check if the first records in the table had null metadata
- This would have set the schema incorrectly

**Solution:**

- Delete and recreate the vector database tables

## Diagnostic Steps

### Step 1: Check Write Logs

Run the diagnostic script:

```bash
./scripts/debug-lancedb-metadata.sh helpmaton-production
```

Look for these log patterns:

1. **In Conversation Logger:**

   ```
   [Conversation Logger] Parameter values being passed - agentId: "xxx", workspaceId: "xxx", conversationId: "xxx"
   ```

2. **In Memory Write:**

   ```
   [Memory Write] Parameter values - agentId: "xxx" (type: string), workspaceId: "xxx" (type: string), conversationId: "xxx" (type: string)
   ```

3. **In Queue Processor:**
   ```
   [Write Server] Created record with metadata: {
     "conversationId": "xxx",
     "workspaceId": "xxx",
     "agentId": "xxx"
   }
   ```

If **any** of these show null values, that's where the problem originates.

### Step 2: Check Read Logs

When searching memory, check for:

```
[Read Client] Sample row metadata value: {
  "conversationId": "xxx",
  "workspaceId": "xxx",
  "agentId": "xxx"
}
```

### Step 3: Compare Timestamps

Check if the records being read were created before or after the metadata fix.

## Solutions

### Solution 1: Regenerate Vector Databases (Recommended)

If the issue is old records with null metadata:

1. **Backup current conversations** (they're in DynamoDB, so they're safe)

2. **Delete old vector databases:**

   ```bash
   # List all vector databases
   aws s3 ls s3://helpmaton-vector-db-production/ --recursive | grep lancedb

   # Delete specific agent's databases (example)
   aws s3 rm s3://helpmaton-vector-db-production/agents/AGENT_ID/ --recursive
   ```

3. **Re-run memory writes:**
   - Use the `run-all-memory-summaries` script to regenerate
   - Or wait for new conversations to be created naturally

### Solution 2: Fix Parameter Passing

If logs show null parameter values:

1. Find where `writeToWorkingMemory()` is called with null values
2. Fix the code to pass correct values
3. Deploy the fix
4. Regenerate affected databases

### Solution 3: Manual Data Migration

If you need to preserve existing embeddings:

1. Read all records from LanceDB
2. Update metadata from conversation records in DynamoDB
3. Delete old tables
4. Re-insert records with correct metadata

This would require a custom migration script.

## Testing

### Unit Test

Create a test to verify metadata is properly stored and retrieved:

```typescript
test("metadata is preserved through write and read", async () => {
  const agentId = "test-agent-123";
  const workspaceId = "test-workspace-456";
  const conversationId = "test-conversation-789";

  // Write with metadata
  await writeToWorkingMemory(agentId, workspaceId, conversationId, [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there" },
  ]);

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Read and verify metadata
  const results = await query(agentId, "working", {});

  expect(results.length).toBeGreaterThan(0);
  expect(results[0].metadata).toMatchObject({
    conversationId,
    workspaceId,
    agentId,
  });
});
```

### Integration Test

1. Create a new conversation via API
2. Check CloudWatch logs for the write operation
3. Search memory via the agent's `search_memory` tool
4. Verify metadata is present in search results

## Monitoring

Add these CloudWatch Insights queries:

### Query 1: Check Write Metadata

```
fields @timestamp, @message
| filter @message like /\[Write Server\] Sample record metadata being inserted/
| sort @timestamp desc
| limit 20
```

### Query 2: Check Read Metadata

```
fields @timestamp, @message
| filter @message like /\[Read Client\] Sample row metadata value/
| sort @timestamp desc
| limit 20
```

### Query 3: Find Null Metadata

```
fields @timestamp, @message
| filter @message like /"conversationId": null/
| sort @timestamp desc
| limit 20
```

## Prevention

To prevent this issue in the future:

1. **Add validation** in `writeToWorkingMemory()` to throw if any parameter is null
2. **Add E2E tests** that verify metadata end-to-end
3. **Add metrics** to track records with null metadata
4. **Add alarms** if null metadata rate exceeds threshold

## Next Steps

1. Run the diagnostic script to check logs
2. Identify which scenario applies (old records, null parameters, or schema issue)
3. Apply the appropriate solution
4. Verify with new conversations
5. Update this document with findings
