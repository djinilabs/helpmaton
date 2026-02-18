# System Patterns

## Tech Stack

### Backend

- **Runtime**: Node.js 20.x, TypeScript
- **Framework**: Architect Framework (AWS serverless)
- **Database**: DynamoDB (with encryption for sensitive data)
- **Storage**: S3 (document management)
- **Compute**: AWS Lambda
- **Analytics**: DuckDB (in-memory with httpfs + DuckPGQ for S3-backed graph queries in lancedb image)
- **API**: API Gateway (REST API)
- **Build**: esbuild
- **Testing**: Jest (backend tests)

### Frontend

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **Routing**: React Router v7
- **State Management**: TanStack Query (React Query)
- **Styling**: Tailwind CSS
- **UI Components**: Custom components with Sonner for toasts
- **Markdown**: react-markdown with remark-gfm
- **AI SDK**: @ai-sdk/react, ai package
- **Analytics**: PostHog, Sentry

### Infrastructure

- **Deployment**: GitHub Actions (CI/CD)
- **Infrastructure as Code**: Architect Framework (app.arc)
- **Region**: eu-west-2 (London)
- **CDN**: CloudFront
- **Authentication**: NextAuth.js (session-based, JWT, API keys, OAuth, passkeys via Credentials provider)

### Development Tools

- **Package Manager**: pnpm 10.24.0
- **Monorepo**: pnpm workspaces
- **Type Checking**: TypeScript strict mode
- **Linting**: ESLint with TypeScript, React plugins, Tailwind CSS plugin
- **E2E Testing**: Playwright
- **API Docs**: OpenAPI/Swagger generation

## Architecture Patterns

### Project Structure

- **Monorepo**: Separate `apps/backend` and `apps/frontend`
- **Backend Routes**: Organized in `apps/backend/src/http/`
- **Plugins**: Custom Architect plugins in `apps/backend/src/plugins/`. TypeScript support is provided by the local **plugin-typescript** (ejected from @architect/plugin-typescript); it compiles TS to `dist/` via esbuild and is used by `arc deploy` and `arc sandbox`.
- **Scheduled Tasks**: Lambda functions in `apps/backend/src/scheduled/`
- **Utilities**: Shared utilities in `apps/backend/src/utils/`
- **Tables**: Database abstraction in `apps/backend/src/tables/`

### Database Patterns

- **Workspace creation**: Single place—`createWorkspaceRecord` in `utils/workspaceCreate.ts`. All new workspaces (create-from-UI and import) get 2 USD initial credits. The `workspace_created` PostHog event is also sent only from this function (best-effort, does not block creation). Callers pass `pk`, `sk`, `name`, `createdBy`, `subscriptionId`, and optional `description`, `currency`, `spendingLimits`, `creationNotes`.
- **Agent creation**: Single place—`createAgentRecord` in `utils/agentCreate.ts`. All agent rows are created via this function. The PostHog `agent_created` event is sent only from this function (best-effort, does not block creation); sent only when pk parses to both workspaceId and agentId. Callers: POST `/api/workspaces/:workspaceId/agents`, workspace import (`workspaceImport.ts`), and workspace agent tool `create_agent` (`workspaceAgentTools.ts`). Params type: `CreateAgentRecordParams` (same shape as agent record minus `version`/`createdAt`). Ref parsing shared with workspace creation via `utils/refUtils.ts` (`idFromRef`).
- **DynamoDB**: Single-table design with GSIs
- **Encryption**: Sensitive tables use `encrypt true` in app.arc
- **TTL**: Expiring records (sessions, logs, reservations)
- **Indexes**: GSIs for query patterns (byWorkspaceId, byAgentId, etc.)
- **No Table Scans**: Always use indexed queries

### API Patterns

- **REST API**: HTTP-to-REST plugin converts Architect routes to REST
- **Authentication**: Lambda authorizer extracts workspace, applies throttling
- **Throttling**: Subscription-based rate limits (Free/Starter/Pro)
- **Per-agent limits**: Enforce plan caps for eval judges and schedules via GSI count checks before creation
- **Error Handling**: Centralized error handling utilities
- **OpenAPI**: Auto-generated from code annotations
- **MCP Integrations**: Non-OAuth MCP services (e.g., PostHog) use API keys in `mcp-server.config.apiKey` and validate base URLs against approved regions before requests.
- **MCP OAuth (per-server creds)**: Some OAuth MCP servers (Zendesk) store client credentials + subdomain in `mcp-server.config` instead of env vars, and OAuth endpoints are built from the stored subdomain.
- **Passkeys (WebAuthn)**: Custom flow with `@simplewebauthn/server` (backend) and `@simplewebauthn/browser` (frontend). Passkeys stored in `next-auth` table (pk=USER#userId, sk=PASSKEY#credentialId) with GSI `byCredentialId` for login lookup. Login issues a short-lived one-time JWT; Auth.js Credentials provider (`passkey`) verifies the token and creates the same session as email sign-in. Challenges: register bound to session, login in signed cookie.

### Code Patterns

- **TypeScript**: Strict mode, ES modules
- **Path Aliases**: `@/*` maps to `apps/backend/src/*`
- **Testing**: Jest for unit tests, Playwright for E2E
- **Error Handling**: Custom error utilities in `utils/handlingErrors.ts`
- **Logging**: Structured logging with table logger
- **Sentry Tracing**: Use `@sentry/aws-serverless` with wrapper-level `startSpan` for Lambda/SQS/scheduled handlers and flush only in handler `finally` blocks; manual spans for aws-lite S3 calls.
- **Tool Validation**: MCP tool inputs use `validateToolArgs` with strict Zod schemas; generic MCP tools validate method params against discovered JSON Schemas (Ajv) cached in `mcp-server.config.toolSchemaCache`.
- **List tool pagination**: DynamoDB list tools (workspace agents, agent config) use shared `listLimitSchema` and `listCursorSchema` from `toolSchemas.ts` (limit default 50, max 200; cursor optional). Use `queryPaginated` and return `nextCursor`, `hasMore`. When filtering (e.g. list_documents by folder), filter in memory after the query so `nextCursor`/`hasMore` stay correct: DynamoDB applies `Limit` before `FilterExpression`, so using a filter in the query would return pages with fewer than `limit` matching items while still setting `LastEvaluatedKey`, making pagination semantics inconsistent. Alternatively use a GSI keyed by the filter attribute or a fetch-until-filled loop if you need server-side filtering with accurate cursor semantics.
- **Resource cleanup**: Workspace/agent cleanup is centralized in helper utilities; conversation files are deleted by parsing stored message URLs (no S3 list operations).
- **Credit user errors**: `InsufficientCreditsError` / `SpendingLimitExceededError` are expected 402s; log at `info`, skip Sentry, and notify workspace owners via email (rate-limited per user per error type to 1/hr).
- **Scraper errors**: Scrape endpoint sets `req.skipSentryCapture` for scraper-related failures (timeouts, block pages; see `isScraperRelatedError` in scrapeHelpers). Express error handler skips Sentry when this flag is set; only the express handler reports to Sentry for HTTP routes, avoiding double-reporting.
- **AI SDK tool message format**: The AI SDK’s prompt validator only clears pending tool-call IDs when it sees a message with **role "tool"**. Tool results must be in a separate model message with `role: "tool"`, not inside the assistant message; otherwise `AI_MissingToolResultsError` is thrown (e.g. in agent-schedule-queue continuation). See `convert-ui-messages-to-model-messages.ts` (`pushToolResultsMessage`, `buildToolMessage`) and `aiSdkToolMessageFormat.test.ts`.
- **LLM Observers**: Wrap models with `llmObserver` to emit events; wrap tools for execution timing; build conversation records from observed events
- **Embeddings**: Use OpenRouter embeddings (`thenlper/gte-base`) via `@openrouter/sdk`; embeddings can use workspace OpenRouter keys when BYOK is configured, otherwise fall back to the system `OPENROUTER_API_KEY`. Background embedding generation (SQS queue) reserves/adjusts credits when using the system key and skips charges for BYOK.
- **Knowledge reranking**: Use OpenRouter’s OpenAI-compatible chat completions API (`/api/v1/chat/completions`) with a prompt that returns document indices ordered by relevance; same API key and BYOK as embeddings. Cost and generation ID come from response `usage.cost` and `id`. Prefer chat models (e.g. `openai/gpt-4o-mini`) for reranking; `getRerankingModels()` includes both “rerank”-named and recommended chat models.
- **Embedding credits**: Embedding reservations now follow the 3-step flow when OpenRouter returns a generation ID (reserve → adjust with token usage → enqueue cost verification for finalization).
- **Memory extraction**: Per-agent extraction can summarize full conversations and emit graph fact operations; extraction validates credits before LLM calls, writes conversation-level working memory with deterministic IDs via SQS updates, and persists graph facts through DuckPGQ.
- **SQS Queue Processing**: No retries on error via `handlingSQSErrors`
  - Handler failures are logged and reported to Sentry
  - Wrapper always returns empty `batchItemFailures` to avoid redelivery
- **PostHog user identification (backend)**: Centralized in auth middleware. `ensurePostHogIdentityFromRequest(req)` is called from `requireAuth` / `requireAuthOrSession` (workspaces and subscription apps) after setting `req.userRef` and `req.session`. In authenticated routes use `trackEvent(name, properties)` or `trackBusinessEvent(feature, action, properties)` without passing `req`; user is taken from request context. Pass `req` only when the handler did not go through that middleware, or pass `properties.user_id` in non-request flows (e.g. webhooks, queues).
- **PostHog user_signed_up**: Sent when the user record is created, not at login. Fired from (1) the Auth.js DynamoDB adapter wrapper in authUtils when `createUser` is called (email sign-ups), and (2) `createUserFromInvite` in workspaceInvites when a new user is created via invite. Tracking is best-effort; failures are logged and do not block sign-up.
- **PostHog frontend (identity and dedup)**: Init uses `mask_all_text: true` so autocapture never sends element text (avoids PII before identify). In PostHogProvider, when the user becomes authenticated we call `posthog.alias(newId)` only when the current distinct_id is an anonymous id (i.e. does not start with `user/`) before first identifying as `user/${id}` (via `shouldAliasBeforeIdentify`), then `posthog.identify(newId, { email })`, so anonymous and identified profiles merge into one. We never alias between two `user/...` ids. Effect deps are `[status, userId, userEmail]` for stability.
- **Large tool payload display**: Use `TruncatedPayloadDisplay` for tool output, args, and JSON data. Lazy-renders (only stringify/render when user expands); truncates to 5000 chars with "Copy full" button. Prevents UI freeze from large payloads. Used in ToolPart, DataPart, UnknownPart, ConversationDetailModal, NestedConversation, ConversationTemporalGraph.

### Naming Conventions

- **Files**: kebab-case for files, PascalCase for React components
- **Tables**: kebab-case (e.g., `workspace-document`, `agent-key`)
- **Routes**: RESTful patterns in app.arc
- **GSIs**: Descriptive names (e.g., `byWorkspaceId`, `byAgentIdAndDate`)

### Deployment Patterns

- **PR Deployments**: Each PR creates CloudFormation stack
- **Tweet on new PR**: GitHub Actions workflow `.github/workflows/tweet-on-pr.yml` runs on PR opened/reopened (targeting main) and posts from the Helpmaton X account via `smapiot/send-tweet-v2-action` (X API v2 so Free tier works; v1.1 returns 453). X API credentials (OAuth 1.0a): `X_API_KEY` and `X_API_SECRET` from the portal (Consumer Key/Secret); `X_ACCESS_TOKEN` and `X_ACCESS_TOKEN_SECRET` from a one-time 3-legged OAuth flow (run `node scripts/x-oauth-get-user-tokens.mjs`). Portal Bearer Token cannot post tweets. See docs/tweet-on-pr-setup.md. Draft PRs and PRs with label `no-tweet` are skipped.
- **Tweet on release**: The Release workflow (`.github/workflows/release.yml`) posts a tweet after creating a release, with truncated commit summaries from the auto-generated release notes. Uses the same X API credentials as tweet-on-pr.
- **Infrastructure Changes**: Only via app.arc or Architect plugins
- **No Direct AWS Changes**: All infrastructure changes through code
- **Reserved Concurrency**: Use per-Lambda `config.arc` with `@aws concurrency <n>` when isolating handlers
- **Environment**: Uses ARC_DB_PATH for local DynamoDB
- **Environment Detection**: Primary check is `process.env.ARC_ENV === "testing"` for local development (Architect sandbox). For S3/AWS services, also check if credentials are available - if missing, fall back to local mocked services (s3rver). Never use `NODE_ENV` alone for environment detection. This allows tests to run without credentials while staging/production use real AWS services

## Key Architectural Decisions

1. **Serverless First**: Everything runs on Lambda for scalability
2. **Single-Table Design**: DynamoDB with GSIs for query flexibility
3. **Encryption at Rest**: Sensitive data encrypted in DynamoDB
4. **Workspace Isolation**: Multi-tenant architecture with workspace-based access
5. **Credit System**: Token-based usage tracking with reservations
6. **Streaming Support**: Lambda URLs for long-running agent conversations
7. **Workspace agent and meta-agent**: Virtual workspace agent (no DB record) at `agentId === "_workspace"`; stream path `/api/streams/{workspaceId}/_workspace/test`. Meta-agent reuses an existing agent in “configuration mode” via path `/api/streams/{workspaceId}/{agentId}/config/test` or when the workspace agent calls `configure_agent(agentId, message)` with `configurationMode: true`. Workspace agent tools in `workspaceAgentTools.ts`; meta-agent (config-only) tools in `agentConfigTools.ts`. Frontend: WorkspaceDetail “Workspace assistant” chat; AgentDetail “Configure with AI” chat.
8. **Container Images**: Custom Lambda container images for specific routes (e.g., LanceDB)
   - Multi-stage builds to minimize image size (builder stage for dependencies, runtime stage for final image)
   - Build tools removed from final image
   - Package manager caches cleaned after installation
   - `@container-images` entries can include a group token (e.g., `llm-shared`) to merge routes/queues/schedules into a single Lambda using `http/<group>/index.handler`
