import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "posthog-feature-flags",
  name: "PostHog Feature Flags",
  description: "A/B testing, gradual rollouts, flag evaluation",
  role: "product",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "posthog"
    }
  ],
  content: "## PostHog Feature Flags\n\nWhen working with feature flags:\n\n- List feature flags for the project to see keys, names, and rollout state.\n- Use get feature flag to inspect a specific flag's configuration and targeting.\n- For A/B tests, relate flag keys to events or insights to measure impact.\n- Always specify projectId; list projects first if unknown.\n- When asked about rollout status, return flag key, name, and enabled state; mention filters if present.\n\n## Step-by-step instructions\n\n1. Resolve projectId (list projects if needed).\n2. Use the PostHog tool to list feature flags for the project.\n3. For a specific flag: use get feature flag with the flag key to return configuration, targeting, and enabled state.\n4. For rollout status: return key, name, enabled, and any filters or rollout percentage.\n5. For A/B impact: relate the flag key to events or insights and summarize results.\n\n## Examples of inputs and outputs\n\n- **Input**: “What’s the status of the checkout-redesign flag?”  \n  **Output**: Flag key, name, enabled (true/false), and targeting/filters if present; from get feature flag.\n\n- **Input**: “List all feature flags and their rollout.”  \n  **Output**: Table or list: flag key, name, enabled, rollout % or filters; from list feature flags.\n\n## Common edge cases\n\n- **Unknown projectId**: List projects first and ask which one or use the default.\n- **Flag key not found**: Say the flag wasn’t found and suggest checking the key or listing flags.\n- **User asks for “effect” of a flag**: Use events or insights tied to the flag key and summarize; if no data, say so.\n- **API error**: Report the error and suggest retrying or checking project/credentials.\n\n## Tool usage for specific purposes\n\n- **List feature flags**: Use to answer “what flags exist” and “rollout status of all flags”; always with projectId.\n- **Get feature flag**: Use for a single flag’s config, targeting, and enabled state when the user names a key or flag.\n- **Events/insights**: Use when the user asks for A/B or impact; link flag key to event counts or insights.",
};

export default skill;
