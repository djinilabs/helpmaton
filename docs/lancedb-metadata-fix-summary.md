# LanceDB Metadata Fix - Summary

## Problem

LanceDB search was retrieving records with null metadata values:

```json
{
  "conversationId": null,
  "workspaceId": null,
  "agentId": null
}
```

## Root Cause

**LanceDB is schema-less and infers the schema from the first batch of records.**

If the first records written to a table had `null` values for metadata fields (conversationId, workspaceId, agentId), LanceDB created a schema where those fields are nullable. Once the schema is set, it **cannot be changed** without recreating the table.

## The Fix

### 1. Code Changes (Implemented)

Updated `apps/backend/src/queues/agent-temporal-grain-queue/index.ts`:

**Before:**

```typescript
let metadata: Record<string, unknown> = {};
if (r.metadata && typeof r.metadata === "object") {
  const jsonString = JSON.stringify(r.metadata);
  metadata = JSON.parse(jsonString);
}
```

**After:**

```typescript
let metadata: Record<string, string> = {
  conversationId: "",
  workspaceId: "",
  agentId: "",
};

if (r.metadata && typeof r.metadata === "object") {
  const jsonString = JSON.stringify(r.metadata);
  const parsed = JSON.parse(jsonString);

  // Ensure all metadata fields are strings (never null)
  metadata = {
    conversationId: String(parsed.conversationId || ""),
    workspaceId: String(parsed.workspaceId || ""),
    agentId: String(parsed.agentId || ""),
  };
}
```

This ensures:

- Metadata fields are always **strings**, never null
- LanceDB creates schema with string fields
- New tables will have correct schema
- Existing records with null values are converted to empty strings

### 2. Additional Improvements

- **Validation**: Added early validation in `writeToWorkingMemory()` to throw if parameters are null
- **Comprehensive Logging**:
  - Read operations now log all metadata from all rows
  - Summary statistics show how many records have complete vs null metadata
  - Write operations log metadata values at each step
- **Diagnostic Tools**: Created scripts to debug, test, and fix the issue

## Deployment Steps

### Step 1: Deploy the Code Fix

```bash
# Commit and push the changes
git add -A
git commit -m "Fix LanceDB metadata schema to prevent null values"
git push

# Or deploy directly
pnpm deploy:production
```

### Step 2: Recreate Vector Databases

**Option A: Recreate All Databases**

```bash
./scripts/recreate-lancedb-tables.sh helpmaton-production
```

**Option B: Recreate Specific Agent**

```bash
./scripts/recreate-lancedb-tables.sh helpmaton-production <agent-id>
```

**Option C: Manual Deletion**

```bash
# List databases
aws s3 ls s3://helpmaton-vector-db-production/agents/ --recursive

# Delete specific agent
aws s3 rm s3://helpmaton-vector-db-production/agents/<agent-id>/ --recursive
```

### Step 3: Regenerate Memories

After deleting databases, they will be automatically recreated on next write with correct schema.

**Option A: Wait for Natural Regeneration**

- New conversations will automatically populate the databases
- Old memories will be lost (only new conversations will be stored)

**Option B: Force Regeneration (if needed)**

```bash
# This would require a custom script to replay conversations
# Or use the summarization script for existing data
pnpm run-all-memory-summaries
```

### Step 4: Verify the Fix

```bash
# Test with a specific agent
node scripts/test-lancedb-metadata.mjs <workspace-id> <agent-id>
```

Expected output:

```
✅ All metadata fields are correct!
   LanceDB is properly storing and retrieving metadata.
```

Check logs for:

```
[Read Client] Metadata summary: {
  "total": 10,
  "withConversationId": 10,
  "withWorkspaceId": 10,
  "withAgentId": 10,
  "withAllMetadata": 10,
  "withNullMetadata": 0
}
```

## Why This Happened

The metadata storage fix was implemented earlier (December 2025), but the **existing tables** were created before that fix, with a schema that allowed null values. The code was correctly writing metadata, but LanceDB's schema prevented proper storage.

## Files Changed

- `apps/backend/src/queues/agent-temporal-grain-queue/index.ts` - Metadata schema fix
- `apps/backend/src/utils/memory/writeMemory.ts` - Added validation and logging
- `apps/backend/src/utils/conversationLogger.ts` - Added parameter logging
- `apps/backend/src/utils/vectordb/readClient.ts` - Comprehensive read logging
- `scripts/recreate-lancedb-tables.sh` - New script to recreate databases
- `scripts/debug-lancedb-metadata.sh` - Diagnostic script
- `scripts/test-lancedb-metadata.mjs` - Test script
- `docs/lancedb-metadata-diagnosis.md` - Troubleshooting guide

## Monitoring

After deployment, monitor these logs:

1. **Write Success:**

   ```
   [Write Server] Creating table with sample record metadata: {
     "conversationId": "conv-123",
     "workspaceId": "ws-456",
     "agentId": "agent-789"
   }
   ```

2. **Read Success:**

   ```
   [Read Client] Metadata summary: {
     "withNullMetadata": 0
   }
   ```

3. **Validation Errors (if parameters are null):**
   ```
   [Memory Write] ERROR: agentId is invalid: "null"
   ```

## Impact

- ✅ **No data loss**: Conversations are stored in DynamoDB and are safe
- ✅ **Automatic regeneration**: New conversations will populate databases correctly
- ⚠️ **Old memories lost**: Previous memory records will be deleted and need regeneration
- ✅ **Future-proof**: New schema prevents this issue from happening again

## Questions?

- Check `docs/lancedb-metadata-diagnosis.md` for detailed troubleshooting
- Run `./scripts/debug-lancedb-metadata.sh` to check current state
- Run `./scripts/test-lancedb-metadata.mjs` to test after deployment
