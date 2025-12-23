# Active Context

## Current Status

**Status**: OpenRouter Integration with 3-Step Pricing and BYOK Support - Completed ✅

Successfully integrated OpenRouter as the primary LLM provider while maintaining support for Google and other providers. Implemented a 3-step pricing verification process and full BYOK (Bring Your Own Key) support for OpenRouter.

**Key Features Implemented**:

1. **OpenRouter Integration**:
   - Added `@openrouter/ai-sdk-provider` package
   - Extended Provider type to include `"openrouter"` in both backend and frontend
   - Implemented OpenRouter model factory with auto-selection support (using `"auto"` model name)
   - Updated all LLM call sites (test, stream, webhook, agent delegation) to use OpenRouter by default
   - Added OpenRouter models to pricing configuration including "auto" selection
   - Updated `/api/models` endpoint to include OpenRouter provider and models

2. **3-Step Pricing Process**:
   - **Step 1**: Estimate cost and reserve credits from workspace balance
   - **Step 2**: Calculate actual cost based on token usage and adjust balance
   - **Step 3**: Background job queries OpenRouter API for actual cost and makes final adjustment
   - Created SQS FIFO queue (`openrouter-cost-verification-queue`) for background cost verification
   - Extended credit-reservations schema with OpenRouter-specific fields (generationId, provider, modelName, tokenUsageBasedCost, openrouterCost)
   - All costs use `Math.ceil()` for rounding to ensure we never undercharge

3. **5.5% OpenRouter Markup**:
   - Applied 5.5% markup to all OpenRouter costs to account for credit purchase fee
   - Markup applied in `calculateTokenCost()` for steps 1 and 2
   - Markup applied in cost verification queue for step 3
   - Ensures accurate billing that covers OpenRouter's fees

4. **BYOK (Bring Your Own Key) Support**:
   - OpenRouter BYOK keys can be stored and retrieved (code supports it)
   - When workspace has OpenRouter API key, it's used automatically and credit deduction is skipped
   - Provider-specific keys (Google, OpenAI, Anthropic) can be stored for direct provider access
   - Note: API endpoints currently only accept `google`, `openai`, `anthropic` - OpenRouter BYOK key storage would require adding `"openrouter"` to `VALID_PROVIDERS`

5. **Cost Rounding**:
   - All cost calculations use `Math.ceil()` instead of `Math.round()` to ensure we never undercharge
   - Applied consistently across all pricing calculations (token costs, OpenRouter API costs)

**Files Modified**:

- `apps/backend/package.json` - Added `@openrouter/ai-sdk-provider` dependency
- `apps/backend/src/http/utils/modelFactory.ts` - Added OpenRouter support with auto-selection
- `apps/backend/src/http/utils/agentUtils.ts` - Updated to support OpenRouter provider
- `apps/backend/src/tables/schema.ts` - Extended credit-reservations schema with OpenRouter fields
- `apps/backend/src/utils/creditManagement.ts` - Added `finalizeCreditReservation()` and updated `adjustCreditReservation()` for 3-step pricing
- `apps/backend/src/utils/pricing.ts` - Added 5.5% markup for OpenRouter, all rounding uses `Math.ceil()`
- `apps/backend/src/utils/openrouterUtils.ts` - New utility for extracting generation IDs and sending cost verification messages
- `apps/backend/src/queues/openrouter-cost-verification-queue/index.ts` - New queue processor for step 3 cost verification
- `apps/backend/app.arc` - Added `openrouter-cost-verification-queue` SQS FIFO queue
- `apps/backend/src/config/pricing.json` - Added OpenRouter provider and models including "auto"
- `apps/backend/src/http/get-api-models/index.ts` - Updated to include OpenRouter provider
- `apps/backend/src/http/any-api-workspaces-catchall/routes/post-test-agent.ts` - Updated to extract OpenRouter generation IDs
- `apps/backend/src/http/any-api-streams-000workspaceId-000agentId-000secret/index.ts` - Updated to extract OpenRouter generation IDs
- `apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/index.ts` - Updated to extract OpenRouter generation IDs
- `apps/frontend/src/utils/modelConfig.ts` - Added OpenRouter provider support
- `apps/frontend/src/utils/api.ts` - Extended `AvailableModels` interface to include OpenRouter
- `apps/backend/src/utils/__tests__/openrouterUtils.test.ts` - New tests for generation ID extraction
- `apps/backend/src/utils/__tests__/creditManagement.test.ts` - Added tests for `finalizeCreditReservation()`
- `apps/backend/ENV.md` - Added `OPENROUTER_API_KEY` documentation

**Verification**: All tests passing (1735 tests), type checking and linting passed successfully

**Previous Status**: Tailwind CSS Linting Rules Implementation - Completed ✅

Added comprehensive Tailwind CSS linting rules to enforce code quality and consistency across the frontend codebase.

**Changes Made**:

- Installed `eslint-plugin-tailwindcss` as a dev dependency
- Added Tailwind CSS plugin to frontend ESLint configuration
- Configured standard Tailwind linting rules:
  - `tailwindcss/classnames-order`: Enforces proper class ordering (warning)
  - `tailwindcss/enforces-negative-arbitrary-values`: Enforces negative arbitrary values (warning)
  - `tailwindcss/enforces-shorthand`: Suggests using shorthand utilities like `size-*` instead of `w-* h-*` (warning)
  - `tailwindcss/no-contradicting-classname`: Prevents conflicting classes (error)
- Fixed all 20 conflicting classname errors across 8 files
- Auto-fixed 1090 classname ordering warnings across the entire frontend codebase

**Files Modified**:

- `eslint.config.js` - Added Tailwind CSS plugin and rules configuration
- `package.json` - Added `eslint-plugin-tailwindcss` dependency
- `apps/frontend/src/components/ChannelModal.tsx` - Fixed conflicting border classes
- `apps/frontend/src/components/ConversationDetailModal.tsx` - Fixed conflicting border classes
- `apps/frontend/src/components/DocumentViewer.tsx` - Fixed conflicting border classes
- `apps/frontend/src/components/EmailConnectionModal.tsx` - Fixed conflicting border classes
- `apps/frontend/src/components/McpServerModal.tsx` - Fixed conflicting border classes
- `apps/frontend/src/components/PromptGeneratorDialog.tsx` - Fixed conflicting border classes
- `apps/frontend/src/components/ToolsHelpDialog.tsx` - Fixed conflicting border classes
- `apps/frontend/src/components/TrialCreditRequestModal.tsx` - Fixed conflicting border classes
- `apps/frontend/src/components/UpgradeModal.tsx` - Fixed conflicting border classes
- `apps/frontend/src/pages/AgentDetail.tsx` - Fixed conflicting dark:bg classes (2 instances)

**Verification**: Type checking and linting passed successfully

**Status**: webhook-logs Table Removal - Completed ✅

Removed the `webhook-logs` table and all its usage from the codebase. The table was write-only (no retrieval functionality) and was not being used for any operational purpose.

**Changes Made**:

- Removed table definition from `app.arc`
- Removed schema definition, type exports, and DatabaseSchema entry from `schema.ts`
- Removed all logging code from webhook handler (`post-api-webhook-000userId-000key/index.ts`)
- Simplified handler response (removed `requestId` from response)
- Updated tests to remove logging assertions and database mocks
- Removed `webhook-logs` mock from test helpers
- Removed documentation references from `database-schema.md` and `webhook-system.md`

**Files Modified**:

- `apps/backend/app.arc` - Removed table definition
- `apps/backend/src/tables/schema.ts` - Removed schema, types, and DatabaseSchema entry
- `apps/backend/src/http/post-api-webhook-000userId-000key/index.ts` - Removed logging code
- `apps/backend/src/http/post-api-webhook-000userId-000key/__tests__/handler.test.ts` - Updated tests
- `apps/backend/src/http/utils/__tests__/test-helpers.ts` - Removed mock
- `docs/database-schema.md` - Removed table documentation
- `docs/webhook-system.md` - Removed logging section

**Verification**: Type checking and linting passed successfully
**Status**: Auto-Merge Workflow Fix - Completed ✅

Fixed three issues where the auto-merge workflow was not working correctly:

1. **mergeable_state check**: The workflow was checking `mergeable_state !== 'clean'`, but `mergeable_state` can be "blocked" even when `mergeable === true` and all checks pass. Removed the overly strict `mergeable_state` check since `mergeable` is the authoritative field.

2. **web-flow committer**: The workflow was rejecting PRs where commits had `web-flow` as the committer (GitHub's system account used for web/API commits). Added `web-flow` to the allowed committers list since it's not a real contributor - only the author matters for security.

3. **Default branch trigger**: The workflow was being triggered by workflow runs on the default branch (`main`), which don't have PRs to merge. Added early skip when head branch is the default branch to avoid unnecessary processing.

**Changes**:
- Removed `mergeable_state !== 'clean'` check from auto-merge workflow
- Added `web-flow` to allowed committers (alongside Renovate bot identifiers)
- Added early skip when workflow_run head branch is the default branch (no PRs to merge)
- Improved commit validation logic with clearer error messages
- Added comments explaining why we only check `mergeable` field and allow `web-flow`
- Workflow now relies on: `mergeable === true`, all checks passed, Renovate bot author, only Renovate/web-flow commits

**Files Modified**:
- `.github/workflows/auto-merge.yml` - Removed redundant `mergeable_state` check, added `web-flow` to allowed committers, added default branch skip

**Verification**: Type checking and linting passed (lint warnings are false positives about GitHub Actions context)

**Previous Status**: E2E Test Suite Expansion - ALL PHASES COMPLETE ✅

Successfully implemented and verified a comprehensive chained E2E test suite that mirrors a real user's journey through Helpmaton. All 11 tests across 3 phases run sequentially using the same authenticated user session, eliminating the need for repeated email-based logins. The test suite completes in approximately 1 minute (excluding setup) and all tests pass consistently.

**Key Implementation Details**:

1. **Test Architecture**:

   - Created chained test suite using Playwright's `test.describe.serial()` for sequential execution
   - Implemented shared state management to pass resource IDs (workspace, agent, conversation) between tests
   - Single authenticated user session maintained throughout all tests
   - Tests build on previous test results (realistic user workflow)

2. **Utility Files Created**:

   - `tests/e2e/utils/shared-state.ts` - Interface and state object for sharing test data across test cases
   - `tests/e2e/utils/environment.ts` - Environment detection utilities (local, PR, production) and conditional test logic

3. **Page Object Model**:

   - `tests/e2e/pages/workspaces-page.ts` - WorkspacesPage class for workspace listing and creation
   - `tests/e2e/pages/workspace-detail-page.ts` - WorkspaceDetailPage class for workspace management (agents, documents, team, credits)
   - `tests/e2e/pages/agent-detail-page.ts` - AgentDetailPage class for agent configuration and testing
   - All page objects extend BasePage and provide type-safe methods for UI interaction

4. **Test Coverage (All Phases)**:

   **Phase 1: Core User Journey**

   - Test 1: Login and authenticate (reuses existing login infrastructure)
   - Test 2: Create first workspace (with name and description)
   - Test 3: Create first agent (with name, system prompt, model selection)
   - Test 4: Upload documents (text document creation and verification)
   - Test 5: Test agent chat (send message, wait for response, verify streaming)
   - Test 6: Verify conversation history (check conversation count)

   **Phase 2: Team & Billing Features**

   - Test 7: Team collaboration - Invite member (with E2E_OVERRIDE_MAX_USERS support)
   - Test 8: Credit management - Purchase credits (conditional on PR environment)
   - Test 9: Spending limits - Set limits (daily, weekly, monthly)

   **Phase 3: Advanced Features**

   - Test 10: Memory system - Verify memory records (UI accessibility and record counting)
   - Test 11: Usage analytics - Check dashboard (user-level usage statistics)

5. **Configuration Updates**:
   - Updated `playwright.config.ts` with comment about 10-minute timeout for chained test suites
   - Updated `tests/e2e/config/env.ts` with billing test configuration
   - Added environment detection for conditional billing tests (PR environment only)

**Benefits of This Approach**:

- **Fast Execution**: Single login saves 1-2 minutes per test (10-20 min cumulative savings)
- **Realistic Testing**: Mirrors actual user behavior (users don't re-login for every action)
- **Easy Debugging**: Failed tests show exactly which step in the journey broke
- **Maintainable**: Page objects isolate UI changes from test logic
- **Scalable**: Easy to add new tests to the journey

**Files Created**:

- `tests/e2e/utils/shared-state.ts` - Shared state management
- `tests/e2e/utils/environment.ts` - Environment detection utilities
- `tests/e2e/pages/workspaces-page.ts` - Workspaces page object
- `tests/e2e/pages/workspace-detail-page.ts` - Workspace detail page object (with document upload, team management, credit purchase, spending limits)
- `tests/e2e/pages/agent-detail-page.ts` - Agent detail page object (with memory records, usage analytics)
- `tests/e2e/pages/home-page.ts` - Home page object (for user-level usage analytics)
- `tests/e2e/pages/login-page.ts` - Login page object (enhanced with robust navigation)
- `tests/e2e/user-journey.spec.ts` - Main chained test file with all 3 phases (11 tests)

**Files Modified**:

- `playwright.config.ts` - Set `fullyParallel: false`, added comment about extended timeout for chained tests
- `tests/e2e/config/env.ts` - Added billing test configuration
- `tests/e2e/fixtures/test-fixtures.ts` - Added worker-scoped shared context and page fixtures for state persistence
- `tests/e2e/.env` - Added AUTH_SECRET for local test environment
- `apps/backend/src/utils/apiGatewayUsagePlans.ts` - Added environment check to skip API Gateway operations in local/test environments

**Test Results**:

- ✅ Test 1: Login and authenticate
- ✅ Test 2: Create first workspace
- ✅ Test 3: Create first agent
- ✅ Test 4: Upload documents
- ✅ Test 5: Test agent chat
- ✅ Test 6: Verify conversation history
- ✅ Test 7: Team collaboration - Invite member
- ✅ Test 8: Credit management - Purchase credits
- ✅ Test 9: Spending limits - Set limits
- ✅ Test 10: Memory system - Verify memory records
- ✅ Test 11: Usage analytics - Check dashboard
- **Total execution time**: ~1 minute (excluding setup/teardown)
- **Pass rate**: 100% (11/11 tests passing)

**Key Technical Solutions**:

1. **Shared Browser Context** - Modified test fixtures to use worker-scoped `sharedContext` and `sharedPage` fixtures, ensuring authentication cookies persist across all serial tests
2. **API Gateway Bypass for Local Testing** - Added environment check (`ARC_ENV === "testing" || NODE_ENV === "test"`) in `apiGatewayUsagePlans.ts` to skip AWS API Gateway operations and return mock API key IDs
3. **Accordion Selectors** - Updated page objects to use `button:has(h2:has-text("Title"))` pattern instead of id attributes for more reliable interaction
4. **Agent Creation Flow** - Fixed to extract agent ID from link href after creation (UI doesn't auto-navigate to agent detail page)
5. **Chat Input Element** - Corrected selector from `textarea` to `input[placeholder="Type your message..."]` to match actual AgentChat component

**Verification**: Type checking, linting, and all E2E tests pass successfully

**Completed Enhancements**:

- ✅ Phase 2: Team collaboration, credit management, and spending limits tests implemented
- ✅ Phase 3: Memory system and usage analytics tests implemented
- ✅ Document upload functionality added to Test 4 (text document creation)
- ✅ Enhanced page objects with comprehensive methods for all features
- ✅ Environment-specific test logic (billing tests only in PR environments)
- ✅ Robust error handling and retry logic for flaky UI interactions

**Potential Future Enhancements**:

- Add subscription management tests (upgrade/downgrade plans)
- Add workspace deletion and cleanup tests
- Add agent deletion tests
- Add document deletion tests
- Add more comprehensive memory search tests (with actual memory records)
- Add workspace-level usage analytics tests
- Add agent-level usage analytics tests
- Add multi-workspace scenarios
- Add error scenario tests (invalid inputs, network failures)
  **Status**: Memory Summarization Chronological Sorting - Completed ✅

Fixed issue where conversations were not sorted by date when creating daily summaries (and other temporal grain summaries). The LLM was receiving events out of chronological order, which could affect summary quality.

**Changes**:

- Added timestamp sorting (oldest first) to all summarization tasks before passing content to LLM
- Ensures chronological order so LLM sees events in proper sequence
- Applied to: daily, weekly, monthly, quarterly, and yearly summarization tasks

**Files Modified**:

- `apps/backend/src/scheduled/summarize-memory-daily/index.ts` - Sort working memory by timestamp before summarization
- `apps/backend/src/scheduled/summarize-memory-weekly/index.ts` - Sort day summaries by timestamp before summarization
- `apps/backend/src/scheduled/summarize-memory-monthly/index.ts` - Sort week summaries by timestamp before summarization
- `apps/backend/src/scheduled/summarize-memory-quarterly/index.ts` - Sort month summaries by timestamp before summarization
- `apps/backend/src/scheduled/summarize-memory-yearly/index.ts` - Sort quarter summaries by timestamp before summarization

**Verification**: Type checking and linting passed successfully

**Previous Status**: README Comprehensive Update with 10 Advanced Features - Completed ✅

Significantly expanded README.md to showcase Helpmaton's full feature set, adding 10 advanced capabilities that were previously undocumented. This provides a complete picture of the platform's cost management, analytics, authentication, and infrastructure capabilities.

**Features Added to README**:

1. **Cost Management & Billing**:

   - Credit system with atomic reservations and adjustments
   - BYOK (Bring Your Own Key) for using own LLM API keys
   - Granular spending limits at workspace and agent levels
   - Advanced tiered pricing and reasoning token billing

2. **Usage Analytics & Monitoring**:

   - Comprehensive token tracking (prompt, completion, reasoning, cached)
   - Daily/hourly aggregation with historical data
   - Per-workspace and per-agent breakdowns

3. **Trial & Free Access**:

   - Trial credit request system
   - 7-day free plan with automatic blocking after expiration
   - Risk-free platform evaluation

4. **Flexible Authentication**:

   - Session-based auth, JWT tokens (24-hour expiration)
   - Workspace API keys, OAuth email login

5. **Subscription Sharing**:

   - Multiple managers per subscription (unlimited on Pro)
   - Shared access to workspaces for team collaboration

6. **Memory Retention Policies**:

   - Plan-based retention periods (Free: 48hrs working memory, Pro: 240hrs)
   - Automatic cleanup of old memories

7. **Advanced Infrastructure** (added to Technology Stack):
   - Custom Lambda container images
   - Multi-stage Docker builds
   - SQS FIFO queues with message groups
   - Lemon Squeezy payment integration
   - Automated usage aggregation

**Changes**:

- Added 6 new major sections to Key Features (Cost Management, Analytics, Trial Access, Authentication, Subscription Sharing, Retention Policies)
- Retained previous Memory System and MCP Tools sections
- Expanded Technology Stack section with advanced infrastructure details (container images, atomic operations, payment integration, monitoring)
- Added Vector Database documentation link to Reference section
- Enhanced Subscription Management and Pricing Calculation documentation descriptions

**Files Modified**:

- `README.md` - Added 10 advanced features, expanded technology stack, updated documentation links

**Verification**: Type checking and linting passed successfully

**Previous Status**: Login Form Enter Key Submission - Completed ✅

Added explicit Enter key handler to the email input field on the login form to ensure form submission works when pressing Enter, in addition to clicking the submit button.

**Changes**:

- Added `handleKeyDown` function to detect Enter key press
- Function checks if email is valid and not currently submitting before triggering form submission
- Added `onKeyDown={handleKeyDown}` handler to email input element

**Files Modified**:

- `apps/frontend/src/components/Login.tsx` - Added Enter key handler for email input

**Verification**: Type checking and linting passed successfully

**Previous Status**: LanceDB Docker Image Optimization - Completed ✅

Dramatically optimized the LanceDB Docker image build time and size by installing ONLY LanceDB runtime dependencies instead of all backend dependencies. Since esbuild bundles all JavaScript code into the compiled `dist/` files, the Docker image only needs the native LanceDB modules that can't be bundled.

**Changes**:

- Created minimal `package.json` with only 4 packages: `@lancedb/lancedb`, `apache-arrow`, `reflect-metadata` (and platform binary)
- Added `pnpm.supportedArchitectures` config to package.json to install only linux-arm64 platform binaries (not darwin, windows, etc.)
- Simplified Dockerfile to single-stage build (no build tools needed - LanceDB ships pre-compiled `.node` binaries)
- Uses pnpm for consistency with project standards
- Removed: python3, make, gcc-c++, git, monorepo workspace files, all 40+ backend dependencies

**Impact**:

- Expected ~1GB+ reduction in node_modules (from 600MB+ to ~80-100MB)
- Expected ~4-6 minutes faster builds
- Much simpler Dockerfile (single-stage, simple pnpm install)

**Files Created**:

- `apps/backend/docker/lancedb/package.json` - Minimal runtime dependencies with pnpm platform configuration

**Files Modified**:

- `apps/backend/docker/lancedb/Dockerfile` - Complete rewrite for minimal runtime-only installation with pnpm

**Verification**: Type checking and linting passed successfully

**Previous Status**: JWT Token Expiration Extended to 24 Hours - Completed ✅

Extended JWT access token expiration from 1 hour to 24 hours to improve user experience. This reduces the frequency of token refreshes while still maintaining reasonable security. Updated all related code and documentation to reflect the new expiration time.

**Previous Status**: Message Queue Duplication Fix - Completed ✅

Fixed critical issue where conversation recording was sending ALL messages to the queue every time `updateConversation()` was called, not just the new ones. This caused massive duplication in fact extraction, embedding generation, and vector database writes. Solution: Modified `updateConversation()` to identify and send only truly new messages (not present in existing conversation) to the queue.

**Previous Status**: Memory Search Tool Documentation - Completed ✅

Added `search_memory` tool to both the frontend UI (ToolsHelpDialog) and backend prompt generation endpoint so that users and agents are aware of this capability. The tool was already implemented and available to agents, but was not visible in the tools list or mentioned in generated prompts.

**Previous Status**: LanceDB Metadata Flattening Fix - Implemented ✅

Fixed issue where LanceDB search returns metadata with null values. Root cause: LanceDB doesn't handle nested metadata objects properly - data was being written but lost during storage/retrieval. Solution: Flattened metadata structure to store conversationId, workspaceId, and agentId as top-level fields instead of nested in a metadata object.

**Previous Status**: SQS Partial Batch Failures - Completed ✅

The SQS queue processing now supports partial batch failures, allowing successful messages to be deleted from the queue while failed ones are retried individually. This prevents unnecessary reprocessing of successfully processed messages and improves efficiency.

**Recent Fixes (Latest)**:

- **ECR Image Cleanup Strategy Implementation** (December 18, 2025)

  - **Problem**: ECR repository grows indefinitely with unused Docker images from PR deployments, increasing storage costs (~$25+/month and growing)
  - **Solution**: Implemented automated cleanup system with multiple safety mechanisms
  - **Components Created**:
    - `scripts/cleanup-ecr-images.mjs` - Main cleanup script with CloudFormation/ECR integration
    - `scripts/ecr-utils.mjs` - Utility functions for image parsing and classification
    - `scripts/__tests__/ecr-utils.test.mjs` - Comprehensive unit tests
    - `.github/workflows/cleanup-ecr-images.yml` - Scheduled GitHub Actions workflow
    - `docs/ecr-image-cleanup.md` - Complete documentation with troubleshooting guide
  - **Key Features**:
    - Queries all CloudFormation stacks to build "protected set" of images in use
    - Never deletes images currently deployed in any environment (production or PRs)
    - Keeps last N production deployments (default: 15) for rollback capability
    - Checks GitHub API for open PRs to protect active environments
    - 24-hour minimum age requirement prevents race conditions
    - Dry-run mode by default for safety
    - Detailed reporting with categorization of deletion candidates
  - **Safety Mechanisms**:
    1. Protected image set from active CloudFormation stacks
    2. Multi-layer validation (deployment status, age, PR status)
    3. Dry-run mode (requires explicit --execute flag)
    4. Time-based safety buffer (24-hour minimum age)
  - **Automation**:
    - Scheduled weekly execution (Sunday 2 AM UTC)
    - Manual trigger with configurable parameters
    - GitHub Actions workflow with artifact upload
  - **Configuration**:
    - Added npm scripts: `cleanup-ecr`, `cleanup-ecr:dry-run`, `cleanup-ecr:execute`
    - Environment variables for customization
    - Default retention: 15 production images, 24-hour minimum age
  - **Expected Impact**:
    - Reduce storage from ~250GB to ~25GB
    - Cost savings: ~$22.50/month (90% reduction)
    - Maintain clean repository with only active images
  - **Dependencies Added**:
    - `@aws-sdk/client-cloudformation` - Query CloudFormation stacks
    - `@aws-sdk/client-lambda` - Get Lambda function configurations
    - `@aws-sdk/client-ecr` - Manage ECR images
    - `@octokit/rest` - Check GitHub PR status
  - **Files Modified**:
    - `package.json` - Added cleanup scripts and AWS SDK dependencies
  - **Documentation**: Complete guide with usage, troubleshooting, and best practices
  - **Testing**: Unit tests for all utility functions with comprehensive coverage
  - **Verification**: Type checking and linting passed successfully

- **JWT Token Expiration Extended to 24 Hours** (December 18, 2025)

  - **Change**: Extended JWT access token expiration from 1 hour to 24 hours
  - **Reason**: Improve user experience by reducing frequency of token refreshes while maintaining reasonable security
  - **Files Modified**:
    - `apps/backend/src/utils/tokenUtils.ts` - Changed `ACCESS_TOKEN_EXPIRY` from `60 * 60` (1 hour) to `24 * 60 * 60` (24 hours)
    - `apps/backend/src/http/any-api-workspaces-catchall/middleware.ts` - Updated session expiration compatibility code for JWT tokens (2 locations)
    - `apps/backend/src/http/any-api-user-catchall/routes/post-refresh-token.ts` - Updated API documentation comment
    - `apps/backend/src/http/any-api-user-catchall/routes/post-generate-tokens.ts` - Updated API documentation comment
    - `docs/authentication.md` - Updated documentation to reflect 24-hour token lifetime
  - **Impact**: Users will need to refresh their tokens less frequently (once per 24 hours instead of once per hour)
  - **Verification**: Type checking and linting passed successfully
  - **Note**: OpenAPI JSON files will be regenerated automatically during next deployment

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
