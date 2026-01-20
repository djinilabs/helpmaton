# Function Complexity Report

Generated: 2026-01-20T13:52:50.858Z

## Summary

- Total functions analyzed: 9668
- Functions with complexity >= 2: 2716

## Top 20 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 73 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:171 |
| 4 | 62 | <anonymous> | apps/frontend/src/components/PlanComparison.tsx:17 |
| 5 | 58 | <anonymous> | apps/frontend/src/components/ChatMessage.tsx:123 |
| 6 | 52 | createMcpServerTools | apps/backend/src/http/utils/mcpUtils.ts:221 |
| 7 | 52 | buildStreamRequestContext | apps/backend/src/http/utils/streamRequestContext.ts:508 |
| 8 | 52 | <anonymous> | apps/frontend/src/pages/SubscriptionManagement.tsx:23 |
| 9 | 51 | setupAgentAndTools | apps/backend/src/http/utils/agentSetup.ts:132 |
| 10 | 50 | <anonymous> | apps/backend/src/http/any-api-mcp-oauth-000serviceType-callback/mcp-oauth-app.ts:16 |
| 11 | 49 | pipeAIStreamToResponse | apps/backend/src/http/utils/streamAIPipeline.ts:18 |
| 12 | 48 | convertRequestBodyToMessages | apps/backend/src/http/utils/streamRequestContext.ts:132 |
| 13 | 48 | jinaSearch | apps/backend/src/utils/jina.ts:324 |
| 14 | 47 | extractTokenUsage | apps/backend/src/utils/conversationLogger.ts:589 |
| 15 | 46 | handleToolContinuation | apps/backend/src/http/utils/continuation.ts:58 |
| 16 | 46 | buildConversationMessagesFromObserver | apps/backend/src/http/utils/llmObserver.ts:643 |
| 17 | 46 | generateEmbedding | apps/backend/src/utils/embedding.ts:58 |
| 18 | 46 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:53 |
| 19 | 46 | <anonymous> | apps/frontend/src/components/ConversationDetailModal.tsx:42 |
| 20 | 45 | <anonymous> | apps/backend/src/http/any-api-authorizer/index.ts:86 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 20)
- `--out <path>`: output path (default docs/complexity-report.md)

