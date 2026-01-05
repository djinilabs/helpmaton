# Active Context

## Current Status

**Status**: Agent Delegation Improvements - Completed ✅

**Latest Work**:

1. **Documentation Created**: Created comprehensive documentation (`docs/agent-delegation-backend-changes.md`) describing all backend changes for agent delegation improvements, including infrastructure changes, database schema updates, queue processing, agent matching algorithms, and delegation tracking.

2. **Agent Delegation Enhancements**: Enhanced agent delegation capabilities with async support, query-based agent matching, and comprehensive delegation tracking. Implemented new tools for asynchronous delegation, status checking, and cancellation, along with a queue-based processing system for long-running delegations.

**Previous Work**: Completed comprehensive refactoring of the stream handler to improve maintainability, ensure proper error logging, and eliminate dangling promises:

1. **Stream Handler Refactoring**: Significantly reduced complexity by extracting specialized utilities into separate files with distinct responsibilities. The main handler now acts as a router and orchestrator, making the codebase much easier to follow and maintain. Reduced main handler from 500+ lines to ~250 lines.

2. **Error Logging**: Ensured all errors are properly logged to Sentry. Previously ignored errors (like stream end failures) are now captured with appropriate context and tags. No errors are masked - all are either properly handled or logged to Sentry.

3. **Promise Handling**: Fixed dangling promises by ensuring all async operations are properly awaited or returned. No "fire and forget" promises remain in the codebase. All promises are either awaited or returned.

**Previous Work**: Fixed two critical issues with Lambda Function URLs in streaming mode (502 errors and CloudFormation IAM permissions). Also consolidated the `GET /api/streams/url` handler into the unified `/api/streams/*` catchall handler. The unified handler supports both Lambda Function URL (true streaming) and API Gateway (buffered streaming) invocations, with conditional authentication (JWT for test endpoint, secret for stream endpoint) and CORS headers.

**Recent Changes**:

1. **Stream Handler Refactoring** (Latest):

   - **Complexity Reduction**: Extracted monolithic handler into specialized utility files:
     - `streamEndpointDetection.ts` - Endpoint type detection and path extraction
     - `streamPathExtraction.ts` - Path parameter extraction
     - `streamCorsHeaders.ts` - CORS header computation and OPTIONS handling
     - `streamResponseStream.ts` - Response stream creation (real and mock)
     - `streamAIPipeline.ts` - AI stream to response stream piping
     - `streamRequestContext.ts` - Request context building
     - `streamAuthentication.ts` - JWT and secret-based authentication
     - `streamErrorHandling.ts` - Error handling and persistence
     - `streamPostProcessing.ts` - Credit adjustment, usage tracking, conversation logging
     - `streamExecution.ts` - Stream execution orchestration
     - `streamEventNormalization.ts` - Event type normalization
   - **URL Endpoint Isolation**: Moved `/api/streams/url` endpoint to separate handler file (`get-api-streams-url/index.ts`)
   - **Main Handler Simplification**: Reduced main handler from 500+ lines to ~250 lines, acting as router/orchestrator
   - **Test Coverage**: All existing tests pass, comprehensive unit tests for new utilities

2. **Error Logging Improvements** (Latest):

   - **Sentry Integration**: All previously ignored errors now logged to Sentry:
     - Stream end failures in error handling paths
     - Stream end failures in AI pipeline finally block
     - Conversation error persistence failures
     - Event flushing errors (PostHog/Sentry)
   - **Error Context**: All Sentry captures include appropriate tags and extra context
   - **No Masked Errors**: All errors are either properly handled or logged to Sentry

3. **Promise Handling Fixes** (Latest):

   - **Dangling Promise Fix**: Fixed issue where `persistConversationError` was called inside `.then()` without awaiting
   - **Promise Verification**: Verified all async operations are properly awaited or returned
   - **No Fire-and-Forget**: Eliminated all "fire and forget" promise patterns

4. **Lambda Function URL Streaming Fix** (Previous):

   - Fixed 502 errors by wrapping response stream with `HttpResponseStream.from()` before writing
   - Updated `/api/streams/url` endpoint to wrap stream with headers (status code 200/404, Content-Type: application/json)
   - Fixed early error handling to wrap stream before writing invalid path parameter errors
   - Updated catch block to wrap stream with appropriate headers before writing errors
   - All responses now properly formatted for Lambda Function URLs in RESPONSE_STREAM mode

5. **CloudFormation IAM Permissions Fix** (Latest):

   - Updated `lambda-urls` plugin to add CloudFormation permissions to all functions with Function URLs
   - Refactored `addIamPermissionsForStreamUrlLookup()` to accept array of function IDs instead of hardcoded name
   - Plugin now automatically grants `cloudformation:DescribeStacks` and `cloudformation:DescribeStackResources` permissions
   - Each function gets its own IAM policy (scoped to current CloudFormation stack)
   - Permissions added to all functions in `@lambda-urls` pragma automatically

6. **URL Endpoint Consolidation**:

   - Consolidated `GET /api/streams/url` handler into unified `/api/streams/*` catchall handler
   - Removed separate route from `app.arc` (was `get /api/streams/url`)
   - Added `"url"` endpoint type to `EndpointType` union
   - Moved URL retrieval functions (`getStreamingFunctionUrl`, `getFunctionUrlFromCloudFormation`) with caching logic into unified handler
   - URL endpoint now handled in both Lambda Function URL and API Gateway paths
   - Added 10 comprehensive tests for URL endpoint functionality
   - Fixed test cache clearing using `vi.resetModules()` and dynamic imports
   - Deleted old handler files (`get-api-streams-url/index.ts` and test file)

7. **Streaming Endpoints Unification** (Previous):

   - Updated `app.arc` to use catch-all route `any /api/streams/*` for both endpoints
   - Unified handler supports both `/api/streams/:workspaceId/:agentId/test` (JWT auth) and `/api/streams/:workspaceId/:agentId/:secret` (secret auth)
   - Added endpoint type detection based on path pattern
   - Supports both Lambda Function URL (true streaming) and API Gateway (buffered streaming) invocations
   - Created dual handler wrapper that automatically detects invocation method

8. **Authentication & Authorization**:

   - Test endpoint: JWT Bearer token authentication with workspace permission checks
   - Stream endpoint: Secret validation from path parameters
   - Conditional authentication logic based on detected endpoint type
   - Both authentication methods work with both invocation types (Lambda Function URL and API Gateway)

9. **CORS Headers**:

   - Test endpoint: Uses `FRONTEND_URL` environment variable for CORS headers
   - Stream endpoint: Uses agent's streaming server configuration (allowed origins from database)
   - Conditional CORS header generation based on endpoint type
   - All responses include appropriate CORS headers

10. **Streaming Implementation**:

    - Lambda Function URL: True streaming using `awslambda.streamifyResponse` (writes chunks as they arrive)
    - API Gateway: Buffered streaming (collects all chunks, returns complete response)
    - Automatic detection of invocation method
    - Same business logic for both streaming approaches

11. **Utility Relocation**:

    - Moved `types.ts` → `src/utils/messageTypes.ts` (used by non-HTTP utils)
    - Moved utilities to `src/http/utils/`:
      - `agentSetup.ts`, `messageConversion.ts`, `toolFormatting.ts`, `requestValidation.ts`
      - `streaming.ts`, `responseFormatting.ts`, `continuation.ts`, `toolCostExtraction.ts`
      - `responseStream.ts` → `responseStreamSetup.ts` (renamed to avoid conflict)
    - Moved all test files to `src/http/utils/__tests__/agentUtils/`
    - Updated all imports across the codebase (12+ files)

12. **Express Handler Cleanup**:

    - Removed `registerPostTestAgent` from Express app
    - Old Express route handler deprecated (still exists but not registered)
    - All test agent requests now go through unified streaming handler

13. **Error Handling**:
    - BYOK authentication error detection preserved
    - Credit error handling with proper formatting
    - Error responses include appropriate CORS headers based on endpoint type
    - All error paths properly handled for both invocation methods

**Files Created**:

- None (consolidated into existing unified handler)

**Files Created** (Latest):

- `apps/backend/src/http/get-api-streams-url/index.ts` - URL endpoint handler (isolated from main handler)
- `apps/backend/src/http/utils/streamEndpointDetection.ts` - Endpoint type detection utilities
- `apps/backend/src/http/utils/streamPathExtraction.ts` - Path parameter extraction utilities
- `apps/backend/src/http/utils/streamCorsHeaders.ts` - CORS header computation utilities
- `apps/backend/src/http/utils/streamResponseStream.ts` - Response stream creation utilities
- `apps/backend/src/http/utils/streamAIPipeline.ts` - AI stream piping utilities
- `apps/backend/src/http/utils/streamRequestContext.ts` - Request context building utilities
- `apps/backend/src/http/utils/streamAuthentication.ts` - Authentication utilities
- `apps/backend/src/http/utils/streamErrorHandling.ts` - Error handling and persistence utilities
- `apps/backend/src/http/utils/streamPostProcessing.ts` - Post-processing utilities (credits, usage, logging)
- `apps/backend/src/http/utils/streamExecution.ts` - Stream execution orchestration utilities
- `apps/backend/src/http/utils/streamEventNormalization.ts` - Event normalization utilities
- `apps/backend/src/http/utils/__tests__/streamEndpointDetection.test.ts` - Unit tests
- `apps/backend/src/http/utils/__tests__/streamPathExtraction.test.ts` - Unit tests
- `apps/backend/src/http/utils/__tests__/streamCorsHeaders.test.ts` - Unit tests
- `apps/backend/src/http/utils/__tests__/streamResponseStream.test.ts` - Unit tests
- `apps/backend/src/http/utils/__tests__/streamAIPipeline.test.ts` - Unit tests
- `apps/backend/src/http/utils/__tests__/streamRequestContext.test.ts` - Unit tests
- `apps/backend/src/http/utils/__tests__/streamAuthentication.test.ts` - Unit tests
- `apps/backend/src/http/utils/__tests__/streamErrorHandling.test.ts` - Unit tests
- `apps/backend/src/http/utils/__tests__/streamPostProcessing.test.ts` - Unit tests
- `apps/backend/src/http/utils/__tests__/streamExecution.test.ts` - Unit tests
- `apps/backend/src/http/utils/__tests__/streamEventNormalization.test.ts` - Unit tests

**Files Modified** (Latest):

- `apps/backend/src/http/any-api-streams-catchall/index.ts` - Refactored to use extracted utilities; reduced from 500+ lines to ~250 lines; fixed dangling promise; added Sentry logging for all error paths
- `apps/backend/src/http/utils/streamErrorHandling.ts` - Added Sentry logging for all error paths (stream end failures, persistence failures)
- `apps/backend/src/http/utils/streamAIPipeline.ts` - Added Sentry logging for stream end failures in finally block
- `apps/backend/src/http/utils/streamPostProcessing.ts` - Fixed promise handling in tool extraction; added Sentry logging for conversation logging errors

**Files Modified** (Previous):

- `apps/backend/src/http/any-api-streams-catchall/index.ts` - Fixed response stream wrapping for `/api/streams/url` endpoint and error handling paths; all responses now properly wrap stream with headers before writing
- `apps/backend/src/plugins/lambda-urls/index.js` - Refactored IAM permissions function to accept multiple function IDs; automatically grants CloudFormation permissions to all functions with Function URLs

**Files Modified** (Previous):

- `apps/backend/app.arc` - Removed `get /api/streams/url` route (now handled by catch-all `any /api/streams/*`)
- `apps/backend/src/http/any-api-streams-catchall/index.ts` - Added URL endpoint handling with CloudFormation lookup, caching, and environment variable support; added `"url"` endpoint type; integrated URL endpoint into both Lambda Function URL and API Gateway paths
- `apps/backend/src/http/any-api-streams-catchall/__tests__/handler.test.ts` - Added 10 tests for URL endpoint (environment variable, CloudFormation lookup, error handling, method validation); fixed cache clearing between tests using `vi.resetModules()` and dynamic imports
- `apps/frontend/src/utils/api.ts` - Updated `getStreamUrl()` to call unified `/api/streams/url` endpoint
- `docs/streaming-system.md` - Updated documentation to reflect URL endpoint consolidation

**Files Removed**:

- `apps/backend/src/http/get-api-streams-url/index.ts` - Handler functionality moved to unified handler
- `apps/backend/src/http/get-api-streams-url/__tests__/handler.test.ts` - Tests moved to unified handler test file
- `apps/backend/src/http/utils/agentSetup.ts` - Moved from old location, updated imports
- `apps/backend/src/http/utils/messageConversion.ts` - Moved from old location, updated imports
- `apps/backend/src/http/utils/toolFormatting.ts` - Moved from old location, updated imports
- `apps/backend/src/http/utils/requestValidation.ts` - Moved from old location, updated imports
- `apps/backend/src/http/utils/streaming.ts` - Moved from old location, updated imports
- `apps/backend/src/http/utils/responseFormatting.ts` - Moved from old location, updated imports
- `apps/backend/src/http/utils/continuation.ts` - Moved from old location, updated imports
- `apps/backend/src/http/utils/toolCostExtraction.ts` - Moved from old location, updated imports
- `apps/backend/src/http/utils/responseStreamSetup.ts` - Moved and renamed from old location, updated imports
- `apps/backend/src/utils/messageTypes.ts` - Moved from old location (was `types.ts`)
- `apps/backend/src/http/utils/__tests__/agentUtils/*.test.ts` - Moved all test files, updated imports
- `apps/backend/src/http/any-api-workspaces-catchall/workspaces-app.ts` - Removed `registerPostTestAgent` registration
- Updated 12+ files with new import paths for relocated utilities

**Files Removed**:

- `apps/backend/src/http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/__tests__/` - Test files moved to new location

**Configuration**:

- Route: `any /api/streams/*` (catch-all for all streaming endpoints)
- Test endpoint: `/api/streams/:workspaceId/:agentId/test` (JWT auth, FRONTEND_URL CORS)
- Stream endpoint: `/api/streams/:workspaceId/:agentId/:secret` (secret auth, agent config CORS)
- URL endpoint: `/api/streams/url` (GET only, returns streaming Function URL, no auth required)
- Handler: Unified Lambda handler supporting both Lambda Function URL and API Gateway
- CORS: Conditional based on endpoint type
- Local Development: Automatic detection, uses appropriate streaming method
- URL Discovery: Supports `STREAMING_FUNCTION_URL` env var, CloudFormation stack outputs, with 5-minute cache TTL

**Verification**: All tests passing (211 tests in stream handler utilities, 17 test files), typecheck and lint clean ✅

**Latest Verification**: Typecheck, lint, and all handler tests passing after refactoring, error logging improvements, and promise handling fixes ✅

**Code Quality Improvements**:

- Reduced main handler complexity by ~50% (500+ lines → ~250 lines)
- Created 11 specialized utility modules with single responsibilities
- All errors properly logged to Sentry (no masked errors)
- All promises properly awaited or returned (no dangling promises)
- Comprehensive test coverage for all new utilities

**Previous Status**: Stream Handler Refactoring & Code Quality Improvements - Completed ✅

**Previous Work**: Completed comprehensive refactoring of the stream handler (`apps/backend/src/http/any-api-streams-catchall/index.ts`) to improve maintainability and code quality. The refactoring extracted specialized utilities into separate files, ensured all errors are logged to Sentry, and eliminated all dangling promises.

**Previous Status**: Scrape Endpoint Lambda Function URL Conversion - Completed ✅

**Previous Work**: Converted `/api/scrape` endpoint from API Gateway to Lambda Function URLs to support the full 6-minute timeout. API Gateway has a hard 29-second timeout limit that was causing early connection terminations even though the Lambda continued running. The endpoint now uses Lambda Function URLs which support up to 15 minutes, allowing the full 6-minute timeout to work correctly. Implemented dynamic URL discovery with caching to minimize AWS API calls, and added local development support that automatically uses API Gateway URL in sandbox environments.

**Recent Changes**:

1. **Lambda Function URL Integration**:

   - Added `post /api/scrape` to `@lambda-urls` pragma in `app.arc`
   - Lambda Function URLs support up to 15 minutes (exceeds 6-minute Lambda timeout)
   - Created `ScrapeFunctionUrl` CloudFormation output (consistent with `StreamingFunctionUrl`)
   - Updated lambda-urls plugin to recognize scrape route and use clean output naming

2. **Dynamic URL Discovery with Caching**:

   - Created `apps/backend/src/http/utils/scrapeUrl.ts` utility module
   - `getScrapeFunctionUrl()`: Main function with 5-minute cache TTL
   - `getScrapeFunctionUrlFromCloudFormation()`: Queries CloudFormation stack outputs
   - Environment variable support: `SCRAPE_FUNCTION_URL` for explicit configuration
   - Graceful fallback to API Gateway URL if Function URL unavailable

3. **Local Development Support**:

   - Automatically detects local sandbox (`ARC_ENV === "testing"`)
   - Bypasses Function URL discovery in local development
   - Uses API Gateway URL directly (`getApiBaseUrl() + "/api/scrape"`)
   - No caching needed for local dev (always uses localhost)
   - Function URLs in deployed environments include `/api/scrape` path automatically

4. **Tool Integration**:
   - Updated `createScrapeFetchTool()` in `tavilyTools.ts` to use `getScrapeFunctionUrl()`
   - Removed unused `getApiBaseUrl()` function from `tavilyTools.ts`
   - Tool automatically adapts to environment (Function URL in deployed, API Gateway in local)

**Files Created**:

- `apps/backend/src/http/utils/scrapeUrl.ts` - Function URL utility with caching and local dev support

**Files Modified**:

- `apps/backend/app.arc` - Added `post /api/scrape` to `@lambda-urls` pragma
- `apps/backend/src/http/utils/tavilyTools.ts` - Updated to use `getScrapeFunctionUrl()`, removed unused `getApiBaseUrl()`
- `apps/backend/src/plugins/lambda-urls/index.js` - Added special case for scrape route with `ScrapeFunctionUrl` output name

**Configuration**:

- Function URL Output: `ScrapeFunctionUrl` (CloudFormation output)
- Cache TTL: 5 minutes (same as streaming URL)
- Local Development: Uses API Gateway URL (`http://localhost:3333/api/scrape`)
- Fallback: API Gateway URL if Function URL unavailable

**Verification**: All tests passing, typecheck and lint clean ✅

**Previous Status**: Puppeteer Dockerfile Package Manager Fix - Completed ✅

**Previous Work**: Fixed Docker build failure for puppeteer container image. The Dockerfile was using `yum` (Amazon Linux 2) but the base image `public.ecr.aws/lambda/nodejs:20` uses Amazon Linux 2023 which requires `dnf`. Updated all `yum` commands to `dnf` and corrected the comment.

**Previous Status**: Puppeteer Web Scraping Endpoint - Completed ✅

**Latest Work**: Implemented a web scraping endpoint (`POST /api/scrape`) that uses Puppeteer to scrape any URL and return the Accessibility Object Model (AOM) as XML. The endpoint uses Decodo residential proxies, blocks unnecessary resources, and charges workspace credits per successful request.

**Recent Changes**:

1. **Puppeteer Scraping Endpoint**:

   - Created `POST /api/scrape` endpoint that accepts a URL and returns AOM as XML
   - Uses Puppeteer with headless Chrome to scrape web pages
   - Waits for client-side generated content (`networkidle2`)
   - Navigation timeout: 5 minutes (300000 ms) to handle slow-loading sites and CAPTCHA solving
   - Extracts Accessibility Object Model (AOM) using Puppeteer's accessibility snapshot API
   - Falls back to DOM traversal if accessibility snapshot fails
   - Converts AOM tree to XML format with proper escaping
   - Enhanced content extraction for JavaScript-heavy sites (Reddit, etc.) with Shadow DOM traversal
   - Content loading strategy: waits for substantial content, scrolls to trigger lazy-loaded content, then extracts AOM

2. **Stealth Plugin & Anti-Detection**:

   - Integrated `puppeteer-extra-plugin-stealth` with all evasions explicitly enabled
   - Verifies and logs all enabled evasions on startup
   - Uses Windows Chrome user agent (more common than Mac) for better stealth
   - Chrome launch arguments configured to reduce automation detection
   - Disabled site isolation to allow access to cross-origin iframes (needed for reCAPTCHA)

3. **CAPTCHA Solving Integration**:

   - Integrated `puppeteer-extra-plugin-recaptcha` with 2Captcha provider
   - Automatically detects and solves reCAPTCHAs on main frame and all child frames
   - Supports Reddit's custom `reputation-recaptcha` element detection
   - Waits up to 35 seconds for CAPTCHA solving to complete
   - Comprehensive logging for CAPTCHA detection and solving process
   - API key configured via `TWOCAPTCHA_API_KEY` environment variable

4. **Decodo Residential Proxy Integration**:

   - Randomly selects proxy URL from `DECODO_PROXY_URLS` environment variable (JSON array)
   - Proxy URLs formatted as `http://username:password@gate.decodo.com:port` (ports 10001-10010)
   - Extracts and validates proxy credentials from URL
   - Authenticates with proxy using Puppeteer's `page.authenticate()` method

5. **Resource Blocking** (Currently Disabled):

   - Resource blocking temporarily disabled to ensure full page rendering for screenshots and AOM extraction
   - Previously blocked: images, CSS, fonts, media files, subframes, and known tracker domains
   - Can be re-enabled via `setupResourceBlocking()` function if needed

6. **Docker Container Image**:

   - Created `apps/backend/docker/puppeteer/Dockerfile` for Lambda container image
   - Installs Chrome via `@puppeteer/browsers` for linux-arm64 architecture
   - Includes all required system dependencies for headless Chrome
   - Configured for 2048 MB memory limit
   - Image automatically built in CI/CD workflows

7. **Authentication & Authorization**:

   - Validates encrypted JWT token from Authorization header
   - Extracts `workspaceId`, `agentId`, and `conversationId` from token payload
   - Uses `jwtDecrypt` from `jose` library for token decryption
   - Validates token issuer and audience

8. **Workspace Credit Charging**:

   - Charges 0.005 USD (5000 millionths) per successful scrape request
   - Uses workspace credit transaction system (only charges on success)
   - Transaction committed atomically at end of request via `handlingErrors` wrapper
   - Transaction includes workspaceId, agentId, conversationId, and URL in description

9. **Error Handling & Monitoring**:
   - Reports server errors to Sentry with full context (handler, method, path, status code)
   - Flushes Sentry events before request completes (critical for Lambda)
   - Reports browser cleanup errors to Sentry
   - Comprehensive error handling with proper browser cleanup in finally block

**Files Created**:

- `apps/backend/src/http/post-api-scrape/index.ts` - Main endpoint handler
- `apps/backend/src/http/post-api-scrape/__tests__/index.test.ts` - Unit tests
- `apps/backend/docker/puppeteer/Dockerfile` - Docker container image
- `apps/backend/docker/puppeteer/package.json` - Minimal runtime dependencies

**Files Modified**:

- `apps/backend/app.arc` - Added route and container image configuration
- `apps/backend/src/http/post-api-scrape/config.arc` - Configured 6-minute Lambda timeout
- `apps/backend/src/http/post-api-scrape/index.ts` - Main handler with stealth plugin, CAPTCHA solving, enhanced content extraction
- `apps/backend/docker/puppeteer/package.json` - Added `puppeteer-extra`, `puppeteer-extra-plugin-recaptcha`, `puppeteer-extra-plugin-stealth`
- `apps/backend/package.json` - Added stealth and reCAPTCHA plugins to devDependencies for type checking
- `esbuild-config.cjs` - Added `TWOCAPTCHA_API_KEY` and `DECODO_PROXY_URLS` to environment variables, externalized stealth plugin
- `scripts/build-backend.ts` - Externalized stealth plugin in esbuild config
- `apps/backend/src/plugins/container-images/index.js` - Configured 2048 MB memory for scrape endpoint
- `apps/backend/ENV.md` - Documented `DECODO_PROXY_URLS` and `TWOCAPTCHA_API_KEY` environment variables
- `.github/workflows/deploy-pr.yml` - Added `DECODO_PROXY_URLS` and `TWOCAPTCHA_API_KEY` to environment variables
- `.github/workflows/deploy-prod.yml` - Added `DECODO_PROXY_URLS` and `TWOCAPTCHA_API_KEY` to environment variables

**Configuration**:

- Route: `POST /api/scrape`
- Container Image: `puppeteer`
- Memory: 2048 MB
- Lambda Timeout: 360 seconds (6 minutes) - configured in `config.arc`
- Navigation Timeout: 300000 ms (5 minutes) - for `page.goto()` calls
- Architecture: arm64 (Graviton2)
- User Agent: Windows Chrome (Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...)
- Stealth Plugin: All evasions enabled with verification and logging

**Verification**: All tests passing, typecheck and lint clean ✅

**Previous Status**: Web Fetch Tool Rename - Completed ✅

**Previous Work**: Renamed the `fetch_web` tool to `fetch_url` throughout the entire codebase for better clarity and consistency. The tool name now more accurately reflects its purpose of fetching content from specific URLs rather than general web content.

**Recent Changes**:

1. **Tool Name Rename (`fetch_web` → `fetch_url`)**:
   - Renamed tool from `fetch_web` to `fetch_url` across all backend and frontend code
   - Updated tool registration in agent setup and delegation logic
   - Updated all error messages, descriptions, and documentation references
   - Updated type definitions in `tavilyCredits.ts` to use `fetch_url`
   - Updated schema comments to reflect new tool name
   - Updated frontend UI components (ToolsHelpDialog, AgentDetail) with new tool name
   - Updated all documentation files (tavily-integration.md, agent-configuration.md, README.md)

**Files Modified**:

- `apps/backend/src/http/utils/tavilyTools.ts` - All tool references and error messages
- `apps/backend/src/tables/schema.ts` - Schema comment
- `apps/backend/src/http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup.ts` - Tool registration
- `apps/backend/src/http/utils/agentUtils.ts` - Tool registration
- `apps/backend/src/utils/tavilyCredits.ts` - Type definitions and comments
- `apps/backend/src/http/utils/__tests__/tavilyTools.test.ts` - Test references
- `apps/frontend/src/components/ToolsHelpDialog.tsx` - Tool name and descriptions
- `apps/frontend/src/pages/AgentDetail.tsx` - UI text and descriptions
- `docs/tavily-integration.md` - All references
- `docs/agent-configuration.md` - Tool documentation
- `README.md` - Feature description
- `memory/activeContext.md` - Context documentation

**Verification**: All tests passing (1902 tests), typecheck and lint clean ✅

**Previous Status**: Multi-Table Atomic Update API with DynamoDB Transactions - Completed ✅

**Previous Work**: Implemented a database-level `atomicUpdate` method that enables multi-table DynamoDB transactions with optimistic concurrency control. This allows users to atomically update multiple records across different tables with automatic retries on version conflicts.

**Previous Changes**:

1. **Multi-Table Atomic Update API**:

   - Added `atomicUpdate` method to database object for multi-table transactions
   - Supports fetching multiple records, passing them to a callback function, and executing a DynamoDB transaction
   - Implements optimistic concurrency control with version number checks
   - Automatic retry logic (max 3 retries) on version conflicts with no exponential backoff
   - Schema validation for all records before transaction execution
   - Support for both create and update operations in the same transaction

2. **Type Definitions**:

   - Added `RecordSpec` type for specifying records to fetch (table, pk, optional sk)
   - Added `AtomicUpdateRecordSpec` type (Map of record specs keyed by string identifiers)
   - Added `AtomicUpdateCallback` type for user-provided callback functions
   - Added `TableRecord` union type for all possible table record types
   - Extended `DatabaseSchema` with `DatabaseSchemaWithAtomicUpdate` type

3. **Implementation Details**:

   - Fetch phase: Retrieves all specified records (passes `undefined` if not found)
   - Callback phase: Calls user-provided function with Map of fetched records
   - Validation phase: Validates each returned record against its table schema
   - Transaction building: Creates `TransactWriteItems` with version checks:
     - Updates: `#version = :expectedVersion` condition
     - Creates: `attribute_not_exists(pk)` condition
   - Transaction execution: Executes DynamoDB transaction with retry logic
   - Table name translation: Maps logical table names to physical DynamoDB table names

4. **Test Coverage**:
   - 12 comprehensive unit tests covering all scenarios
   - Single table operations (create and update)
   - Multi-table transactions (2+ tables)
   - Version conflict retry logic
   - Missing records handling
   - Schema validation failures
   - Record matching by pk/sk
   - Empty callback results
   - Non-conditional error handling

**Files Modified**:

- `apps/backend/src/tables/schema.ts` - Added type definitions (RecordSpec, AtomicUpdateRecordSpec, AtomicUpdateCallback, TableRecord, DatabaseSchemaWithAtomicUpdate)
- `apps/backend/src/tables/database.ts` - Implemented atomicUpdate method with fetch, callback, validation, transaction building, and retry logic
- `apps/backend/src/tables/__tests__/database.test.ts` - Created comprehensive test suite (12 tests)

**Verification**: All tests passing (12 tests), typecheck and lint clean ✅

**Previous Status**: OpenRouter Cost Verification Retry Logic & Error Handling - Completed ✅

**Previous Work**: Added exponential backoff retry logic to OpenRouter cost fetching with proper error handling to ensure no masked errors. All errors that prevent cost computation are now properly thrown and logged.

**Recent Changes**:

1. **OpenRouter Cost Verification Retry Logic**:

   - Added exponential backoff retry mechanism to `fetchOpenRouterCost()` function
   - Configuration: Initial delay 500ms, max 3 retries (4 total attempts), max delay 5 seconds, multiplier 2x
   - Retries on: Server errors (5xx), rate limits (429), and network errors (fetch failures, connection refused, timeouts)
   - Does not retry on: 404 (generation not found - permanent failure), other 4xx errors
   - Added jitter (0-20% random) to prevent thundering herd problems
   - Comprehensive logging for each retry attempt with delay and error details

2. **Error Handling Improvements**:

   - Changed `fetchOpenRouterCost()` return type from `Promise<number | null>` to `Promise<number>` - always returns cost or throws error
   - 404 errors now throw errors instead of returning null (cannot compute cost if generation not found)
   - Missing cost field in response now throws error instead of returning null (cannot compute cost without data)
   - All errors are properly propagated to handler wrapper for logging and SQS batch failure tracking
   - Removed null checks in calling code - errors are handled by handler wrapper

3. **Test Updates**:
   - Updated tests to expect errors to be thrown when cost cannot be computed
   - Added reservation mocks to tests that were missing them (required for atomic update logic)
   - Fixed cost calculation expectations for multiple generation IDs (markup applied individually, then summed)
   - Updated test expectations to verify messages are marked as failed in batch response when errors occur
   - All 1,835 tests passing

**Files Modified**:

- `apps/backend/src/queues/openrouter-cost-verification-queue/index.ts` - Added retry logic with exponential backoff, changed error handling to throw instead of return null
- `apps/backend/src/queues/openrouter-cost-verification-queue/__tests__/index.test.ts` - Updated tests for new error-throwing behavior, added reservation mocks, fixed cost calculations
- `apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/index.ts` - Fixed variable scope for openrouterGenerationIds
- `apps/backend/src/http/utils/agentUtils.ts` - Fixed import order, removed unused variable, changed endpoint type
- `apps/backend/src/utils/__tests__/creditManagement.test.ts` - Added mockUpdate variable reference

**Verification**: All tests passing (1,835 tests), typecheck and lint clean ✅

**Previous Status**: Message Storage Simplification & Tool Call Display - Completed ✅

**Previous Work**: Simplified message storage by removing redundant toolCalls/toolResults fields, fixed tool call duplication, and enhanced UI to display tool calls/results properly.

**Previous Changes**:

1. **Message Storage Simplification**:

   - Removed `toolCalls` and `toolResults` fields from `agent-conversations` schema
   - Tool calls and results are now stored only as messages within the `messages` array
   - Removed empty message filtering (keeps all messages including empty ones to prevent bugs)
   - Updated all API endpoints (test, webhook, stream) to remove toolCalls/toolResults from responses
   - Updated frontend types and UI components to remove references to deprecated fields
   - Updated database schema documentation

2. **Tool Call Extraction from \_steps**:

   - Updated test endpoint to use `_steps` as source of truth for tool calls/results
   - When tools execute server-side, the AI SDK stores them in `result._steps.status.value`
   - Test endpoint now extracts from `_steps` first, falls back to direct properties if needed
   - Added diagnostic logging for API key usage and tool call extraction
   - Fixed issue where server-side tool executions weren't being recorded

3. **Tool Call Duplication Fix**:

   - Fixed `expandMessagesWithToolCalls()` to prevent duplicate tool calls/results
   - Previously created separate messages AND kept original message with all content
   - Now creates separate messages for tool calls/results, and text-only message if text exists
   - Preserves metadata (tokenUsage, costs, etc.) on the text-only message
   - Fix applies to all endpoints (test, webhook, stream) automatically

4. **Frontend UI Enhancements**:
   - Updated `ConversationDetailModal` to display tool-call and tool-result content with proper UI components
   - Tool calls shown in blue boxes with expandable arguments section
   - Tool results shown in green boxes with expandable results section
   - Supports markdown rendering for string results, JSON formatting for object results
   - Visual distinction between tool calls, tool results, and text content

**Files Modified**:

- `apps/backend/src/tables/schema.ts` - Removed toolCalls/toolResults from schema
- `apps/backend/src/utils/conversationLogger.ts` - Removed filtering, fixed expandMessagesWithToolCalls duplication
- `apps/backend/src/http/any-api-workspaces-catchall/routes/post-test-agent.ts` - Extract from \_steps, removed filtering
- `apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/index.ts` - Removed filtering
- `apps/backend/src/http/any-api-streams-000workspaceId-000agentId-000secret/index.ts` - Removed filtering
- `apps/backend/src/http/utils/modelFactory.ts` - Added diagnostic logging for API key usage
- `apps/frontend/src/utils/api.ts` - Removed toolCalls/toolResults from ConversationDetail interface
- `apps/frontend/src/components/ConversationDetailModal.tsx` - Enhanced UI for tool calls/results display
- `apps/backend/src/utils/__tests__/conversationLogger.test.ts` - Updated tests for new behavior
- `docs/database-schema.md` - Updated schema documentation

**Verification**: All tests passing, typecheck and lint clean ✅

**Previous Status**: Tavily Extract API Fix - Completed ✅

**Latest Fix**: Fixed Tavily extract API request format to use `urls` (array) instead of `url` (singular). The Tavily API requires `urls` as an array parameter, even for a single URL. Updated request body and response handling to support array responses.

**Changes Made**:

- Updated `tavilyExtract()` function in `apps/backend/src/utils/tavily.ts` to send `urls: [url]` instead of `url: url`
- Added response handling to support both array and single object responses (extracts first element if array)
- Updated tests to verify new request format and added test case for array response handling
- All tests passing, typecheck and lint clean

**Files Modified**:

- `apps/backend/src/utils/tavily.ts` - Fixed request body to use `urls` array, added array response handling
- `apps/backend/src/utils/__tests__/tavily.test.ts` - Updated tests to verify `urls` parameter and added array response test

**Previous Status**: Tavily Integration with Comprehensive Test Coverage - Completed ✅

**Changes Made**:

- Integrated Tavily API as both search and fetch tools for agents
- Implemented daily API call limits (10 calls/day for free tier, 10 free + pay-as-you-go for paid tiers)
- Added credit-based billing system ($0.008 per API call = 8,000 millionths)
- Created comprehensive unit tests for all new functions (59 tests total)
- Addressed all PR review comments with code improvements
- Fixed frontend state synchronization issues for Tavily toggle states

**Key Features Implemented**:

1. **Web Tools**:

   - `search_web`: Web search tool for finding current information, news, articles
   - `fetch_url`: Content extraction tool for extracting and summarizing web page content (supports Tavily and Jina.ai providers)
   - Both tools require agent-level configuration to enable
   - Cost: $0.008 per call for Tavily (first 10 calls/day free for paid tiers), Jina.ai is free

2. **Daily Limits & Billing**:

   - Free tier: 10 calls per 24 hours (hard limit, requests blocked when exceeded)
   - Paid tiers: 10 free calls/day, then $0.008 per call (requires workspace credits)
   - Rolling 24-hour window tracking using hourly buckets in DynamoDB
   - Credit reservation and adjustment based on actual API usage

3. **Request Tracking**:

   - `tavily-call-buckets` DynamoDB table with GSI for efficient queries
   - Hourly bucket tracking with 25-hour TTL for 24-hour window coverage
   - Functions: `incrementTavilyCallBucket()`, `getTavilyCallCountLast24Hours()`, `checkTavilyDailyLimit()`

4. **Credit Management**:

   - `calculateTavilyCost()`: Cost calculation (8,000 millionths per call)
   - `reserveTavilyCredits()`: Credit reservation before API calls
   - `adjustTavilyCreditReservation()`: Adjustment based on actual usage from API response
   - `refundTavilyCredits()`: Automatic refund on API errors

5. **Error Handling**:

   - Network errors retried with exponential backoff (max 3 retries)
   - Automatic credit refunds on API failures
   - Tracking failures logged but don't fail tool execution
   - Proper error messages returned to agents

6. **Frontend Integration**:
   - Toggle switches in agent detail page for enabling/disabling tools
   - Tool information in Tools Help Dialog
   - Fixed state synchronization issues when navigating between agents

**Files Created**:

- `apps/backend/src/utils/tavily.ts` - Tavily API client with retry logic
- `apps/backend/src/utils/tavilyCredits.ts` - Credit management utilities
- `apps/backend/src/http/utils/tavilyTools.ts` - Tool creation functions
- `apps/backend/src/utils/__tests__/tavily.test.ts` - API client tests (11 tests)
- `apps/backend/src/utils/__tests__/tavilyCredits.test.ts` - Credit management tests (15 tests)
- `apps/backend/src/http/utils/__tests__/tavilyTools.test.ts` - Tool creation tests (14 tests)
- `docs/tavily-integration.md` - Comprehensive documentation

**Files Modified**:

- `esbuild-config.cjs` - Added `TAVILY_API_KEY` to environment variable injection
- `apps/backend/app.arc` - Added `tavily-call-buckets` table and GSI
- `apps/backend/src/config/pricing.json` - Added Tavily pricing ($0.008 per request)
- `apps/backend/src/tables/schema.ts` - Added Tavily fields to agent schema and tavily-call-buckets table schema
- `apps/backend/src/utils/requestTracking.ts` - Added Tavily call tracking functions
- `apps/backend/src/utils/__tests__/requestTracking.test.ts` - Added Tavily tracking tests (19 tests)
- `apps/backend/src/http/utils/agentUtils.ts` - Added Tavily tools to agent delegation
- `apps/backend/src/http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/agentSetup.ts` - Added Tavily tools to test agent setup
- `apps/backend/src/http/any-api-workspaces-catchall/routes/get-workspace-agent.ts` - Include Tavily flags in response
- `apps/backend/src/http/any-api-workspaces-catchall/routes/put-workspace-agent.ts` - Handle Tavily flag updates
- `apps/backend/ENV.md` - Documented `TAVILY_API_KEY` environment variable
- `apps/frontend/src/utils/api.ts` - Added Tavily flags to Agent and UpdateAgentInput interfaces
- `apps/frontend/src/pages/AgentDetail.tsx` - Added UI toggles and state management (fixed sync issues)
- `apps/frontend/src/components/ToolsHelpDialog.tsx` - Added Tavily tools to help dialog
- `docs/agent-configuration.md` - Added Tavily tools section

**PR Review Comments Addressed**:

1. Fixed comment about atomicUpdate retry handling (clarified delegation)
2. Fixed terminology confusion (credit vs Tavily API call) in comments and docs
3. Fixed sleep function abort signal race condition in tavily.ts
4. Removed no-op reservation update, now deletes reservation after adjustment
5. Added error handling for tracking failures (logged but don't fail tool execution)
6. Added clarifying comments about logic flow in tavilyTools.ts
7. Fixed frontend state synchronization issues (removed inconsistent early return checks)

**Test Coverage**:

- 59 total tests across 3 test files
- 11 tests for Tavily API client (search, extract, error handling, retries)
- 15 tests for credit management (reservation, adjustment, refund, edge cases)
- 14 tests for tool creation (success paths, error handling, credit flows)
- 19 tests for request tracking (bucket creation, counting, limit checking)
- All tests passing, typecheck and lint clean

**Verification**: `pnpm typecheck`, `pnpm lint`, `pnpm test` - All passing ✅

**Previous Status**: Conversation Error Logging & UI Signals - Completed ✅

**Changes Made**:

- Added conversation-level error schema (message, stack, provider/model, endpoint, metadata) and serialization helpers.
- Persist LLM/provider errors for stream/test/webhook endpoints even when calls fail; conversations now store errors alongside messages.
- API responses expose error details and error flags; conversation list shows error badge, detail view shows full message/stack and metadata.
- Updated Conversation types to include `hasError`, `error`, and stream conversation type.
- Added unit tests for error persistence; typecheck and lint pass.

**Files Modified**:

- `apps/backend/src/utils/conversationLogger.ts` - Added error info builder, error persistence in start/update.
- `apps/backend/src/tables/schema.ts` - Added `error` field to `agent-conversations` schema.
- `apps/backend/src/http/any-api-streams-000workspaceId-000agentId-000secret/index.ts` - Persist errors on stream failures.
- `apps/backend/src/http/any-api-workspaces-catchall/routes/post-test-agent.ts` - Persist errors on test endpoint failures.
- `apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/index.ts` - Persist errors on webhook failures.
- `apps/backend/src/http/any-api-workspaces-catchall/routes/get-agent-conversations.ts` - Include `hasError` flag.
- `apps/backend/src/http/any-api-workspaces-catchall/routes/get-agent-conversation.ts` - Return error details.
- `apps/frontend/src/utils/api.ts` - Conversation types include error info/stream type.
- `apps/frontend/src/components/ConversationList.tsx` - Error badge in list.
- `apps/frontend/src/components/ConversationDetailModal.tsx` - Show error message/stack in detail.
- `apps/backend/src/utils/__tests__/conversationLogger.test.ts` - Added error persistence tests.

**Verification**: `pnpm typecheck`, `pnpm lint`

**Previous Status**: OpenRouter Cost Verification and Credit Validation Logic Fixes - Completed ✅

Fixed two critical issues in the cost verification and credit management system:

1. **OpenRouter API Response Structure Fix**:

   - Fixed cost extraction from OpenRouter API response - was checking `data.data.data.total_cost` (three levels) but actual structure is `data.data.total_cost` (two levels)
   - Updated type definitions and cost extraction logic to match actual API response structure
   - Updated all test mocks to use correct two-level structure
   - Cost verification queue now correctly extracts `total_cost` from OpenRouter responses

2. **Credit Validation vs Deduction Logic Separation**:
   - Fixed incorrect logic where `ENABLE_CREDIT_VALIDATION` was controlling both validation checks AND reservation creation
   - Separated concerns: `ENABLE_CREDIT_VALIDATION` now only controls credit balance validation (checking if credits are sufficient)
   - `ENABLE_CREDIT_DEDUCTION` now controls whether reservations are created and costs are charged
   - Updated `validateCreditsAndLimitsAndReserve()` to check `isCreditDeductionEnabled()` for reservation creation
   - Added comprehensive logging to clarify why reservations might not be created
   - Updated tests to reflect new behavior and added test for validation disabled but deduction enabled scenario

**Changes Made**:

- Fixed OpenRouter response parsing in `apps/backend/src/queues/openrouter-cost-verification-queue/index.ts`
- Updated credit validation logic in `apps/backend/src/utils/creditValidation.ts` to separate validation from deduction
- Added `isCreditDeductionEnabled` import and usage
- Updated all test mocks and added new test cases
- Improved logging in cost verification queue and stream handler

**Files Modified**:

- `apps/backend/src/queues/openrouter-cost-verification-queue/index.ts` - Fixed response structure parsing, improved logging
- `apps/backend/src/utils/creditValidation.ts` - Separated validation from deduction logic
- `apps/backend/src/http/any-api-streams-000workspaceId-000agentId-000secret/index.ts` - Added logging for missing reservations
- `apps/backend/src/queues/openrouter-cost-verification-queue/__tests__/index.test.ts` - Updated test mocks and added new test
- `apps/backend/src/utils/__tests__/creditValidation.test.ts` - Added `isCreditDeductionEnabled` mock, updated tests

**Verification**: All tests passing (25 tests), type checking and linting passed successfully

**Previous Status**: Cost Display Rounding Fix - Completed ✅

Fixed cost display in the UI to always round up (never down) to ensure costs are never understated. Updated `formatCurrency()` function to use `Math.ceil()` instead of `toFixed()` which could round down.

**Changes Made**:

- Modified `formatCurrency()` in `apps/frontend/src/utils/currency.ts` to always round up using `Math.ceil()`
- Applied to all cost displays across the UI (conversation costs, usage stats, credit balance, etc.)
- Ensures users always see accurate costs that are never rounded down

**Files Modified**:

- `apps/frontend/src/utils/currency.ts` - Updated `formatCurrency()` to use `Math.ceil()` for rounding up

**Verification**: Type checking and linting passed successfully

**Previous Status**: Message Final Cost Tracking with OpenRouter Generation IDs - Completed ✅

Implemented tracking of OpenRouter generation IDs on assistant messages and automatic updates with final verified costs (including 5.5% markup) when the cost verification queue processes the OpenRouter API response. This ensures conversation records reflect the actual final cost from OpenRouter rather than just estimated costs.

**Key Features Implemented**:

1. **Generation ID Tracking**:

   - Extended `UIMessage` type to include `openrouterGenerationId` and `finalCostUsd` fields
   - Store generation ID on assistant messages when creating/updating conversations
   - Generation IDs are extracted from OpenRouter API responses and stored on messages

2. **Cost Verification Queue Enhancement**:

   - Extended queue message schema to include optional `conversationId` and `agentId` for message updates
   - Queue processor finds messages by generation ID and updates them with `finalCostUsd`
   - Updates conversation-level `costUsd` to reflect final verified costs
   - Backward compatible (optional fields, graceful handling of missing data)

3. **Cost Calculation Preference**:

   - `conversationLogger` now prefers `finalCostUsd` from messages when calculating total conversation cost
   - Falls back to calculated cost from `tokenUsage` when `finalCostUsd` not available
   - Supports mixing messages with and without final costs

4. **Comprehensive Test Coverage**:
   - 9 tests for queue processor (message updates, error handling, backward compatibility)
   - 4 tests for conversationLogger cost calculation with finalCostUsd
   - 3 tests for enqueueCostVerification with conversation context

**Files Modified**:

- `apps/backend/src/http/post-api-workspaces-000workspaceId-agents-000agentId-test/utils/types.ts` - Extended UIMessage type with openrouterGenerationId and finalCostUsd
- `apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/index.ts` - Store generationId on messages, pass conversation context
- `apps/backend/src/http/any-api-workspaces-catchall/routes/post-test-agent.ts` - Store generationId on messages, pass conversation context
- `apps/backend/src/http/any-api-streams-000workspaceId-000agentId-000secret/index.ts` - Store generationId on messages, pass conversation context
- `apps/backend/src/utils/creditManagement.ts` - Extended enqueueCostVerification to accept conversationId and agentId
- `apps/backend/src/queues/openrouter-cost-verification-queue/index.ts` - Updated schema, find and update messages with finalCostUsd
- `apps/backend/src/utils/conversationLogger.ts` - Prefer finalCostUsd when calculating total cost
- `apps/backend/src/queues/openrouter-cost-verification-queue/__tests__/index.test.ts` - New comprehensive test suite (9 tests)
- `apps/backend/src/utils/__tests__/conversationLogger.test.ts` - Added 4 tests for finalCostUsd preference
- `apps/backend/src/utils/__tests__/creditManagement.test.ts` - Added 3 tests for enqueueCostVerification

**Verification**: All tests passing, type checking and linting passed successfully

**Previous Status**: OpenRouter Integration with 3-Step Pricing and BYOK Support - Completed ✅

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

### Agent Delegation Improvements (Latest)

**Status**: ✅ Completed

**Overview**: Significantly enhanced agent-to-agent delegation capabilities by adding asynchronous delegation support, intelligent query-based agent matching, delegation status tracking, and a robust queue-based processing system. Agents can now delegate tasks to other agents using natural language queries, track async delegation status, and cancel pending tasks.

**Key Features Implemented**:

1. **Async Delegation Support**:

   - New `call_agent_async` tool for fire-and-forget delegation
   - Returns task ID immediately without waiting for completion
   - Supports long-running tasks that exceed Lambda timeout limits
   - Queue-based processing with 300-second timeout (5 minutes)
   - Delegation timeout set to 280 seconds (20s buffer for queue processing)

2. **Query-Based Agent Matching**:

   - Intelligent fuzzy matching algorithm for finding agents by description
   - Matches against agent name, system prompt, and capabilities
   - Supports synonyms and partial word matching (e.g., "doc" matches "document", "mail" matches "email")
   - Capability-based matching (search_documents, search_web, send_email, search_memory, etc.)
   - Minimum score threshold (2.0) to prevent false positives
   - Agent metadata caching (5-minute TTL) to reduce database queries

3. **Delegation Management Tools**:

   - `check_delegation_status` tool to query task status and retrieve results
   - `cancel_delegation` tool to cancel pending or running tasks
   - Status tracking: pending → running → completed/failed/cancelled
   - Task results and error messages stored in database

4. **Queue-Based Processing**:

   - New SQS queue (`agent-delegation-queue`) with 300-second timeout
   - Exponential backoff retry logic (3 retries, 1-10 second delays with jitter)
   - Retryable error detection (timeouts, network errors, rate limits, 5xx errors)
   - Automatic task status updates (pending → running → completed/failed)
   - Proper error handling with task failure tracking

5. **Delegation Tracking**:

   - Conversation metadata tracking for all delegations
   - Tracks both sync and async delegations with status
   - Includes taskId for async delegations
   - Status updates from queue processor when tasks complete/fail
   - Delegation history stored in conversation records

6. **Enhanced List Agents Tool**:
   - Improved formatting with agent descriptions, capabilities, and model information
   - Truncates long descriptions to 200 characters
   - Shows all available capabilities (search_documents, search_web, send_email, etc.)
   - Displays model name and provider information

**Technical Improvements**:

1. **Timeout Handling**:

   - Proper timeout cleanup to prevent memory leaks
   - Timeout handle stored and cleared in finally block
   - Prevents dangling timers when generateText completes before timeout

2. **Type Safety**:

   - Fixed TypeScript type errors for `fetchWebProvider` (added "scrape" to union type)
   - Proper type annotations for queue message schema
   - Non-null assertions for context in queue processor

3. **Error Handling**:

   - Comprehensive error handling in queue processor
   - Task status updates on both success and failure
   - Delegation tracking updated when tasks complete/fail
   - Proper error messages returned to calling agent

4. **Code Quality**:
   - Fixed lint errors (unused variables)
   - Proper formatting and code style
   - Comprehensive unit tests for all new functionality

**Files Created**:

- `apps/backend/src/queues/agent-delegation-queue/index.ts` - Queue processor for async delegations
- `apps/backend/src/http/utils/__tests__/agentUtils.test.ts` - Comprehensive unit tests for delegation features

**Files Modified**:

- `apps/backend/app.arc` - Added `agent-delegation-tasks` table, GSI, and `agent-delegation-queue`
- `apps/backend/src/http/utils/agentUtils.ts` - Added async delegation tools, query matching, delegation tracking
- `apps/backend/src/http/utils/agentSetup.ts` - Added async delegation tools to agent setup
- `apps/backend/src/tables/schema.ts` - Added `agent-delegation-tasks` table schema and delegation tracking to conversations
- `apps/backend/src/utils/conversationLogger.ts` - Added `trackDelegation()` function for conversation metadata
- `apps/frontend/src/components/ToolsHelpDialog.tsx` - Updated tool descriptions and added async delegation tools

**Database Schema Changes**:

- New table: `agent-delegation-tasks` with status tracking, results, errors, and TTL
- GSI: `byWorkspaceAndAgent` for querying delegations by workspace and calling agent
- Conversation schema: Added `delegations` array field for tracking delegation history

**Configuration**:

- Queue timeout: 300 seconds (5 minutes)
- Delegation timeout: 280 seconds (20s buffer for queue processing)
- Task TTL: 7 days
- Agent metadata cache TTL: 5 minutes
- Retry configuration: 3 retries, exponential backoff (1-10 seconds), 20% jitter

**Verification**: All tests passing (23 tests in agentUtils.test.ts), typecheck and lint clean ✅

### Stratified Agent Memory System Implementation

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
