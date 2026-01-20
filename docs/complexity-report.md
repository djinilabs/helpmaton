# Function Complexity Report

Generated: 2026-01-20T10:35:03.002Z

## Summary

- Total functions analyzed: 9420
- Functions with complexity >= 2: 2542

## Top 10 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 108 | convertUIMessagesToModelMessages | apps/backend/src/http/utils/messageConversion.ts:400 |
| 4 | 102 | callAgentInternal | apps/backend/src/http/utils/agentUtils.ts:806 |
| 5 | 95 | processSlackTask | apps/backend/src/queues/bot-webhook-queue/index.ts:613 |
| 6 | 94 | convertAiSdkUIMessageToUIMessage | apps/backend/src/http/utils/messageConversion.ts:31 |
| 7 | 88 | <anonymous> | apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/index.ts:168 |
| 8 | 88 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:22 |
| 9 | 87 | expandMessagesWithToolCalls | apps/backend/src/utils/conversationLogger.ts:439 |
| 10 | 85 | buildConversationErrorInfo | apps/backend/src/utils/conversationErrorInfo.ts:632 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 50)
- `--out <path>`: output path (default docs/complexity-report.md)

