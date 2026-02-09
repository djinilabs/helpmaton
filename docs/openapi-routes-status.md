# OpenAPI Documentation Status for /api/workspaces Routes

## Summary

**Total paths in generated spec**: 85  
**Workspace-related paths documented**: 74 (paths under `/api/workspaces`, plus `/api/workspaces/import`, `/api/workspaces/onboarding-agent/stream`)  
**Missing documentation**: 1 known route (see below)

The OpenAPI spec is generated from `@openapi` JSDoc annotations in route handler files. Run `pnpm generate:openapi` to regenerate `apps/backend/openapi.json` and update the copy in `apps/frontend/public/openapi.json`. To verify coverage, compare the `paths` object in the generated spec against the routes registered in `apps/backend/src/http/any-api-workspaces-catchall/routes` and related handlers.

## Documented route areas

The generated spec includes paths for:

- **User**: verify-gate, api-keys (CRUD), refresh-token, generate-tokens
- **Workspaces**: CRUD, import, onboarding-agent/stream, spending-limits, members, invites, integrations, documents, channels, agents, trial-credit-request, trial-status, usage, transactions, suggestions, export, api-key(s), email-connection, mcp-servers, email OAuth
- **Agents**: CRUD, generate-prompt, improve-prompt-from-evals, keys, spending-limits, schedules, eval-judges, eval-results, conversations, usage, transactions, tools, suggestions, memory, knowledge-graph, stream-servers, file upload-url
- **Public/other**: /api/version, /api/usage, /api/usage/daily, /api/stream-url, /api/pricing, /api/models, /api/health
- **Email**: /api/email/oauth/{provider}/callback, workspace email OAuth authorize

## Missing documentation

Routes that exist in code but do not yet have `@openapi` annotations:

- **POST /api/workspaces/{workspaceId}/credits/purchase** – Create Lemon Squeezy checkout for credit purchase ([post-workspace-credits-purchase.ts](apps/backend/src/http/any-api-workspaces-catchall/routes/post-workspace-credits-purchase.ts))

## Next steps

To add or update OpenAPI documentation:

1. Add `@openapi` JSDoc annotations above the route registration in the handler file.
2. Define request/response schemas in `apps/backend/src/openapi/schemas.ts` if needed.
3. Run `pnpm generate:openapi` to regenerate the spec.
4. Verify the new path appears in `apps/backend/openapi.json`.

See [docs/openapi-generation.md](openapi-generation.md) for annotation format and examples.
