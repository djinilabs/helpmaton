## Analytics (PostHog)

### Event naming
- Use snake_case `feature_action` (example: `agent_schedule_created`).
- Prefer backend tracking for webhook, async, and billing flows.

### Required properties
- `workspace_id` for workspace-scoped actions
- `agent_id` when an agent is targeted
- `user_id` when known (admin/system events)
- `subscription_tier` for billing and limits
- `environment` is set by tracking helpers

### Helper locations
- Frontend: `apps/frontend/src/utils/tracking.ts`
- Backend: `apps/backend/src/utils/tracking.ts`

## Observability (Sentry)

### Tracing defaults
- Backend Lambdas trace 100% of production traffic by default.
- Non-production environments disable tracing unless explicitly enabled in code.
- Flushing happens only at the end of Lambda execution to avoid delaying spans.

### Configuration
- `SENTRY_DSN`: required to enable Sentry.
- `SENTRY_TRACES_SAMPLE_RATE`: optional override for production sample rate (default: `1.0`).
- `SENTRY_RELEASE`: optional release identifier; falls back to `GITHUB_SHA`.
