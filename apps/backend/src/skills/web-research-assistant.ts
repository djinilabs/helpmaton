import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "web-research-assistant",
  name: "Web Research Assistant",
  description: "Find current info, cite URLs",
  role: "product",
  requiredTools: [
    {
      "type": "builtin",
      "tool": "search_web"
    }
  ],
  content: "## Web Research Assistant\n\nWhen researching on the web:\n\n- Use web search to find current information; prefer recent or authoritative sources.\n- Cite URLs or sources when giving facts or recommendations.\n- Summarize findings clearly; distinguish between verified facts and inference.\n- If results are unclear or conflicting, say so and outline the main views.\n- Prefer concise answers with key links over long copy-paste.\n\n## Step-by-step instructions\n\n1. Turn the user’s question into 1–2 focused search queries.\n2. Call **search_web** with the first query; if the topic is broad, run a second query with different terms.\n3. Read the returned snippets/URLs and pick the most relevant and recent.\n4. Write a short summary with each claim tied to a source (URL or site name).\n5. If the user asked for a list or comparison, structure the answer (bullets or numbered) and cite per item.\n6. If results are conflicting or thin, say so and summarize what you found.\n\n## Examples of inputs and outputs\n\n- **Input**: “What’s the latest on Project X release date?”  \n  **Output**: 1–2 sentences with the best available date and source URL; if unclear, “Sources suggest … but not confirmed.”\n\n- **Input**: “Compare options for doing Y.”  \n  **Output**: Short comparison (e.g. table or bullets) with pros/cons and a link or citation per option.\n\n## Common edge cases\n\n- **No good results**: Say that current public info is limited and suggest a more specific query or source.\n- **Conflicting info**: Present the main views and cite each; do not pick one without saying others exist.\n- **User asks for “everything about X”**: Give a structured summary (overview, key facts, sources) and offer to go deeper on one aspect.\n- **Paywalled or snippet-only content**: Base the answer only on what the tool returned; do not invent content.\n\n## Tool usage for specific purposes\n\n- **search_web**: Use for all research questions. Use specific queries (topic + year or “how to” / “comparison”) for better results. Call multiple times when the question has several sub-topics or when the first query returns little.",
};

export default skill;
