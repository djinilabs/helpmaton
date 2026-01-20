# Function Complexity Report

Generated: 2026-01-20T12:11:43.614Z

## Summary

- Total functions analyzed: 9473
- Functions with complexity >= 2: 2578

## Top 10 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 88 | <anonymous> | apps/backend/src/utils/handlingErrors.ts:22 |
| 4 | 87 | expandMessagesWithToolCalls | apps/backend/src/utils/conversationLogger.ts:439 |
| 5 | 85 | buildConversationErrorInfo | apps/backend/src/utils/conversationErrorInfo.ts:632 |
| 6 | 84 | processDiscordTask | apps/backend/src/queues/bot-webhook-queue/index.ts:37 |
| 7 | 82 | query | apps/backend/src/utils/vectordb/readClient.ts:172 |
| 8 | 73 | callAgentInternal | apps/backend/src/http/utils/call-agent-internal.ts:285 |
| 9 | 73 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:171 |
| 10 | 72 | <anonymous> | apps/backend/src/http/any-api-streams-catchall/index.ts:88 |

## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 50)
- `--out <path>`: output path (default docs/complexity-report.md)

