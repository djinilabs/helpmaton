import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "todoist-task-management",
  name: "Todoist Task Management",
  description: "Add, list, and close tasks; list projects",
  role: "product",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "todoist"
    }
  ],
  content: "## Todoist Task Management\n\nWhen managing tasks in Todoist:\n\n- Use **todoist_add_task** (tool name may have a suffix if multiple Todoist servers exist) to create tasks with natural language due dates.\n- Use **todoist_get_tasks** to list active tasks using Todoist filters (e.g. by project, date, label).\n- Use **todoist_close_task** to complete a task by ID.\n- Use **todoist_get_projects** to list projects and resolve project IDs when the user refers to a project by name.\n- Todoist OAuth does not provide refresh tokens; suggest reconnecting if the token is revoked.\n\n## Step-by-step instructions\n\n1. For \"add task X\": call **todoist_add_task** with content and optional due string (natural language, e.g. \"tomorrow\", \"next Monday\"); optionally specify project_id from **todoist_get_projects** if the user named a project.\n2. For \"list my tasks\" or \"tasks for project Y\": call **todoist_get_tasks** with filter string and/or project_id; summarize task content, due date, and ID.\n3. For \"complete task Z\": call **todoist_close_task** with the task ID; confirm completion to the user.\n4. When project is ambiguous: call **todoist_get_projects** and list names/IDs so the user can choose, or infer from context.\n5. Keep summaries concise (task content, due, ID); avoid dumping full payloads unless asked.\n\n## Examples of inputs and outputs\n\n- **Input**: \"Add a task: Review PR by tomorrow.\"  \n  **Output**: Call **todoist_add_task** with content \"Review PR\" and due \"tomorrow\"; confirm \"Added task: Review PR (due tomorrow).\"\n\n- **Input**: \"What tasks are due this week?\"  \n  **Output**: List of tasks from **todoist_get_tasks** with an appropriate filter (e.g. \"due: this week\"); summarize content, due date, and ID per task.\n\n- **Input**: \"Mark task 12345 as done.\"  \n  **Output**: Call **todoist_close_task** with id 12345; confirm \"Task 12345 completed.\"\n\n## Common edge cases\n\n- **Project not found**: Use **todoist_get_projects** to list projects; say \"Project [name] not found\" or suggest the closest match.\n- **Task not found**: Say \"Task [id] not found\" and suggest listing tasks to get valid IDs.\n- **Natural language due**: **todoist_add_task** accepts natural language (e.g. \"tomorrow\", \"next Friday\"); use it when the user gives a relative date.\n- **API/OAuth error**: Report that Todoist returned an error; mention that reconnecting may be needed if the token was revoked.\n\n## Tool usage for specific purposes\n\n- **todoist_add_task**: Use to create a task; include content and optional due (natural language) and project_id.\n- **todoist_get_tasks**: Use to list active tasks; use filter and/or project_id to scope.\n- **todoist_close_task**: Use to complete a task by ID.\n- **todoist_get_projects**: Use to list projects and resolve project_id when the user refers to a project by name.",
};

export default skill;
