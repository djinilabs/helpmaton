# Scripts Directory

This directory contains utility scripts for managing the Helpmaton infrastructure and operations.

## Available Scripts

### ECR Image Cleanup

**Purpose**: Automatically clean up unused Docker images from AWS ECR to reduce storage costs.

**Files**:

- `cleanup-ecr-images.mjs` - Main cleanup script
- `ecr-utils.mjs` - Utility functions for image operations
- `__tests__/ecr-utils.test.mjs` - Unit tests

**Usage**:

```bash
# Dry run (default)
pnpm cleanup-ecr

# Execute deletions
pnpm cleanup-ecr:execute

# With custom parameters
node scripts/cleanup-ecr-images.mjs --execute --retention 20 --min-age 48
```

**Documentation**: See [docs/ecr-image-cleanup.md](../docs/ecr-image-cleanup.md)

### Build and Push Lambda Images

**File**: `build-and-push-lambda-images.sh`

Builds and pushes Lambda container images to ECR for deployment.

### CloudFormation Management

- `cleanup-cloudformation-deployment.mjs` - Clean up CloudFormation deployments
- `cleanup-cloudformation-routes.mjs` - Clean up API Gateway routes
- `fix-api-resource-drift.mjs` - Fix API Gateway resource drift
- `verify-rest-api-preserved.mjs` - Verify REST API configuration

### PR Environment Management

- `cleanup-closed-prs.sh` - Clean up resources from closed PRs
- `cleanup-pr-api-keys.sh` - Remove API keys from closed PR environments
- `cleanup-pr-log-groups.sh` - Delete CloudWatch logs for closed PRs
- `undeploy-pr.sh` - Undeploy a specific PR environment

### Production Operations

- `cleanup-production-log-groups.mjs` - Remove unused production CloudWatch log groups

### Backend Build and Deployment

- `build-backend.ts` - Build backend Lambda functions
- `deploy-api-gateway.sh` - Deploy API Gateway changes
- `configure-cloudfront-cache-behavior.sh` - Configure CloudFront caching

### Database and Memory

- `run-all-memory-summaries.mjs` - Run memory summarization for all agents
- `test-lancedb-metadata.mjs` - Test LanceDB metadata storage
- `debug-lancedb-metadata.sh` - Debug LanceDB metadata issues
- `recreate-lancedb-tables.sh` - Recreate vector database tables

### Testing and Verification

- `test-aggregation.ts` - Test token usage aggregation
- `verify-aggregates.ts` - Verify aggregated token usage data
- `run-staging-agent-tests.ts` - End-to-end validation against a PR stack

#### Staging Agent Tests (`run-staging-agent-tests.ts`)

**Purpose**: Provision a temporary workspace in a PR deployment and validate key agent workflows end-to-end.

**What it sets up**
- Resolves CloudFormation outputs/resources for the PR stack (API URL, streaming URL, tables, SQS queues).
- Generates an auth token (or uses `AUTH_TOKEN`) and validates API access.
- Creates a workspace and upgrades its subscription plan to unlock agent limits.
- Creates agents:
  - **Hello Agent** (simple test agent)
  - **Delegated Agent** (target for async delegation)
  - **Delegator Agent** (calls `call_agent_async`)
- Enables delegation on the delegator agent.
- Creates a streaming server config and a webhook API key.
- Creates an eval judge with the required JSON schema prompt.
- Sets workspace credits directly in DynamoDB to ensure enough budget for tests.

**What it tests**
- **Test endpoint** (`/api/streams/:workspaceId/:agentId/test`)
  - Sends a prompt that requires `get_datetime`.
  - Validates the conversation record contains the reply marker, weekday, and tool usage.
- **Streaming endpoint** (`/api/streams/:workspaceId/:agentId/:secret`)
  - Validates a streamed response is logged correctly with tool usage and reply marker.
- **Webhook endpoint** (`/api/webhook/:workspaceId/:agentId/:key`)
  - Validates immediate text response contains the reply marker.
  - Validates the stored conversation includes tool calls/results and known content.
- **Async delegation**
  - Calls delegator agent and waits for the delegation task in DynamoDB.
  - Validates delegated agent conversation contains expected reply marker and weekday.
- **Eval queue**
  - Waits for an eval result entry tied to the test conversation and judge ID.
- **Schedule queue**
  - Creates a schedule, sends a direct SQS message, and validates a scheduled conversation is logged.
- **Temporal grain queue**
  - Sends a direct SQS message to write a memory fact.
  - Verifies the fact is retrievable via the memory API.
- **Cost verification**
  - Polls credit transactions for the test conversation to verify cost reconciliation ran.

**How it validates**
- Uses a unique run marker embedded in prompts to correlate conversations.
- Polls DynamoDB tables (conversations, eval results, delegation tasks, credit transactions) with exponential backoff.
- Checks for:
  - Tool call presence (`get_datetime`) in conversation messages
  - Expected weekday in assistant reply
  - Reply marker in assistant output
  - Matching eval judge result
  - Presence of cost-transaction entries for the conversation

**Cleanup behavior**
- Deletes the workspace only after a fully successful run.
- Leaves resources behind on failure (or when `KEEP_STAGING_TEST_RESOURCES=1`).

**Usage**
```bash
pnpm tsx scripts/run-staging-agent-tests.ts --pr 186
```

**Inputs**
- `--pr <number>`: required PR number (stack suffix).
- `--model <name>`: override model (default `google/gemini-2.5-flash`).
- `--timeout <ms>`: per-step timeout (default `180000`).
- `--credits <usd>`: workspace credits to set (default `25`).
- `--reply <text>`: override reply marker.
- `AUTH_SECRET`: required if not using `AUTH_TOKEN`.
- `AUTH_TOKEN`: optional pre-generated auth token.
- `KEEP_STAGING_TEST_RESOURCES=1`: keep workspace on success.

**Potential future improvements**
- Add a GSI for `conversationId` in credit-transactions to avoid filtered scans.
- Emit a structured JSON report (pass/fail per step with timings).
- Add CloudWatch log links on failures for faster triage.
- Add per-step timeouts and retries (vs one global timeout).
- Parallelize independent polls (eval + schedule + cost verification).
- Add explicit validation for tool-result de-duplication and assistant text fallback.
- Provide a `--dry-run` mode that only resolves stack resources and validates auth.

### Credits and Pricing

- `add-credits.ts` - Add credits to user accounts
- `update-pricing.mjs` - Update pricing calculations
- `migrate-to-usd.ts` - Migrate credit system to USD
- `migrate-transaction-fields.ts` - Migrate legacy transaction fields to nano-dollars

**Usage**
```bash
pnpm tsx scripts/migrate-transaction-fields.ts --stack HelpmatonProduction
```

### API and Discord

- `generate-openapi.ts` - Generate OpenAPI documentation
- `register-discord-commands.ts` - Register Discord slash commands

### Development

- `watchSourceRefreshLambda.cjs` - Watch for source changes and refresh Lambda functions during development

## Running Scripts

Most scripts can be run via npm scripts defined in `package.json`:

```bash
# List all available scripts
pnpm run

# Run specific script
pnpm <script-name>
```

For scripts without npm shortcuts, run directly:

```bash
# Make executable if needed
chmod +x scripts/<script-name>.sh

# Run the script
./scripts/<script-name>.sh
# or
node scripts/<script-name>.mjs
# or
pnpm exec tsx scripts/<script-name>.ts
```

## Adding New Scripts

When adding new scripts:

1. Place in this directory with appropriate extension (`.mjs`, `.ts`, `.sh`)
2. Add executable permissions for shell scripts: `chmod +x scripts/<name>.sh`
3. Add npm script to `package.json` if commonly used
4. Document in this README
5. Add unit tests if applicable (in `__tests__/` subdirectory)
6. Create detailed documentation in `docs/` for complex scripts

## Testing Scripts

Scripts with unit tests can be run:

```bash
# Run tests
pnpm test scripts/__tests__/<test-name>.test.mjs

# Run with coverage
pnpm test --coverage scripts/__tests__/
```

## AWS Permissions

Many scripts require AWS credentials. Ensure you have:

- AWS CLI configured (`aws configure`)
- Appropriate IAM permissions for the operations
- Correct AWS region set (default: `eu-west-2`)

## Safety

Scripts that modify infrastructure should:

- Run in dry-run mode by default
- Require explicit flags for actual changes
- Provide detailed logging and reporting
- Validate inputs before execution
- Check for protected resources

## Documentation

For detailed documentation on specific scripts, see:

- [ECR Image Cleanup](../docs/ecr-image-cleanup.md)
- [Deployment Guide](../docs/deployment.md)
- [Development Setup](../docs/development-setup.md)
