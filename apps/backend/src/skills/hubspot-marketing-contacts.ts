import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "hubspot-marketing-contacts",
  name: "HubSpot Marketing Contacts",
  description: "Contact lists, segmentation, campaigns",
  role: "marketing",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "hubspot"
    }
  ],
  content: "## HubSpot Marketing Contacts\n\nWhen using HubSpot for marketing contacts:\n\n- List or search contacts with relevant properties for segmentation questions.\n- Use get contact for full details when the user asks about a specific person or email.\n- When asked about lists or segments, summarize contact counts and key properties.\n- For campaign context, relate contacts to companies or deals when that helps the answer.\n- Prefer search when the user provides an email, name, or other identifier.\n\n## Step-by-step instructions\n\n1. For “find contact X”: use search (email, name, or identifier); then get contact for full details if needed.\n2. For lists/segments: list or search contacts with filters or properties; summarize counts and key properties.\n3. For campaign context: relate contacts to companies or deals via HubSpot tools when the question asks for it.\n4. Always return concise summaries (counts, key fields) rather than raw dumps; cite filters used.\n\n## Examples of inputs and outputs\n\n- **Input**: “Who is john@example.com in HubSpot?”  \n  **Output**: Short summary from get contact: name, email, key properties, and company/deal if relevant.\n\n- **Input**: “How many contacts do we have in segment Y?”  \n  **Output**: Count and brief description of the segment (filters/properties); from list or search with those filters.\n\n## Common edge cases\n\n- **No contact found**: Say “No contact found for [identifier]” and suggest checking spelling or trying another field.\n- **Vague “segment”**: Ask which list, property, or filter they mean; or list available properties and let them choose.\n- **Large result set**: Summarize count and a sample (e.g. first 5–10) with key properties; do not dump hundreds of contacts.\n- **API/oauth error**: Tell the user the HubSpot request failed and suggest reconnecting or retrying.\n\n## Tool usage for specific purposes\n\n- **Search contacts**: Use when the user gives an email, name, or other identifier; then get contact for full details.\n- **List contacts**: Use for “how many”, “list by property”, or segment-style questions with filters.\n- **Get contact**: Use after search or when the user asks for full details for one contact.\n- **Companies/deals**: Use when the question ties contacts to companies or deals (campaign, account).",
};

export default skill;
