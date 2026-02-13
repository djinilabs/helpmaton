import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "hubspot-sales-crm",
  name: "HubSpot Sales CRM",
  description: "Contacts, companies, deals pipeline",
  role: "sales",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "hubspot"
    }
  ],
  content: "## HubSpot Sales CRM\n\nWhen using HubSpot for sales:\n\n- List or search contacts, companies, and deals to answer pipeline and relationship questions.\n- Use get contact/company/deal for full details before summarizing.\n- When reporting pipeline, group deals by stage or owner and summarize amounts or counts.\n- For contact lookup, prefer search by email or name; then use get for full record.\n- Keep property names and IDs consistent with HubSpot’s schema in responses.\n\n## Step-by-step instructions\n\n1. For contact/company/deal lookup: search by email, name, or identifier; then use get for the full record before summarizing.\n2. For pipeline: list deals with filters (stage, owner); group by stage or owner and summarize counts and amounts.\n3. For relationships: use get contact/company/deal and follow associations (e.g. contact’s companies, company’s deals).\n4. Keep property names and IDs as in HubSpot; summarize in plain language but cite key IDs when relevant.\n\n## Examples of inputs and outputs\n\n- **Input**: “What’s the status of deal X?”  \n  **Output**: Stage, amount, key dates, and related contact/company from get deal (and get contact/company if needed).\n\n- **Input**: “Pipeline by stage this month.”  \n  **Output**: Count and total amount per stage (and optionally per owner); from list deals with stage and date filters.\n\n## Common edge cases\n\n- **Record not found**: Say “No [contact/company/deal] found for [identifier]” and suggest checking ID or search term.\n- **Missing stage or owner**: List available stages or owners from schema or a sample deal, then re-query.\n- **Large pipeline**: Summarize by stage (and owner if asked); do not list every deal unless the user asks.\n- **API/oauth error**: Report that HubSpot returned an error and suggest reconnecting or retrying.\n\n## Tool usage for specific purposes\n\n- **Search**: Use for contact/company/deal lookup by email, name, or other identifier; then get for full details.\n- **List deals**: Use for pipeline views; filter by stage, owner, date; summarize counts and amounts.\n- **Get contact/company/deal**: Use for full record and associations (e.g. contact’s companies, deal’s contact).",
};

export default skill;
