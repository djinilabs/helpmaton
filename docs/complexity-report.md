# Function Complexity Report

Generated: 2026-01-20T11:23:31.969Z

## Summary

- Total functions analyzed: 9441
- Functions with complexity >= 2: 2558

## Top 50 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 95 | processSlackTask | apps/backend/src/queues/bot-webhook-queue/index.ts:613 |
| 4 | 94 | convertAiSdkUIMessageToUIMessage | apps/backend/src/http/utils/messageConversion.ts:26 |
| 5 | 88 | <anonymous> | apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/index.ts:168 |
| 6 | 88 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:22 |
| 7 | 87 | expandMessagesWithToolCalls | apps/backend/src/utils/conversationLogger.ts:439 |
| 8 | 85 | buildConversationErrorInfo | apps/backend/src/utils/conversationErrorInfo.ts:632 |
| 9 | 84 | processDiscordTask | apps/backend/src/queues/bot-webhook-queue/index.ts:38 |
| 10 | 82 | query | apps/backend/src/utils/vectordb/readClient.ts:172 |
| 11 | 73 | callAgentInternal | apps/backend/src/http/utils/call-agent-internal.ts:285 |
| 12 | 73 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:171 |
| 13 | 72 | <anonymous> | apps/backend/src/http/any-api-streams-catchall/index.ts:88 |
| 14 | 70 | importWorkspace | apps/backend/src/utils/workspaceImport.ts:150 |
| 15 | 63 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/put-mcp-server.ts:98 |
| 16 | 63 | callAgentNonStreaming | apps/backend/src/http/utils/agentCallNonStreaming.ts:60 |
| 17 | 62 | <anonymous> | apps/frontend/src/components/PlanComparison.tsx:17 |
| 18 | 61 | aggregateTokenUsageForDate | apps/backend/src/scheduled/aggregate-token-usage/index.ts:20 |
| 19 | 60 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/__tests__/post-generate-prompt.test.ts:92 |
| 20 | 60 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/post-generate-prompt.ts:92 |
| 21 | 60 | extractOpenRouterGenerationId | apps/backend/src/utils/openrouterUtils.ts:7 |
| 22 | 59 | <anonymous> | apps/backend/src/http/post-api-widget-000workspaceId-000agentId-000key/index.ts:113 |
| 23 | 58 | <anonymous> | apps/frontend/src/components/ChatMessage.tsx:123 |
| 24 | 57 | injectKnowledgeIntoMessages | apps/backend/src/utils/knowledgeInjection.ts:135 |
| 25 | 54 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/post-test-agent.ts:167 |
| 26 | 52 | createMcpServerTools | apps/backend/src/http/utils/mcpUtils.ts:221 |
| 27 | 52 | buildStreamRequestContext | apps/backend/src/http/utils/streamRequestContext.ts:508 |
| 28 | 52 | <anonymous> | apps/frontend/src/pages/SubscriptionManagement.tsx:23 |
| 29 | 51 | setupAgentAndTools | apps/backend/src/http/utils/agentSetup.ts:132 |
| 30 | 50 | <anonymous> | apps/backend/src/http/any-api-mcp-oauth-000serviceType-callback/mcp-oauth-app.ts:16 |
| 31 | 49 | pipeAIStreamToResponse | apps/backend/src/http/utils/streamAIPipeline.ts:18 |
| 32 | 48 | convertRequestBodyToMessages | apps/backend/src/http/utils/streamRequestContext.ts:132 |
| 33 | 48 | jinaSearch | apps/backend/src/utils/jina.ts:324 |
| 34 | 47 | extractTokenUsage | apps/backend/src/utils/conversationLogger.ts:962 |
| 35 | 46 | handleToolContinuation | apps/backend/src/http/utils/continuation.ts:58 |
| 36 | 46 | buildConversationMessagesFromObserver | apps/backend/src/http/utils/llmObserver.ts:643 |
| 37 | 46 | generateEmbedding | apps/backend/src/utils/embedding.ts:58 |
| 38 | 46 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:239 |
| 39 | 46 | <anonymous> | apps/frontend/src/components/ConversationDetailModal.tsx:42 |
| 40 | 45 | <anonymous> | apps/backend/src/http/any-api-authorizer/index.ts:86 |
| 41 | 44 | buildAOMNode | apps/backend/src/utils/aomUtils.ts:480 |
| 42 | 44 | <anonymous> | apps/frontend/src/components/ChatMessage.tsx:672 |
| 43 | 43 | <anonymous> | apps/backend/src/tables/database.ts:91 |
| 44 | 42 | <anonymous> | apps/frontend/src/components/ConversationDetailModal.tsx:950 |
| 45 | 42 | <anonymous> | apps/frontend/src/components/NestedConversation.tsx:727 |
| 46 | 41 | execute | apps/backend/src/http/utils/agentUtils.ts:2077 |
| 47 | 41 | <anonymous> | apps/backend/src/utils/conversationLogger.ts:1514 |
| 48 | 41 | exaSearch | apps/backend/src/utils/exa.ts:143 |
| 49 | 41 | <anonymous> | apps/frontend/src/components/ChannelModal.tsx:26 |
| 50 | 40 | resolveWrapperChainMessage | apps/backend/src/utils/conversationErrorInfo.ts:250 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 50)
- `--out <path>`: output path (default docs/complexity-report.md)

