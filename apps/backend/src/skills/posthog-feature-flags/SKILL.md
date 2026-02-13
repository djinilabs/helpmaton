---
id: posthog-feature-flags
name: PostHog Feature Flags
description: A/B testing, gradual rollouts, flag evaluation
role: product
requiredTools:
  - type: mcpService
    serviceType: posthog
---

## PostHog Feature Flags

When working with feature flags:

- List feature flags for the project to see keys, names, and rollout state.
- Use get feature flag to inspect a specific flag's configuration and targeting.
- For A/B tests, relate flag keys to events or insights to measure impact.
- Always specify projectId; list projects first if unknown.
- When asked about rollout status, return flag key, name, and enabled state; mention filters if present.
