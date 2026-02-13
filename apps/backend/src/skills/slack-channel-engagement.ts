import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "slack-channel-engagement",
  name: "Slack Channel Engagement",
  description: "Read history, post messages",
  role: "support",
  requiredTools: [
    {
      "type": "mcpService",
      "serviceType": "slack"
    }
  ],
  content: "## Slack Channel Engagement\n\nUse this skill for support-style channel engagement: customer-facing or support channels where you read history and post replies or updates. (For internal team/project channels and announcements, prefer the Slack Internal Comms skill.)\n\nWhen engaging in Slack channels:\n\n- List channels to find the right channel by name or topic.\n- Use get channel history to read recent messages before replying or summarizing.\n- When posting, use the post message tool with clear, concise text; mention or thread when appropriate.\n- Summarize channel activity (e.g. last N messages, key topics) when the user asks what’s happening.\n- Do not post sensitive or confidential information; keep tone professional.\n\n## Step-by-step instructions\n\n1. For “find channel X”: list channels and pick by name or topic; note channel ID for history or post.\n2. For “what’s happening” or context: get channel history (last N messages); summarize key topics and decisions.\n3. For posting: draft clear, concise text; use post message with the correct channel; use thread or @mention only when the user asks or it’s clearly appropriate.\n4. Do not include secrets or confidential data in any message.\n\n## Examples of inputs and outputs\n\n- **Input**: “What’s the latest in #support?”  \n  **Output**: Short summary of the last few messages (who said what, main topic); from get channel history for #support.\n\n- **Input**: “Post in #general: Team sync is at 3pm today.”  \n  **Output**: Confirm channel and text; call post message; then “Posted to #general.”\n\n## Common edge cases\n\n- **Channel not found**: Say “Channel [name] not found” and suggest listing channels or checking the name.\n- **No history / permission**: Report “Could not read history” and suggest permissions or a different channel.\n- **User says “reply in thread”**: Use the thread parameter when posting so the message is in the correct thread.\n- **API/oauth error**: Report Slack error and suggest reconnecting or retrying.\n\n## Tool usage for specific purposes\n\n- **List channels**: Use to find the right channel by name or topic before reading history or posting (support/customer channels).\n- **Get channel history**: Use to read recent messages for “what’s happening” or to gather context before replying.\n- **Post message**: Use to send a new message; specify channel; use thread or mentions only when appropriate.",
};

export default skill;
