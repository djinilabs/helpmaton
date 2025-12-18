# Active Context

## Current Status

**Status**: Message Queue Duplication Fix - Completed ✅

Fixed critical issue where conversation recording was sending ALL messages to the queue every time `updateConversation()` was called, not just the new ones. This caused massive duplication in fact extraction, embedding generation, and vector database writes. Solution: Modified `updateConversation()` to identify and send only truly new messages (not present in existing conversation) to the queue.

**Previous Status**: Memory Search Tool Documentation - Completed ✅

Added `search_memory` tool to both the frontend UI (ToolsHelpDialog) and backend prompt generation endpoint so that users and agents are aware of this capability. The tool was already implemented and available to agents, but was not visible in the tools list or mentioned in generated prompts.

**Previous Status**: LanceDB Metadata Flattening Fix - Implemented ✅

Fixed issue where LanceDB search returns metadata with null values. Root cause: LanceDB doesn't handle nested metadata objects properly - data was being written but lost during storage/retrieval. Solution: Flattened metadata structure to store conversationId, workspaceId, and agentId as top-level fields instead of nested in a metadata object.

**Previous Status**: SQS Partial Batch Failures - Completed ✅

The SQS queue processing now supports partial batch failures, allowing successful messages to be deleted from the queue while failed ones are retried individually. This prevents unnecessary reprocessing of successfully processed messages and improves efficiency.

**Recent Fixes (Latest)**:

- **Message Queue Duplication Fix** (December 18, 2025)

  - **Issue**: When recording conversations, the system was sending ALL messages to the queue every time `updateConversation()` was called, not just the new ones. In a multi-turn conversation with 5 messages where 1 new message was added, all 5 messages were being sent to the queue for fact extraction and embedding generation, causing 5x duplication.
  - **Root Cause**: The `updateConversation()` function was calling `writeToWorkingMemory()` with `filteredNewMessages`, which was ALL the messages the client sent (full conversation history), not just the truly new messages.
  - **Solution**:
    - Exported `getMessageKey()` helper function for generating unique keys based on message role and content
    - Created `findNewMessages()` helper function to identify messages not present in existing conversation
    - Modified `updateConversation()` to track truly new messages inside the `atomicUpdate` callback
    - Only send truly new messages to the queue, preventing duplicates
  - **Code Changes**:
    - `apps/backend/src/utils/conversationLogger.ts`:
      - Exported `getMessageKey()` function (previously private)
      - Added `findNewMessages()` function to compare existing vs incoming messages
      - Modified `updateConversation()` to identify truly new messages and only send those to queue
    - `apps/backend/src/utils/__tests__/conversationLogger.test.ts`:
      - Added 3 new test suites with 8 comprehensive tests
      - Tests for `getMessageKey()` message comparison logic
      - Tests for `findNewMessages()` duplicate detection
      - Tests for `updateConversation()` queue write behavior with various scenarios
  - **Benefits**:
    - Eliminated 5x-10x reduction in queue messages for multi-turn conversations
    - Reduced Gemini API embedding costs (no redundant calls)
    - Reduced LanceDB writes (no duplicate facts)
    - Better performance in queue processing
    - Significant cost savings across SQS, Gemini API, and storage
  - **Verification**:
    - All 39 tests pass (including 8 new tests)
    - Type checking passes with no errors
    - Linting passes with no warnings
  - **Impact**: This fix prevents massive duplication in the memory system, significantly reducing costs and improving performance. Queue messages will now contain only truly new conversation messages, not the entire history.

- **Memory Search Tool Documentation** (December 18, 2025)

  - **Issue**: The `search_memory` tool was already implemented and functional but was not documented in:
    - Frontend UI (`ToolsHelpDialog.tsx`) - users couldn't see it in the tools list
    - Prompt generation endpoint (`post-generate-prompt.ts`) - agents weren't informed about this capability
  - **Solution**: Added `search_memory` tool to both locations:
    - Added complete tool definition with parameters to `ToolsHelpDialog.tsx` - shows as "Always Available" with grain, minimumDaysAgo, maximumDaysAgo, maxResults, and queryText parameters
    - Added tool description to prompt generation endpoint - now included in AI agent system prompts
  - **Files Modified**:
    - `apps/frontend/src/components/ToolsHelpDialog.tsx` - Added search_memory tool definition
    - `apps/backend/src/http/any-api-workspaces-catchall/routes/post-generate-prompt.ts` - Added search_memory to toolsInfo
  - **Verification**: All type checking and linting passes successfully
  - **Impact**: Users can now see the memory search capability in the tools list, and agents will be informed about this tool when their prompts are generated

- **LanceDB Metadata Flattening Fix** (December 18, 2025)

  - **Root Cause Identified**: LanceDB doesn't properly handle nested metadata objects. When metadata was stored as `{metadata: {conversationId, workspaceId, agentId}}`, the nested fields were being lost during storage/retrieval, resulting in null values even though data was written correctly.
  - **Solution**: Flatten the metadata structure - store `conversationId`, `workspaceId`, and `agentId` as **top-level fields** on the record instead of nested in a metadata object.
  - **Code Fixes**:
    - Updated `agent-temporal-grain-queue/index.ts` to store metadata fields at top level: `{id, content, vector, timestamp, conversationId, workspaceId, agentId}`
    - Applied flattening to table creation, record insertion, and update operations
    - Updated `readClient.ts` to read metadata fields from top level and reconstruct metadata object for backward compatibility
    - Supports legacy tables that still have nested metadata (tries top-level first, falls back to nested)
    - Added extensive logging to track metadata values through write and read operations
    - Added validation in `writeToWorkingMemory()` to throw early if required parameters are null/undefined
  - **Diagnostic Tools Created**:
    - `scripts/debug-lancedb-metadata.sh` - Check CloudWatch logs for write and read operations
    - `scripts/test-lancedb-metadata.mjs` - End-to-end test to verify metadata storage and retrieval
    - `scripts/recreate-lancedb-tables.sh` - Delete and recreate vector databases with correct schema
    - `docs/lancedb-metadata-diagnosis.md` - Comprehensive troubleshooting guide
    - `docs/lancedb-metadata-fix-summary.md` - Complete deployment guide
  - **Next Steps**: Deploy updated code, then recreate vector databases to apply flattened structure

- **Implemented SQS Partial Batch Failures** (December 2025)
  - Updated `handlingSQSErrors` utility to return `SQSBatchResponse` with failed message IDs
  - Modified queue handler to track failed messages and continue processing remaining messages
  - Created Architect plugin (`sqs-partial-batch-failures`) to configure event source mappings with `ReportBatchItemFailures`
  - Added comprehensive unit tests for both the utility and plugin
  - Benefits: Prevents reprocessing of successful messages, improves queue processing efficiency, reduces duplicate work
- **Fixed environment detection for LanceDB S3 configuration** - Changed environment detection logic to use `arcEnv === "testing" || !accessKeyId || !secretAccessKey`. This ensures staging/PR environments use AWS S3 credentials when available, but falls back to local s3rver configuration when credentials are missing (for tests and local development). Fixed in queue processor, read client, and config module.
- **Fixed S3 path-style addressing for LanceDB** - Changed `awsVirtualHostedStyleRequest: "false"` to `s3ForcePathStyle: "true"` in both queue processor and read client to properly construct S3 URLs for local development (s3rver) and prevent malformed HTTP requests
- Fixed metadata storage/retrieval in LanceDB - metadata fields (conversationId, workspaceId, agentId) are now properly stored and retrieved using JSON serialization to handle Apache Arrow Structs
- Created dev script (`scripts/run-all-memory-summaries.mjs`) to run all memory summarizations for all agents in local development
- Moved `@posthog/ai` dependency from `apps/backend/package.json` to root `package.json` to fix module resolution issues
- Fixed `@posthog/ai` loading errors by implementing lazy imports (dynamic imports) to avoid loading Anthropic SDK wrappers when not needed

## Recent Changes

### Stratified Agent Memory System Implementation (Latest)

**Status**: ✅ Completed

**Overview**: Implemented a comprehensive memory system that enables AI agents to remember important facts, people, and events from their conversations through progressive summarization across multiple temporal grains.

**Key Features Implemented**:

1. **Memory Hierarchy**:

   - Working memory: Raw conversation facts stored immediately (no summarization)
   - Daily summaries: LLM-summarized working memory from each day
   - Weekly summaries: Consolidated daily summaries
   - Monthly summaries: Aggregated weekly summaries
   - Quarterly summaries: Condensed monthly summaries
   - Yearly summaries: Synthesized quarterly summaries

2. **Write Operations**:

   - Automatic extraction of facts from conversations (user and assistant messages)
   - Embedding generation using Gemini API (`text-embedding-004`)
   - SQS FIFO queues with message groups for serialized writes per database
   - Non-blocking writes to avoid impacting conversation performance

3. **Summarization**:

   - LLM-based summarization using Google Gemini API
   - Grain-specific prompts that preserve important information (people, events, facts)
   - Scheduled tasks for each grain (daily, weekly, monthly, quarterly, yearly)
   - Progressive abstraction as information moves up the hierarchy

4. **Retention Policies**:

   - Subscription plan-based retention periods (Free, Starter, Pro)
   - Automatic cleanup of old memories based on retention periods
   - Different retention for each grain (e.g., Free: 48 hours working, 30 days daily; Pro: 240 hours working, 120 days daily)
   - Daily scheduled cleanup task

5. **Memory Search**:

   - `search_memory` tool available to agents
   - Search across any temporal grain
   - Temporal filtering (minimum/maximum days ago)
   - Semantic search with vector similarity
   - Results prefixed with date when events occurred

6. **Time Formatting**:
   - Utilities for converting dates to grain-specific time strings
   - Formats: `YYYY-MM-DD` (daily), `YYYY-W{week}` (weekly), `YYYY-MM` (monthly), `YYYY-Q{quarter}` (quarterly), `YYYY` (yearly)
   - Parsing and date range calculations for each grain

**Files Created**:

- `apps/backend/src/utils/memory/writeMemory.ts` - Writing conversations to working memory
- `apps/backend/src/utils/memory/searchMemory.ts` - Memory search functionality
- `apps/backend/src/utils/memory/summarizeMemory.ts` - LLM summarization logic
- `apps/backend/src/utils/memory/retentionPolicies.ts` - Retention policy calculations
- `apps/backend/src/utils/memory/timeFormats.ts` - Time string formatting utilities
- `apps/backend/src/http/utils/memorySearchTool.ts` - Agent tool for memory search
- `apps/backend/src/scheduled/summarize-memory-daily/index.ts` - Daily summarization task
- `apps/backend/src/scheduled/summarize-memory-weekly/index.ts` - Weekly summarization task
- `apps/backend/src/scheduled/summarize-memory-monthly/index.ts` - Monthly summarization task
- `apps/backend/src/scheduled/summarize-memory-quarterly/index.ts` - Quarterly summarization task
- `apps/backend/src/scheduled/summarize-memory-yearly/index.ts` - Yearly summarization task
- `apps/backend/src/scheduled/cleanup-memory-retention/index.ts` - Retention cleanup task
- `apps/backend/src/utils/memory/__tests__/timeFormats.test.ts` - Time formatting tests (30 tests)
- `apps/backend/src/utils/memory/__tests__/retentionPolicies.test.ts` - Retention policy tests (13 tests)
- `apps/backend/src/utils/memory/__tests__/summarizeMemory.test.ts` - Summarization tests (9 tests)
- `apps/backend/src/utils/memory/__tests__/memorySystem.integration.test.ts` - Comprehensive integration tests (3 tests, 120s timeout)

**Files Modified**:

- `apps/backend/src/utils/conversationLogger.ts` - Added `writeToWorkingMemory()` calls after conversation creation/updates
- `apps/backend/src/http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup.ts` - Added `search_memory` tool to agent tools
- `apps/backend/src/http/utils/agentUtils.ts` - Added `search_memory` tool for delegated agents
- `apps/backend/src/utils/vectordb/types.ts` - Added `"working"` to `TemporalGrain` type
- `apps/backend/app.arc` - Added all scheduled tasks for summarization and cleanup
- `apps/backend/src/queues/agent-temporal-grain-queue/__tests__/index.test.ts` - Fixed type errors in tests

**Documentation Created**:

- `docs/agent-memory-system.md` - Comprehensive documentation (357 lines) covering architecture, components, usage, and configuration
- `apps/backend/ENV.md` - Updated with `GEMINI_API_KEY` usage for memory system and vector database S3 bucket configuration

**Test Coverage**:

- 52 unit tests for utility functions (timeFormats, retentionPolicies, summarizeMemory)
- 3 comprehensive integration tests simulating full memory lifecycle with mocked LLM and vector database
- All tests passing, typecheck and lint clean

**Integration Points**:

- Memory writes triggered automatically from conversation logging
- `search_memory` tool integrated into agent toolset
- Scheduled tasks configured in `app.arc` for automatic summarization
- Retention cleanup runs daily to maintain storage efficiency

**Recent Fixes and Improvements**:

1. **Metadata Storage/Retrieval Fix** (Latest):

   - Fixed issue where metadata fields (conversationId, workspaceId, agentId) were being stored as null
   - Root cause: LanceDB stores nested objects as Apache Arrow Structs, which require special handling
   - Solution: Implemented JSON serialization/deserialization when storing and retrieving metadata to convert Arrow Structs to plain objects
   - Updated `apps/backend/src/queues/agent-temporal-grain-queue/index.ts` to use JSON serialization when storing metadata
   - Updated `apps/backend/src/utils/vectordb/readClient.ts` with `convertMetadataToPlainObject()` helper function
   - All metadata is now properly preserved through the storage/retrieval pipeline

2. **Dev Script for Memory Summarization** (Latest):

   - Created `scripts/run-all-memory-summaries.mjs` - JavaScript script to run all temporal grain summarizations for all agents in dev mode
   - Script processes all workspaces and agents, running daily → weekly → monthly → quarterly → yearly summarizations in sequence
   - Includes safety check to only run in local development mode
   - Usage: `pnpm run-all-memory-summaries`
   - Added to `package.json` scripts

3. **Dependency Management Fixes** (Latest):
   - Moved `@posthog/ai` from `apps/backend/package.json` to root `package.json` to fix module resolution issues
   - Fixed `@posthog/ai` loading errors by implementing lazy imports (dynamic `await import()`) in:
     - `apps/backend/src/http/utils/modelFactory.ts`
     - `apps/backend/src/http/utils/agentUtils.ts`
   - Made `createAgentModel()` async to support lazy loading
   - Updated all callers to await `createAgentModel()`
   - This prevents loading Anthropic SDK wrappers when they're not needed, avoiding initialization errors

**Files Modified (Latest)**:

- `apps/backend/src/utils/handlingSQSErrors.ts` - Updated to return `SQSBatchResponse` with partial batch failure support; Handler now returns array of failed message IDs; Catches unexpected errors and returns all messages as failed
- `apps/backend/src/queues/agent-temporal-grain-queue/index.ts` - Updated handler to track failed messages and return their IDs; Continues processing remaining messages even if some fail; Fixed environment detection to check credentials first, falling back to local config when missing; Fixed S3 path-style addressing by changing `awsVirtualHostedStyleRequest: "false"` to `s3ForcePathStyle: "true"`; Added JSON serialization for metadata storage
- `apps/backend/src/plugins/sqs-partial-batch-failures/index.js` - New Architect plugin to configure SQS event source mappings with `ReportBatchItemFailures`
- `apps/backend/app.arc` - Added `sqs-partial-batch-failures` plugin to enable partial batch failures
- `apps/backend/src/utils/__tests__/handlingSQSErrors.test.ts` - New test file with comprehensive tests for partial batch failure handling
- `apps/backend/src/plugins/sqs-partial-batch-failures/__tests__/index.test.js` - New test file for the SQS plugin
- `apps/backend/src/queues/agent-temporal-grain-queue/__tests__/index.test.ts` - Updated tests to verify handler returns failed message IDs; Added tests for partial batch failures
- `apps/backend/src/utils/vectordb/readClient.ts` - Fixed environment detection to check credentials first, falling back to local config when missing; Fixed S3 path-style addressing by changing `awsVirtualHostedStyleRequest: "false"` to `s3ForcePathStyle: "true"`; Added `convertMetadataToPlainObject()` helper function
- `apps/backend/src/utils/vectordb/config.ts` - Fixed environment detection in `getS3ConnectionOptions()` to check credentials first, falling back to local config when missing
- `apps/backend/src/http/utils/modelFactory.ts` - Lazy import of `withTracing` from `@posthog/ai`
- `apps/backend/src/http/utils/agentUtils.ts` - Lazy import of `withTracing`, made `createAgentModel()` async
- `apps/backend/src/http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup.ts` - Updated to await `createAgentModel()`
- `package.json` - Moved `@posthog/ai` to root dependencies, added `run-all-memory-summaries` script
- `apps/backend/package.json` - Removed `@posthog/ai` dependency
- `scripts/run-all-memory-summaries.mjs` - New dev script for running all summarizations

**Next Steps**:

- Monitor queue processing efficiency with partial batch failures in production
- Track retry rates and dead-letter queue usage
- Monitor summarization quality and adjust prompts if needed
- Track storage usage and optimize if necessary
- Consider configurable summarization prompts per agent
- Explore cross-agent memory sharing for team workspaces
- Test metadata retrieval with existing records (may need to recreate records with proper metadata)

### Lambda Container Image Deployment Fixes (December 2025)

**Problem**: Lambda function using container images was failing with `Runtime.InvalidEntrypoint` / `ProcessSpawnFailed` errors.

**Root Causes Identified & Fixed**:

1. **Architecture Mismatch** (Most Critical)

   - Lambda function configured for `arm64` but Docker image was built for `amd64` by default
   - **Fix**: Added `--platform linux/arm64` to Docker build command in `scripts/build-and-push-lambda-images.sh`
   - Added Docker Buildx setup in GitHub Actions workflow for cross-platform builds

2. **Docker Buildx Manifest Format**

   - Buildx v0.10+ adds provenance and SBOM metadata by default, which Lambda doesn't support
   - **Fix**: Added `--provenance=false --sbom=false` flags to buildx command

3. **ES Module vs CommonJS Format**

   - Build script was outputting ES modules (`format: "esm"`) but Lambda needs CommonJS
   - **Fix**: Changed `format: "esm"` to `format: "cjs"` in `scripts/build-backend.ts`

4. **Environment Variable Injection Timing**

   - Docker image was built before environment variables were set in GitHub Actions workflow
   - **Fix**: Added all environment variables to "Build backend (for Docker images)" step so they're available when `esbuild-config.cjs` reads `process.env` during build

5. **ImageConfig Configuration**
   - Lambda requires all three ImageConfig properties (EntryPoint, Command, WorkingDirectory) to be non-empty
   - **Fix**: Set `ImageConfig.EntryPoint = ["/lambda-entrypoint.sh"]`, `ImageConfig.Command = [handlerPath]`, and `ImageConfig.WorkingDirectory = "/var/task"`

**Files Modified**:

- `.github/workflows/deploy-pr.yml` - Added env vars to build step, Docker Buildx setup
- `scripts/build-and-push-lambda-images.sh` - Added `--platform linux/arm64`, `--provenance=false --sbom=false`
- `scripts/build-backend.ts` - Changed format from `"esm"` to `"cjs"`
- `apps/backend/src/plugins/container-images/index.js` - Set ImageConfig properties correctly
- `apps/backend/docker/lancedb/Dockerfile` - Added entrypoint verification and file permissions

**Current Configuration**:

- Lambda Architecture: `arm64`
- ImageConfig.EntryPoint: `["/lambda-entrypoint.sh"]`
- ImageConfig.Command: `["http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"]`
- ImageConfig.WorkingDirectory: `"/var/task"`
- Build Format: CommonJS (`cjs`)
- Environment variables: Injected at build time via esbuild `define` option

### Docker Image Size Optimization (December 2025)

**Problem**: Lambda Docker images were larger than desired, increasing deployment time and storage costs.

**Optimizations Implemented**:

1. **Multi-Stage Builds**

   - LanceDB Dockerfile now uses two-stage build (builder + runtime)
   - Build tools (python3, make, gcc-c++, git) and pnpm are only in builder stage
   - Final image contains only runtime dependencies and compiled code
   - Expected size reduction: 50-70%

2. **Package Manager Cache Cleanup**

   - Added `pnpm store prune` to remove unused packages from pnpm store
   - Removed `/root/.pnpm-store` and workspace `.pnpm` directories after install

3. **.dockerignore File**

   - Created `.dockerignore` to exclude unnecessary files from build context
   - Excludes: node_modules, tests, docs, git files, IDE configs, build artifacts

4. **Removed Verification Steps**
   - Removed verbose verification RUN commands from production Dockerfile
   - These can be added back temporarily for debugging if needed

**Files Modified**:

- `.dockerignore` - Created to exclude unnecessary files
- `apps/backend/docker/base/Dockerfile` - Updated paths for monorepo build context
- `apps/backend/docker/lancedb/Dockerfile` - Implemented multi-stage build
- **Subscription and Credit Purchase Fixes** (Latest)
- **Credit System Migration to Integer Millionths** (Latest)
- **Token Usage Tracking and Display Improvements** (Latest)

  - Fixed token usage extraction to ensure reasoning tokens and cached prompt tokens are included in total token counts
  - Updated `extractTokenUsage()` to calculate `totalTokens` as `nonCachedPromptTokens + cachedPromptTokens + completionTokens + reasoningTokens`, ensuring all token types are included
  - Updated `aggregateTokenUsage()` to calculate `totalTokens` as `promptTokens + cachedPromptTokens + completionTokens + reasoningTokens` when aggregating multiple usage objects
  - Enhanced message deduplication logic to intelligently merge messages based on tokenUsage presence and content format (array vs string)
  - Added `normalizeContentForComparison()` function to handle content format differences (string vs array) when deduplicating messages
  - Implemented `X-Conversation-Id` header requirement for all interactive endpoints (test and streaming)
  - Refactored conversation updates to use `atomicUpdate()` for thread-safe updates with optimistic locking
  - Moved conversation ID generation to client-side (`AgentChat` component) using memoized UUID, removed session storage dependency
  - Updated frontend UI to display token usage breakdown including reasoning tokens and cached prompt tokens:
    - `ConversationList`: Shows `Total (P: X, C: Y, R: Z, Cache: W)` format
    - `ConversationDetailModal`: Shows full breakdown in metadata and individual message badges
    - `AgentChat`: Shows token usage badges for each message with breakdown
  - Updated all unit tests to reflect new token calculation logic (reasoning and cached tokens included in totals)
  - Token usage can now exist on any message type, not just assistant messages
  - All changes verified with type checking, linting, and comprehensive test coverage

- **Credit System Migration to Integer Millionths**

  - Migrated entire credit system from floating-point numbers to integer millionths representation to eliminate precision loss
  - Created `creditConversions.ts` utility with `toMillionths()` and `fromMillionths()` functions for conversions
  - Updated all pricing calculations to use `Math.ceil()` instead of `Math.round()` to always round up (never down)
  - Updated database schemas to enforce integer storage for all credit/cost fields (creditBalance, spendingLimits.amount, costUsd/Eur/Gbp, etc.)
  - Updated all API endpoints to expect and return values in millionths (integer format)
  - Updated frontend components to convert from millionths to currency units for display:
    - `CreditBalance`, `SpendingLimitsManager`, `UsageStats`, `UsageChart`, `TrialUsageBar`
    - Created `currency.ts` utility with `formatCurrency()`, `fromMillionths()`, and `toMillionths()` functions
  - Updated all test files to use millionths instead of decimal values
  - Fixed `costDiagnostics.ts` to properly convert millionths to currency units in `generateCostReport()` display
  - Fixed `compareCosts()` threshold to use 100 millionths (equivalent to 0.0001 currency units) instead of 0.0001
  - Updated Lemon Squeezy webhook handlers to convert cents to millionths (cents \* 10_000)
  - Updated Discord command handlers to convert between currency units and millionths
  - Updated error messages to display currency units while storing/returning millionths in API responses
  - All changes verified with type checking, linting, and comprehensive test coverage

- **Subscription and Credit Purchase Fixes**

  - Fixed Lemon Squeezy portal URL to always redirect to `https://app.lemonsqueezy.com/my-orders` instead of using dynamic customer portal URLs
  - Fixed issue where free plans incorrectly showed as "cancelled" with renewal dates - added cleanup logic to remove Lemon Squeezy-related fields (status, renewsAt, endsAt) from free plans
  - Added credit purchase functionality to the UI - integrated `CreditPurchase` component into workspace detail page with proper currency support
  - Fixed redirect URL after credit purchase to return users to workspace page instead of Lemon Squeezy customer portal
  - Enhanced credit purchase checkout creation with extensive logging to track `custom_price` values through the entire flow
  - Added variant configuration checking to verify PWYW (Pay What You Want) status and log warnings
  - Updated product description in checkout to guide users on entering the correct amount for PWYW variants
  - Added verification logic to ensure `custom_price` is correctly set and returned by Lemon Squeezy API
  - All changes verified with type checking and linting

- **Test Refactoring: Use Actual Route Handlers**

  - Fixed issue where test files (`get-workspace-api-key.test.ts`, `delete-workspace-api-key.test.ts`, `put-workspace-api-key.test.ts`) were using inlined handler implementations instead of importing and testing the actual route handlers
  - Created `route-test-helpers.ts` utility that captures route handlers during Express app registration, allowing tests to use the real implementation
  - Refactored all three test files to import and register actual route handlers instead of duplicating logic
  - Tests now properly verify the actual route behavior, including correct migration logic (e.g., `createdAt` is NOT passed during migration, matching the real implementation)
  - This ensures tests will catch bugs in the real implementation and won't diverge from the code over time
  - Fixed linting errors by adding `eslint-disable-next-line import/order` comments where necessary for test helper imports

- **Credit Deduction Test Coverage**

  - Analyzed credit deduction flow across all endpoints (test agent, webhook, stream, agent delegation)
  - Identified gaps in test coverage for `adjustCreditReservation` calls
  - Added comprehensive integration tests to verify credit deduction is correctly applied for each generated message
  - Tests verify that `adjustCreditReservation` is called with correct parameters (reservationId, workspaceId, provider, modelName, tokenUsage, maxRetries, usesByok)
  - Added edge case tests for scenarios where credit deduction should not occur (undefined tokenUsage, zero tokens, BYOK requests, feature flag disabled)
  - Added error handling tests to ensure requests succeed even if credit adjustment fails
  - Tests added for webhook handler and stream handler endpoints
  - Refined test suite to focus on essential credit deduction verification scenarios

- **Token Usage Preservation for Assistant Messages**

  - Fixed issue where only the last assistant message had tokenUsage; now all assistant messages preserve their tokenUsage
  - Enhanced `updateConversation` in `conversationLogger.ts` to preserve tokenUsage from existing assistant messages during full history replacement
  - Added logic to recover/infer tokenUsage for assistant messages that don't have it by calculating from conversation-level tokenUsage (when possible)
  - Fixed missing `reasoningTokens` in database schema - added `reasoningTokens: z.number().optional()` to `agent-conversations` schema in `schema.ts`
  - ReasoningTokens are now properly preserved in conversation-level tokenUsage records
  - Added comprehensive test coverage for tokenUsage preservation and recovery scenarios
  - **Note**: For existing conversations where the first message was created without tokenUsage and conversation-level tokenUsage only reflects the last message, we cannot retroactively recover the first message's tokenUsage. Going forward, all new assistant messages will have tokenUsage attached.

- **API Gateway Auto-Deployment**

  - Created `scripts/deploy-api-gateway.sh` to automatically trigger API Gateway deployments after CloudFormation stack updates
  - Updated `.github/workflows/deploy-prod.yml` to run API Gateway deployment after production deploys
  - Updated `.github/workflows/deploy-pr.yml` to run API Gateway deployment after PR deploys
  - This ensures API Gateway changes (routes, methods, integrations) are immediately live after `arc deploy` completes
  - Script retrieves REST API ID and stage name from CloudFormation outputs and creates a new deployment
  - Handles edge cases like missing outputs, rate limiting, and determines stage name from stack name if needed

- Memory Bank strategy initialized
- Created memory folder structure with three core files

## Next Steps

1. Monitor memory system performance:
   - Track summarization quality and adjust prompts if needed
   - Monitor storage usage and retention cleanup effectiveness
   - Verify memory search performance and relevance
2. Monitor Lambda function performance and cold start times
3. Measure actual image size reduction after deployment
4. Document container image deployment process for other functions

## Notes

- Project is actively maintained
- Uses AWS serverless architecture (Lambda, API Gateway, DynamoDB)
- Monorepo structure with backend and frontend apps
- PR deployments create CloudFormation stacks for testing
- Container images are built for `arm64` architecture (Graviton2) for better price/performance
- Environment variables are injected at build time, not runtime, for container image functions
