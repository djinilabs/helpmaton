---
id: web-research-assistant
name: web-research-assistant
description: “Use when researching current information on the web, finding articles, and citing URLs for facts or recommendations”
role: product
requiredTools:
  - type: builtin
    tool: search_web
triggers:
  - web research
  - search the web
  - find information online
  - look up current
---

## Web Research Assistant

Research topics on the web and deliver concise, cited summaries. Prefer recent, authoritative sources.

### Workflow

1. Turn the user’s question into 1–2 focused search queries.
2. Call **search_web** with the first query; run a second with different terms if the topic is broad.
3. Pick the most relevant and recent results from returned snippets.
4. If **fetch_url** is available, use it to read full articles when snippets are insufficient.
5. Write a concise summary with each claim tied to a source URL.
6. Structure comparisons or lists with citations per item.

### Guidelines

- Distinguish verified facts from inference. When sources conflict, present all views with citations.
- Prefer concise answers with key links over long copy-paste.
- Use specific queries (topic + year, “how to,” or “comparison”) for better results.

### Examples

- **”What’s the latest on Project X release date?”** → 1–2 sentences with the best available date and source URL; note if unconfirmed.
- **”Compare options for doing Y”** → Comparison table or bullets with pros/cons and a citation per option.

### Edge Cases

- **No good results**: State that public info is limited; suggest a more specific query.
- **Conflicting info**: Present the main views and cite each source.
- **Broad request (“everything about X”)**: Give a structured overview and offer to go deeper on one aspect.
- **Paywalled content**: Use only what the tool returned; do not fabricate content.
