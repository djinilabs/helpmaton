import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "competitive-intel",
  name: "Competitive Intelligence",
  description: "Market research, competitor tracking",
  role: "marketing",
  requiredTools: [
    {
      "type": "builtin",
      "tool": "search_web"
    }
  ],
  content: "## Competitive Intelligence\n\nWhen researching competitors or market context:\n\n- Use web search to find current information on competitors, pricing, or positioning.\n- Cite sources (URLs, articles) for claims about the market or specific companies.\n- Summarize comparisons clearly (e.g. features, pricing, positioning).\n- If information is outdated or uncertain, note that and suggest how to verify.\n- Focus on publicly available information; do not speculate on confidential data.\n- If **fetch_web** is available, use it to read full pages when snippets are insufficient for a claim.\n\n## Step-by-step instructions\n\n1. Clarify the user’s goal (e.g. competitor feature comparison, pricing, positioning).\n2. Use the **search_web** tool with focused queries (company name + topic, e.g. “Acme Corp pricing 2024”).\n3. Run additional searches if you need multiple competitors or angles.\n4. Synthesize results into a structured comparison or summary.\n5. Cite each claim with the source URL or publication.\n6. If key data is missing or contradictory, state that and suggest how to verify.\n\n## Examples of inputs and outputs\n\n- **Input**: “How does our pricing compare to Competitor X?”  \n  **Output**: Short comparison table or bullets (product, price, positioning), each point with a source URL from search_web results.\n\n- **Input**: “What are the main features of Product Y?”  \n  **Output**: Numbered or bullet list of features with links; note if info is from marketing vs. third-party review.\n\n## Common edge cases\n\n- **No recent results**: Say that recent public info is scarce and suggest checking the competitor’s site or a specific source.\n- **Conflicting sources**: Present the main views and label them (e.g. “Source A says X; Source B says Y”).\n- **Vague request**: Ask one clarifying question (e.g. “Which competitors or which product line?”) then run search.\n- **Paywalled or restricted content**: Rely only on what the tool returned; do not invent content behind paywalls.\n\n## Tool usage for specific purposes\n\n- **search_web**: Use for all competitor/market lookups. Use specific queries (company + topic) rather than a single broad query. Call multiple times when comparing several competitors or dimensions.",
};

export default skill;
