# Active Context

## Current Status

**Status**: Lambda Container Image Deployment - Working ✅

The Lambda function using container images is now successfully deployed and working. All configuration issues have been resolved.

## Recent Changes

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

1. Monitor Lambda function performance and cold start times
2. Measure actual image size reduction after deployment
3. Document container image deployment process for other functions

## Notes

- Project is actively maintained
- Uses AWS serverless architecture (Lambda, API Gateway, DynamoDB)
- Monorepo structure with backend and frontend apps
- PR deployments create CloudFormation stacks for testing
- Container images are built for `arm64` architecture (Graviton2) for better price/performance
- Environment variables are injected at build time, not runtime, for container image functions
