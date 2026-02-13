---
id: posthog-events-debugging
name: PostHog Events Debugging
description: Event inspection, person lookup, data quality checks
role: engineering
requiredTools:
  - type: mcpService
    serviceType: posthog
---

## PostHog Events Debugging

When debugging events or persons:

- Use list events with filters (event name, distinct_id, person_id, time range) to find relevant data.
- Use get person or list persons to inspect user profiles and property consistency.
- For data quality, check that expected events exist and have the right properties.
- Always specify projectId; list projects first if unknown.
- When reporting issues, include event names, distinct_id or person_id, and sample payloads where helpful.
