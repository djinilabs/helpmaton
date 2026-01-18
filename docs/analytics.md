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
