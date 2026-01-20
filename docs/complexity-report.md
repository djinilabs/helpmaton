# Function Complexity Report

Generated: 2026-01-20T13:32:02.276Z

## Summary

- Total functions analyzed: 9628
- Functions with complexity >= 2: 2682

## Top 20 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 73 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:171 |
| 4 | 62 | <anonymous> | apps/frontend/src/components/PlanComparison.tsx:17 |
| 5 | 60 | extractOpenRouterGenerationId | apps/backend/src/utils/openrouterUtils.ts:7 |
| 6 | 59 | <anonymous> | apps/backend/src/http/post-api-widget-000workspaceId-000agentId-000key/index.ts:113 |
| 7 | 58 | <anonymous> | apps/frontend/src/components/ChatMessage.tsx:123 |
| 8 | 57 | injectKnowledgeIntoMessages | apps/backend/src/utils/knowledgeInjection.ts:135 |
| 9 | 54 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/post-test-agent.ts:167 |
| 10 | 52 | createMcpServerTools | apps/backend/src/http/utils/mcpUtils.ts:221 |
| 11 | 52 | buildStreamRequestContext | apps/backend/src/http/utils/streamRequestContext.ts:508 |
| 12 | 52 | <anonymous> | apps/frontend/src/pages/SubscriptionManagement.tsx:23 |
| 13 | 51 | setupAgentAndTools | apps/backend/src/http/utils/agentSetup.ts:132 |
| 14 | 50 | <anonymous> | apps/backend/src/http/any-api-mcp-oauth-000serviceType-callback/mcp-oauth-app.ts:16 |
| 15 | 49 | pipeAIStreamToResponse | apps/backend/src/http/utils/streamAIPipeline.ts:18 |
| 16 | 48 | convertRequestBodyToMessages | apps/backend/src/http/utils/streamRequestContext.ts:132 |
| 17 | 48 | jinaSearch | apps/backend/src/utils/jina.ts:324 |
| 18 | 47 | extractTokenUsage | apps/backend/src/utils/conversationLogger.ts:589 |
| 19 | 46 | handleToolContinuation | apps/backend/src/http/utils/continuation.ts:58 |
| 20 | 46 | buildConversationMessagesFromObserver | apps/backend/src/http/utils/llmObserver.ts:643 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 20)
- `--out <path>`: output path (default docs/complexity-report.md)

