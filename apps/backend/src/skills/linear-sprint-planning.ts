import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "linear-sprint-planning",
  name: "Linear Sprint Planning",
  description: "Project views, team capacity",
  role: "product",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "linear"
    }
  ],
  content: "## Linear Sprint Planning\n\nWhen planning sprints or capacity in Linear:\n\n- List teams and projects first to scope the view.\n- List issues by team/project and state to see backlog and in-progress work.\n- Summarize counts by state or assignee to show capacity or load.\n- When asked for sprint scope, filter by project/team and report open or unassigned issues.\n- Use issue details (estimate, cycle) when available to enrich summaries.\n\n## Step-by-step instructions\n\n1. If team/project is unclear: list teams and projects and ask or infer from context.\n2. List issues filtered by team/project and state (e.g. Backlog, In Progress, Done).\n3. Summarize counts by state and optionally by assignee for capacity.\n4. For sprint scope: report open or unassigned issues; include estimate or cycle when the tool returns them.\n5. Keep summaries short (counts, key issues); avoid dumping full issue lists unless asked.\n\n## Examples of inputs and outputs\n\n- **Input**: “What’s our sprint capacity for Team X?”  \n  **Output**: Count of issues by state (and by assignee if useful); optionally total estimate; from list issues for that team.\n\n- **Input**: “What can we pull into the next sprint?”  \n  **Output**: List of open/backlog issues (title, state, assignee) for the relevant project/team; optionally with estimates.\n\n## Common edge cases\n\n- **Multiple teams/projects**: Ask which one, or summarize per team/project with clear labels.\n- **No issues in state**: Report “No issues in [state]” for that team/project.\n- **Estimates missing**: Summarize counts without estimates and note that estimates aren’t set.\n- **API/oauth error**: Report Linear error and suggest reconnecting or retrying.\n\n## Tool usage for specific purposes\n\n- **List teams/projects**: Use when scope is unknown before listing issues.\n- **List issues**: Use with team/project and state filters for backlog, in progress, and sprint scope; use assignee for capacity.\n- **Get issue**: Use when you need estimate or cycle for specific issues in a summary.",
};

export default skill;
