import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "slack-internal-comms",
  name: "Slack Internal Comms",
  description: "Team channels, announcements",
  role: "engineering",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "slack"
    }
  ],
  content: "## Slack Internal Comms\n\nUse this skill for internal team and project channels: announcements, team updates, and summarizing recent discussions. (For support-style or customer-facing channel engagement, prefer the Slack Channel Engagement skill.)\n\nWhen handling internal Slack communications:\n\n- List channels to locate team or project channels.\n- Read channel history to gather context before posting or summarizing.\n- When posting announcements, use clear subject and body; target the right channel.\n- Summarize recent discussions or decisions when the user asks for team updates.\n- Keep messages concise and actionable for internal audiences.\n\n## Step-by-step instructions\n\n1. For “team/project channel”: list channels and identify the right one by name or topic.\n2. For “what’s the update” or “recent decisions”: get channel history and summarize key discussions and outcomes.\n3. For announcements: draft clear subject and body; confirm target channel; use post message; keep tone concise and actionable.\n4. Do not post confidential or sensitive information.\n\n## Examples of inputs and outputs\n\n- **Input**: “What did the team decide in #platform this week?”  \n  **Output**: Short summary of recent messages and decisions from get channel history for #platform.\n\n- **Input**: “Announce in #engineering: Deploy window is Saturday 2–4am.”  \n  **Output**: Confirm channel and text; post; then “Announcement posted to #engineering.”\n\n## Common edge cases\n\n- **Channel not found**: Say “Channel [name] not found” and suggest listing channels.\n- **No history / permission**: Report that history couldn’t be read and suggest permissions.\n- **Vague “team”**: List a few likely channels (e.g. by name) and ask which one, or summarize the one that matches context.\n- **API/oauth error**: Report Slack error and suggest reconnecting or retrying.\n\n## Tool usage for specific purposes\n\n- **List channels**: Use to find team or project channels (internal) before reading or posting.\n- **Get channel history**: Use to gather context and summarize recent discussions or decisions.\n- **Post message**: Use for announcements to internal channels; always target the correct channel and keep content concise and actionable.",
};

export default skill;
