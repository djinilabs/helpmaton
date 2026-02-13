import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "document-research",
  name: "Document Research",
  description: "Deep search, synthesis from knowledge base",
  role: "product",
  requiredTools: [
    {
      "type": "builtin",
      "tool": "search_documents"
    }
  ],
  content: "## Document Research\n\nWhen researching from the knowledge base:\n\n- Run search with clear, specific queries; use multiple queries if the topic is broad.\n- Synthesize findings across snippets into a concise answer or summary.\n- Indicate which documents or sections support each claim.\n- When the user asks for a list (e.g. features, steps), extract and order from the docs.\n- If the answer is uncertain or partial, say so and suggest where to look next.\n\n## Step-by-step instructions\n\n1. Identify the main topic and any sub-questions (e.g. “how to configure X” and “what are the limits”).\n2. Call **search_documents** for each distinct sub-topic with a focused query.\n3. Read all returned snippets and note document names and sections.\n4. Synthesize into one answer: list or narrative, with each claim tied to a document/section.\n5. If the user asked for a list, preserve order from the docs or state the ordering you used.\n6. If information is missing or ambiguous, say so and suggest which doc or section to check.\n\n## Examples of inputs and outputs\n\n- **Input**: “How do we set up SSO and what are the limits?”  \n  **Output**: Short “Setup” and “Limits” subsections, each with bullets and document citations from search_documents results.\n\n- **Input**: “List all API endpoints for billing.”  \n  **Output**: Numbered or bullet list taken from docs, with document/section references.\n\n## Common edge cases\n\n- **Broad question**: Split into 2–3 queries (e.g. “SSO setup”, “SSO limits”, “SSO troubleshooting”) and combine answers.\n- **No results for one sub-question**: Answer the parts you found; for the missing part say “I didn’t find this in the knowledge base.”\n- **Duplicate or overlapping snippets**: Deduplicate and cite the single best source per point.\n- **User asks “everything about X”**: Give a structured summary (overview, steps, limits, caveats) and cite docs; offer to go deeper on one part.\n\n## Tool usage for specific purposes\n\n- **search_documents**: Use for every research question. Use one query per distinct sub-topic; avoid one very long query. Use it to pull lists (features, steps, endpoints) directly from the text.",
};

export default skill;
