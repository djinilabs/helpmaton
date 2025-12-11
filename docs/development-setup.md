# Development Setup

This guide will help you set up a local development environment for Helpmaton.

## Prerequisites

### Required Software

- **Node.js**: Version 20.x or higher
- **pnpm**: Version 10.24.0 or higher (package manager)
- **Git**: For version control

### Installing Prerequisites

**Node.js**:

```bash
# Using nvm (recommended)
nvm install 20
nvm use 20

# Or download from https://nodejs.org/
```

**pnpm**:

```bash
npm install -g pnpm@10.24.0
```

**Git**:

```bash
# macOS
brew install git

# Linux
sudo apt-get install git

# Windows
# Download from https://git-scm.com/
```

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/helpmaton.git
cd helpmaton
```

### 2. Install Dependencies

```bash
pnpm install
```

This will install all dependencies for both backend and frontend.

### 3. Environment Variables

Create a `.env` file in `apps/backend/`:

```bash
cd apps/backend
cp .env.example .env  # If .env.example exists
```

Or create `.env` manually with:

```bash
# Authentication
AUTH_SECRET=your-local-secret-key-here
BASE_URL=http://localhost:3333

# Email (Mailgun)
MAILGUN_KEY=your-mailgun-api-key
MAILGUN_DOMAIN=helpmaton.com

# LLM API
GEMINI_API_KEY=your-gemini-api-key

# Database (local persistence)
ARC_DB_PATH=./db

# S3 (local development)
HELPMATON_S3_BUCKET=workspace.documents
HELPMATON_S3_ENDPOINT=http://localhost:4568
HELPMATON_S3_ACCESS_KEY_ID=dummy
HELPMATON_S3_SECRET_ACCESS_KEY=dummy
HELPMATON_S3_REGION=us-east-1

# Optional: Monitoring
SENTRY_DSN=your-sentry-dsn
VITE_SENTRY_DSN=your-sentry-dsn
VITE_POSTHOG_API_KEY=your-posthog-key
POSTHOG_API_KEY=your-posthog-key

# Lemon Squeezy (Payment Integration)
LEMON_SQUEEZY_API_KEY=sk_test_your_api_key_here
LEMON_SQUEEZY_WEBHOOK_SECRET=whsec_your_webhook_secret_here
LEMON_SQUEEZY_STORE_ID=12345
LEMON_SQUEEZY_STARTER_VARIANT_ID=67890
LEMON_SQUEEZY_PRO_VARIANT_ID=67891
LEMON_SQUEEZY_CREDIT_PRODUCT_ID=123456
LEMON_SQUEEZY_CHECKOUT_SUCCESS_URL=http://localhost:5173/subscription?success=true
LEMON_SQUEEZY_CHECKOUT_CANCEL_URL=http://localhost:5173/subscription?cancelled=true
```

**Note**: See [Environment Variables](./deployment.md#environment-variables) for detailed descriptions.

### 4. Start Development Servers

**Start both backend and frontend**:

```bash
pnpm dev
```

This runs:

- Backend: Architect Sandbox on `http://localhost:3333`
- Frontend: Vite dev server on `http://localhost:5173`

**Start individually**:

Backend only:

```bash
pnpm dev:backend
```

Frontend only:

```bash
pnpm dev:frontend
```

## Local Services

### DynamoDB (Database)

Architect Sandbox includes a local DynamoDB emulator:

- **Port**: `6000` (default)
- **Endpoint**: `http://localhost:6000`
- **Persistence**: Data is persisted to `apps/backend/db/` when `ARC_DB_PATH` is set

**Database Admin UI**:

```bash
pnpm dev:dbadmin
```

Opens DynamoDB admin interface at `http://localhost:8000`

### S3 (Document Storage)

For local S3, you'll need to run s3rver separately:

```bash
# Install s3rver globally (if not already installed)
npm install -g s3rver

# Run s3rver
s3rver --directory ./s3-data --port 4568
```

Or use Docker:

```bash
docker run -p 4568:4568 \
  -v $(pwd)/s3-data:/data \
  scality/s3server:latest
```

**S3 Configuration**:

- **Port**: `4568`
- **Endpoint**: `http://localhost:4568`
- **Bucket**: `workspace.documents` (created automatically)

## Project Structure

```
helpmaton/
├── apps/
│   ├── backend/          # Backend (Architect Framework)
│   │   ├── src/          # Source code
│   │   ├── db/           # Local database (gitignored)
│   │   └── app.arc       # Architect configuration
│   └── frontend/         # Frontend (React + Vite)
│       ├── src/          # Source code
│       └── public/       # Static assets
├── docs/                 # Documentation
├── scripts/              # Utility scripts
├── tests/                # E2E tests
└── package.json          # Root package.json
```

## Development Workflow

### Hot Reload

Both backend and frontend support hot reload:

- **Backend**: Lambda functions are automatically reloaded when source files change
- **Frontend**: Vite provides instant HMR (Hot Module Replacement)

### Type Checking

Run TypeScript type checking:

```bash
pnpm typecheck
```

### Linting

Run ESLint:

```bash
pnpm lint
```

### Running Tests

**Unit Tests**:

```bash
pnpm test
```

**E2E Tests**:

```bash
# Headless
pnpm test:e2e

# With UI
pnpm test:e2e:ui

# Headed browser
pnpm test:e2e:headed

# Debug mode
pnpm test:e2e:debug
```

## Debugging

### Backend Debugging

**VS Code Launch Configuration**:

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "attach",
      "name": "Attach to Sandbox",
      "port": 9229,
      "restart": true,
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

Start sandbox with debugging:

```bash
NODE_OPTIONS="--inspect" pnpm dev:backend
```

### Frontend Debugging

Frontend debugging works out of the box with browser DevTools:

1. Open browser DevTools (F12)
2. Set breakpoints in source files
3. Use React DevTools extension for component debugging

### Database Debugging

Use DynamoDB Admin UI:

```bash
pnpm dev:dbadmin
```

Or query directly:

```bash
# Using AWS CLI (configured for local endpoint)
aws dynamodb list-tables --endpoint-url http://localhost:6000
```

## Common Tasks

### Adding Credits to Workspace

```bash
cd apps/backend
pnpm exec tsx ../../scripts/add-credits.ts
```

Follow the prompts to add credits to a workspace.

### Testing Aggregation

```bash
pnpm test-aggregation
```

### Verifying Aggregates

```bash
pnpm verify-aggregates
```

### Generating OpenAPI Spec

```bash
pnpm generate:openapi
```

Generates `apps/backend/openapi.json` and `apps/frontend/public/openapi.json`.

### Updating Pricing

```bash
pnpm update-pricing
```

Fetches latest model pricing and updates `apps/backend/src/config/pricing.json`.

## Troubleshooting

### Port Already in Use

If port 3333 or 5173 is already in use:

**Backend**:

```bash
# Change port in Architect config or kill existing process
lsof -ti:3333 | xargs kill
```

**Frontend**:

```bash
# Vite will automatically use next available port
# Or specify port in vite.config.ts
```

### Database Issues

**Reset local database**:

```bash
rm -rf apps/backend/db
pnpm dev:backend
```

**Database not persisting**:

- Ensure `ARC_DB_PATH=./db` is set
- Check `apps/backend/db/` directory exists
- Verify write permissions

### S3 Issues

**S3 not accessible**:

- Verify s3rver is running on port 4568
- Check `HELPMATON_S3_ENDPOINT` is set correctly
- Ensure bucket name matches `HELPMATON_S3_BUCKET`

**Create bucket manually**:

```bash
aws s3 mb s3://workspace.documents \
  --endpoint-url http://localhost:4568
```

### Build Issues

**Clear build cache**:

```bash
rm -rf apps/backend/dist
rm -rf apps/frontend/dist
rm -rf node_modules/.cache
pnpm install
```

**Type errors**:

```bash
# Check TypeScript version
pnpm typecheck

# Update dependencies
pnpm update
```

### Authentication Issues

**Magic links not working**:

- Verify `MAILGUN_KEY` and `MAILGUN_DOMAIN` are set
- Check `BASE_URL` matches your local URL
- Use testmail.app for local testing (no Mailgun needed)

**Session not persisting**:

- Check cookies are enabled in browser
- Verify `AUTH_SECRET` is set
- Clear browser cookies and try again

## Environment-Specific Configuration

### Local Development

- **Backend URL**: `http://localhost:3333`
- **Frontend URL**: `http://localhost:5173`
- **Database**: Local DynamoDB (persisted to disk)
- **S3**: Local s3rver

### Testing

- **Database**: In-memory (no persistence)
- **S3**: Local s3rver or mocked
- **Environment**: `NODE_ENV=test`

### Production

- **Backend URL**: `https://app.helpmaton.com`
- **Database**: AWS DynamoDB
- **S3**: AWS S3

## Best Practices

### Code Quality

1. **Run typecheck before committing**:

   ```bash
   pnpm typecheck
   ```

2. **Run linting**:

   ```bash
   pnpm lint
   ```

3. **Write tests**:
   - Unit tests for utilities
   - Integration tests for API endpoints
   - E2E tests for user flows

### Git Workflow

1. **Create feature branch**:

   ```bash
   git checkout -b feature/my-feature
   ```

2. **Commit changes**:

   ```bash
   git add .
   git commit -m "Add my feature"
   ```

3. **Push and create PR**:
   ```bash
   git push origin feature/my-feature
   ```

### Database Best Practices

1. **Never commit database files**: `apps/backend/db/` is gitignored
2. **Use migrations**: For schema changes, update `app.arc` and schema files
3. **Test with clean database**: Reset database between test runs

### Environment Variables

1. **Never commit secrets**: Use `.env` files (gitignored)
2. **Document new variables**: Update `ENV.md` when adding new variables
3. **Use different values**: Use different secrets for dev/staging/prod

## Additional Resources

- [Architect Framework Docs](https://arc.codes/)
- [Vite Docs](https://vitejs.dev/)
- [React Docs](https://react.dev/)
- [TypeScript Docs](https://www.typescriptlang.org/)

## Getting Help

If you encounter issues:

1. Check this documentation
2. Review [Troubleshooting Guide](./troubleshooting.md)
3. Search existing GitHub issues
4. Ask in Discord community
5. Create a new issue with details
