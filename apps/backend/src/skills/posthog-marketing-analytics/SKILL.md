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
