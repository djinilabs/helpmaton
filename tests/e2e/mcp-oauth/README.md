# MCP OAuth Integration E2E Tests

This suite tests all OAuth-based MCP integrations end-to-end:

- OAuth connection
- Enabling MCP servers on an agent
- Calling a real MCP tool from agent chat

## What You Need

- A running local environment:
  - Frontend at `http://localhost:5173`
  - Backend at `http://localhost:3333`
- OAuth apps configured for all 14 tested services
- Test accounts for each service
- Ability to complete OAuth flows in a browser (manual login, consent, 2FA)

Note: PostHog is supported elsewhere in the project but is not included in these OAuth E2E tests.

## How It Works

1. Creates a workspace + agent
1b. Upgrades the local test subscription to `pro` to avoid MCP server limits
2. Creates an OAuth MCP server for each service
3. Initiates OAuth flow and pauses for manual completion if needed
4. Verifies the OAuth connection
5. Enables the MCP server on the agent
6. Calls a tool via agent chat

## Running the Tests

From the repo root:

```
pnpm test:e2e:mcp-oauth
```

This suite uses the installed Google Chrome (`channel: "chrome"`) to avoid
Google OAuth blocking the automated Chromium build.

For manual OAuth steps, run with headed mode:

```
pnpm test:e2e:mcp-oauth
```

## Guardrail

This suite only runs when `RUN_MCP_OAUTH_E2E=true` is set. The `test:e2e:mcp-oauth`
script sets this automatically, so it will not run as part of `pnpm test:e2e`.

## Headed Mode

The `test:e2e:mcp-oauth` script forces `HEADLESS=false`, so the browser always
opens for manual OAuth completion. If you need headless mode, run:

```
HEADLESS=true pnpm test:e2e:mcp-oauth
```

## Preserving OAuth Credentials

By default, the OAuth E2E test cleans up MCP servers after each provider. To
preserve the created MCP servers (so you can reuse credentials for tool tests),
set:

```
MCP_OAUTH_PRESERVE=true pnpm test:e2e:mcp-oauth
```

## Manual OAuth Steps

The test will pause with Playwright Inspector when manual steps are required:

- Login screens
- Consent/authorization screens
- 2FA prompts
- Account selection

Complete the flow in the browser and the test will continue automatically once
it detects the callback URL.

## Service-Specific Prompts

Some services require extra config before OAuth:

- **Shopify**: `shopDomain`
- **Zendesk**: `subdomain`

The test will prompt you in the terminal for these values, or you can set
environment variables to avoid prompts:

```
MCP_OAUTH_SHOPIFY_SHOP_DOMAIN=your-shop.myshopify.com
MCP_OAUTH_ZENDESK_SUBDOMAIN=your-zendesk-subdomain
MCP_OAUTH_ZENDESK_CLIENT_ID=your-zendesk-client-id
MCP_OAUTH_ZENDESK_CLIENT_SECRET=your-zendesk-client-secret
SHOPIFY_OAUTH_CLIENT_ID=your-shopify-client-id
SHOPIFY_OAUTH_CLIENT_SECRET=your-shopify-client-secret
MCP_OAUTH_SKIP_SERVICES=google-drive,gmail
MCP_OAUTH_SKIP_GOOGLE_DRIVE=true
MCP_OAUTH_SKIP_GMAIL=true
```

For best results, put these in `tests/e2e/.env` so they are loaded before
the test starts.

## MCP Tool Integration Test

There is a separate Vitest integration test that invokes every MCP tool for
each provider using real services. It queries the local DynamoDB sandbox
directly and fails if it cannot find credentials for a provider.

From the repo root:

```
RUN_MCP_TOOLS_INTEGRATION=true pnpm test:mcp-tools:integration
```

To limit providers:

```
RUN_MCP_TOOLS_INTEGRATION=true pnpm test:mcp-tools:integration --services=github,slack
```

You can also pass a comma-separated list directly:

```
RUN_MCP_TOOLS_INTEGRATION=true pnpm test:mcp-tools:integration github,slack
```

Google Drive note:

```
MCP_GOOGLE_DRIVE_FILE_ID=your-file-id
MCP_GOOGLE_DRIVE_QUERY=your-search-query
```

## Error Reporting

When a service fails, the test will:

- Capture a screenshot in `test-results/`
- Print the error details in the test output
- Continue to the next service (final test will fail with a summary)

Example failure output:

```
[zendesk] Redirect URI mismatch
Details: The redirect URI in the OAuth app configuration does not match the callback URL
Action: Update OAuth app redirect URI to match: http://localhost:3333/api/mcp-oauth/zendesk/callback
Screenshot: test-results/mcp-oauth-zendesk-oauth-1700000000000.png
```

## Notes

- If a tool requires parameters, the test will prompt you for JSON args.
- If no tool can be matched for a service, the test will record a failure for that service.
