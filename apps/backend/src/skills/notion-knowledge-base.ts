import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "notion-knowledge-base",
  name: "Notion Knowledge Base",
  description: "Search and surface docs, create/update pages for FAQs",
  role: "support",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "notion"
    }
  ],
  content: "## Notion Knowledge Base\n\nWhen using Notion for knowledge or FAQs:\n\n- Search for pages and databases to find relevant docs before answering.\n- Read page content to cite specific sections when answering user questions.\n- When creating or updating pages, use the correct parent (page, database, or workspace) and property schema.\n- For FAQs, prefer updating existing pages when the answer already exists; create new pages when the topic is new.\n- Keep page titles and properties consistent with the existing workspace structure.\n\n## Step-by-step instructions\n\n1. For “find/answer X”: use Notion search (pages/databases) with the topic; open the most relevant page(s) and read content.\n2. Answer from the page content; cite page title and section.\n3. For “add/update FAQ”: search for an existing page on the topic; if found, update that page; if not, create a new page under the right parent with correct properties.\n4. When creating/updating, use the parent (page, database, or workspace) and property types the workspace expects.\n\n## Examples of inputs and outputs\n\n- **Input**: “What’s our policy on refunds?”  \n  **Output**: Short answer drawn from the relevant Notion page, with “According to [Page title]…” and section reference.\n\n- **Input**: “Add a FAQ: How do I reset my password?”  \n  **Output**: Confirm the answer text and target page/database; then create or update the page and confirm “Added/updated [page title].”\n\n## Common edge cases\n\n- **No page found**: Say “I didn’t find a page about [topic]” and offer to create one if the user wants.\n- **Multiple matching pages**: Pick the most relevant (e.g. by title or type) or summarize from the best one and mention others.\n- **Missing parent or schema**: Ask which parent page or database to use, or list options from search.\n- **API/oauth error**: Report that Notion returned an error and suggest reconnecting or retrying.\n\n## Tool usage for specific purposes\n\n- **Search (pages/databases)**: Use to find existing docs and FAQs before answering or before creating/updating.\n- **Read page**: Use to get content for answering questions and to check existing FAQ content before updating.\n- **Create/update page**: Use to add or update FAQ content; always specify parent and required properties.",
};

export default skill;
