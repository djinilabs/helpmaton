# Function Complexity Report

Generated: 2026-01-20T10:56:58.292Z

## Summary

- Total functions analyzed: 9432
- Functions with complexity >= 2: 2552

## Top 10 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 102 | callAgentInternal | apps/backend/src/http/utils/agentUtils.ts:806 |
| 4 | 95 | processSlackTask | apps/backend/src/queues/bot-webhook-queue/index.ts:613 |
| 5 | 94 | convertAiSdkUIMessageToUIMessage | apps/backend/src/http/utils/messageConversion.ts:26 |
| 6 | 88 | <anonymous> | apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/index.ts:168 |
| 7 | 88 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:22 |
| 8 | 87 | expandMessagesWithToolCalls | apps/backend/src/utils/conversationLogger.ts:439 |
| 9 | 85 | buildConversationErrorInfo | apps/backend/src/utils/conversationErrorInfo.ts:632 |
| 10 | 84 | processDiscordTask | apps/backend/src/queues/bot-webhook-queue/index.ts:38 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 50)
- `--out <path>`: output path (default docs/complexity-report.md)

