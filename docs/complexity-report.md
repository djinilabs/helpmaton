# Function Complexity Report

Generated: 2026-01-20T14:56:29.137Z

## Summary

- Total functions analyzed: 9465
- Functions with complexity >= 2: 2632

## Top 20 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 52 | <anonymous> | apps/backend/src/http/any-api-mcp-oauth-000serviceType-callback/mcp-oauth-app.ts:16 |
| 2 | 49 | pipeAIStreamToResponse | apps/backend/src/http/utils/streamAIPipeline.ts:18 |
| 3 | 48 | convertRequestBodyToMessages | apps/backend/src/http/utils/streamRequestContext.ts:132 |
| 4 | 48 | jinaSearch | apps/backend/src/utils/jina.ts:324 |
| 5 | 47 | extractTokenUsage | apps/backend/src/utils/conversationLogger.ts:589 |
| 6 | 46 | handleToolContinuation | apps/backend/src/http/utils/continuation.ts:58 |
| 7 | 46 | buildConversationMessagesFromObserver | apps/backend/src/http/utils/llmObserver.ts:643 |
| 8 | 46 | generateEmbedding | apps/backend/src/utils/embedding.ts:58 |
| 9 | 46 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:53 |
| 10 | 46 | <anonymous> | apps/frontend/src/components/ConversationDetailModal.tsx:42 |
| 11 | 45 | <anonymous> | apps/backend/src/http/any-api-authorizer/index.ts:86 |
| 12 | 44 | extractToolingFromResult | apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/webhookHandler.ts:160 |
| 13 | 44 | buildAOMNode | apps/backend/src/utils/aomUtils.ts:480 |
| 14 | 44 | <anonymous> | apps/frontend/src/components/ChatMessage.tsx:673 |
| 15 | 43 | <anonymous> | apps/backend/src/tables/database.ts:91 |
| 16 | 42 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/post-mcp-server.ts:111 |
| 17 | 42 | <anonymous> | apps/frontend/src/components/ConversationDetailModal.tsx:950 |
| 18 | 42 | <anonymous> | apps/frontend/src/components/NestedConversation.tsx:727 |
| 19 | 41 | execute | apps/backend/src/http/utils/agentUtils.ts:1244 |
| 20 | 41 | extractSlackToolingFromResult | apps/backend/src/queues/bot-webhook-queue/slackTask.ts:410 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 20)
- `--out <path>`: output path (default docs/complexity-report.md)

