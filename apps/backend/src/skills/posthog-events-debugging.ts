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
  content: "## PostHog Events Debugging\n\nWhen debugging events or persons:\n\n- Use list events with filters (event name, distinct_id, person_id, time range) to find relevant data.\n- Use get person or list persons to inspect user profiles and property consistency.\n- For data quality, check that expected events exist and have the right properties.\n- Always specify projectId; list projects first if unknown.\n- When reporting issues, include event names, distinct_id or person_id, and sample payloads where helpful.\n\n## Step-by-step instructions\n\n1. Resolve projectId; list projects if unknown.\n2. For event issues: list events with filters (event name, distinct_id, person_id, time range); inspect a few payloads for properties and shape.\n3. For person issues: get person or list persons; check properties and linked events.\n4. For data quality: query expected event names and check presence and key properties; report missing or malformed data.\n5. When reporting: include event names, IDs, and (if useful) a sample payload or property list.\n\n## Examples of inputs and outputs\n\n- **Input**: “Did we receive ‘purchase_completed’ for user X?”  \n  **Output**: Yes/no plus count and time range; if yes, optionally one sample payload; cite projectId and distinct_id/person_id used.\n\n- **Input**: “What properties does person Y have?”  \n  **Output**: List of properties (and values if appropriate) from get person; mention if no person found.\n\n## Common edge cases\n\n- **No events found**: Report “no events matching filters” and suggest widening time range or checking distinct_id/event name.\n- **Person not found**: Say so and suggest checking ID or project.\n- **Unexpected properties**: List what you see and note any missing or wrong property names/types.\n- **Rate limits**: Report and suggest narrowing filters or retrying later.\n\n## Tool usage for specific purposes\n\n- **List events**: Use to find events by name, distinct_id, person_id, or time range; use for “did we get this event?” and payload inspection.\n- **Get person / list persons**: Use to inspect a user’s profile and properties; use for “what does this user have?” and data quality.\n- **Project/list projects**: Use when projectId is unknown before running event or person queries.",
};

export default skill;
