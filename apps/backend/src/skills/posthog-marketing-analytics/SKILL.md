---
id: posthog-marketing-analytics
name: PostHog Marketing Analytics
description: Funnel analysis, campaign attribution, conversion tracking
role: marketing
requiredTools:
  - type: mcpService
    serviceType: posthog
---

## PostHog Marketing Analytics

When analyzing marketing data:

- Use events and persons to trace user journeys and conversion funnels.
- Prefer insights over raw events when answering funnel or retention questions.
- When comparing campaigns, use distinct_id and event properties for attribution.
- Always specify projectId; list projects first if unknown.
- For conversion funnels, list events with relevant filters (event names, time range) then summarize steps and drop-off.
- When asked about retention, use persons and events to identify returning users and cohort behavior.

## Step-by-step instructions

1. If projectId is unknown, use PostHog tools to list projects and pick the relevant one.
2. For funnel questions: identify the event sequence (e.g. signup → trial_start → paid), query events with filters and time range, then summarize steps and drop-off rates.
3. For attribution or campaigns: use distinct_id and event properties to relate events to campaigns; summarize by campaign or source.
4. For retention: use persons and events to count returning users and cohort behavior over time.
5. Prefer high-level insights (counts, rates, trends) over raw event dumps; cite filters and time range used.

## Examples of inputs and outputs

- **Input**: “What’s our signup-to-paid funnel look like this month?”  
  **Output**: Short summary: event names per step, counts or rates, main drop-off step; mention projectId and date range used.

- **Input**: “Which campaign drove the most signups?”  
  **Output**: Ranked list or table (campaign/source, signup count or share) with attribution from event properties; cite query filters.

## Common edge cases

- **No projectId**: List projects first and ask the user which one, or use the default if only one.
- **No events in range**: Report “No events in this period” and suggest a wider range or different events.
- **Ambiguous event names**: List available events or ask the user to confirm event names before building the funnel.
- **Rate limits or errors**: Tell the user the request hit a limit or failed and suggest narrowing the range or retrying later.

## Tool usage for specific purposes

- **PostHog MCP (events)**: Use to query events with filters (event names, properties, time range) for funnels, counts, and attribution. Always include projectId and a sensible time range.
- **PostHog MCP (persons/insights)**: Use for retention and cohort-style questions; relate persons to events via distinct_id. Use insights when the tool supports them for funnel or retention answers.
