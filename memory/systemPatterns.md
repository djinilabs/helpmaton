# System Patterns

## Tech Stack

### Backend

- **Runtime**: Node.js 20.x, TypeScript
- **Framework**: Architect Framework (AWS serverless)
- **Database**: DynamoDB (with encryption for sensitive data)
- **Storage**: S3 (document management)
- **Compute**: AWS Lambda
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
- **Authentication**: NextAuth.js (session-based, JWT, API keys, OAuth)

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
- **Plugins**: Custom Architect plugins in `apps/backend/src/plugins/`
- **Scheduled Tasks**: Lambda functions in `apps/backend/src/scheduled/`
- **Utilities**: Shared utilities in `apps/backend/src/utils/`
- **Tables**: Database abstraction in `apps/backend/src/tables/`

### Database Patterns

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

### Code Patterns

- **TypeScript**: Strict mode, ES modules
- **Path Aliases**: `@/*` maps to `apps/backend/src/*`
- **Testing**: Jest for unit tests, Playwright for E2E
- **Error Handling**: Custom error utilities in `utils/handlingErrors.ts`
- **Logging**: Structured logging with table logger
- **Sentry Tracing**: Use `@sentry/aws-serverless` with wrapper-level `startSpan` for Lambda/SQS/scheduled handlers and flush only in handler `finally` blocks; manual spans for aws-lite S3 calls.
- **Credit user errors**: `InsufficientCreditsError` / `SpendingLimitExceededError` are expected 402s; log at `info` and do not report to Sentry or trigger notifications.
- **LLM Observers**: Wrap models with `llmObserver` to emit events; wrap tools for execution timing; build conversation records from observed events
- **Embeddings**: Use OpenRouter embeddings (`thenlper/gte-base`) via `@openrouter/sdk`; embeddings use the system `OPENROUTER_API_KEY` (no workspace BYOK).
- **SQS Queue Processing**: Use partial batch failures via `handlingSQSErrors` utility
  - Handler returns array of failed message IDs
  - Successful messages are deleted immediately
  - Failed messages are retried individually
  - Prevents reprocessing of successful messages

### Naming Conventions

- **Files**: kebab-case for files, PascalCase for React components
- **Tables**: kebab-case (e.g., `workspace-document`, `agent-key`)
- **Routes**: RESTful patterns in app.arc
- **GSIs**: Descriptive names (e.g., `byWorkspaceId`, `byAgentIdAndDate`)

### Deployment Patterns

- **PR Deployments**: Each PR creates CloudFormation stack
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
7. **Container Images**: Custom Lambda container images for specific routes (e.g., LanceDB)
   - Multi-stage builds to minimize image size (builder stage for dependencies, runtime stage for final image)
   - Build tools removed from final image
   - Package manager caches cleaned after installation
   - `@container-images` entries can include a group token (e.g., `llm-shared`) to merge routes/queues/schedules into a single Lambda using `http/<group>/index.handler`
