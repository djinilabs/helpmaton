import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "notion-project-tracking",
  name: "Notion Project Tracking",
  description: "Query databases, track tasks, status updates",
  role: "product",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "notion"
    }
  ],
  content: "## Notion Project Tracking\n\nWhen tracking projects or tasks in Notion:\n\n- Query databases with filters and sorts to list tasks or items by status, assignee, or date.\n- Read database schema (properties) before querying so filters use valid values.\n- When creating database pages, include required properties and use the correct types.\n- For status updates, use update database page to change status or other properties.\n- Summarize results clearly (e.g. count by status, list of open items).\n\n## Step-by-step instructions\n\n1. Identify the target database (and optionally workspace) from the user’s question.\n2. If needed, read the database schema to get property names and allowed values for filters.\n3. Query the database with filters (status, assignee, date) and sort as needed; summarize counts and key items.\n4. For “create task”: use create database page with required properties and correct types.\n5. For “update status” (or other property): use update database page with the page ID and new values.\n\n## Examples of inputs and outputs\n\n- **Input**: “What tasks are open for Project X?”  \n  **Output**: Count and short list (title, status, assignee) from a database query filtered by project and status.\n\n- **Input**: “Mark task Y as Done.”  \n  **Output**: Confirm the task and new status; call update database page; then “Updated [title] to Done.”\n\n## Common edge cases\n\n- **Database not found**: Say so and suggest checking the database name or listing available databases.\n- **Invalid filter value**: Check schema for allowed values (e.g. status options) and retry or ask the user.\n- **Missing required property on create**: Read schema, list required properties, and ask or infer values before creating.\n- **API/oauth error**: Report Notion error and suggest reconnecting or retrying.\n\n## Tool usage for specific purposes\n\n- **Query database**: Use to list tasks by status, assignee, project, or date; use filters and sort; then summarize.\n- **Read database/schema**: Use before querying or creating so filters and new pages use valid property names and types.\n- **Create database page**: Use to add a task; include all required properties.\n- **Update database page**: Use to change status or other properties on an existing task.",
};

export default skill;
