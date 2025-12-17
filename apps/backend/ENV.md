# Environment Variables

This document describes the environment variables required for the helpmaton backend authentication system.

## Required Environment Variables

### `AUTH_SECRET`

- **Description**: Secret key used for JWT token signing and encryption
- **Required**: Yes
- **Example**: `your-random-secret-key-here`
- **How to generate**: Use a cryptographically secure random string generator

  ```bash
  # Using OpenSSL
  openssl rand -base64 32

  # Using Node.js
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```

### `MAILGUN_KEY`

- **Description**: Mailgun API key for sending authentication emails
- **Required**: Yes
- **Example**: `key-1234567890abcdef1234567890abcdef`
- **How to obtain**:
  1. Sign up for a Mailgun account at https://www.mailgun.com
  2. Navigate to your domain settings
  3. Copy your API key from the dashboard

### `MAILGUN_DOMAIN`

- **Description**: Mailgun domain for sending emails
- **Required**: No (defaults to `helpmaton.com`)
- **Example**: `mg.helpmaton.com` or `helpmaton.com`
- **Note**: Must be a verified domain in your Mailgun account

### `BASE_URL`

- **Description**: Base URL of your application (used for generating magic link URLs)
- **Required**: Yes (for production)
- **Example**:
  - Development: `http://localhost:3333`
  - Production: `https://app.helpmaton.com`
- **Note**: This should match the URL where your application is hosted

## Optional Environment Variables

### `ARC_DB_PATH`

- **Description**: Path to the directory where the local sandbox database files should be persisted
- **Required**: No (defaults to in-memory database if not set)
- **Example**: `./db` or `./apps/backend/db`
- **Note**:
  - When set, the local DynamoDB sandbox will persist data to disk, allowing data to survive server restarts
  - The directory will be created automatically if it doesn't exist
  - This is only used in local development (sandbox mode)
  - The database directory should be added to `.gitignore` to avoid committing local data

### `ALLOWED_EMAILS`

- **Description**: Comma-separated list of email addresses allowed to sign in
- **Required**: No
- **Example**: `user1@example.com,user2@example.com`
- **Note**:
  - If not set, all emails are allowed to sign in
  - If set, only emails in this list can sign in
  - Testmail emails (ending with `@inbox.testmail.app`) are always allowed

### `GEMINI_API_KEY`

- **Description**: Google Gemini API key for AI agent functionality and memory system
- **Required**: Yes (for agent webhook functionality and memory system)
- **Example**: `AIzaSy...`
- **How to obtain**:
  1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
  2. Create a new API key
  3. Copy the key value
- **Note**:
  - Used to invoke Gemini models for agent responses via webhooks
  - Used for embedding generation (`text-embedding-004`) in the memory system
  - Used for LLM-based summarization in the stratified memory system
  - Workspace-specific API keys can override this system key (see [Agent Memory System documentation](../docs/agent-memory-system.md))

### `SENTRY_DSN`

- **Description**: Sentry Data Source Name (DSN) for error tracking and monitoring
- **Required**: No (Sentry will not be initialized if not provided)
- **Example**: `https://abc123@o123456.ingest.sentry.io/123456`
- **How to obtain**:
  1. Sign up for a Sentry account at https://sentry.io
  2. Create a new project
  3. Copy the DSN from the project settings
- **Note**:
  - Used for backend error tracking in Lambda functions
  - Only 500-level server errors are reported to Sentry
  - Errors are automatically flushed before Lambda response to ensure delivery
  - If not set, the application will continue to work but errors won't be tracked in Sentry

### `CLOUDFLARE_TURNSTILE_SECRET_KEY`

- **Description**: Cloudflare Turnstile secret key for server-side CAPTCHA validation
- **Required**: Yes (for trial credit requests)
- **Example**: `0x4AAAAAAABkMYinukE_vqYQ_SecretKey123456789`
- **How to obtain**:
  1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
  2. Navigate to Turnstile
  3. Select your site
  4. Copy the Secret Key
- **Note**: Used for server-side validation of CAPTCHA tokens in trial credit request flow. Backend uses this variable directly.

### `DISABLE_TRIAL_PERIOD_CHECK` (Temporary)

- **Description**: Disables the 7-day trial period check for trial credit requests
- **Required**: No
- **Example**: `true` or `false`
- **Note**:
  - **TEMPORARY**: This is a temporary flag to allow any account to request trial credits
  - Set to `"true"` to disable the trial period check
  - Set to `"false"` or omit to enable the normal 7-day trial period check
  - **To re-enable the check**: Remove this variable or set it to `"false"`

### `CLOUDFLARE_TURNSTILE_SITE_KEY`

- **Description**: Cloudflare Turnstile site key for client-side CAPTCHA widget
- **Required**: Yes (for trial credit requests)
- **Example**: `0x4AAAAAAABkMYinukE_vqYQ`
- **How to obtain**:
  1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
  2. Navigate to Turnstile
  3. Create a new site (or use existing)
  4. Copy the Site Key
- **Note**:
  - Used for CAPTCHA widget rendering in the frontend
  - The Vite config automatically maps this to `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` for the frontend
  - You can use either `CLOUDFLARE_TURNSTILE_SITE_KEY` or `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` - both will work

### `DISCORD_BOT_TOKEN`

- **Description**: Discord bot token for sending notifications
- **Required**: Yes (for trial credit request notifications)
- **Example**: `MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNA.GaBcDe.FgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRs`
- **How to obtain**:
  1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
  2. Select your bot application
  3. Go to "Bot" section
  4. Copy the token
- **Note**: Keep this secret secure and never commit it to version control

### `DISCORD_TRIAL_CREDIT_CHANNEL_ID`

- **Description**: Discord channel ID where trial credit requests will be sent
- **Required**: Yes (for trial credit request notifications)
- **Example**: `123456789012345678`
- **How to obtain**:
  1. Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
  2. Right-click on the channel where you want notifications
  3. Click "Copy ID"
- **Note**: The bot must have permission to send messages in this channel

## Frontend Environment Variables

These environment variables are used by the frontend application and must be prefixed with `VITE_` to be accessible during the build process.

### `VITE_SENTRY_DSN`

- **Description**: Sentry Data Source Name (DSN) for frontend error tracking
- **Required**: No (Sentry will not be initialized if not provided)
- **Example**: `https://abc123@o123456.ingest.sentry.io/123456`
- **How to obtain**: Same as `SENTRY_DSN` (can use the same value)
- **Note**:
  - Used for frontend error tracking in the React application
  - Automatically tracks unhandled errors and React error boundaries
  - If not set, the application will continue to work but errors won't be tracked in Sentry

### `VITE_POSTHOG_API_KEY`

- **Description**: PostHog project API key for analytics tracking
- **Required**: No (PostHog will not be initialized if not provided)
- **Example**: `phc_abc123def456ghi789jkl012mno345pqr678stu901vwx234`
- **How to obtain**:
  1. Sign up for a PostHog account at https://posthog.com
  2. Create a new project
  3. Go to Project Settings → API Keys
  4. Copy the Project API Key
- **Note**:
  - Used for frontend analytics tracking (page views, user interactions, session recordings)
  - Automatically tracks page views, page leaves, and user interactions
  - If not set, the application will continue to work but analytics won't be tracked

### `VITE_POSTHOG_API_HOST`

- **Description**: PostHog API host URL
- **Required**: No (defaults to `https://us.i.posthog.com`)
- **Example**:
  - US: `https://us.i.posthog.com`
  - EU: `https://eu.i.posthog.com`
  - Self-hosted: `https://posthog.yourdomain.com`
- **Note**:
  - Should match the region where your PostHog instance is hosted
  - Only needed if using a custom PostHog instance or EU region

### `POSTHOG_API_KEY`

- **Description**: PostHog project API key for backend LLM analytics tracking
- **Required**: No (PostHog will not be initialized if not provided)
- **Example**: `phc_abc123def456ghi789jkl012mno345pqr678stu901vwx234`
- **How to obtain**:
  1. Sign up for a PostHog account at https://posthog.com
  2. Create a new project
  3. Go to Project Settings → API Keys
  4. Copy the Project API Key
- **Note**:
  - Used for backend LLM analytics tracking (conversations, token usage, costs, latency, tool calls)
  - Automatically tracks all `streamText()` and `generateText()` calls via `@posthog/ai` integration
  - If not set, the application will continue to work but LLM analytics won't be tracked
  - Same API key can be used for both frontend (`VITE_POSTHOG_API_KEY`) and backend (`POSTHOG_API_KEY`)

### `POSTHOG_API_HOST`

- **Description**: PostHog API host URL for backend LLM analytics
- **Required**: No (defaults to `https://us.i.posthog.com`)
- **Example**:
  - US: `https://us.i.posthog.com`
  - EU: `https://eu.i.posthog.com`
  - Self-hosted: `https://posthog.yourdomain.com`
- **Note**:
  - Should match the region where your PostHog instance is hosted
  - Only needed if using a custom PostHog instance or EU region
  - Same host can be used for both frontend (`VITE_POSTHOG_API_HOST`) and backend (`POSTHOG_API_HOST`)

### `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` (Deprecated)

- **Description**: Cloudflare Turnstile site key for CAPTCHA validation
- **Required**: No (use `CLOUDFLARE_TURNSTILE_SITE_KEY` instead)
- **Example**: `0x4AAAAAAABkMYinukE_vqYQ`
- **Note**:
  - This variable is still supported for backwards compatibility
  - Prefer using `CLOUDFLARE_TURNSTILE_SITE_KEY` instead
  - The Vite config automatically maps `CLOUDFLARE_TURNSTILE_SITE_KEY` to this variable

## Email OAuth Configuration

### `GMAIL_CLIENT_ID`

- **Description**: Google OAuth 2.0 client ID for Gmail email connections
- **Required**: No (required only if using Gmail OAuth)
- **Example**: `123456789-abcdefghijklmnop.apps.googleusercontent.com`
- **How to obtain**:
  1. Go to [Google Cloud Console](https://console.cloud.google.com)
  2. Create a new project or select an existing one
  3. Enable the Gmail API
  4. Go to "Credentials" → "Create Credentials" → "OAuth client ID"
  5. Configure OAuth consent screen if not already done
  6. Select "Web application" as application type
  7. Add authorized redirect URIs: `{OAUTH_REDIRECT_BASE_URL}/api/email/oauth/gmail/callback`
  8. Copy the Client ID

### `GMAIL_CLIENT_SECRET`

- **Description**: Google OAuth 2.0 client secret for Gmail email connections
- **Required**: No (required only if using Gmail OAuth)
- **Example**: `GOCSPX-abcdefghijklmnopqrstuvwxyz`
- **How to obtain**: Created together with `GMAIL_CLIENT_ID` (see above)
- **Note**: Keep this secret secure and never commit it to version control

### `OUTLOOK_CLIENT_ID`

- **Description**: Microsoft Azure AD application (client) ID for Outlook email connections
- **Required**: No (required only if using Outlook OAuth)
- **Example**: `12345678-1234-1234-1234-123456789abc`
- **How to obtain**:
  1. Go to [Azure Portal](https://portal.azure.com)
  2. Navigate to "Azure Active Directory" → "App registrations"
  3. Click "New registration"
  4. Enter application name and select supported account types
  5. Add redirect URI: `{OAUTH_REDIRECT_BASE_URL}/api/email/oauth/outlook/callback`
  6. Go to "API permissions" → Add "Mail.Send" permission
  7. Copy the Application (client) ID

### `OUTLOOK_CLIENT_SECRET`

- **Description**: Microsoft Azure AD client secret for Outlook email connections
- **Required**: No (required only if using Outlook OAuth)
- **Example**: `abc123~DEF456ghi789JKL012mno345PQR678stu901`
- **How to obtain**:
  1. In your Azure AD app registration, go to "Certificates & secrets"
  2. Click "New client secret"
  3. Add description and select expiration
  4. Copy the secret value (only shown once)
- **Note**: Keep this secret secure and never commit it to version control

### `OAUTH_REDIRECT_BASE_URL`

- **Description**: Base URL for OAuth callback redirects
- **Required**: Yes (if using Gmail or Outlook OAuth)
- **Example**:
  - Development with frontend proxy: `http://localhost:5173`
  - Development with direct backend: `http://localhost:3333`
  - Production: `https://app.helpmaton.com`
- **Note**:
  - This should match where OAuth providers will redirect to (frontend URL if frontend proxies backend)
  - OAuth redirect URIs are constructed as: `{OAUTH_REDIRECT_BASE_URL}/api/email/oauth/{provider}/callback`
  - Must match the redirect URIs configured in Google Cloud Console and Azure Portal **exactly** (including protocol, port, and no trailing slash)
  - Do not include a trailing slash in this value

### `FRONTEND_URL`

- **Description**: Frontend application URL for OAuth callback redirects
- **Required**: No (defaults to `http://localhost:5173` in development)
- **Example**:
  - Development: `http://localhost:5173`
  - Production: `https://app.helpmaton.com`
- **Note**: Used to redirect users back to the frontend after OAuth flow completes

## S3 Configuration

The S3 integration is used for storing workspace documents. This integration operates outside of Architect's built-in S3 plugin and requires separate AWS credentials.

### `HELPMATON_S3_BUCKET`

- **Description**: S3 bucket name for storing workspace documents
- **Required**: No (defaults to `workspace.documents`)
- **Example**: `workspace.documents` or `my-workspace-docs`
- **Note**:
  - Used in both local development and production
  - The bucket must exist and be accessible with the provided credentials

### `HELPMATON_S3_ENDPOINT`

- **Description**: S3 endpoint URL (for local development with s3rver or custom S3-compatible services)
- **Required**: No (defaults to `http://localhost:4568` for local development)
- **Example**:
  - Local: `http://localhost:4568`
  - Custom: `https://s3.example.com`
- **Note**:
  - Only used in local development (when `ARC_ENV=testing` or `NODE_ENV!=production`)
  - In production, uses the standard AWS S3 endpoint for the specified region

### `HELPMATON_S3_ACCESS_KEY_ID`

- **Description**: AWS access key ID for S3 access
- **Required**: Yes (for production)
- **Example**: `AKIAIOSFODNN7EXAMPLE`
- **How to obtain**:
  1. Go to AWS IAM → Users → Select your user → Security credentials
  2. Create access key → Copy the Access key ID
- **Note**:
  - Required in production when not using IAM roles
  - Falls back to `AWS_ACCESS_KEY_ID` if not set
  - Must have permissions to read/write objects in the specified S3 bucket

### `HELPMATON_S3_SECRET_ACCESS_KEY`

- **Description**: AWS secret access key for S3 access
- **Required**: Yes (for production)
- **Example**: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
- **How to obtain**:
  1. Created together with the access key ID (see above)
  2. Copy the Secret access key (only shown once)
- **Note**:
  - Required in production when not using IAM roles
  - Falls back to `AWS_SECRET_ACCESS_KEY` if not set
  - Keep this secret secure and never commit it to version control

### `HELPMATON_S3_REGION`

- **Description**: AWS region where the S3 bucket is located
- **Required**: No (defaults to `AWS_REGION` or `eu-west-2`)
- **Example**: `eu-west-2`, `us-east-1`
- **Note**:
  - Should match the region where your S3 bucket is created
  - Falls back to `AWS_REGION` environment variable if not set
  - Defaults to `eu-west-2` if neither is set

## Vector Database S3 Configuration

The vector database (LanceDB) integration is used for storing agent memory data in a stratified memory system. This integration uses S3 for persistent storage of vector databases.

### `HELPMATON_VECTORDB_S3_BUCKET_PRODUCTION`

- **Description**: S3 bucket name for storing vector databases in production
- **Required**: Yes (for production deployments)
- **Example**: `vectordb.production` or `helpmaton-vectordb-prod`
- **Note**:
  - Used when `ARC_ENV=production` or `NODE_ENV=production`
  - Falls back to `HELPMATON_S3_BUCKET_PRODUCTION` if not set
  - The bucket must exist and be accessible with the provided credentials
  - Stores LanceDB vector databases for agent memory (working, daily, weekly, monthly, quarterly, yearly grains)
  - Path structure: `s3://bucket/vectordb/{agentId}/{grain}/{timeString}/`

### `HELPMATON_VECTORDB_S3_BUCKET_STAGING`

- **Description**: S3 bucket name for storing vector databases in staging/development
- **Required**: Yes (for staging/development deployments)
- **Example**: `vectordb.staging` or `helpmaton-vectordb-staging`
- **Note**:
  - Used when `ARC_ENV!=production` and `NODE_ENV!=production`
  - Falls back to `HELPMATON_S3_BUCKET_STAGING` if not set
  - The bucket must exist and be accessible with the provided credentials
  - Can use the same bucket as workspace documents or a separate bucket
  - Path structure: `s3://bucket/vectordb/{agentId}/{grain}/{timeString}/`

**Important Notes**:

- Vector database S3 buckets are separate from workspace document buckets
- The same AWS credentials (`HELPMATON_S3_ACCESS_KEY_ID`, `HELPMATON_S3_SECRET_ACCESS_KEY`) are used for both
- Vector databases are organized by agent ID, temporal grain (working, daily, weekly, etc.), and time string
- Each agent has separate vector databases for each memory grain
- See [Agent Memory System documentation](../docs/agent-memory-system.md) for more details

## Setting Environment Variables

### Local Development

For local development with Architect sandbox, you can set environment variables in a `.env` file in the `apps/backend` directory:

```bash
AUTH_SECRET=your-local-secret
MAILGUN_KEY=your-mailgun-key
MAILGUN_DOMAIN=helpmaton.com
BASE_URL=http://localhost:3333
ARC_DB_PATH=./db
HELPMATON_S3_BUCKET=workspace.documents
HELPMATON_S3_ENDPOINT=http://localhost:4568
HELPMATON_VECTORDB_S3_BUCKET_STAGING=vectordb.staging
SENTRY_DSN=https://your-sentry-dsn
VITE_SENTRY_DSN=https://your-sentry-dsn
VITE_POSTHOG_API_KEY=phc_your-posthog-api-key
VITE_POSTHOG_API_HOST=https://us.i.posthog.com
POSTHOG_API_KEY=phc_your-posthog-api-key
POSTHOG_API_HOST=https://us.i.posthog.com

# Lemon Squeezy Configuration
LEMON_SQUEEZY_API_KEY=sk_test_your_api_key_here
LEMON_SQUEEZY_WEBHOOK_SECRET=whsec_your_webhook_secret_here
LEMON_SQUEEZY_STORE_ID=12345
LEMON_SQUEEZY_STARTER_VARIANT_ID=67890
LEMON_SQUEEZY_PRO_VARIANT_ID=67891
LEMON_SQUEEZY_CREDIT_VARIANT_ID=123456
LEMON_SQUEEZY_CHECKOUT_SUCCESS_URL=http://localhost:5173/subscription?success=true
LEMON_SQUEEZY_CHECKOUT_CANCEL_URL=http://localhost:5173/subscription?cancelled=true
```

Or set them directly when running the sandbox:

```bash
AUTH_SECRET=secret MAILGUN_KEY=key ARC_DB_PATH=./db pnpm arc sandbox
```

**Note**: The `ARC_DB_PATH` environment variable is automatically set in the `dev:backend` script to persist the local database to `apps/backend/db`. This ensures your local data persists across server restarts.

### Production/Staging

For production and staging environments, environment variables are **injected directly into Lambda bundles at build time** using esbuild's `define` option. This approach ensures that each PR deployment has isolated environment variables without relying on SSM Parameter Store (which would be shared across all staging deployments).

**How it works:**

1. Environment variables are set in the GitHub Actions workflow's `env:` section
2. During the build process, esbuild replaces `process.env.VAR_NAME` with the actual string values
3. The values are hardcoded into the compiled Lambda function bundles
4. Each deployment gets its own isolated set of environment variables

**Configuration:**

The build-time injection is configured in `esbuild-config.cjs`. The configuration automatically:

- Reads environment variables from `process.env` during the build
- Creates a `define` object that maps `process.env.VAR_NAME` to the actual string value
- Only includes variables that are explicitly set (undefined variables are not replaced)
- Handles both `process.env.VAR_NAME` and `process.env['VAR_NAME']` patterns

**For CI/CD deployments:**

Environment variables are automatically set in the GitHub Actions workflows (`.github/workflows/deploy-pr.yml` and `.github/workflows/deploy-prod.yml`). The variables are available during the build process and will be injected into the bundles.

**For manual deployments:**

If deploying manually, ensure environment variables are set in your shell before running `arc deploy`:

```bash
export AUTH_SECRET="your-secret"
export MAILGUN_KEY="your-mailgun-key"
export BASE_URL="https://app.helpmaton.com"
# ... set other required variables ...

cd apps/backend
pnpm arc deploy --production --no-hydrate --verbose
```

**Note:** Unlike the previous approach using `arc env`, environment variables are no longer stored in SSM Parameter Store. They are embedded directly in the Lambda function code during the build process. This means:

- Each PR deployment has completely isolated environment variables
- Changes to environment variables require a new deployment
- Variables are visible in the compiled bundle (acceptable for Lambda functions)

## Lemon Squeezy Configuration

### `LEMON_SQUEEZY_API_KEY`

- **Description**: Lemon Squeezy API key for authenticating API requests
- **Required**: Yes (for subscription management and checkout creation)
- **Example**:
  - Production: `sk_live_1234567890abcdefghijklmnopqrstuvwxyz`
  - Test: `sk_test_1234567890abcdefghijklmnopqrstuvwxyz`
- **How to obtain**:
  1. Log in to [Lemon Squeezy Dashboard](https://app.lemonsqueezy.com)
  2. Go to Settings → API
  3. Create a new API key or copy existing key
  4. Use the "Secret Key" (starts with `sk_live_` for production or `sk_test_` for test mode)
- **Note**:
  - Keep this secret secure and never commit it to version control
  - Use test API keys (`sk_test_`) for development/staging and live API keys (`sk_live_`) for production
  - Test mode for checkouts is determined by `NODE_ENV` (see `LEMON_SQUEEZY_TEST_MODE` below)

### `LEMON_SQUEEZY_WEBHOOK_SECRET`

- **Description**: Webhook signing secret for verifying webhook authenticity
- **Required**: Yes (for webhook signature verification)
- **Example**: `whsec_1234567890abcdefghijklmnopqrstuvwxyz`
- **How to obtain**:
  1. In Lemon Squeezy Dashboard, go to Settings → Webhooks
  2. Create a new webhook endpoint: `https://app.helpmaton.com/api/webhooks/lemonsqueezy`
  3. Copy the "Signing Secret" (starts with `whsec_`)
- **Note**: This secret is used to verify that webhooks are actually from Lemon Squeezy

### `LEMON_SQUEEZY_STORE_ID`

- **Description**: Your Lemon Squeezy store ID
- **Required**: Yes (for creating checkout sessions)
- **Example**: `12345`
- **How to obtain**:
  1. In Lemon Squeezy Dashboard, go to Settings → General
  2. Copy your Store ID (numeric value)

### `LEMON_SQUEEZY_STARTER_VARIANT_ID`

- **Description**: Lemon Squeezy variant ID for Starter plan (29 EUR/month)
- **Required**: Yes (for Starter plan checkout)
- **Example**: `67890`
- **How to obtain**:
  1. In Lemon Squeezy Dashboard, go to Products
  2. Create or select your Starter plan product
  3. Create a variant with price: 29 EUR, billing period: Monthly
  4. Copy the Variant ID (numeric value)

### `LEMON_SQUEEZY_PRO_VARIANT_ID`

- **Description**: Lemon Squeezy variant ID for Pro plan (99 EUR/month)
- **Required**: Yes (for Pro plan checkout)
- **Example**: `67891`
- **How to obtain**:
  1. In Lemon Squeezy Dashboard, go to Products
  2. Create or select your Pro plan product
  3. Create a variant with price: 99 EUR, billing period: Monthly
  4. Copy the Variant ID (numeric value)

### `LEMON_SQUEEZY_CREDIT_VARIANT_ID`

- **Description**: Lemon Squeezy variant ID for credit purchases (used for custom amount purchases)
- **Required**: Yes (for credit purchase functionality)
- **Example**: `123456`
- **How to obtain**:
  1. In Lemon Squeezy Dashboard, go to Products
  2. Create a new product named "Credits" or "Workspace Credits"
  3. Create a single variant with any price (e.g., 1 EUR) - the price will be overridden with `custom_price` during checkout
  4. Copy the Variant ID (numeric value)
- **Note**: Even though we use `custom_price` to set the exact amount, Lemon Squeezy requires a variant ID. The variant's default price will be overridden by the custom price you specify.

### `LEMON_SQUEEZY_CHECKOUT_SUCCESS_URL`

- **Description**: URL to redirect users after successful payment
- **Required**: No (defaults to `{BASE_URL}/subscription?success=true`)
- **Example**: `https://app.helpmaton.com/subscription?success=true`
- **Note**: Should point to subscription management page with success message

### `LEMON_SQUEEZY_CHECKOUT_CANCEL_URL`

- **Description**: URL to redirect users if they cancel checkout
- **Required**: No (defaults to `{BASE_URL}/subscription?cancelled=true`)
- **Example**: `https://app.helpmaton.com/subscription?cancelled=true`
- **Note**: Should point to subscription management page

### `LEMON_SQUEEZY_TEST_MODE`

- **Description**: Explicitly enable or disable test mode for checkouts
- **Required**: No (auto-detected from `NODE_ENV` if not set)
- **Example**: `true` or `false`
- **How it works**:
  - If not set, test mode is automatically determined by `NODE_ENV`:
    - `NODE_ENV !== "production"` → test mode enabled (development, test, staging, etc.)
    - `NODE_ENV === "production"` → test mode disabled (live mode)
  - If set to `true`, forces test mode regardless of `NODE_ENV`
  - If set to `false`, forces live mode regardless of `NODE_ENV`
- **Note**:
  - In test mode, checkouts use test payment methods (e.g., card `4242 4242 4242 4242`)
  - Test mode checkouts don't process real payments
  - Use test mode for development and staging environments
  - The API key type (`sk_test_` vs `sk_live_`) should match your environment, but doesn't control test mode

**Important Notes**:

- Use test mode keys (`sk_test_`) for development and staging
- Use production keys (`sk_live_`) only for production environment
- Webhook URL must be publicly accessible: `https://app.helpmaton.com/api/webhooks/lemonsqueezy`
- Configure webhook in Lemon Squeezy Dashboard to send all subscription and order events
- Credit purchases use custom amounts (user enters any amount, that exact amount is charged and credited)

## Security Notes

1. **Never commit secrets to version control**: Always use environment variables or secure secret management systems
2. **Use different secrets per environment**: Use different `AUTH_SECRET` values for development, staging, and production
3. **Rotate secrets regularly**: Periodically rotate your `AUTH_SECRET`, `MAILGUN_KEY`, S3 credentials, and Lemon Squeezy API keys
4. **Restrict email access**: In production, consider setting `ALLOWED_EMAILS` to restrict who can sign in
5. **S3 credentials security**:
   - Never commit `HELPMATON_S3_ACCESS_KEY_ID` or `HELPMATON_S3_SECRET_ACCESS_KEY` to version control
   - Use IAM roles when possible instead of access keys
   - Grant S3 credentials only the minimum permissions needed (read/write to the specific bucket)
   - Rotate S3 credentials regularly
6. **Lemon Squeezy security**:
   - Never commit `LEMON_SQUEEZY_API_KEY` or `LEMON_SQUEEZY_WEBHOOK_SECRET` to version control
   - Use test mode keys for development and staging
   - Rotate API keys regularly
   - Verify all webhook signatures to prevent unauthorized access
