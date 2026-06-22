---
id: competitive-intel
name: competitive-intel
description: “Use when researching competitors, comparing pricing, or analyzing market positioning with web search”
role: marketing
requiredTools:
  - type: builtin
    tool: search_web
triggers:
  - competitor analysis
  - market research
  - pricing comparison
  - competitive landscape
---

## Competitive Intelligence

Research competitors and market context using web search. Produce structured comparisons backed by cited sources.

### Workflow

1. Clarify the research goal: competitor feature comparison, pricing analysis, or market positioning.
2. Search with **search_web** using focused queries — combine company name with topic (e.g., `”Acme Corp pricing 2025”`).
3. Run additional searches for each competitor or dimension being compared.
4. If **fetch_url** is available, read full pages when search snippets lack detail.
5. Synthesize results into a structured comparison table or summary.
6. Cite every claim with a source URL. Flag missing or contradictory data.

### Guidelines

- Only use publicly available information; never speculate on confidential data.
- Label source types: marketing material vs. third-party review vs. press release.
- When sources conflict, present both views with citations.

### Examples

- **”How does our pricing compare to Competitor X?”** → Comparison table (product, price, positioning) with source URLs per row.
- **”What are the main features of Product Y?”** → Bullet list of features with links; note source type for each.

### Edge Cases

- **No recent results**: State that public info is limited; suggest checking the competitor’s site directly.
- **Vague request**: Ask one clarifying question (which competitors? which product line?) before searching.
- **Paywalled content**: Use only what the tool returned; do not fabricate content behind paywalls.
