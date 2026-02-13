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

## Step-by-step instructions

1. Resolve projectId (list projects if needed).
2. Use the PostHog tool to list feature flags for the project.
3. For a specific flag: use get feature flag with the flag key to return configuration, targeting, and enabled state.
4. For rollout status: return key, name, enabled, and any filters or rollout percentage.
5. For A/B impact: relate the flag key to events or insights and summarize results.

## Examples of inputs and outputs

- **Input**: “What’s the status of the checkout-redesign flag?”  
  **Output**: Flag key, name, enabled (true/false), and targeting/filters if present; from get feature flag.

- **Input**: “List all feature flags and their rollout.”  
  **Output**: Table or list: flag key, name, enabled, rollout % or filters; from list feature flags.

## Common edge cases

- **Unknown projectId**: List projects first and ask which one or use the default.
- **Flag key not found**: Say the flag wasn’t found and suggest checking the key or listing flags.
- **User asks for “effect” of a flag**: Use events or insights tied to the flag key and summarize; if no data, say so.
- **API error**: Report the error and suggest retrying or checking project/credentials.

## Tool usage for specific purposes

- **List feature flags**: Use to answer “what flags exist” and “rollout status of all flags”; always with projectId.
- **Get feature flag**: Use for a single flag’s config, targeting, and enabled state when the user names a key or flag.
- **Events/insights**: Use when the user asks for A/B or impact; link flag key to event counts or insights.
