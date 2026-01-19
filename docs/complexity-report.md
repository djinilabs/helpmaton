# Function Complexity Report

Generated: 2026-01-19T10:52:36.379Z

## Summary

- Total functions analyzed: 9184
- Functions with complexity >= 2: 2456

## Top 50 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 204 | buildConversationErrorInfo | apps/backend/src/utils/conversationLogger.ts:100 |
| 2 | 172 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/put-workspace-agent.ts:99 |
| 3 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 4 | 109 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/__tests__/put-workspace-agent.test.ts:46 |
| 5 | 108 | convertUIMessagesToModelMessages | apps/backend/src/http/utils/messageConversion.ts:400 |
| 6 | 101 | callAgentInternal | apps/backend/src/http/utils/agentUtils.ts:806 |
| 7 | 95 | processSlackTask | apps/backend/src/queues/bot-webhook-queue/index.ts:613 |
| 8 | 94 | convertAiSdkUIMessageToUIMessage | apps/backend/src/http/utils/messageConversion.ts:31 |
| 9 | 92 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:306 |
| 10 | 88 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:22 |
| 11 | 85 | <anonymous> | apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/index.ts:168 |
| 12 | 85 | expandMessagesWithToolCalls | apps/backend/src/utils/conversationLogger.ts:1240 |
| 13 | 84 | processDiscordTask | apps/backend/src/queues/bot-webhook-queue/index.ts:38 |
| 14 | 82 | query | apps/backend/src/utils/vectordb/readClient.ts:172 |
| 15 | 72 | <anonymous> | apps/backend/src/http/any-api-streams-catchall/index.ts:88 |
| 16 | 70 | importWorkspace | apps/backend/src/utils/workspaceImport.ts:150 |
| 17 | 62 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:146 |
| 18 | 62 | <anonymous> | apps/frontend/src/components/PlanComparison.tsx:17 |
| 19 | 61 | aggregateTokenUsageForDate | apps/backend/src/scheduled/aggregate-token-usage/index.ts:20 |
| 20 | 60 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/__tests__/post-generate-prompt.test.ts:92 |
| 21 | 60 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/post-generate-prompt.ts:92 |
| 22 | 60 | callAgentNonStreaming | apps/backend/src/http/utils/agentCallNonStreaming.ts:60 |
| 23 | 60 | extractOpenRouterGenerationId | apps/backend/src/utils/openrouterUtils.ts:7 |
| 24 | 59 | <anonymous> | apps/backend/src/http/post-api-widget-000workspaceId-000agentId-000key/index.ts:113 |
| 25 | 58 | <anonymous> | apps/frontend/src/components/ChatMessage.tsx:123 |
| 26 | 57 | injectKnowledgeIntoMessages | apps/backend/src/utils/knowledgeInjection.ts:135 |
| 27 | 54 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/post-test-agent.ts:167 |
| 28 | 53 | <anonymous> | apps/backend/src/http/any-api-workspaces-catchall/routes/put-mcp-server.ts:98 |
| 29 | 52 | buildStreamRequestContext | apps/backend/src/http/utils/streamRequestContext.ts:508 |
| 30 | 52 | <anonymous> | apps/frontend/src/pages/SubscriptionManagement.tsx:23 |
| 31 | 51 | setupAgentAndTools | apps/backend/src/http/utils/agentSetup.ts:132 |
| 32 | 48 | convertRequestBodyToMessages | apps/backend/src/http/utils/streamRequestContext.ts:132 |
| 33 | 48 | jinaSearch | apps/backend/src/utils/jina.ts:324 |
| 34 | 47 | extractTokenUsage | apps/backend/src/utils/conversationLogger.ts:1750 |
| 35 | 46 | handleToolContinuation | apps/backend/src/http/utils/continuation.ts:58 |
| 36 | 46 | createMcpServerTools | apps/backend/src/http/utils/mcpUtils.ts:221 |
| 37 | 46 | generateEmbedding | apps/backend/src/utils/embedding.ts:58 |
| 38 | 46 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:239 |
| 39 | 46 | <anonymous> | apps/frontend/src/components/ConversationDetailModal.tsx:42 |
| 40 | 45 | <anonymous> | apps/backend/src/http/any-api-authorizer/index.ts:86 |
| 41 | 45 | <anonymous> | apps/backend/src/http/any-api-mcp-oauth-000serviceType-callback/mcp-oauth-app.ts:16 |
| 42 | 45 | pipeAIStreamToResponse | apps/backend/src/http/utils/streamAIPipeline.ts:18 |
| 43 | 44 | buildAOMNode | apps/backend/src/utils/aomUtils.ts:480 |
| 44 | 44 | <anonymous> | apps/frontend/src/components/ChatMessage.tsx:672 |
| 45 | 43 | <anonymous> | apps/backend/src/tables/database.ts:91 |
| 46 | 42 | <anonymous> | apps/frontend/src/components/ConversationDetailModal.tsx:950 |
| 47 | 42 | <anonymous> | apps/frontend/src/components/NestedConversation.tsx:727 |
| 48 | 41 | execute | apps/backend/src/http/utils/agentUtils.ts:2160 |
| 49 | 41 | <anonymous> | apps/backend/src/utils/conversationLogger.ts:2302 |
| 50 | 41 | exaSearch | apps/backend/src/utils/exa.ts:143 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 50)
- `--out <path>`: output path (default docs/complexity-report.md)

