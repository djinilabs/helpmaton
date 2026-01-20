# Function Complexity Report

Generated: 2026-01-20T11:50:29.494Z

## Summary

- Total functions analyzed: 9458
- Functions with complexity >= 2: 2565

## Top 10 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 94 | convertAiSdkUIMessageToUIMessage | apps/backend/src/http/utils/messageConversion.ts:26 |
| 4 | 88 | <anonymous> | apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/index.ts:168 |
| 5 | 88 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:22 |
| 6 | 87 | expandMessagesWithToolCalls | apps/backend/src/utils/conversationLogger.ts:439 |
| 7 | 85 | buildConversationErrorInfo | apps/backend/src/utils/conversationErrorInfo.ts:632 |
| 8 | 84 | processDiscordTask | apps/backend/src/queues/bot-webhook-queue/index.ts:37 |
| 9 | 82 | query | apps/backend/src/utils/vectordb/readClient.ts:172 |
| 10 | 73 | callAgentInternal | apps/backend/src/http/utils/call-agent-internal.ts:285 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 50)
- `--out <path>`: output path (default docs/complexity-report.md)

