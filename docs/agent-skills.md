# Agent Skills

Agent skills are optional instruction blocks that are appended to an agent’s system prompt. Each skill is tied to specific **tools** (MCP servers or built-in tools). A skill can only be enabled when **all** of its required tools are enabled for the agent.

## Skill content structure

Each skill’s markdown content (below the frontmatter) **must** include the following sections so the agent can use the skill reliably:

- **Step-by-step instructions**: Clear, ordered steps for using the skill (including when and how to call tools).
- **Examples of inputs and outputs**: Sample user requests and expected agent behavior or response shape (including example tool calls and results where relevant).
- **Common edge cases**: What to do when data is missing, results are empty, the user is vague, or errors occur (e.g. rate limits, timeouts).
- **Tool usage**: How to use each available tool for specific purposes (e.g. “use search_documents for FAQ-style questions”, “use PostHog events for funnel steps”).

These sections should reference the actual tools the skill requires (built-in or MCP) and give concrete guidance so the model can follow the skill consistently.

## Overview

- **Location**: Agent detail page → **External tools** → **Skills**.
- **Behavior**: Enabled skills’ content is merged with the agent’s base system prompt in a dedicated “Enabled Skills” section. The order of enabled skills is preserved.
- **Tool requirements**: Every skill declares `requiredTools`. The skill is only available when every required tool is satisfied (e.g. MCP server enabled and, for OAuth servers, connected).
- **Validation**: On agent update, any `enabledSkillIds` that are unknown or whose tool requirements are not met are stripped before saving.

## Tool requirements

### MCP services

- **Type**: `mcpService` with `serviceType` (e.g. `posthog`, `notion`, `linear`).
- **Rule**: The agent must have at least one enabled MCP server with that `serviceType`.
- **OAuth**: For OAuth-based MCP servers (Notion, Linear, HubSpot, Zendesk, Slack, etc.), the server must be **connected** (tokens present). Disconnected OAuth servers do not satisfy the requirement.

### Built-in tools

| Built-in ID           | Agent condition |
|-----------------------|------------------|
| `search_documents`   | Document search enabled |
| `search_memory`      | Memory search enabled |
| `search_web`         | Web search provider set (Tavily or Jina) |
| `fetch_web`          | Web fetch provider set (Tavily, Jina, or scrape) |
| `exa_search`         | Exa search enabled |
| `send_email`         | Send email enabled **and** workspace has email connection |
| `image_generation`   | Image generation enabled |

**Note:** The built-in ID (e.g. `image_generation`) may differ from the actual tool name exposed to the model (e.g. `generate_image`). Skills reference the built-in ID in `requiredTools`; skill content can mention the actual tool name for clarity.

## Skill catalog (by tool)

Skills are grouped by role in the UI (marketing, product, support, sales, engineering, other). Below is a summary by required tool.

- **PostHog** (`mcpService: posthog`): Marketing analytics, product analytics, feature flags, events debugging.
- **Notion** (`mcpService: notion`): Knowledge base, project tracking.
- **Linear** (`mcpService: linear`): Issue management, sprint planning.
- **HubSpot** (`mcpService: hubspot`): Sales CRM, marketing contacts.
- **Zendesk** (`mcpService: zendesk`): Support tickets, customer context.
- **Slack** (`mcpService: slack`): Channel engagement, internal comms.
- **Intercom** (`mcpService: intercom`): Customer conversations.
- **GitHub** (`mcpService: github`): Issue and PR workflow.
- **Stripe** (`mcpService: stripe`): Billing overview.
- **Shopify** (`mcpService: shopify`): E-commerce ops.
- **Salesforce** (`mcpService: salesforce`): CRM query.
- **Todoist** (`mcpService: todoist`): Task management.
- **Document search** (`search_documents`): Document FAQ assistant, document research.
- **Web search** (`search_web`): Web research assistant, competitive intelligence.
- **Web fetch** (`fetch_web`): Web content fetch.
- **Exa search** (`exa_search`): Exa semantic research.
- **Email** (`send_email`): Email follow-up, email support reply.
- **Memory search** (`search_memory`): Memory context recall.
- **Image generation** (`image_generation`): Image generation assistant.

## API

- **GET** `/api/workspaces/:workspaceId/agents/:agentId/available-skills`  
  Returns `{ skills, groupedByRole }` for the agent. Only skills whose required tools are all satisfied are included.

- **PUT** `/api/workspaces/:workspaceId/agents/:agentId`  
  Accepts `enabledSkillIds` in the body. Invalid or ineligible IDs are stripped; the cleaned list is persisted.

## Workspace export/import

- **Export**: Agent `enabledSkillIds` are included in the workspace export.
- **Import**: On import, skill IDs whose required tools are not satisfied in the target workspace are stripped.
