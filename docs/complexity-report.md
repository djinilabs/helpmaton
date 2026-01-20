# Function Complexity Report

Generated: 2026-01-20T13:00:27.264Z

## Summary

- Total functions analyzed: 9574
- Functions with complexity >= 2: 2643

## Top 20 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 73 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:171 |
| 4 | 63 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/put-mcp-server.ts:98 |
| 5 | 63 | callAgentNonStreaming | apps/backend/src/http/utils/agentCallNonStreaming.ts:60 |
| 6 | 62 | <anonymous> | apps/frontend/src/components/PlanComparison.tsx:17 |
| 7 | 61 | aggregateTokenUsageForDate | apps/backend/src/scheduled/aggregate-token-usage/index.ts:20 |
| 8 | 60 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/__tests__/post-generate-prompt.test.ts:92 |
| 9 | 60 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/post-generate-prompt.ts:92 |
| 10 | 60 | extractOpenRouterGenerationId | apps/backend/src/utils/openrouterUtils.ts:7 |
| 11 | 59 | <anonymous> | apps/backend/src/http/post-api-widget-000workspaceId-000agentId-000key/index.ts:113 |
| 12 | 58 | <anonymous> | apps/frontend/src/components/ChatMessage.tsx:123 |
| 13 | 57 | injectKnowledgeIntoMessages | apps/backend/src/utils/knowledgeInjection.ts:135 |
| 14 | 54 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/post-test-agent.ts:167 |
| 15 | 52 | createMcpServerTools | apps/backend/src/http/utils/mcpUtils.ts:221 |
| 16 | 52 | buildStreamRequestContext | apps/backend/src/http/utils/streamRequestContext.ts:508 |
| 17 | 52 | <anonymous> | apps/frontend/src/pages/SubscriptionManagement.tsx:23 |
| 18 | 51 | setupAgentAndTools | apps/backend/src/http/utils/agentSetup.ts:132 |
| 19 | 50 | <anonymous> | apps/backend/src/http/any-api-mcp-oauth-000serviceType-callback/mcp-oauth-app.ts:16 |
| 20 | 49 | pipeAIStreamToResponse | apps/backend/src/http/utils/streamAIPipeline.ts:18 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 20)
- `--out <path>`: output path (default docs/complexity-report.md)

