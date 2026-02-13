import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "stripe-billing-overview",
  name: "Stripe Billing Overview",
  description: "Search charges, balance and refund metrics",
  role: "sales",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "stripe"
    }
  ],
  content: "## Stripe Billing Overview\n\nWhen answering billing or revenue questions with Stripe:\n\n- Use **stripe_search_charges** (tool name may have a suffix if multiple Stripe servers exist) to find charges by query string and/or email.\n- Use **stripe_get_metrics** to retrieve balance and refunds for a required date range.\n- Summarize revenue and refund trends clearly; cite the date range used.\n- The integration is read-only; no write operations are performed.\n- Always specify a date range for metrics; use the user's implied period (e.g. \"this month\") or ask if unclear.\n\n## Step-by-step instructions\n\n1. For \"charges for customer X\" or \"find charge Y\": call **stripe_search_charges** with query and/or email as appropriate.\n2. For balance or refunds: call **stripe_get_metrics** with the required date range (start and end).\n3. For revenue overview: use **stripe_get_metrics** for the period; summarize balance and refunds; optionally use **stripe_search_charges** to illustrate recent charges.\n4. When summarizing: report amounts and date range; distinguish balance vs refunds when both are relevant.\n5. If the user asks for a time period not given, infer (e.g. \"last 30 days\") or ask for clarification.\n\n## Examples of inputs and outputs\n\n- **Input**: \"What's our Stripe balance and refunds for last month?\"  \n  **Output**: Balance and refund totals from **stripe_get_metrics** for that date range; cite the range used.\n\n- **Input**: \"Find charges for john@example.com.\"  \n  **Output**: List of matching charges (id, amount, status, date) from **stripe_search_charges** with email filter; summarize count and total if useful.\n\n## Common edge cases\n\n- **No date range for metrics**: **stripe_get_metrics** requires a date range; infer from context (e.g. \"this month\") or ask the user.\n- **No charges found**: Say \"No charges matching [query/email]\" and suggest widening the search.\n- **Read-only**: Do not attempt to create refunds or modify data; only report what the tools return.\n- **API/OAuth error**: Report that Stripe returned an error and suggest reconnecting or retrying.\n\n## Tool usage for specific purposes\n\n- **stripe_search_charges**: Use to find charges by Stripe query string and/or email; use for \"charges for X\" or \"find charge\".\n- **stripe_get_metrics**: Use for balance and refunds in a date range; always provide the required date range for the period requested.",
};

export default skill;
