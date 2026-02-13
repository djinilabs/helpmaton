import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "zendesk-support-tickets",
  name: "Zendesk Support Tickets",
  description: "Search tickets, draft replies, help center search",
  role: "support",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "zendesk"
    }
  ],
  content: "## Zendesk Support Tickets\n\nWhen handling support tickets in Zendesk:\n\n- Search tickets using Zendesk query syntax (e.g. status:open, type:ticket, requester:email).\n- Use get ticket details for full comment history before drafting a reply.\n- When drafting a comment, use the draft comment tool; keep tone polite and structured.\n- Search help center when the user asks for articles or self-service content.\n- Summarize ticket status, requester, and key comments before suggesting or drafting replies.\n\n## Step-by-step instructions\n\n1. For “find tickets”: use Zendesk search with query syntax (e.g. status:open, requester:email@example.com).\n2. For a specific ticket: get ticket details to read full thread and internal notes.\n3. Summarize status, requester, and key comments before drafting; then use the draft comment tool with a polite, structured reply.\n4. For “article” or self-service: search help center and cite articles; optionally use content in the draft.\n5. Do not send or submit the reply unless the user explicitly asks to send; otherwise return the draft.\n\n## Examples of inputs and outputs\n\n- **Input**: “What open tickets does john@example.com have?”  \n  **Output**: List of ticket IDs and subjects (and status) from search; optionally one-line summary per ticket.\n\n- **Input**: “Draft a reply to ticket 12345.”  \n  **Output**: Short summary of the ticket and a draft comment (acknowledge, answer, close); from get ticket + draft comment tool.\n\n## Common edge cases\n\n- **No tickets found**: Report “No tickets matching [query]” and suggest widening filters or checking requester/subdomain.\n- **Ticket not found**: Say “Ticket [id] not found” and suggest checking ID or permissions.\n- **User wants to send**: Only send/submit when the user explicitly confirms; otherwise provide draft only.\n- **API/oauth error**: Report Zendesk error and suggest reconnecting or retrying.\n\n## Tool usage for specific purposes\n\n- **Search tickets**: Use for “open tickets”, “tickets for X”, or list views; use Zendesk query syntax (status, type, requester).\n- **Get ticket**: Use before drafting a reply to get full thread and notes.\n- **Draft comment**: Use to create the reply text; keep tone polite and structured; do not send unless user asks.\n- **Search help center**: Use when the user asks for articles or self-service content to include in the reply.",
};

export default skill;
