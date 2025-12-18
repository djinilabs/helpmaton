# LanceDB Metadata Flattening Solution

## The Real Problem

After deleting the databases and creating fresh insertions with correct metadata values, we discovered the true root cause:

**LanceDB doesn't properly handle nested objects in metadata fields.**

### Evidence

Write logs showed correct data:

```json
{
  "conversationId": "def5d237-1ed4-4c0e-88c4-d2d966e6131f",
  "workspaceId": "98b89495-b885-4953-af08-f7ff802b75e6",
  "agentId": "dde6e29d-d383-4101-86c5-addefafc0740"
}
```

But read logs showed null values:

```json
{
  "conversationId": null,
  "workspaceId": null,
  "agentId": null
}
```

This proved the data was being **written correctly** but **lost during storage/retrieval**.

## Root Cause

The original structure stored metadata as a **nested object**:

```typescript
{
  id: "...",
  content: "...",
  vector: [...],
  timestamp: "...",
  metadata: {                    // <-- Nested object
    conversationId: "...",
    workspaceId: "...",
    agentId: "..."
  }
}
```

LanceDB uses Apache Arrow format internally, and nested objects in metadata fields are not properly preserved through the storage/retrieval cycle. The fields exist in the schema but their values become null.

## The Solution: Flatten the Structure

Instead of nesting metadata, store fields at the **top level** of the record:

```typescript
{
  id: "...",
  content: "...",
  vector: [...],
  timestamp: "...",
  conversationId: "...",         // <-- Top level
  workspaceId: "...",            // <-- Top level
  agentId: "..."                 // <-- Top level
}
```

## Implementation

### Write Path (Queue Processor)

**Before:**

```typescript
return {
  id: r.id,
  content: r.content,
  vector: r.embedding,
  timestamp: r.timestamp,
  metadata: {
    conversationId: String(parsed.conversationId || ""),
    workspaceId: String(parsed.workspaceId || ""),
    agentId: String(parsed.agentId || ""),
  },
};
```

**After:**

```typescript
return {
  id: r.id,
  content: r.content,
  vector: r.embedding,
  timestamp: r.timestamp,
  conversationId: String(parsed.conversationId || ""),
  workspaceId: String(parsed.workspaceId || ""),
  agentId: String(parsed.agentId || ""),
};
```

### Read Path (Read Client)

The read client now:

1. Reads metadata fields from top level
2. Reconstructs a metadata object for backward compatibility
3. Falls back to nested metadata for legacy tables

```typescript
// Read from top level
const rowAny = row as any;
const metadata: Record<string, unknown> = {
  conversationId: rowAny.conversationId || row.metadata?.conversationId || null,
  workspaceId: rowAny.workspaceId || row.metadata?.workspaceId || null,
  agentId: rowAny.agentId || row.metadata?.agentId || null,
};

// Return with reconstructed metadata object
return {
  id: row.id,
  content: row.content,
  embedding: row.embedding,
  timestamp: row.timestamp,
  metadata, // <-- Reconstructed for backward compatibility
};
```

## Files Changed

- `apps/backend/src/queues/agent-temporal-grain-queue/index.ts`:

  - Table creation: Flatten metadata fields
  - Record insertion: Flatten metadata fields
  - Record updates: Flatten metadata fields
  - Logging: Updated to show top-level fields

- `apps/backend/src/utils/vectordb/readClient.ts`:
  - Read top-level metadata fields
  - Reconstruct metadata object for backward compatibility
  - Support legacy nested metadata as fallback
  - Enhanced logging to show both raw and reconstructed metadata

## Deployment Steps

### 1. Deploy the Code

```bash
git add -A
git commit -m "Fix LanceDB metadata by flattening structure to top-level fields"
git push
```

### 2. Recreate Vector Databases

The flattened structure requires recreating existing databases:

```bash
# Delete all databases
./scripts/recreate-lancedb-tables.sh helpmaton-production

# Or delete specific agent
./scripts/recreate-lancedb-tables.sh helpmaton-production <agent-id>
```

### 3. Verify the Fix

After deployment and database recreation:

```bash
# Test with a real agent
node scripts/test-lancedb-metadata.mjs <workspace-id> <agent-id>
```

Expected logs:

```
[Write Server] Creating table with sample record metadata fields: {
  "conversationId": "actual-id",
  "workspaceId": "actual-id",
  "agentId": "actual-id"
}

[Read Client] Metadata fields from row: {
  "conversationId": "actual-id",
  "workspaceId": "actual-id",
  "agentId": "actual-id"
}

[Read Client] Metadata summary: {
  "total": 10,
  "withAllMetadata": 10,
  "withNullMetadata": 0
}
```

## Why This Works

1. **Top-level fields** are properly handled by LanceDB/Apache Arrow
2. **Primitive types** (strings) are preserved correctly
3. **No nested objects** means no Arrow Struct conversion issues
4. **Backward compatible** - read client reconstructs metadata object

## Migration Strategy

The solution supports **gradual migration**:

1. **New tables**: Created with flattened structure automatically
2. **Existing tables**: Can be left as-is (read client supports both)
3. **Optimal path**: Recreate databases for best performance

## Testing

### Unit Test Pattern

```typescript
test("metadata is preserved through write and read with flattened structure", async () => {
  const metadata = {
    conversationId: "conv-123",
    workspaceId: "ws-456",
    agentId: "agent-789",
  };

  // Write
  await writeToWorkingMemory(
    metadata.agentId,
    metadata.workspaceId,
    metadata.conversationId,
    [{ role: "user", content: "test" }]
  );

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Read and verify
  const results = await query(metadata.agentId, "working", {});
  expect(results[0].metadata).toMatchObject(metadata);
});
```

## Lessons Learned

1. **LanceDB metadata handling**: Nested objects in metadata fields are not reliable
2. **Flat is better than nested**: Keep record structures flat for better compatibility
3. **Test storage round-trips**: Always verify data can be written AND read back correctly
4. **Schema inference matters**: LanceDB infers schema from data structure, not just types

## Future Improvements

1. **Type safety**: Create proper TypeScript types for flattened structure
2. **Schema versioning**: Track schema version in records for future migrations
3. **Metadata validation**: Add runtime validation for metadata fields
4. **Performance testing**: Measure query performance with flattened vs nested metadata

## References

- LanceDB Documentation: https://lancedb.github.io/lancedb/
- Apache Arrow Documentation: https://arrow.apache.org/docs/
- Issue tracking: This fix resolves the metadata null values issue
