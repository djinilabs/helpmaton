import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "posthog-events-debugging",
  name: "PostHog Events Debugging",
  description: "Event inspection, person lookup, data quality checks",
  role: "engineering",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "posthog"
    }
  ],
  content: "## PostHog Events Debugging\n\nWhen debugging events or persons:\n\n- Use **posthog_list_events** (tool name may have a suffix if multiple PostHog servers exist) with filters (event, distinctId, personId, after, before) to find relevant data.\n- Use **posthog_get_person** or **posthog_list_persons** to inspect user profiles and property consistency.\n- For data quality, check that expected events exist and have the right properties via **posthog_list_events**.\n- Always specify projectId; call **posthog_list_projects** first if unknown.\n- When reporting issues, include event names, distinct_id or person_id, and sample payloads where helpful.\n\n## Step-by-step instructions\n\n1. Resolve projectId: call **posthog_list_projects** if unknown.\n2. For event issues: call **posthog_list_events** with projectId, event, distinctId/personId, and after/before; inspect returned payloads for properties and shape.\n3. For person issues: call **posthog_get_person** or **posthog_list_persons** with projectId; check properties and linked events.\n4. For data quality: call **posthog_list_events** for expected event names and check presence and key properties; report missing or malformed data.\n5. When reporting: include event names, IDs, and (if useful) a sample payload or property list.\n\n## Examples of inputs and outputs\n\n- **Input**: “Did we receive ‘purchase_completed’ for user X?”  \n  **Output**: Yes/no plus count and time range from **posthog_list_events**; if yes, optionally one sample payload; cite projectId and distinctId/personId used.\n\n- **Input**: “What properties does person Y have?”  \n  **Output**: List of properties (and values if appropriate) from **posthog_get_person**; mention if no person found.\n\n## Common edge cases\n\n- **No events found**: Report “no events matching filters” and suggest widening after/before range or checking distinctId/event name.\n- **Person not found**: Say so and suggest checking ID or project.\n- **Unexpected properties**: List what you see and note any missing or wrong property names/types.\n- **Rate limits**: Report and suggest narrowing filters or retrying later.\n\n## Tool usage for specific purposes\n\n- **posthog_list_events**: Use to find events by event name, distinctId, personId, or after/before; use for “did we get this event?” and payload inspection.\n- **posthog_get_person** / **posthog_list_persons**: Use to inspect a user’s profile and properties; use for “what does this user have?” and data quality.\n- **posthog_list_projects**: Use when projectId is unknown before running event or person queries.",
};

export default skill;
