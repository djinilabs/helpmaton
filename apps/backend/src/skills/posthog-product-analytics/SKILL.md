---
id: posthog-product-analytics
name: PostHog Product Analytics
description: Feature adoption, retention, user journey analysis
role: product
requiredTools:
  - type: mcpService
    serviceType: posthog
---

## PostHog Product Analytics

When analyzing product usage:

- Use events to measure feature adoption and usage patterns.
- Use persons to understand user segments and retention.
- Prefer saved insights when they answer the question; otherwise list events with clear filters.
- Always specify projectId; list projects first if unknown.
- For adoption questions, identify the relevant event names and time range, then summarize counts or trends.
- When asked about user journeys, combine events and persons to describe paths and drop-off.

## Step-by-step instructions

1. Resolve projectId (list projects if unknown) and the relevant event names or insight.
2. For adoption: query events for the feature-related event(s) with time range; summarize counts or trend.
3. For retention: use persons and events (e.g. distinct_id) to compute returning users or cohorts; summarize over time.
4. For user journeys: query events in sequence, optionally filter by person; summarize paths and drop-off.
5. Prefer saved insights when they match the question; otherwise build from events with clear filters and cite them.

## Examples of inputs and outputs

- **Input**: “How many users used the new export feature last week?”  
  **Output**: Count (or trend) for the export-related event(s), projectId, and date range; if no such event, say so and suggest event names to check.

- **Input**: “Where do users drop off in the onboarding flow?”  
  **Output**: Short sequence of steps with counts or rates and the main drop-off step; cite event names and filters used.

## Common edge cases

- **Unknown projectId**: List projects and ask which one, or use the only/default project.
- **No matching events**: Report zero or “no events found” and suggest verifying event names or time range.
- **Ambiguous “feature”**: List likely event names or ask the user to confirm which event(s) represent the feature.
- **API/rate limit**: Tell the user and suggest a smaller range or retry later.

## Tool usage for specific purposes

- **PostHog MCP (events)**: Use for adoption counts, funnels, and journey steps. Always set projectId and time range; use event name and property filters as needed.
- **PostHog MCP (persons / insights)**: Use for retention and segments; use saved insights when they answer the question directly.
