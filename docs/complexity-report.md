# Function Complexity Report

Generated: 2026-01-20T14:15:03.545Z

## Summary

- Total functions analyzed: 9710
- Functions with complexity >= 2: 2741

## Top 20 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 73 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:171 |
| 4 | 62 | <anonymous> | apps/frontend/src/components/PlanComparison.tsx:17 |
| 5 | 58 | <anonymous> | apps/frontend/src/components/ChatMessage.tsx:123 |
| 6 | 52 | <anonymous> | apps/frontend/src/pages/SubscriptionManagement.tsx:23 |
| 7 | 50 | <anonymous> | apps/backend/src/http/any-api-mcp-oauth-000serviceType-callback/mcp-oauth-app.ts:16 |
| 8 | 49 | pipeAIStreamToResponse | apps/backend/src/http/utils/streamAIPipeline.ts:18 |
| 9 | 48 | convertRequestBodyToMessages | apps/backend/src/http/utils/streamRequestContext.ts:132 |
| 10 | 48 | jinaSearch | apps/backend/src/utils/jina.ts:324 |
| 11 | 47 | extractTokenUsage | apps/backend/src/utils/conversationLogger.ts:589 |
| 12 | 46 | handleToolContinuation | apps/backend/src/http/utils/continuation.ts:58 |
| 13 | 46 | buildConversationMessagesFromObserver | apps/backend/src/http/utils/llmObserver.ts:643 |
| 14 | 46 | generateEmbedding | apps/backend/src/utils/embedding.ts:58 |
| 15 | 46 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:53 |
| 16 | 46 | <anonymous> | apps/frontend/src/components/ConversationDetailModal.tsx:42 |
| 17 | 45 | <anonymous> | apps/backend/src/http/any-api-authorizer/index.ts:86 |
| 18 | 44 | extractToolingFromResult | apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/webhookHandler.ts:160 |
| 19 | 44 | buildAOMNode | apps/backend/src/utils/aomUtils.ts:480 |
| 20 | 44 | <anonymous> | apps/frontend/src/components/ChatMessage.tsx:672 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 20)
- `--out <path>`: output path (default docs/complexity-report.md)

