# MCP OAuth Integration E2E Tests

This suite tests all OAuth-based MCP integrations end-to-end:

- OAuth connection
- Enabling MCP servers on an agent
- Calling a real MCP tool from agent chat

## What You Need

- A running local environment:
  - Frontend at `http://localhost:5173`
  - Backend at `http://localhost:3333`
- OAuth apps configured for all 14 services
- Test accounts for each service
- Ability to complete OAuth flows in a browser (manual login, consent, 2FA)

## How It Works

1. Creates a workspace + agent
2. Creates an OAuth MCP server for each service
3. Initiates OAuth flow and pauses for manual completion if needed
4. Verifies the OAuth connection
5. Enables the MCP server on the agent
6. Calls a tool via agent chat

## Running the Tests

From the repo root:

```
pnpm test:e2e tests/e2e/mcp-oauth/mcp-oauth-integration.spec.ts
```

For manual OAuth steps, run with headed mode:

```
HEADLESS=false pnpm test:e2e tests/e2e/mcp-oauth/mcp-oauth-integration.spec.ts
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

The test will prompt you in the terminal for these values.

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
