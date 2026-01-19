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

### Credits and Pricing

- `add-credits.ts` - Add credits to user accounts
- `update-pricing.mjs` - Update pricing calculations
- `migrate-to-usd.ts` - Migrate credit system to USD

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
