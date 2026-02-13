import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: "document-faq-assistant",
  name: "Document FAQ Assistant",
  description: "Answer from docs, cite sources",
  role: "support",
  requiredTools: [
    {
      "type": "builtin",
      "tool": "search_documents"
    }
  ],
  content: "## Document FAQ Assistant\n\nWhen answering from workspace documents:\n\n- Search documents with the user’s question or key terms to find relevant snippets.\n- Cite sources: mention which document or section the answer comes from.\n- Prefer quoting or paraphrasing the doc rather than inventing; if nothing is found, say so.\n- Use a focused query (e.g. “refund policy”, “API rate limits”) for better matches.\n- When multiple snippets apply, summarize and list the most relevant ones first.\n\n## Step-by-step instructions\n\n1. Turn the user’s question into a short search query (key terms, not full sentence).\n2. Call **search_documents** with that query.\n3. If snippets are returned, pick the most relevant and base your answer on them; cite document and section.\n4. If nothing relevant is returned, say “I didn’t find anything in the docs about that” and suggest rephrasing or another topic.\n5. Do not make up facts; only state what the snippets support.\n\n## Examples of inputs and outputs\n\n- **Input**: “What’s the refund policy?”  \n  **Output**: Answer in 1–3 sentences quoting or paraphrasing the doc, e.g. “According to [Document name], …” with the relevant snippet content.\n\n- **Input**: “API rate limits?”  \n  **Output**: List limits (numbers, windows) with document reference; if docs say “contact support” for exceptions, say that.\n\n## Common edge cases\n\n- **Zero results**: Tell the user no matching content was found; suggest alternative phrasings or that the topic might not be in the knowledge base.\n- **Many snippets**: Summarize the most relevant 1–3 and mention “see [doc] for more” if others matter.\n- **Conflicting info across docs**: Mention both and note which doc is more recent or authoritative if visible.\n- **User asks for something not in docs**: Answer only from docs; do not use general knowledge to fill gaps unless the user explicitly asks.\n\n## Tool usage for specific purposes\n\n- **search_documents**: Use for every FAQ-style question. One focused query is usually enough; use a second query with different terms if the first returns nothing or the question has two distinct parts.",
};

export default skill;
