# Function Complexity Report

Generated: 2026-01-20T12:16:39.178Z

## Summary

- Total functions analyzed: 9489
- Functions with complexity >= 2: 2586

## Top 50 most complex functions

| Rank | Complexity | Function | Location |
| --- | --- | --- | --- |
| 1 | 170 | <anonymous> | apps/frontend/src/pages/AgentDetail.tsx:344 |
| 2 | 127 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:369 |
| 3 | 87 | expandMessagesWithToolCalls | apps/backend/src/utils/conversationLogger.ts:439 |
| 4 | 85 | buildConversationErrorInfo | apps/backend/src/utils/conversationErrorInfo.ts:632 |
| 5 | 84 | processDiscordTask | apps/backend/src/queues/bot-webhook-queue/index.ts:37 |
| 6 | 82 | query | apps/backend/src/utils/vectordb/readClient.ts:172 |
| 7 | 73 | callAgentInternal | apps/backend/src/http/utils/call-agent-internal.ts:285 |
| 8 | 73 | <anonymous> | apps/frontend/src/components/McpServerModal.tsx:171 |
| 9 | 72 | <anonymous> | apps/backend/src/http/any-api-streams-catchall/index.ts:88 |
| 10 | 70 | importWorkspace | apps/backend/src/utils/workspaceImport.ts:150 |


## How to run

`pnpm complexity:report`

Options:
- `--top <number>`: limit list size (default 50)
- `--out <path>`: output path (default docs/complexity-report.md)

