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
