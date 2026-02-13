import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "exa-semantic-research",
  name: "Exa Semantic Research",
  description: "Conceptual and semantic web search; cite sources",
  role: "product",
  requiredTools: [
    {
      "type": "builtin",
      "tool": "exa_search"
    }
  ],
  content: "## Exa Semantic Research\n\nWhen using Exa for semantic or conceptual search:\n\n- Use **exa_search** (or the actual Exa tool name as provided) for conceptual and semantic queries rather than simple keyword match.\n- Cite sources (URLs, titles) for each claim or finding; Exa returns relevant links and snippets.\n- Combine with **search_web** when both are available for broader coverage (keyword + semantic).\n- Prefer clear, concept-based queries (e.g. \"approaches to X\", \"comparisons of Y and Z\") to get the best semantic results.\n- If results are thin or off-topic, rephrase the query to be more specific or try a different angle.\n\n## Step-by-step instructions\n\n1. Turn the user's question into a conceptual or semantic query (what concept or relationship they care about).\n2. Call **exa_search** with that query; use any filters or options the tool supports (e.g. date, type) when relevant.\n3. Read the returned results (snippets, URLs, titles) and select the most relevant for the answer.\n4. Summarize findings and cite each point with the source URL or title.\n5. If the user asked for a comparison or list, structure the answer (bullets or numbered) and cite per item.\n6. When both **exa_search** and **search_web** are available, use Exa for conceptual depth and search_web for recency or keyword-focused backup.\n\n## Examples of inputs and outputs\n\n- **Input**: \"What are the main approaches to implementing feature flags?\"  \n  **Output**: Short list of approaches with a source URL or title per approach from **exa_search** results; conceptual query works well with Exa.\n\n- **Input**: \"Find comparisons of tool A vs tool B.\"  \n  **Output**: Structured comparison (e.g. pros/cons, use cases) with citations from **exa_search**; note if info is from marketing vs third-party.\n\n## Common edge cases\n\n- **No good results**: Say that semantic search didn't return strong matches and suggest a more specific or rephrased query, or try **search_web** if available.\n- **Conflicting info**: Present the main views and cite each source; do not pick one without noting others.\n- **User asks for \"everything about X\"**: Give a structured summary (overview, key points, sources) and offer to go deeper on one aspect.\n- **Exa vs search_web**: Use Exa for conceptual/semantic questions; use search_web for very recent or keyword-heavy queries when both are enabled.\n\n## Tool usage for specific purposes\n\n- **exa_search**: Use for conceptual and semantic queries (e.g. \"approaches to X\", \"how Y relates to Z\"); cite returned URLs/titles; combine with search_web when both available for comprehensive research.",
};

export default skill;
