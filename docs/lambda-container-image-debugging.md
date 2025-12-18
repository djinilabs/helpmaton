# Lambda Container Image Deployment - Debugging Summary

## Objective

Deploy an AWS Lambda function using a container image (Docker) instead of a ZIP package. The function in question is the streaming endpoint: `any /api/streams/:workspaceId/:agentId/:secret`, which uses the `lancedb` container image.

## Current Error

**Error Type:** `Runtime.InvalidEntrypoint`  
**Error Message:** `ProcessSpawnFailed`  
**Status:** ❌ **Still failing**

The Lambda function fails at INIT time with `ProcessSpawnFailed`, indicating that Lambda cannot find or execute the handler entrypoint.

## Lambda Function Configuration

**Function Name:** `HelpmatonStagingPR5-AnyApiStreamsWorkspaceIdAgentI-4dODUr7Z2zdv`  
**Package Type:** `Image`  
**Image:** ECR container image (`lancedb`)

**Current ImageConfig:**

```json
{
  "EntryPoint": ["/lambda-entrypoint.sh"],
  "Command": [
    "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
  ],
  "WorkingDirectory": "/var/task"
}
```

## Architecture

### Docker Image Structure

- **Base Image:** `public.ecr.aws/lambda/nodejs:20` (AWS Lambda Node.js 20.x base image)
- **Handler Location:** `/var/task/http/any-api-streams-000workspaceId-000agentId-000secret/index.js`
- **Handler Export:** `module.exports.handler` (CommonJS format)
- **Handler Wrapper:** The handler is wrapped with `awslambda.streamifyResponse()` for RESPONSE_STREAM mode

### Code Flow

1. TypeScript source: `apps/backend/src/http/any-api-streams-000workspaceId-000agentId-000secret/index.ts`
2. Compiled to: `apps/backend/dist/http/any-api-streams-000workspaceId-000agentId-000secret/index.js`
3. Copied to container: `/var/task/http/any-api-streams-000workspaceId-000agentId-000secret/index.js`
4. Lambda Command: `http/any-api-streams-000workspaceId-000agentId-000secret/index.handler`

## Attempted Solutions

### Phase 1: Environment Variable Approach (Failed)

**Approach:** Use a wrapper `index.js` at `/var/task/index.js` that reads `LAMBDA_HANDLER_PATH` environment variable to dynamically load the correct handler.

**Implementation:**

- Created wrapper at `apps/backend/docker/lancedb/index.js`
- Set `LAMBDA_HANDLER_PATH` environment variable in CloudFormation
- Dockerfile `CMD`: `["index.handler"]`

**Result:** ❌ Failed - `ProcessSpawnFailed` error persisted

**Issues:**

- Wrapper attempted to load handler dynamically at runtime
- Module loading failed during INIT phase
- Top-level `console.log` statements in wrapper caused initialization failures

### Phase 2: Explicit ImageConfig Properties (Failed)

**Approach:** Explicitly set `ImageConfig.WorkingDirectory` and `ImageConfig.EntryPoint` in CloudFormation to ensure Lambda uses correct paths.

**Implementation:**

- Set `ImageConfig.WorkingDirectory = "/var/task"`
- Set `ImageConfig.EntryPoint = ["/lambda-entrypoint.sh"]`
- Still using wrapper approach with `LAMBDA_HANDLER_PATH`

**Result:** ❌ Failed - `ProcessSpawnFailed` error persisted

**Issues:**

- Explicitly setting properties didn't resolve the underlying issue
- Wrapper approach still problematic

### Phase 3: Direct Handler Path (Current - Failed)

**Approach:** Point `ImageConfig.Command` directly to the handler path, bypassing the wrapper entirely.

**Implementation:**

- Removed `LAMBDA_HANDLER_PATH` environment variable
- Set `ImageConfig.Command = ["http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"]`
- Removed wrapper dependency
- Updated Dockerfile to verify handler file exists

**Result:** ❌ Failed - `ProcessSpawnFailed` error persists

**Configuration:**

```javascript
properties.ImageConfig.Command = [
  "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler",
];
properties.ImageConfig.WorkingDirectory = "/var/task";
properties.ImageConfig.EntryPoint = ["/lambda-entrypoint.sh"];
```

**Issues:**

- Lambda still cannot find or execute the handler
- Handler file exists in image (verified in Dockerfile build)
- Handler file is 11MB (large bundled file)
- Handler uses CommonJS format: `module.exports = __toCommonJS(...)`

### Phase 4: EntryPoint Requirement (Current)

**Approach:** Discovered that when `ImageConfig` is present, AWS Lambda requires all three properties (`EntryPoint`, `Command`, `WorkingDirectory`) to be non-empty.

**Implementation:**

- Re-added `ImageConfig.EntryPoint = ["/lambda-entrypoint.sh"]` (was removed in Phase 3)
- Ensured all three properties are set

**Status:** ⏳ **Pending deployment**

## Key Findings

### Handler File Verification

✅ **Handler file exists:** Verified in Dockerfile build step

- Path: `/var/task/http/any-api-streams-000workspaceId-000agentId-000secret/index.js`
- Size: ~11MB (large bundled file)
- Format: CommonJS (`module.exports`)

### Handler Export Structure

The compiled handler file:

- Uses `module.exports = __toCommonJS(any_api_streams_000workspaceId_000agentId_000secret_exports)`
- Exports `handler` function
- Handler is wrapped with `awslambda.streamifyResponse()` at module load time

**Local Test Result:**

```bash
# Attempting to load handler locally fails because awslambda is not available
Error: getDefined(...).streamifyResponse is not a function
```

This is expected - `awslambda` is only available in Lambda runtime environment.

### Dockerfile Verification

Added verification steps in Dockerfile:

```dockerfile
# Verify Lambda entrypoint exists
RUN test -f /lambda-entrypoint.sh && test -x /lambda-entrypoint.sh

# Verify handler file exists
RUN test -f ${LAMBDA_TASK_ROOT}/http/any-api-streams-000workspaceId-000agentId-000secret/index.js
```

Both verifications pass during Docker build.

### AWS Lambda Requirements

According to AWS documentation:

1. When `ImageConfig` is present, all properties must be non-empty
2. `EntryPoint` should be absolute path (e.g., `["/lambda-entrypoint.sh"]`)
3. `Command` format: `["path/to/file.handler"]` where path is relative to `WorkingDirectory`
4. Handler path with subdirectories using slashes should work

## Current Configuration

### CloudFormation (via container-images plugin)

```javascript
properties.ImageConfig = {
  EntryPoint: ["/lambda-entrypoint.sh"],
  Command: [
    "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler",
  ],
  WorkingDirectory: "/var/task",
};
```

### Dockerfile

```dockerfile
FROM public.ecr.aws/lambda/nodejs:20

# ... (dependencies, build steps) ...

# Copy compiled code
COPY apps/backend/dist/ ${LAMBDA_TASK_ROOT}/

# Verify entrypoint and handler file exist
RUN test -f /lambda-entrypoint.sh && test -x /lambda-entrypoint.sh
RUN test -f ${LAMBDA_TASK_ROOT}/http/any-api-streams-000workspaceId-000agentId-000secret/index.js

# CMD is overridden by ImageConfig.Command
CMD [ "index.handler" ]
```

## Potential Issues to Investigate

### 1. Handler Path Format

- **Question:** Is the path format `http/any-api-streams-000workspaceId-000agentId-000secret/index.handler` correct?
- **Note:** AWS docs suggest subdirectory paths with slashes should work
- **Action:** Verify if Lambda can resolve paths with multiple subdirectories

### 2. Handler File Size

- **Issue:** Handler file is 11MB (very large)
- **Question:** Could file size cause loading issues?
- **Note:** Large bundled files might have performance implications but shouldn't cause ProcessSpawnFailed

### 3. Module Loading at INIT Time

- **Issue:** Handler calls `awslambda.streamifyResponse()` at module load time
- **Question:** Could this fail during INIT validation before `awslambda` is available?
- **Note:** `awslambda` should be available in Lambda runtime, but timing might matter

### 4. EntryPoint Verification

- **Question:** Does `/lambda-entrypoint.sh` actually exist in the base image?
- **Status:** Verified in Dockerfile build, but should verify in deployed image
- **Action:** Check if entrypoint exists and is executable in the actual deployed container

### 5. Architecture Mismatch

- **Question:** Is the Docker image architecture (x86_64 vs arm64) matching Lambda configuration?
- **Note:** Mismatched architectures can cause ProcessSpawnFailed
- **Action:** Verify image architecture matches Lambda function architecture

## Next Steps

1. **Verify EntryPoint in Deployed Image**

   - Check if `/lambda-entrypoint.sh` exists in the actual deployed container
   - Verify it's executable

2. **Test Handler Path Resolution**

   - Try simpler handler path (e.g., `index.handler` at root)
   - Verify if subdirectory paths work at all

3. **Check Architecture**

   - Verify Docker image architecture matches Lambda function architecture
   - Ensure image is built for correct platform

4. **Handler Module Loading**

   - Consider lazy-loading `streamifyResponse` wrapper
   - Move `awslambda.streamifyResponse()` call to handler function instead of module load

5. **Alternative: Use Wrapper with Different Approach**
   - If direct path doesn't work, try wrapper that doesn't require `awslambda` at module load
   - Export handler synchronously, wrap at runtime

## Files Modified

### Core Files

- `apps/backend/src/plugins/container-images/index.js` - CloudFormation plugin
- `apps/backend/docker/lancedb/Dockerfile` - Docker image definition
- `apps/backend/docker/lancedb/index.js` - Wrapper (currently unused)

### Test Files

- `apps/backend/src/plugins/container-images/__tests__/index.test.js` - Unit tests

### Documentation

- `apps/backend/docker/README.md` - Docker documentation

## Test Results

✅ **All unit tests passing:** 31/31 tests pass  
❌ **Lambda function:** Still failing with `ProcessSpawnFailed`

## References

- [AWS Lambda Container Image Support](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
- [AWS Lambda ImageConfig API](https://docs.aws.amazon.com/lambda/latest/api/API_ImageConfig.html)
- [AWS Lambda Troubleshooting](https://docs.aws.amazon.com/lambda/latest/dg/troubleshooting-invocation.html)
- [AWS Lambda Node.js Base Image](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-image.html)

## Last Updated

2025-12-15 - Phase 4: Re-added EntryPoint requirement
