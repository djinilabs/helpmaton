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

### `OPENROUTER_API_KEY`

- **Description**: OpenRouter API key for unified LLM provider access
- **Required**: Yes (for all LLM calls via OpenRouter)
- **Example**: `sk-or-v1-...`
- **How to obtain**:
  1. Go to [OpenRouter Dashboard](https://openrouter.ai/dashboard)
  2. Sign up or log in to your account
  3. Navigate to Keys section
  4. Create a new API key
  5. Copy the key value
- **Note**:
  - Used as the primary provider for all LLM calls (replaces direct provider API keys)
  - Provides access to multiple AI models from different providers (Anthropic, Google, Meta, Mistral, etc.)
  - Supports automatic model selection when model is set to "auto"
  - Workspace-specific OpenRouter API keys can override this system key (BYOK support)
  - Cost verification is performed in background via OpenRouter API to ensure accurate billing

### `TAVILY_API_KEY`

- **Description**: Tavily API key for web search and content extraction functionality
- **Required**: Yes (for Web search and fetch tools)
- **Example**: `tvly-...`
- **How to obtain**:
  1. Go to [Tavily Dashboard](https://tavily.com)
  2. Sign up or log in to your account
  3. Navigate to API Keys section
  4. Create a new API key
  5. Copy the key value
- **Note**:
  - Used for Web search and fetch tools available to agents
  - System-wide API key (not per-workspace)
  - Tavily API returns usage information (credits consumed) in responses
  - Pricing: $0.008 per API call (1 credit = 1 call)
  - See [Tavily Integration documentation](../docs/tavily-integration.md) for more details

### `TAVILY_API_KEY_TYPE`

- **Description**: Type of Tavily API key being used
- **Required**: No (defaults to free tier behavior)
- **Valid Values**: `"production"` or `"pay-as-you-go"` (case-insensitive)
- **Example**: `production`
- **Note**:
  - Set to `"production"` or `"pay-as-you-go"` if using a production Tavily API key
  - Production keys bypass the 10 calls/day limit and charge credits for all calls
  - If not set or set to any other value, the system enforces free tier limits (10 calls/day)
  - Production keys are pay-as-you-go: all calls are charged, no free tier allowance

### `JINA_API_KEY`

- **Description**: Jina Reader API key for web content extraction functionality
- **Required**: No (Jina Reader API works without API key but with rate limits)
- **Example**: `jina_...`
- **How to obtain**:
  1. Go to [Jina.ai Dashboard](https://jina.ai)
  2. Sign up or log in to your account
  3. Navigate to API Keys section
  4. Create a new API key
  5. Copy the key value
- **Note**:
  - Used for Jina Reader API when `fetchWebProvider` is set to `"jina"` for agents
  - Optional: Jina Reader API works without API key (20 requests per minute limit)
  - With API key: Rate limit increases to 200 requests per minute
  - Free tier: 1 million free tokens available

### `EXA_API_KEY`

- **Description**: Exa.ai API key for category-specific search functionality
- **Required**: Yes (for Exa search tool)
- **Example**: `exa_...`
- **How to obtain**:
  1. Go to [Exa.ai Dashboard](https://exa.ai)
  2. Sign up or log in to your account
  3. Navigate to API Keys section
  4. Create a new API key
  5. Copy the key value
- **Note**:
  - Used for Exa.ai search tool available to agents
  - System-wide API key (not per-workspace)
  - Exa.ai API returns cost information (`costDollars.total`) in responses
  - Pricing: Variable based on number of results (1-25 results: $5/1000 requests, 26-100: $25/1000 requests)
  - Pay-as-you-go: All requests require credits (no free tier)
  - Supports category-specific searches: company, research paper, news, pdf, github, tweet, personal site, people, financial report

### `DECODO_PROXY_URLS`

- **Description**: JSON array of Decodo residential proxy URLs with embedded credentials for web scraping
- **Required**: Yes (for `/api/scrape` endpoint)
- **Example**: `["http://username1:password1@gate.decodo.com:10001", "http://username2:password2@gate.decodo.com:10002", "http://username3:password3@gate.decodo.com:10003"]`
- **Format**:
  - JSON array of strings
  - Each URL format: `http://username:password@gate.decodo.com:PORT`
  - Port range: 10001 to 10010
  - Username and password are embedded in each URL and must be kept as secrets
- **How to obtain**:
  1. Sign up for a Decodo account at [Decodo](https://decodo.com)
  2. Navigate to your proxy settings
  3. Create proxy endpoints with credentials
  4. Format each proxy as: `http://username:password@gate.decodo.com:PORT`
  5. Create a JSON array with all proxy URLs
- **Note**:
  - Used by the `/api/scrape` endpoint for web scraping with Puppeteer
  - The endpoint randomly selects one proxy URL from the array for each request (load balancing)
  - Multiple proxy URLs allow for better distribution of requests and redundancy
  - All credentials are embedded in the URLs and must be kept secure
  - Port numbers can range from 10001 to 10010
  - Keep this secret secure and never commit it to version control

### `TWOCAPTCHA_API_KEY`

- **Description**: 2Captcha API key for automatic reCAPTCHA solving during web scraping
- **Required**: No (CAPTCHA solving will be disabled if not provided)
- **Example**: `1234567890abcdef1234567890abcdef`
- **How to obtain**:
  1. Sign up for a 2Captcha account at [2Captcha](https://2captcha.com)
  2. Navigate to your account settings
  3. Copy your API key from the dashboard
  4. Add funds to your account (pricing: ~$2.99 per 1000 reCAPTCHAs)
- **Note**:
  - Used by the `/api/scrape` endpoint for automatically solving reCAPTCHA challenges
  - Integrated via `puppeteer-extra-plugin-recaptcha` plugin
  - Automatically detects and solves reCAPTCHA v2 and v3 challenges
  - If not set, the scraper will return an error when encountering a CAPTCHA
  - Keep this secret secure and never commit it to version control
  - Costs apply per solved CAPTCHA (~$0.003 per solve)

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

## MCP Server OAuth Configuration

### `GOOGLE_OAUTH_CLIENT_ID`

- **Description**: Google OAuth 2.0 client ID for Google Drive, Gmail, and Google Calendar MCP servers
- **Required**: No (required only if using Google OAuth-based MCP servers)
- **Example**: `123456789-abcdefghijklmnop.apps.googleusercontent.com`
- **How to obtain**:
  1. Go to [Google Cloud Console](https://console.cloud.google.com)
  2. Create a new project or select an existing one
  3. Enable the required APIs (Drive API, Gmail API, Calendar API)
  4. Go to "Credentials" → "Create Credentials" → "OAuth client ID"
  5. Configure OAuth consent screen if not already done
  6. Select "Web application" as application type
  7. Add authorized redirect URIs:
     - `{OAUTH_REDIRECT_BASE_URL}/api/mcp/oauth/google-drive/callback`
     - `{OAUTH_REDIRECT_BASE_URL}/api/mcp/oauth/gmail/callback`
     - `{OAUTH_REDIRECT_BASE_URL}/api/mcp/oauth/google-calendar/callback`
  8. Copy the Client ID

### `GOOGLE_OAUTH_CLIENT_SECRET`

- **Description**: Google OAuth 2.0 client secret for Google Drive, Gmail, and Google Calendar MCP servers
- **Required**: No (required only if using Google OAuth-based MCP servers)
- **Example**: `GOCSPX-abcdefghijklmnopqrstuvwxyz`
- **How to obtain**: Created together with `GOOGLE_OAUTH_CLIENT_ID` (see above)
- **Note**: Keep this secret secure and never commit it to version control

### `NOTION_OAUTH_CLIENT_ID`

- **Description**: Notion OAuth 2.0 client ID for Notion MCP servers
- **Required**: No (required only if using Notion MCP servers)
- **Example**: `12345678-1234-1234-1234-123456789abc`
- **How to obtain**:
  1. Go to [Notion Integrations](https://www.notion.com/my-integrations)
  2. Click "+ New integration"
  3. Select "Public" as the integration type
  4. Provide your company name, website, and redirect URI: `{OAUTH_REDIRECT_BASE_URL}/api/mcp/oauth/notion/callback`
  5. Copy the OAuth client ID from the "Secrets" tab

### `NOTION_OAUTH_CLIENT_SECRET`

- **Description**: Notion OAuth 2.0 client secret for Notion MCP servers
- **Required**: No (required only if using Notion MCP servers)
- **Example**: `secret_abcdefghijklmnopqrstuvwxyz1234567890`
- **How to obtain**: Found in the "Secrets" tab of your Notion integration settings
- **Note**: Keep this secret secure and never commit it to version control

### `LINEAR_OAUTH_CLIENT_ID`

- **Description**: Linear OAuth 2.0 client ID for Linear MCP servers
- **Required**: No (required only if using Linear MCP servers)
- **Example**: `lin_1234567890abcdef`
- **How to obtain**:
  1. Go to [Linear developer settings](https://linear.app/settings/api)
  2. Create a new OAuth application
  3. Add the redirect URI: `{OAUTH_REDIRECT_BASE_URL}/api/mcp/oauth/linear/callback`
  4. Copy the Client ID

### `LINEAR_OAUTH_CLIENT_SECRET`

- **Description**: Linear OAuth 2.0 client secret for Linear MCP servers
- **Required**: No (required only if using Linear MCP servers)
- **Example**: `lin_secret_abcdefghijklmnopqrstuvwxyz1234567890`
- **How to obtain**: Found in the OAuth application settings
- **Note**: Keep this secret secure and never commit it to version control

### `HUBSPOT_OAUTH_CLIENT_ID`

- **Description**: HubSpot OAuth client ID for HubSpot MCP servers
- **Required**: No (required only if using HubSpot MCP servers)
- **Example**: `12345678-abcd-1234-abcd-1234567890ab`
- **How to obtain**:
  1. Go to [HubSpot developer app settings](https://developers.hubspot.com/)
  2. Create or open your app
  3. Add the redirect URI: `{OAUTH_REDIRECT_BASE_URL}/api/mcp/oauth/hubspot/callback`
  4. Copy the Client ID

### `HUBSPOT_OAUTH_CLIENT_SECRET`

- **Description**: HubSpot OAuth client secret for HubSpot MCP servers
- **Required**: No (required only if using HubSpot MCP servers)
- **Example**: `abcd1234efgh5678ijkl9012mnop3456`
- **How to obtain**: Found in the HubSpot app settings
- **Note**: Keep this secret secure and never commit it to version control

### `SLACK_OAUTH_CLIENT_ID`

- **Description**: Slack OAuth client ID for Slack MCP servers
- **Required**: No (required only if using Slack MCP servers)
- **Example**: `1234567890.123456789012`
- **How to obtain**:
  1. Go to [Slack API apps](https://api.slack.com/apps)
  2. Create or open your Slack app
  3. Add the redirect URI: `{OAUTH_REDIRECT_BASE_URL}/api/mcp/oauth/slack/callback`
  4. Copy the Client ID from "Basic Information"

### `SLACK_OAUTH_CLIENT_SECRET`

- **Description**: Slack OAuth client secret for Slack MCP servers
- **Required**: No (required only if using Slack MCP servers)
- **Example**: `abcd1234efgh5678ijkl9012mnop3456`
- **How to obtain**: Found in the Slack app "Basic Information" section
- **Note**: Keep this secret secure and never commit it to version control

## GitHub App Configuration

**Note**: Helpmaton is designed to integrate with GitHub via GitHub Apps (not OAuth Apps) for its MCP server integration. In the current implementation, API calls use standard OAuth user access tokens obtained via a GitHub OAuth client ID and `client_secret`, which must be provided to the backend via appropriate environment variables. Support for private key-based JWT authentication and server-to-server installation access tokens is reserved for potential future use and may not yet be active in all deployments.

**OAuth Scope**: The GitHub OAuth flow uses the `repo` scope, which grants read and write access to all repositories (both public and private) that the user has access to. This integration is designed to perform only read operations, but the token technically has write capabilities.

### `GH_APP_ID`

- **Description**: GitHub App ID (numeric) for GitHub MCP servers. Used as the issuer (`iss`) claim in JWT tokens for installation access tokens (server-to-server authentication). Also used as a fallback for Client ID in OAuth flows if `GH_APP_CLIENT_ID` is not set.
- **Required**: Yes (required if using GitHub MCP servers)
- **Example**: `123456`
- **How to obtain**:
  1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
  2. Click "GitHub Apps" → "New GitHub App"
  3. Fill in the application details:
     - **GitHub App name**: Your app name (e.g., "Helpmaton")
     - **Homepage URL**: Your application URL
     - **User authorization callback URL**: `{OAUTH_REDIRECT_BASE_URL}/api/mcp/oauth/github/callback`
     - Enable "Request user authorization (OAuth) during installation"
     - Set required permissions (e.g., Repository permissions: Read-only access to repositories)
     - **Note**: The OAuth scope used is `repo`, which grants read and write access to all repositories (both public and private) that the user has access to. This integration performs only read operations, but the token technically has write capabilities.
  4. Click "Create GitHub App"
  5. Copy the App ID from the app settings page (shown in the "About" section)
- **Note**: The variable name uses `GH_` prefix instead of `GITHUB_` because GitHub secrets cannot start with `GITHUB_` (reserved prefix).

### `GH_APP_CLIENT_ID`

- **Description**: GitHub App Client ID (string) for GitHub MCP servers. Used in OAuth authorization URLs and token exchange requests.
- **Required**: Yes (required for OAuth flows. Falls back to `GH_APP_ID` if not set, but Client ID is preferred)
- **Example**: `Iv1.8a61f9b3a7aba766`
- **How to obtain**: Found on the same GitHub App settings page as the App ID. The Client ID is shown in the "About" section.
- **Note**: The variable name uses `GH_` prefix instead of `GITHUB_` because GitHub secrets cannot start with `GITHUB_` (reserved prefix).

### `GH_APP_CLIENT_SECRET`

- **Description**: GitHub App Client Secret for OAuth token exchange and refresh flows. This is required for the user authorization OAuth flow (authorization code exchange and token refresh).
- **Required**: Yes (required for OAuth flows)
- **Example**: `github_client_secret_abc123xyz`
- **How to obtain**:
  1. Go to your GitHub App settings page
  2. Scroll to "Client secrets" section
  3. Click "Generate a new client secret"
  4. Copy the secret immediately (it will only be shown once)
  5. Store it securely in your `.env` file
- **Note**:
  - Keep this secret secure and never commit it to version control
  - Client secrets are used for OAuth flows (user authorization)
  - The variable name uses `GH_` prefix instead of `GITHUB_` because GitHub secrets cannot start with `GITHUB_` (reserved prefix)

### `GH_APP_PRIVATE_KEY`

- **Description**: GitHub App private key (PEM format) for JWT authentication. Used to sign JWTs for GitHub App installation tokens (server-to-server authentication). This is NOT used for user OAuth flows, which use `GH_APP_CLIENT_SECRET` instead.
- **Required**: Conditionally (required only if you use GitHub App installation tokens / server-to-server GitHub API access for GitHub MCP servers; not required for user OAuth flows that use the client secret)
- **Example**:
  ```
  -----BEGIN PRIVATE KEY-----
  MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
  -----END PRIVATE KEY-----
  ```
- **How to obtain**:
  1. Go to your GitHub App settings page
  2. Scroll to "Private keys" section
  3. Click "Generate a private key"
  4. Download the `.pem` file or copy the key content
  5. Store it securely in your `.env` file (see formatting options below)
- **Storage in .env file**:

  The private key can be stored in several formats:

  **Option 1: Single line with `\n` escape sequences** (recommended):

  ```bash
  GH_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----"
  ```

  To convert your `.pem` file to this format:

  ```bash
  # On Linux/Mac:
  cat private-key.pem | tr '\n' '\\n' | sed 's/^/GH_APP_PRIVATE_KEY="/;s/$/"/'
  ```

  **Option 2: Base64-encoded** (alternative):

  ```bash
  # Encode the key file:
  cat private-key.pem | base64 -w 0

  # Then in .env:
  GH_APP_PRIVATE_KEY="LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0t..."
  ```

  The code automatically detects and handles both formats.

- **Note**:
  - Keep this key secure and never commit it to version control
  - GitHub Apps can have up to 25 private keys registered at any time
  - The private key is used to generate JWTs (RS256 algorithm) for installation access tokens (server-to-server authentication)
  - JWTs are valid for up to 10 minutes and are automatically regenerated as needed
  - **This is NOT used for user OAuth flows** - OAuth flows use `GH_APP_CLIENT_SECRET` instead
  - The code handles keys with or without PEM headers, escaped newlines, and base64 encoding
  - The variable name uses `GH_` prefix instead of `GITHUB_` because GitHub secrets cannot start with `GITHUB_` (reserved prefix)

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

**Important**: In staging and production environments, LanceDB requires the following environment variables to be set:

- `HELPMATON_S3_ACCESS_KEY_ID` - AWS access key ID for S3 access
- `HELPMATON_S3_SECRET_ACCESS_KEY` - AWS secret access key for S3 access
- `HELPMATON_S3_REGION` - AWS region where the S3 bucket is located (defaults to `AWS_REGION` or `eu-west-2`)

These credentials are used explicitly when connecting to S3 for LanceDB operations. In local development (`ARC_ENV=testing`), LanceDB uses the local s3rver with default credentials.

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
