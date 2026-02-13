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

## Step-by-step instructions

1. Resolve projectId; list projects if unknown.
2. For event issues: list events with filters (event name, distinct_id, person_id, time range); inspect a few payloads for properties and shape.
3. For person issues: get person or list persons; check properties and linked events.
4. For data quality: query expected event names and check presence and key properties; report missing or malformed data.
5. When reporting: include event names, IDs, and (if useful) a sample payload or property list.

## Examples of inputs and outputs

- **Input**: “Did we receive ‘purchase_completed’ for user X?”  
  **Output**: Yes/no plus count and time range; if yes, optionally one sample payload; cite projectId and distinct_id/person_id used.

- **Input**: “What properties does person Y have?”  
  **Output**: List of properties (and values if appropriate) from get person; mention if no person found.

## Common edge cases

- **No events found**: Report “no events matching filters” and suggest widening time range or checking distinct_id/event name.
- **Person not found**: Say so and suggest checking ID or project.
- **Unexpected properties**: List what you see and note any missing or wrong property names/types.
- **Rate limits**: Report and suggest narrowing filters or retrying later.

## Tool usage for specific purposes

- **List events**: Use to find events by name, distinct_id, person_id, or time range; use for “did we get this event?” and payload inspection.
- **Get person / list persons**: Use to inspect a user’s profile and properties; use for “what does this user have?” and data quality.
- **Project/list projects**: Use when projectId is unknown before running event or person queries.
