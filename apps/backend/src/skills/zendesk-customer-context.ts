import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "zendesk-customer-context",
  name: "Zendesk Customer Context",
  description: "Ticket history, requester context",
  role: "support",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "zendesk"
    }
  ],
  content: "## Zendesk Customer Context\n\nWhen gathering customer context from Zendesk:\n\n- Search tickets by requester (email or id) to see prior conversations.\n- Use get ticket details to read full thread and internal notes.\n- Summarize ticket history (open/closed, dates, subjects) before answering or escalating.\n- When the user asks about a specific ticket, fetch details and summarize key points and status.\n- Use help center search when the request is about documentation or known issues.\n\n## Step-by-step instructions\n\n1. For “context for customer X”: search tickets by requester (email or id); get details for the most relevant tickets.\n2. Summarize ticket history: open vs closed, dates, subjects, and key resolution or escalation points.\n3. For a specific ticket: get ticket details and summarize status, requester, and main comments/notes.\n4. When the user asks about docs or known issues: search help center and cite articles in the summary.\n\n## Examples of inputs and outputs\n\n- **Input**: “What’s the ticket history for john@example.com?”  \n  **Output**: Short list: ticket IDs, subjects, status, dates; optionally one line per ticket (e.g. “resolved”, “escalated”).\n\n- **Input**: “Summarize ticket 12345.”  \n  **Output**: Status, requester, subject, and key points from the thread and internal notes; from get ticket.\n\n## Common edge cases\n\n- **No tickets for requester**: Say “No tickets found for [email/id]” and suggest checking spelling or subdomain.\n- **Ticket not found**: Say “Ticket [id] not found” and suggest checking ID or permissions.\n- **Many tickets**: Summarize the most recent or relevant (e.g. open first, then recent closed); do not dump full content.\n- **API/oauth error**: Report Zendesk error and suggest reconnecting or retrying.\n\n## Tool usage for specific purposes\n\n- **Search tickets (by requester)**: Use to find all tickets for a customer (email or id) for history and context.\n- **Get ticket**: Use to read full thread and internal notes for one ticket before summarizing or escalating.\n- **Search help center**: Use when the question is about documentation or known issues to cite in the summary.",
};

export default skill;
