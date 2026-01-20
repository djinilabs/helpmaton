# Function Complexity Report

Generated: 2026-01-20T12:02:01.728Z

## Summary

- Total functions analyzed: 9469
- Functions with complexity >= 2: 2575

## Top 10 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 88 | <anonymous> | apps/backend/src/http/post-api-webhook-000workspaceId-000agentId-000key/index.ts:168 |
| 4 | 88 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:22 |
| 5 | 87 | expandMessagesWithToolCalls | apps/backend/src/utils/conversationLogger.ts:439 |
| 6 | 85 | buildConversationErrorInfo | apps/backend/src/utils/conversationErrorInfo.ts:632 |
| 7 | 84 | processDiscordTask | apps/backend/src/queues/bot-webhook-queue/index.ts:37 |
| 8 | 82 | query | apps/backend/src/utils/vectordb/readClient.ts:172 |
| 9 | 73 | callAgentInternal | apps/backend/src/http/utils/call-agent-internal.ts:285 |
| 10 | 73 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:171 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 50)
- `--out <path>`: output path (default docs/complexity-report.md)

