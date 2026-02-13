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
  content: "## PostHog Feature Flags\n\nWhen working with feature flags:\n\n- Use **posthog_list_projects** (tool name may have a suffix if multiple PostHog servers exist) when projectId is unknown; then use **posthog_list_feature_flags** for the project to see keys, names, and rollout state.\n- Use **posthog_get_feature_flag** with featureFlagId to inspect a specific flag's configuration and targeting.\n- For A/B tests, relate flag keys to **posthog_list_events** or **posthog_list_insights** / **posthog_get_insight** to measure impact.\n- Always specify projectId; list projects first if unknown.\n- When asked about rollout status, return flag key, name, and enabled state; mention filters if present.\n\n## Step-by-step instructions\n\n1. Resolve projectId: call **posthog_list_projects** if needed.\n2. Call **posthog_list_feature_flags** with projectId to list all flags and their rollout.\n3. For a specific flag: call **posthog_get_feature_flag** with projectId and featureFlagId to return configuration, targeting, and enabled state.\n4. For rollout status: return key, name, enabled, and any filters or rollout percentage from the list or get result.\n5. For A/B impact: use **posthog_list_events** or **posthog_list_insights** / **posthog_get_insight** tied to the flag key and summarize results.\n\n## Examples of inputs and outputs\n\n- **Input**: “What’s the status of the checkout-redesign flag?”  \n  **Output**: Flag key, name, enabled (true/false), and targeting/filters if present; from **posthog_get_feature_flag**.\n\n- **Input**: “List all feature flags and their rollout.”  \n  **Output**: Table or list: flag key, name, enabled, rollout % or filters; from **posthog_list_feature_flags**.\n\n## Common edge cases\n\n- **Unknown projectId**: Call **posthog_list_projects** first and ask which one or use the default.\n- **Flag key not found**: Say the flag wasn’t found and suggest checking the featureFlagId or listing flags.\n- **User asks for “effect” of a flag**: Use **posthog_list_events** or **posthog_list_insights** tied to the flag key and summarize; if no data, say so.\n- **API error**: Report the error and suggest retrying or checking project/credentials.\n\n## Tool usage for specific purposes\n\n- **posthog_list_feature_flags**: Use to answer “what flags exist” and “rollout status of all flags”; always with projectId.\n- **posthog_get_feature_flag**: Use for a single flag’s config, targeting, and enabled state when the user names a key or flag (use featureFlagId).\n- **posthog_list_events** / **posthog_list_insights** / **posthog_get_insight**: Use when the user asks for A/B or impact; link flag key to event counts or insights.",
};

export default skill;
