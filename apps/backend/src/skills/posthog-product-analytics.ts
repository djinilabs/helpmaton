import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "posthog-product-analytics",
  name: "PostHog Product Analytics",
  description: "Feature adoption, retention, user journey analysis",
  role: "product",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "posthog"
    }
  ],
  content: "## PostHog Product Analytics\n\nWhen analyzing product usage:\n\n- Use **posthog_list_events** (tool name may have a suffix if multiple PostHog servers exist) to measure feature adoption and usage patterns with projectId, event name, and after/before time range.\n- Use **posthog_list_persons** and **posthog_get_person** to understand user segments and retention.\n- Prefer **posthog_list_insights** and **posthog_get_insight** when they answer the question; otherwise use **posthog_list_events** with clear filters.\n- Always specify projectId; call **posthog_list_projects** first if unknown.\n- For adoption questions, identify the relevant event names and time range, then summarize counts or trends.\n- When asked about user journeys, combine events and persons to describe paths and drop-off.\n\n## Step-by-step instructions\n\n1. Resolve projectId: call **posthog_list_projects** if unknown; identify the relevant event names or insight.\n2. For adoption: call **posthog_list_events** with projectId, event filter, and after/before; summarize counts or trend.\n3. For retention: use **posthog_list_persons** and **posthog_list_events** (e.g. distinctId) to compute returning users or cohorts; summarize over time.\n4. For user journeys: call **posthog_list_events** in sequence, optionally filter by personId/distinctId; summarize paths and drop-off.\n5. Prefer **posthog_list_insights** / **posthog_get_insight** when they match the question; otherwise build from **posthog_list_events** with clear filters and cite them.\n\n## Examples of inputs and outputs\n\n- **Input**: “How many users used the new export feature last week?”  \n  **Output**: Count (or trend) for the export-related event(s), projectId, and date range from **posthog_list_events**; if no such event, say so and suggest event names to check.\n\n- **Input**: “Where do users drop off in the onboarding flow?”  \n  **Output**: Short sequence of steps with counts or rates and the main drop-off step; cite event names and filters used.\n\n## Common edge cases\n\n- **Unknown projectId**: Call **posthog_list_projects** and ask which one, or use the only/default project.\n- **No matching events**: Report zero or “no events found” and suggest verifying event names or time range.\n- **Ambiguous “feature”**: List likely event names or ask the user to confirm which event(s) represent the feature.\n- **API/rate limit**: Tell the user and suggest a smaller range or retry later.\n\n## Tool usage for specific purposes\n\n- **posthog_list_events**: Use for adoption counts, funnels, and journey steps. Always set projectId and after/before time range; use event and distinctId/personId filters as needed.\n- **posthog_list_persons** / **posthog_get_person**: Use for retention and segments.\n- **posthog_list_insights** / **posthog_get_insight**: Use when saved insights answer the question directly.",
};

export default skill;
