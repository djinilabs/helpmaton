import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "linear-issue-management",
  name: "Linear Issue Management",
  description: "List/search issues, triage, assign",
  role: "engineering",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "linear"
    }
  ],
  content: "## Linear Issue Management\n\nWhen managing issues in Linear:\n\n- List issues with filters (team, project, assignee, state) to find relevant work.\n- Use get issue for full details before summarizing or updating.\n- When triaging, report issue state, assignee, and labels; suggest assignee or state changes when appropriate.\n- Search issues by query when the user asks for something specific (e.g. bug, feature name).\n- Prefer listing by team or project when the user context is clear.\n\n## Step-by-step instructions\n\n1. For “find issues”: list issues with filters (team, project, assignee, state) or use search/query for text (e.g. bug, feature name).\n2. For a single issue: get issue by ID or identifier; then summarize title, state, assignee, labels, and description excerpt.\n3. For triage: list relevant issues; report state, assignee, labels; suggest state or assignee changes only when the user asks.\n4. For updates: use the Linear tool to update issue state or assignee after the user confirms.\n\n## Examples of inputs and outputs\n\n- **Input**: “What’s in the backlog for Team Platform?”  \n  **Output**: Short list of issues (title, state, assignee) from list issues filtered by team and state=backlog; optionally count.\n\n- **Input**: “Details for issue ENG-123.”  \n  **Output**: Title, state, assignee, labels, description summary (and link if available) from get issue.\n\n## Common edge cases\n\n- **No team/project given**: Ask which team or project, or list teams/projects and let the user choose.\n- **Issue not found**: Say “Issue [id] not found” and suggest checking the identifier or permissions.\n- **Ambiguous “backlog”**: Use the team’s or project’s backlog state (e.g. “Backlog” state) and say which state you used.\n- **API/oauth error**: Report that Linear returned an error and suggest reconnecting or retrying.\n\n## Tool usage for specific purposes\n\n- **List issues**: Use for backlog, by assignee, by state, or by project/team; always apply relevant filters.\n- **Get issue**: Use for full details of one issue by ID or identifier.\n- **Search/query**: Use when the user asks for “bugs”, “feature X”, or text-based search.\n- **Update issue**: Use to change state or assignee only after the user explicitly asks to update.",
};

export default skill;
